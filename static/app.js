const fileInput = document.getElementById("gifInput");
const uploadCard = document.getElementById("uploadCard");
const uploadMeta = document.getElementById("uploadMeta");
const previewStage = document.querySelector(".preview-stage");
const preview = document.getElementById("preview");
const previewVideo = document.getElementById("previewVideo");
const previewPlaceholder = document.querySelector(".preview-placeholder");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");
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
const targetSize = document.getElementById("targetSize");
const autoReduce = document.getElementById("autoReduce");

const blurEnable = document.getElementById("blurEnable");
const blurRadius = document.getElementById("blurRadius");
const blurValue = document.getElementById("blurValue");
const boxEnable = document.getElementById("boxEnable");
const boxColor = document.getElementById("boxColor");
const boxThickness = document.getElementById("boxThickness");
const clearSelectionBtn = document.getElementById("clearSelection");

const processBtn = document.getElementById("processBtn");
const statusEl = document.getElementById("status");
const downloadLink = document.getElementById("downloadLink");

const FFMPEG_CORE_PATH = "https://unpkg.com/@ffmpeg/core@0.10.0/dist/ffmpeg-core.js";

let sourceWidth = 0;
let sourceHeight = 0;
let currentFile = null;
let currentObjectUrl = null;
let currentIsVideo = false;
let selection = null;
let isDragging = false;
let startX = 0;
let startY = 0;

let ffmpeg = null;
let ffmpegFetchFile = null;
let ffmpegReady = false;
let ffmpegLoading = false;

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

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = isError ? "status error" : "status";
}

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function updateCanvasSize() {
  if (!previewStage) return;
  const width = Math.max(1, previewStage.clientWidth);
  const height = Math.max(1, previewStage.clientHeight);
  overlay.width = width;
  overlay.height = height;
  drawSelection();
}

function drawSelection() {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!selection) return;

  ctx.fillStyle = "rgba(77, 210, 183, 0.2)";
  ctx.strokeStyle = "rgba(77, 210, 183, 0.9)";
  ctx.lineWidth = 2;
  ctx.fillRect(selection.x, selection.y, selection.w, selection.h);
  ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
}

function clearSelection() {
  selection = null;
  drawSelection();
}

function updateOverlayActive() {
  const active = blurEnable.checked || boxEnable.checked;
  overlay.style.pointerEvents = active ? "auto" : "none";
  overlay.style.opacity = active ? "1" : "0";
  if (!active) {
    clearSelection();
  }
}

function showPreviewPlaceholder(label) {
  previewPlaceholder.textContent = label;
  previewPlaceholder.classList.remove("hidden");
  preview.classList.add("hidden");
  previewVideo.classList.add("hidden");
  clearSelection();
  updateCanvasSize();
}

function setSourceSize(width, height) {
  sourceWidth = width || 0;
  sourceHeight = height || 0;
  if (sourceWidth && sourceHeight) {
    origSizeEl.textContent = `${sourceWidth} x ${sourceHeight}`;
  }
  requestAnimationFrame(updateCanvasSize);
}

function loadFile(file) {
  if (!file) return;
  currentFile = file;
  currentIsVideo = file.type.startsWith("video/");
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
  }
  currentObjectUrl = URL.createObjectURL(file);
  outputSizeEl.textContent = "—";
  downloadLink.classList.add("hidden");
  origFileSizeEl.textContent = formatBytes(file.size);
  uploadMeta.textContent = file.name;

  if (currentIsVideo) {
    previewVideo.src = currentObjectUrl;
    previewVideo.classList.remove("hidden");
    preview.classList.add("hidden");
    previewPlaceholder.classList.add("hidden");
    setStatus("Video loaded.");
  } else {
    preview.src = currentObjectUrl;
    preview.classList.remove("hidden");
    previewVideo.classList.add("hidden");
    previewPlaceholder.classList.add("hidden");
    setStatus("GIF loaded.");
  }
}

function triggerFileDialog() {
  if (fileInput) {
    fileInput.click();
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  loadFile(file);
});

uploadCard.addEventListener("click", () => {
  triggerFileDialog();
});

uploadCard.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    triggerFileDialog();
  }
});

uploadCard.addEventListener("dragover", (event) => {
  event.preventDefault();
  uploadCard.classList.add("dragging");
});

uploadCard.addEventListener("dragleave", () => {
  uploadCard.classList.remove("dragging");
});

uploadCard.addEventListener("drop", (event) => {
  event.preventDefault();
  uploadCard.classList.remove("dragging");
  const file = event.dataTransfer && event.dataTransfer.files[0];
  if (!file) return;
  const dt = new DataTransfer();
  dt.items.add(file);
  fileInput.files = dt.files;
  loadFile(file);
});

