from __future__ import annotations

import json
import os
from email.parser import BytesParser
from email.policy import default
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from typing import Optional, Tuple
from urllib.parse import unquote

from PIL import Image, ImageFilter, ImageSequence

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_DIR = os.path.join(BASE_DIR, "templates")
STATIC_DIR = os.path.join(BASE_DIR, "static")
MAX_CONTENT_LENGTH = 30 * 1024 * 1024  # 30MB


def _parse_int(value: Optional[str]) -> Optional[int]:
    if value is None:
        return None
    value = value.strip()
    if value == "":
        return None
    try:
        return int(float(value))
    except ValueError:
        return None


def _parse_float(value: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    value = value.strip()
    if value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _parse_bool(value: Optional[str]) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "on", "yes"}


def _clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def _compute_target_size(
    orig_w: int,
    orig_h: int,
    target_w: Optional[int],
    target_h: Optional[int],
    keep_aspect: bool,
) -> Tuple[int, int]:
    if target_w and target_h:
        return max(1, target_w), max(1, target_h)
    if keep_aspect and (target_w or target_h):
        if target_w:
            ratio = target_w / orig_w
            return max(1, target_w), max(1, int(round(orig_h * ratio)))
        if target_h:
            ratio = target_h / orig_h
            return max(1, int(round(orig_w * ratio))), max(1, target_h)
    if target_w or target_h:
        return max(1, target_w or orig_w), max(1, target_h or orig_h)
    return orig_w, orig_h


def _trim_frames(
    frames: list[Image.Image],
    durations: list[int],
    start_s: float,
    end_s: Optional[float],
) -> Tuple[list[Image.Image], list[int]]:
    if start_s <= 0 and end_s is None:
        return frames, durations

    total_ms = sum(durations)
    start_ms = max(0.0, start_s * 1000.0)
    end_ms = total_ms if end_s is None else max(0.0, end_s * 1000.0)

    if end_ms <= start_ms:
        return [], []

    trimmed_frames: list[Image.Image] = []
    trimmed_durations: list[int] = []

    cursor = 0.0
    for frame, duration in zip(frames, durations):
        frame_start = cursor
        frame_end = cursor + duration
        cursor = frame_end

        if frame_end <= start_ms:
            continue
        if frame_start >= end_ms:
            break

        overlap_start = max(frame_start, start_ms)
        overlap_end = min(frame_end, end_ms)
        overlap_ms = max(1, int(round(overlap_end - overlap_start)))

        trimmed_frames.append(frame)
        trimmed_durations.append(overlap_ms)

    return trimmed_frames, trimmed_durations


def _resample_frames(
    frames: list[Image.Image],
    durations: list[int],
    fps: float,
) -> Tuple[list[Image.Image], list[int]]:
    if fps <= 0 or not frames:
        return frames, durations

    total_ms = sum(durations)
    if total_ms <= 0:
        total_ms = len(frames) * 100

    target_count = max(1, int(round((total_ms / 1000.0) * fps)))
    if target_count >= len(frames):
        duration_ms = max(1, int(round(1000.0 / fps)))
        return frames, [duration_ms] * len(frames)

    cumulative: list[int] = []
    running = 0
    for duration in durations:
        running += max(1, int(duration))
        cumulative.append(running)

    step = total_ms / target_count
    sampled_frames: list[Image.Image] = []
    idx = 0
    for i in range(target_count):
        target = (i + 0.5) * step
        while idx < len(cumulative) - 1 and target > cumulative[idx]:
            idx += 1
        sampled_frames.append(frames[idx])

    duration_ms = max(1, int(round(1000.0 / fps)))
    return sampled_frames, [duration_ms] * len(sampled_frames)


def _estimate_fps(durations: list[int]) -> float:
    if not durations:
        return 0.0
    avg = sum(durations) / max(1, len(durations))
    if avg <= 0:
        return 0.0
    return 1000.0 / avg


def _quantize_frames(frames: list[Image.Image], max_colors: int) -> list[Image.Image]:
    if max_colors < 2:
        return frames
    colors = min(max_colors, 256)
    quantized_frames: list[Image.Image] = []
    for frame in frames:
        rgba = frame.convert("RGBA")
        quantized = rgba.quantize(
            colors=colors,
            method=Image.Quantize.FASTOCTREE,
            dither=Image.Dither.NONE,
        )
        quantized_frames.append(quantized)
    return quantized_frames


def _encode_gif(
    frames: list[Image.Image],
    durations: list[int],
    optimize_output: bool,
    max_colors: int,
) -> bytes:
    if not frames:
        return b""
    frames_to_save = _quantize_frames(frames, max_colors)
    output = BytesIO()
    frames_to_save[0].save(
        output,
        format="GIF",
        save_all=True,
        append_images=frames_to_save[1:],
        loop=0,
        duration=durations,
        disposal=2,
        optimize=optimize_output,
    )
    return output.getvalue()


