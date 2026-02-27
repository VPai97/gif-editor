const fileInput = document.getElementById("gifInput");
const preview = document.getElementById("preview");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");
const clearSelectionBtn = document.getElementById("clearSelection");
const origSizeEl = document.getElementById("origSize");
const origFileSizeEl = document.getElementById("origFileSize");
const outputSizeEl = document.getElementById("outputSize");

const targetWidth = document.getElementById("targetWidth");
const targetHeight = document.getElementById("targetHeight");
const keepAspect = document.getElementById("keepAspect");
const fpsInput = document.getElementById("fps");
const resampleFps = document.getElementById("resampleFps");
const trimStart = document.getElementById("trimStart");
const trimEnd = document.getElementById("trimEnd");
const maxColors = document.getElementById("maxColors");
const optimizeOutput = document.getElementById("optimizeOutput");
const targetSize = document.getElementById("targetSize");
const autoReduce = document.getElementById("autoReduce");
const blurRadius = document.getElementById("blurRadius");
const blurValue = document.getElementById("blurValue");
const processBtn = document.getElementById("processBtn");
const statusEl = document.getElementById("status");
const downloadLink = document.getElementById("downloadLink");

let naturalWidth = 0;
let naturalHeight = 0;
let selection = null;
let isDragging = false;
let startX = 0;
let startY = 0;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function updateCanvasSize() {
  overlay.width = preview.clientWidth || 0;
  overlay.height = preview.clientHeight || 0;
  drawSelection();
}

function clearSelection() {
  selection = null;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
}

function drawSelection() {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!selection) return;

  ctx.fillStyle = "rgba(255, 120, 80, 0.25)";
  ctx.strokeStyle = "rgba(255, 120, 80, 0.9)";
  ctx.lineWidth = 2;

  ctx.fillRect(selection.x, selection.y, selection.w, selection.h);
  ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = isError ? "status error" : "status";
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  preview.src = url;
  downloadLink.classList.add("hidden");
  outputSizeEl.textContent = "—";
  setStatus("GIF loaded. Draw a blur region if needed.");
  origFileSizeEl.textContent = formatBytes(file.size);
});

preview.addEventListener("load", () => {
  naturalWidth = preview.naturalWidth;
  naturalHeight = preview.naturalHeight;
  origSizeEl.textContent = `${naturalWidth} x ${naturalHeight}`;
  updateCanvasSize();
  clearSelection();
});

blurRadius.addEventListener("input", () => {
  blurValue.textContent = blurRadius.value;
});

overlay.addEventListener("mousedown", (event) => {
  if (!preview.src) return;
  const rect = overlay.getBoundingClientRect();
  startX = event.clientX - rect.left;
  startY = event.clientY - rect.top;
  isDragging = true;
  selection = { x: startX, y: startY, w: 0, h: 0 };
});

overlay.addEventListener("mousemove", (event) => {
  if (!isDragging) return;
  const rect = overlay.getBoundingClientRect();
  const currentX = event.clientX - rect.left;
  const currentY = event.clientY - rect.top;

  const x = Math.min(startX, currentX);
  const y = Math.min(startY, currentY);
  const w = Math.abs(currentX - startX);
  const h = Math.abs(currentY - startY);

  selection = { x, y, w, h };
  drawSelection();
});

function stopDrag() {
  if (!isDragging) return;
  isDragging = false;
  drawSelection();
}

overlay.addEventListener("mouseup", stopDrag);
overlay.addEventListener("mouseleave", stopDrag);

clearSelectionBtn.addEventListener("click", () => {
  clearSelection();
});

processBtn.addEventListener("click", async () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    setStatus("Please upload a GIF first.", true);
    return;
  }

  const formData = new FormData();
  formData.append("gif", file);
  formData.append("target_width", targetWidth.value);
  formData.append("target_height", targetHeight.value);
  formData.append("keep_aspect", keepAspect.checked ? "on" : "off");
  formData.append("fps", fpsInput.value);
  formData.append("resample_fps", resampleFps.checked ? "on" : "off");
  formData.append("trim_start", trimStart.value);
  formData.append("trim_end", trimEnd.value);
  formData.append("max_colors", maxColors.value);
  formData.append("optimize", optimizeOutput.checked ? "on" : "off");
  formData.append("target_size_kb", targetSize.value);
  formData.append("auto_reduce", autoReduce.checked ? "on" : "off");
  formData.append("blur_radius", blurRadius.value);

  if (
    selection &&
    selection.w > 0 &&
    selection.h > 0 &&
    naturalWidth &&
    naturalHeight &&
    overlay.width > 0 &&
    overlay.height > 0
  ) {
    const scaleX = naturalWidth / overlay.width;
    const scaleY = naturalHeight / overlay.height;
    formData.append("blur_x", Math.round(selection.x * scaleX));
    formData.append("blur_y", Math.round(selection.y * scaleY));
    formData.append("blur_w", Math.round(selection.w * scaleX));
    formData.append("blur_h", Math.round(selection.h * scaleY));
  }

  processBtn.disabled = true;
  setStatus("Processing GIF...", false);

  try {
    const response = await fetch("/process", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      let message = "Something went wrong.";
      try {
        const data = await response.json();
        if (data && data.error) {
          message = data.error;
        }
      } catch (jsonError) {
        try {
          const text = await response.text();
          if (text) {
            message = text.slice(0, 200);
          }
        } catch (textError) {
          // keep default message
        }
      }
      if (message === "Something went wrong.") {
        message = `Request failed (HTTP ${response.status})`;
      }
      setStatus(message, true);
      outputSizeEl.textContent = "—";
      processBtn.disabled = false;
      return;
    }

    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    downloadLink.href = downloadUrl;
    downloadLink.classList.remove("hidden");
    outputSizeEl.textContent = formatBytes(blob.size);
    setStatus("All set. Download your edited GIF.");
  } catch (error) {
    setStatus("Failed to process GIF.", true);
    outputSizeEl.textContent = "—";
  } finally {
    processBtn.disabled = false;
  }
});
