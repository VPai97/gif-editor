import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "tests" / "assets"
GIF_PATH = ASSETS / "sample.gif"
VIDEO_PATH = ASSETS / "sample.mp4"
DOWNLOAD_DIR = ROOT / "tests" / "downloads"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
DEBUG_DIR = ROOT / "tests" / "debug"
DEBUG_DIR.mkdir(parents=True, exist_ok=True)


def _log(message: str) -> None:
    print(message, flush=True)


def _draw_selection(page):
    overlay = page.locator("#overlay")
    box = None
    for _ in range(30):
        box = overlay.bounding_box()
        if box and box["width"] > 10 and box["height"] > 10:
            break
        page.wait_for_timeout(200)
    if not box or box["width"] <= 10 or box["height"] <= 10:
        raise RuntimeError("Overlay not ready for selection")
    start_x = box["x"] + box["width"] * 0.25
    start_y = box["y"] + box["height"] * 0.25
    end_x = box["x"] + box["width"] * 0.6
    end_y = box["y"] + box["height"] * 0.6
    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.mouse.move(end_x, end_y)
    page.mouse.up()

    selection_value = page.evaluate(
        "() => document.getElementById('overlay')?.dataset?.selection || ''"
    )
    if selection_value:
        return

    page.dispatch_event(
        "#overlay",
        "mousedown",
        {"clientX": start_x, "clientY": start_y, "buttons": 1},
    )
    page.dispatch_event(
        "#overlay",
        "mousemove",
        {"clientX": end_x, "clientY": end_y, "buttons": 1},
    )
    page.dispatch_event("#overlay", "mouseup", {"clientX": end_x, "clientY": end_y})

    selection_value = page.evaluate(
        "() => document.getElementById('overlay')?.dataset?.selection || ''"
    )
    if not selection_value:
        raise RuntimeError("Selection did not register on overlay")


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()
        page.set_default_timeout(180000)

        page.on("console", lambda msg: _log(f"[console:{msg.type}] {msg.text}"))
        page.on("pageerror", lambda exc: _log(f"[pageerror] {exc}"))
        page.on(
            "requestfailed",
            lambda req: _log(f"[requestfailed] {req.url} {req.failure}"),
        )

        _log("Opening Zigma...")
        page.goto("http://127.0.0.1:5002", wait_until="domcontentloaded")
        page.wait_for_selector("#gifInput", state="attached")

        # Test GIF upload + blur/box
        _log("Uploading sample GIF...")
        page.set_input_files("#gifInput", str(GIF_PATH))
        page.wait_for_selector("#preview:not(.hidden)")
        page.wait_for_function(
            "() => { const img = document.getElementById('preview'); return img && img.naturalWidth > 0; }"
        )
        page.wait_for_function(
            "() => { const el = document.getElementById('origSize'); return el && el.textContent.trim() !== '—'; }"
        )

        _log("Selecting blur + highlight region...")
        page.check("#blurEnable")
        page.check("#boxEnable")
        overlay_state = page.evaluate(
            "() => { const overlay = document.getElementById('overlay'); const rect = overlay.getBoundingClientRect(); return { pe: getComputedStyle(overlay).pointerEvents, opacity: getComputedStyle(overlay).opacity, w: rect.width, h: rect.height, sizeText: document.getElementById('origSize')?.textContent }; }"
        )
        _log(f"Overlay state: {overlay_state}")
        _draw_selection(page)

        _log("Exporting GIF...")
        try:
            page.click("#processBtn")
            page.wait_for_selector("#downloadLink:not(.hidden)", timeout=180000)
            with page.expect_download(timeout=60000) as download_info:
                page.click("#downloadLink")
            download = download_info.value
        except Exception as exc:
            status_text = page.locator("#status").text_content()
            page.screenshot(path=str(DEBUG_DIR / "gif_export_failed.png"), full_page=True)
            raise RuntimeError(f"GIF export failed: {exc}. Status: {status_text}") from exc

        gif_out = DOWNLOAD_DIR / "gif_output.gif"
        download.save_as(gif_out)
        assert gif_out.exists() and gif_out.stat().st_size > 0

        # Test video upload + trim -> GIF
        _log("Uploading sample video...")
        page.set_input_files("#gifInput", str(VIDEO_PATH))
        page.wait_for_selector("#previewVideo:not(.hidden)")
        page.wait_for_function(
            "() => { const vid = document.getElementById('previewVideo'); return vid && vid.videoWidth > 0; }"
        )
        page.wait_for_function(
            "() => { const el = document.getElementById('origSize'); return el && el.textContent.trim() !== '—'; }"
        )

        page.fill("#trimStart", "0.2")
        page.fill("#trimEnd", "1.4")

        _log("Exporting video to GIF...")
        try:
            page.click("#processBtn")
            page.wait_for_selector("#downloadLink:not(.hidden)", timeout=180000)
            with page.expect_download(timeout=60000) as download_info:
                page.click("#downloadLink")
            download = download_info.value
        except Exception as exc:
            status_text = page.locator("#status").text_content()
            page.screenshot(path=str(DEBUG_DIR / "video_export_failed.png"), full_page=True)
            raise RuntimeError(f"Video export failed: {exc}. Status: {status_text}") from exc

        vid_out = DOWNLOAD_DIR / "video_output.gif"
        download.save_as(vid_out)
        assert vid_out.exists() and vid_out.stat().st_size > 0

        _log("All tests passed.")
        browser.close()


if __name__ == "__main__":
    run()
