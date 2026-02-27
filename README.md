# Zigma

Local web app for editing GIFs: resize, blur a region, and adjust FPS.

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

- Blur selection is drawn on the preview; leave it empty to skip blur.
- If one of width or height is blank and "Keep aspect" is on, the other dimension is computed automatically.
- Leave FPS blank to keep the original timing.
- The server binds to `0.0.0.0` by default and honors `$PORT` for hosted platforms.

## Deploy on Render

This repo includes `render.yaml` for one-click deploy.

1. Push this repo to GitHub.
2. In Render, create a new Blueprint and connect the repo.
3. Render will use `render.yaml` to create the web service.