def _auto_reduce_to_size(
    frames: list[Image.Image],
    durations: list[int],
    target_bytes: int,
    base_fps: float,
    max_colors: int,
    optimize_output: bool,
    allow_frame_drop: bool,
) -> bytes:
    if not frames or target_bytes <= 0:
        return b""

    colors_steps: list[int] = []
    if max_colors >= 2:
        colors_steps.append(max_colors)
        for colors in [128, 64, 32, 16]:
            if colors < max_colors:
                colors_steps.append(colors)
    else:
        colors_steps = [0, 256, 128, 64, 32, 16]

    fps_steps: list[int] = []
    if allow_frame_drop:
        start_fps = base_fps if base_fps > 0 else 12.0
        for factor in [1.0, 0.85, 0.7, 0.55, 0.4]:
            fps_steps.append(max(4, min(60, int(round(start_fps * factor)))))
    else:
        fps_steps = [0]

    seen_fps: set[int] = set()
    uniq_fps_steps: list[int] = []
    for fps_step in fps_steps:
        if fps_step not in seen_fps:
            uniq_fps_steps.append(fps_step)
            seen_fps.add(fps_step)

    best_data = b""
    best_size = None

    for fps_step in uniq_fps_steps:
        if fps_step > 0:
            candidate_frames, candidate_durations = _resample_frames(frames, durations, fps_step)
        else:
            candidate_frames, candidate_durations = frames, durations

        for colors in colors_steps:
            data = _encode_gif(candidate_frames, candidate_durations, optimize_output, colors)
            if not data:
                continue
            size = len(data)
            if size <= target_bytes:
                return data
            if best_size is None or size < best_size:
                best_size = size
                best_data = data

    return best_data


def _parse_multipart(body: bytes, content_type: str) -> Tuple[dict, dict]:
    headers = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode()
    message = BytesParser(policy=default).parsebytes(headers + body)

    if not message.is_multipart():
        return {}, {}

    fields = {}
    files = {}

    for part in message.iter_parts():
        if part.get_content_disposition() != "form-data":
            continue
        name = part.get_param("name", header="content-disposition")
        if not name:
            continue
        filename = part.get_filename()
        payload = part.get_payload(decode=True) or b""
        if filename:
            files[name] = {
                "filename": filename,
                "data": payload,
                "content_type": part.get_content_type(),
            }
        else:
            charset = part.get_content_charset() or "utf-8"
            fields[name] = payload.decode(charset, errors="replace")

    return fields, files


