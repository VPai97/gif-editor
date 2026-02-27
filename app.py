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

    def do_POST(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        if self.path != "/process":
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return

        length = int(self.headers.get("Content-Length", "0"))
        if length > MAX_CONTENT_LENGTH:
            self._send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "File too large."})
            return

        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid form data."})
            return

        try:
            body = self.rfile.read(length)
            fields, files = _parse_multipart(body, content_type)
        except Exception:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Could not read form data."})
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
        except Exception:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Could not read the GIF file."})
            return

        if image.format != "GIF":
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Only GIF files are supported."})
            return

        target_w = _parse_int(fields.get("target_width"))
        target_h = _parse_int(fields.get("target_height"))
        keep_aspect = fields.get("keep_aspect") == "on"
        fps = _parse_float(fields.get("fps"))

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
            durations.append(duration)

        if fps and fps > 0:
            duration_ms = max(1, int(round(1000 / fps)))
            durations = [duration_ms] * len(frames)

        output = BytesIO()
        base_name = os.path.splitext(file_info["filename"])[0] or "edited"

        frames[0].save(
            output,
            format="GIF",
            save_all=True,
            append_images=frames[1:],
            loop=0,
            duration=durations,
            disposal=2,
        )
        output.seek(0)

        data = output.getvalue()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "image/gif")
        self.send_header(
            "Content-Disposition",
            f'attachment; filename="{base_name}_edited.gif"',
        )
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


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