preview.addEventListener("load", () => {
  setSourceSize(preview.naturalWidth, preview.naturalHeight);
});

preview.addEventListener("error", () => {
  showPreviewPlaceholder("Could not load GIF preview");
  setStatus("Could not load the selected GIF.", true);
});

previewVideo.addEventListener("loadedmetadata", () => {
  setSourceSize(previewVideo.videoWidth, previewVideo.videoHeight);
});

previewVideo.addEventListener("error", () => {
  showPreviewPlaceholder("Could not load video preview");
  setStatus("Could not load the selected video.", true);
});

blurRadius.addEventListener("input", () => {
  blurValue.textContent = blurRadius.value;
});

clearSelectionBtn.addEventListener("click", () => {
  clearSelection();
});

blurEnable.addEventListener("change", updateOverlayActive);
boxEnable.addEventListener("change", updateOverlayActive);

overlay.addEventListener("mousedown", (event) => {
  if (!sourceWidth || !sourceHeight) return;
  if (overlay.style.pointerEvents === "none") return;
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

window.addEventListener("resize", updateCanvasSize);

async function ensureFfmpeg() {
  if (ffmpegReady) return;
  if (ffmpegLoading) {
    while (!ffmpegReady) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return;
  }

  if (!window.FFmpeg || !window.FFmpeg.createFFmpeg) {
    throw new Error("FFmpeg failed to load.");
  }

  ffmpegLoading = true;
  const { createFFmpeg, fetchFile } = FFmpeg;
  ffmpeg = createFFmpeg({ log: false, corePath: FFMPEG_CORE_PATH });
  ffmpegFetchFile = fetchFile;
  if (ffmpeg.setProgress) {
    ffmpeg.setProgress(({ ratio }) => {
      if (!Number.isFinite(ratio)) return;
      const percent = Math.round(ratio * 100);
      setStatus(`Processing... ${percent}%`);
    });
  }
  await ffmpeg.load();
  ffmpegReady = true;
  ffmpegLoading = false;
}

function computeOutputSettings() {
  const tw = Math.round(parseNumber(targetWidth.value));
  const th = Math.round(parseNumber(targetHeight.value));
  let outW = sourceWidth || tw || 0;
  let outH = sourceHeight || th || 0;

  if (tw || th) {
    if (keepAspect.checked && (tw === 0 || th === 0)) {
      if (tw) {
        outW = tw;
        outH = Math.max(1, Math.round((sourceHeight * tw) / sourceWidth));
      } else {
        outH = th;
        outW = Math.max(1, Math.round((sourceWidth * th) / sourceHeight));
      }
    } else {
      outW = tw || sourceWidth;
      outH = th || sourceHeight;
    }
  }

  let fpsValue = parseNumber(fpsInput.value);
  let fpsToUse = resampleFps.checked && fpsValue > 0 ? fpsValue : 0;

  const targetBytes = parseNumber(targetSize.value) * 1024;
  if (autoReduce.checked && targetBytes > 0 && currentFile && currentFile.size > 0) {
    const ratio = targetBytes / currentFile.size;
    if (!tw && !th && ratio < 0.95) {
      const scale = Math.max(0.3, Math.sqrt(ratio));
      outW = Math.max(1, Math.round(sourceWidth * scale));
      outH = Math.max(1, Math.round(sourceHeight * scale));
    }
    if (!fpsValue && ratio < 0.95) {
      const baseFps = 12;
      fpsToUse = Math.max(4, Math.round(baseFps * Math.pow(ratio, 0.7)));
    }
  }

  return { outW, outH, fpsToUse };
}

function getSelectionForOutput(outW, outH) {
  if (!selection || overlay.width === 0 || overlay.height === 0) return null;
  const scaleX = outW / overlay.width;
  const scaleY = outH / overlay.height;
  let x = Math.round(selection.x * scaleX);
  let y = Math.round(selection.y * scaleY);
  let w = Math.round(selection.w * scaleX);
  let h = Math.round(selection.h * scaleY);

  x = Math.max(0, Math.min(x, outW - 1));
  y = Math.max(0, Math.min(y, outH - 1));
  w = Math.max(1, Math.min(w, outW - x));
  h = Math.max(1, Math.min(h, outH - y));

  return { x, y, w, h };
}

function buildFilterGraph(outW, outH, fpsToUse, selectionOutput) {
  const parts = [];
  let labelIndex = 0;
  let current = "[0:v]";
  const nextLabel = () => `[v${labelIndex++}]`;

  const chain = [];
  if (outW && outH && (outW !== sourceWidth || outH !== sourceHeight)) {
    chain.push(`scale=${outW}:${outH}:flags=lanczos`);
  }
  if (fpsToUse && fpsToUse > 0) {
    chain.push(`fps=${fpsToUse}`);
  }
  if (chain.length) {
    const out = nextLabel();
    parts.push(`${current}${chain.join(",")}${out}`);
    current = out;
  }

  if (blurEnable.checked && selectionOutput) {
    const base = nextLabel();
    const tmp = nextLabel();
    const blurred = nextLabel();
    const out = nextLabel();
    const radius = Math.max(1, Math.round(parseNumber(blurRadius.value)));

    parts.push(`${current}split=2${base}${tmp}`);
    parts.push(
      `${tmp}crop=${selectionOutput.w}:${selectionOutput.h}:${selectionOutput.x}:${selectionOutput.y},boxblur=${radius}:1${blurred}`
    );
    parts.push(`${base}${blurred}overlay=${selectionOutput.x}:${selectionOutput.y}${out}`);
    current = out;
  }

  if (boxEnable.checked && selectionOutput) {
    const out = nextLabel();
    const colorValue = (boxColor.value || "#4dd2b7").replace("#", "");
    const thickness = Math.max(1, Math.round(parseNumber(boxThickness.value)));
    parts.push(
      `${current}drawbox=x=${selectionOutput.x}:y=${selectionOutput.y}:w=${selectionOutput.w}:h=${selectionOutput.h}:color=0x${colorValue}@0.9:t=${thickness}${out}`
    );
    current = out;
  }

  if (!parts.length) {
    return { filter: "", map: "" };
  }

  return { filter: parts.join(";"), map: current };
}

function getInputExtension(file) {
  const name = file.name || "input";
  const parts = name.split(".");
  if (parts.length > 1) {
    return parts.pop().toLowerCase();
  }
  if (file.type.startsWith("video/")) return "mp4";
  return "gif";
}

processBtn.addEventListener("click", async () => {
  if (!currentFile) {
    setStatus("Please upload a GIF or video first.", true);
    return;
  }

  if ((blurEnable.checked || boxEnable.checked) && !selection) {
    setStatus("Select a region on the preview first.", true);
    return;
  }

  processBtn.disabled = true;
  setStatus("Loading encoder...");

  try {
    await ensureFfmpeg();
    setStatus("Preparing export...");

    const inputName = `input.${getInputExtension(currentFile)}`;
    const outputName = "output.gif";

    try {
      ffmpeg.FS("unlink", inputName);
    } catch (error) {
      // ignore
    }
    try {
      ffmpeg.FS("unlink", outputName);
    } catch (error) {
      // ignore
    }

    ffmpeg.FS("writeFile", inputName, await ffmpegFetchFile(currentFile));

    const trimStartVal = parseNumber(trimStart.value);
    const trimEndVal = parseNumber(trimEnd.value);
    const duration = trimEndVal > trimStartVal ? trimEndVal - trimStartVal : 0;

    const { outW, outH, fpsToUse } = computeOutputSettings();
    const selectionOutput = getSelectionForOutput(outW || sourceWidth, outH || sourceHeight);

    const { filter, map } = buildFilterGraph(outW, outH, fpsToUse, selectionOutput);

    const args = [];
    if (trimStartVal > 0) {
      args.push("-ss", trimStartVal.toString());
    }
    args.push("-i", inputName);
    if (duration > 0) {
      args.push("-t", duration.toString());
    }
    if (filter) {
      args.push("-filter_complex", filter, "-map", map);
    }
    args.push("-loop", "0", outputName);

    setStatus("Encoding GIF...");
    await ffmpeg.run(...args);

    const data = ffmpeg.FS("readFile", outputName);
    const blob = new Blob([data.buffer], { type: "image/gif" });
    const downloadUrl = URL.createObjectURL(blob);
    const baseName = currentFile.name ? currentFile.name.split(".")[0] : "zigma";

    downloadLink.href = downloadUrl;
    downloadLink.download = `${baseName}_edited.gif`;
    downloadLink.classList.remove("hidden");
    outputSizeEl.textContent = formatBytes(blob.size);
    setStatus("All set. Download your GIF.");
  } catch (error) {
    setStatus(`Processing failed: ${error.message || error}`, true);
    outputSizeEl.textContent = "—";
  } finally {
    processBtn.disabled = false;
  }
});

showPreviewPlaceholder("GIF or video preview");
updateOverlayActive();