class GifEditorHandler(BaseHTTPRequestHandler):
    server_version = "Zigma/1.0"

    def _send_json(self, status: int, payload: dict) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_file(self, path: str, content_type: str) -> None:
        try:
            with open(path, "rb") as handle:
                data = handle.read()
        except FileNotFoundError:
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _content_type_for(self, path: str) -> str:
        if path.endswith(".css"):
            return "text/css"
        if path.endswith(".js"):
            return "application/javascript"
        if path.endswith(".png"):
            return "image/png"
        if path.endswith(".svg"):
            return "image/svg+xml"
        return "application/octet-stream"

    def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        if self.path == "/":
            index_path = os.path.join(TEMPLATE_DIR, "index.html")
            self._send_file(index_path, "text/html; charset=utf-8")
            return

        if self.path.startswith("/static/"):
            rel_path = unquote(self.path[len("/static/") :])
            safe_path = os.path.normpath(rel_path)
            if safe_path.startswith(".."):
                self.send_error(HTTPStatus.BAD_REQUEST, "Invalid path")
                return
            file_path = os.path.join(STATIC_DIR, safe_path)
            self._send_file(file_path, self._content_type_for(file_path))
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_HEAD(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        if self.path == "/":
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            return

        if self.path.startswith("/static/"):
            rel_path = unquote(self.path[len("/static/") :])
            safe_path = os.path.normpath(rel_path)
            if safe_path.startswith(".."):
                self.send_error(HTTPStatus.BAD_REQUEST, "Invalid path")
                return
            file_path = os.path.join(STATIC_DIR, safe_path)
            if not os.path.exists(file_path):
                self.send_error(HTTPStatus.NOT_FOUND, "File not found")
                return
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", self._content_type_for(file_path))
            self.end_headers()
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_POST(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        if self.path != "/process":
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > MAX_CONTENT_LENGTH:
                self._send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "File too large."})
                return

            content_type = self.headers.get("Content-Type", "")
            if "multipart/form-data" not in content_type:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid form data."})
                return

            body = self.rfile.read(length)
            fields, files = _parse_multipart(body, content_type)
        except Exception as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": f"Could not read form data: {exc}"})
            return

        file_info = files.get("gif")
        if not file_info:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "No GIF file provided."})
            return

        if not file_info.get("data") or not file_info.get("filename"):
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "No GIF file selected."})
            return

        try:
            image = Image.open(BytesIO(file_info["data"]))
            if image.format != "GIF":
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Only GIF files are supported."})
                return

            target_w = _parse_int(fields.get("target_width"))
            target_h = _parse_int(fields.get("target_height"))
            keep_aspect = fields.get("keep_aspect") == "on"
            fps = _parse_float(fields.get("fps"))
            resample_fps = _parse_bool(fields.get("resample_fps"))

            trim_start = _parse_float(fields.get("trim_start")) or 0.0
            trim_end = _parse_float(fields.get("trim_end"))

            max_colors = _parse_int(fields.get("max_colors")) or 0
            optimize_output = _parse_bool(fields.get("optimize"))
            target_size_kb = _parse_float(fields.get("target_size_kb")) or 0.0
            auto_reduce = _parse_bool(fields.get("auto_reduce"))

            blur_x = _parse_int(fields.get("blur_x")) or 0
            blur_y = _parse_int(fields.get("blur_y")) or 0
            blur_w = _parse_int(fields.get("blur_w")) or 0
            blur_h = _parse_int(fields.get("blur_h")) or 0
            blur_radius = _parse_float(fields.get("blur_radius")) or 0.0

            orig_w, orig_h = image.size
            out_w, out_h = _compute_target_size(orig_w, orig_h, target_w, target_h, keep_aspect)

            frames = []
            durations = []

            for frame in ImageSequence.Iterator(image):
                duration = frame.info.get("duration", image.info.get("duration", 100))
                current = frame.convert("RGBA")

                if blur_w > 0 and blur_h > 0 and blur_radius > 0:
                    x0 = _clamp(blur_x, 0, orig_w - 1)
                    y0 = _clamp(blur_y, 0, orig_h - 1)
                    x1 = _clamp(blur_x + blur_w, 0, orig_w)
                    y1 = _clamp(blur_y + blur_h, 0, orig_h)
                    if x1 > x0 and y1 > y0:
                        region = current.crop((x0, y0, x1, y1))
                        region = region.filter(ImageFilter.GaussianBlur(radius=blur_radius))
                        current.paste(region, (x0, y0), region)

                if (out_w, out_h) != (orig_w, orig_h):
                    current = current.resize((out_w, out_h), Image.LANCZOS)

                frames.append(current)
                durations.append(int(duration) if duration else 100)

            frames, durations = _trim_frames(frames, durations, trim_start, trim_end)
            if not frames:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Trim range removed all frames."})
                return

            if fps and fps > 0:
                if resample_fps:
                    frames, durations = _resample_frames(frames, durations, fps)
                else:
                    duration_ms = max(1, int(round(1000 / fps)))
                    durations = [duration_ms] * len(frames)

            base_name = os.path.splitext(file_info["filename"])[0] or "edited"
            target_bytes = int(target_size_kb * 1024) if target_size_kb > 0 else 0
            if target_bytes > 0 and auto_reduce:
                optimize_output = True
                base_fps = fps if fps and fps > 0 else _estimate_fps(durations)
                data = _auto_reduce_to_size(
                    frames=frames,
                    durations=durations,
                    target_bytes=target_bytes,
                    base_fps=base_fps,
                    max_colors=max_colors,
                    optimize_output=optimize_output,
                    allow_frame_drop=True,
                )
            else:
                if max_colors > 256:
                    max_colors = 256
                data = _encode_gif(
                    frames=frames,
                    durations=durations,
                    optimize_output=optimize_output,
                    max_colors=max_colors,
                )

            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "image/gif")
            self.send_header(
                "Content-Disposition",
                f'attachment; filename="{base_name}_edited.gif"',
            )
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"Processing failed: {exc}"})


def _load_port(default_port: int) -> int:
    raw = os.environ.get("PORT", "").strip()
    if raw:
        try:
            return int(raw)
        except ValueError:
            return default_port
    return default_port


def run(host: str | None = None, port: int | None = None) -> None:
    resolved_host = host or os.environ.get("HOST", "0.0.0.0")
    resolved_port = port or _load_port(5000)
    server = ThreadingHTTPServer((resolved_host, resolved_port), GifEditorHandler)
    print(f"Zigma running at http://{resolved_host}:{resolved_port}")
    server.serve_forever()


if __name__ == "__main__":
    run()
