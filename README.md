# Zigma

Local web app for editing GIFs and videos: resize, trim, blur regions, highlight boxes, and reduce file size.

## Setup

```bash
cd /home/vignesh/gif-editor
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Then open `http://127.0.0.1:5000` in your browser.

## Notes

- If one of width or height is blank and "Keep aspect" is on, the other dimension is computed automatically.
- Leave FPS blank to keep the original timing.
- Upload GIFs or videos (MP4/WEBM/MOV) and export as GIF.
- Use trim start/end to cut a video or GIF by time (seconds).
- Use target size (KB) to auto-reduce file size by dropping frames and scaling.
- Use blur/highlight with a selection box on the preview.
- The server binds to `0.0.0.0` by default and honors `$PORT` for hosted platforms.

## In-Browser Processing

Zigma now processes media directly in the browser using FFmpeg.wasm (no backend required).
The first run downloads the encoder bundle, which can take a few seconds.

## Deploy on Render

This repo includes `render.yaml` for one-click deploy.

1. Push this repo to GitHub.
2. In Render, create a new Blueprint and connect the repo.
3. Render will use `render.yaml` to create the web service.
