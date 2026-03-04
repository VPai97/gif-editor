const fileInput = document.getElementById("gifInput");
const uploadCard = document.getElementById("uploadCard");
const uploadMeta = document.getElementById("uploadMeta");
const previewWrap = document.getElementById("previewWrap");
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
const blurStart = document.getElementById("blurStart");
const blurEnd = document.getElementById("blurEnd");
const addBlurRegionBtn = document.getElementById("addBlurRegion");
const clearBlurRegionsBtn = document.getElementById("clearBlurRegions");
const blurRegionList = document.getElementById("blurRegionList");
const boxEnable = document.getElementById("boxEnable");
const boxColor = document.getElementById("boxColor");
const boxThickness = document.getElementById("boxThickness");
const boxStart = document.getElementById("boxStart");
const boxEnd = document.getElementById("boxEnd");
const addBoxRegionBtn = document.getElementById("addBoxRegion");
const clearBoxRegionsBtn = document.getElementById("clearBoxRegions");
const boxRegionList = document.getElementById("boxRegionList");
const clearSelectionBtn = document.getElementById("clearSelection");

const processBtn = document.getElementById("processBtn");
const downloadBtn = document.getElementById("downloadBtn");
const statusEl = document.getElementById("status");
const downloadLink = document.getElementById("downloadLink");
const sourceFpsEl = document.getElementById("sourceFps");

const FFMPEG_CORE_PATH = "/static/vendor/ffmpeg/ffmpeg-core.js";

let sourceWidth = 0;
let sourceHeight = 0;
let currentFile = null;
let currentObjectUrl = null;
let currentIsVideo = false;
let downloadReady = false;
let selection = null;
let previewLoopId = null;
let blurRegions = [];
let blurRegionCounter = 1;
let boxRegions = [];
let boxRegionCounter = 1;
let sourceFps = 0;
const previewBuffer = document.createElement("canvas");
const previewBufferCtx = previewBuffer.getContext("2d");
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

function detectSourceFps() {
  if (!currentIsVideo) return 0;
  let fps = 0;
  try {
    if (previewVideo && previewVideo.captureStream) {
      const stream = previewVideo.captureStream();
      const track = stream.getVideoTracks()[0];
      if (track && track.getSettings) {
        const settings = track.getSettings();
        if (Number.isFinite(settings.frameRate)) {
          fps = settings.frameRate;
        }
      }
      stream.getTracks().forEach((t) => t.stop());
    }
  } catch (error) {
    // ignore captureStream failures
  }

  try {
    if (!fps && previewVideo && previewVideo.getVideoPlaybackQuality) {
      const quality = previewVideo.getVideoPlaybackQuality();
      if (quality && quality.totalVideoFrames && previewVideo.duration) {
        const estimate = quality.totalVideoFrames / previewVideo.duration;
        if (Number.isFinite(estimate) && estimate > 0) {
          fps = estimate;
        }
      }
    }
  } catch (error) {
    // ignore playback quality failures
  }

  if (!fps) {
    fps = 25;
  }

  return Math.round(fps);
}

function parseTimeInput(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatTimeValue(value) {
  if (!Number.isFinite(value)) return "0";
  const fixed = value.toFixed(3);
  return fixed.replace(/\.?0+$/, "");
}

function getBlurRange() {
  const start = parseTimeInput(blurStart.value);
  const end = parseTimeInput(blurEnd.value);
  return { start, end };
}

function getBoxRange() {
  const start = parseTimeInput(boxStart.value);
  const end = parseTimeInput(boxEnd.value);
  return { start, end };
}

function hasBlurRegions() {
  return blurRegions.length > 0;
}

function hasBoxRegions() {
  return boxRegions.length > 0;
}

function addBlurRegion() {
  if (!selection || overlay.width === 0 || overlay.height === 0) {
    setStatus("Select a region on the preview first.", true);
    return;
  }

  const { start, end } = getBlurRange();
  if (end > 0 && end <= start) {
    setStatus("Blur end must be greater than blur start.", true);
    return;
  }

  const region = {
    id: blurRegionCounter++,
    x: selection.x / overlay.width,
    y: selection.y / overlay.height,
    w: selection.w / overlay.width,
    h: selection.h / overlay.height,
    start,
    end,
  };

  blurRegions.push(region);
  renderBlurRegionList();
  setStatus("Blur region added.");
  startPreviewLoop();
}

function clearBlurRegions() {
  blurRegions = [];
  renderBlurRegionList();
  setStatus("Cleared blur regions.");
  renderOverlay();
}

function addBoxRegion() {
  if (!selection || overlay.width === 0 || overlay.height === 0) {
    setStatus("Select a region on the preview first.", true);
    return;
  }

  const { start, end } = getBoxRange();
  if (end > 0 && end <= start) {
    setStatus("Highlight end must be greater than highlight start.", true);
    return;
  }

  const region = {
    id: boxRegionCounter++,
    x: selection.x / overlay.width,
    y: selection.y / overlay.height,
    w: selection.w / overlay.width,
    h: selection.h / overlay.height,
    start,
    end,
    color: boxColor.value || "#4dd2b7",
    thickness: Math.max(1, Math.round(parseNumber(boxThickness.value))),
  };

  boxRegions.push(region);
  renderBoxRegionList();
  setStatus("Highlight region added.");
  renderOverlay();
}

function clearBoxRegions() {
  boxRegions = [];
  renderBoxRegionList();
  setStatus("Cleared highlight regions.");
  renderOverlay();
}

function renderBlurRegionList() {
  if (!blurRegionList) return;
  blurRegionList.innerHTML = "";

  if (!blurRegions.length) {
    const empty = document.createElement("div");
    empty.className = "blur-empty";
    empty.textContent = "No blur regions yet.";
    blurRegionList.appendChild(empty);
    return;
  }

  blurRegions.forEach((region) => {
    const item = document.createElement("div");
    item.className = "blur-item";

    const info = document.createElement("div");
    const startLabel = region.start ? `${region.start}s` : "start";
    const endLabel = region.end ? `${region.end}s` : "end";
    const timing =
      region.start || region.end ? `${startLabel} → ${endLabel}` : "All frames";
    info.innerHTML = `<strong>Blur ${region.id}</strong><div>${timing}</div>`;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "secondary";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      blurRegions = blurRegions.filter((entry) => entry.id !== region.id);
      renderBlurRegionList();
      renderOverlay();
    });

    item.appendChild(info);
    item.appendChild(removeBtn);
    blurRegionList.appendChild(item);
  });
}

function renderBoxRegionList() {
  if (!boxRegionList) return;
  boxRegionList.innerHTML = "";

  if (!boxRegions.length) {
    const empty = document.createElement("div");
    empty.className = "blur-empty";
    empty.textContent = "No highlight regions yet.";
    boxRegionList.appendChild(empty);
    return;
  }

  boxRegions.forEach((region) => {
    const item = document.createElement("div");
    item.className = "blur-item";

    const info = document.createElement("div");
    const startLabel = region.start ? `${region.start}s` : "start";
    const endLabel = region.end ? `${region.end}s` : "end";
    const timing =
      region.start || region.end ? `${startLabel} → ${endLabel}` : "All frames";
    info.innerHTML = `<strong>Highlight ${region.id}</strong><div>${timing}</div>`;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "secondary";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      boxRegions = boxRegions.filter((entry) => entry.id !== region.id);
      renderBoxRegionList();
      renderOverlay();
    });

    item.appendChild(info);
    item.appendChild(removeBtn);
    boxRegionList.appendChild(item);
  });
}

function isRegionActive(region) {
  if (!currentIsVideo) return true;
  const time = previewVideo.currentTime || 0;
  if (!region.start && !region.end) return true;
  if (region.end > 0) {
    return time >= region.start && time <= region.end;
  }
  return time >= region.start;
}

function updateCanvasSize() {
  if (!previewStage) return;
  updatePreviewStageSize();
  const width = Math.max(1, previewStage.clientWidth);
  const height = Math.max(1, previewStage.clientHeight);
  overlay.width = width;
  overlay.height = height;
  drawSelection();
}

function resetPreviewStageSize() {
  if (!previewStage) return;
  previewStage.style.width = "100%";
  previewStage.style.height = "100%";
}

function updatePreviewStageSize() {
  if (!previewWrap || !previewStage) return;
  if (!sourceWidth || !sourceHeight) return;
  const maxW = previewWrap.clientWidth;
  const maxH = previewWrap.clientHeight;
  if (!maxW || !maxH) return;
  const aspect = sourceWidth / sourceHeight;
  let width = maxW;
  let height = width / aspect;
  if (height > maxH) {
    height = maxH;
    width = height * aspect;
  }
  previewStage.style.width = `${Math.round(width)}px`;
  previewStage.style.height = `${Math.round(height)}px`;
}

function drawSelection() {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!selection) {
    overlay.dataset.selection = "";
    return;
  }

  overlay.dataset.selection = JSON.stringify(selection);
  renderOverlay();
}

function clearSelection() {
  selection = null;
  drawSelection();
}

function getPreviewSource() {
  if (currentIsVideo && !previewVideo.classList.contains("hidden")) {
    return previewVideo;
  }
  if (!currentIsVideo && !preview.classList.contains("hidden")) {
    return preview;
  }
  return null;
}

function renderOverlay() {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const shouldBlur = blurEnable.checked;
  const shouldBox = boxEnable.checked;
  const src = getPreviewSource();

  if (shouldBlur && src && overlay.width > 0 && overlay.height > 0) {
    const activeRegions = blurRegions.filter((region) => isRegionActive(region));
    const tempRegion =
      selection &&
      !blurRegions.some(
        (region) =>
          Math.abs(region.x * overlay.width - selection.x) < 1 &&
          Math.abs(region.y * overlay.height - selection.y) < 1 &&
          Math.abs(region.w * overlay.width - selection.w) < 1 &&
          Math.abs(region.h * overlay.height - selection.h) < 1
      )
        ? [
            {
              x: selection.x / overlay.width,
              y: selection.y / overlay.height,
              w: selection.w / overlay.width,
              h: selection.h / overlay.height,
            },
          ]
        : [];

    const regionsToBlur = [...activeRegions, ...tempRegion];
    if (regionsToBlur.length) {
      previewBuffer.width = overlay.width;
      previewBuffer.height = overlay.height;
      previewBufferCtx.clearRect(0, 0, overlay.width, overlay.height);
      previewBufferCtx.drawImage(src, 0, 0, overlay.width, overlay.height);

      const radius = Math.max(1, Math.round(parseNumber(blurRadius.value)));
      regionsToBlur.forEach((region) => {
        const x = region.x * overlay.width;
        const y = region.y * overlay.height;
        const w = region.w * overlay.width;
        const h = region.h * overlay.height;

        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.filter = `blur(${radius}px)`;
        ctx.drawImage(previewBuffer, 0, 0);
        ctx.restore();
      });
    }
  }

  if (selection) {
    if (!shouldBox) {
      ctx.strokeStyle = "rgba(77, 210, 183, 0.9)";
      ctx.lineWidth = 2;
      ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
    } else {
      ctx.strokeStyle = boxColor.value || "#4dd2b7";
      ctx.lineWidth = Math.max(1, Math.round(parseNumber(boxThickness.value)));
      ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
    }
  }

  if (blurRegions.length) {
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 1;
    blurRegions.forEach((region) => {
      const x = region.x * overlay.width;
      const y = region.y * overlay.height;
      const w = region.w * overlay.width;
      const h = region.h * overlay.height;
      ctx.strokeRect(x, y, w, h);
    });
    ctx.restore();
  }

  if (shouldBox && boxRegions.length) {
    boxRegions.forEach((region) => {
      if (!isRegionActive(region)) return;
      const x = region.x * overlay.width;
      const y = region.y * overlay.height;
      const w = region.w * overlay.width;
      const h = region.h * overlay.height;
      ctx.strokeStyle = region.color || "#4dd2b7";
      ctx.lineWidth = region.thickness || 2;
      ctx.strokeRect(x, y, w, h);
    });
  }
}

function startPreviewLoop() {
  if (previewLoopId) return;
  const loop = () => {
    if ((!selection && !hasBlurRegions() && !hasBoxRegions()) || (!blurEnable.checked && !boxEnable.checked)) {
      previewLoopId = null;
      return;
    }
    renderOverlay();
    previewLoopId = requestAnimationFrame(loop);
  };
  previewLoopId = requestAnimationFrame(loop);
}

function stopPreviewLoop() {
  if (!previewLoopId) return;
  cancelAnimationFrame(previewLoopId);
  previewLoopId = null;
}

function updateOverlayActive() {
  const active = blurEnable.checked || boxEnable.checked;
  overlay.style.pointerEvents = active ? "auto" : "none";
  overlay.style.opacity = active ? "1" : "0";
  if (!active) {
    clearSelection();
    stopPreviewLoop();
    return;
  }

  if ((blurEnable.checked && (selection || hasBlurRegions())) || (boxEnable.checked && (selection || hasBoxRegions()))) {
    startPreviewLoop();
  }
}

function showPreviewPlaceholder(label) {
  previewPlaceholder.textContent = label;
  previewPlaceholder.classList.remove("hidden");
  preview.classList.add("hidden");
  previewVideo.classList.add("hidden");
  clearSelection();
  resetPreviewStageSize();
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
  sourceFps = 0;
  if (sourceFpsEl) {
    sourceFpsEl.textContent = "—";
  }
  blurRegions = [];
  blurRegionCounter = 1;
  renderBlurRegionList();
  boxRegions = [];
  boxRegionCounter = 1;
  renderBoxRegionList();
  clearSelection();
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
  }
  currentObjectUrl = URL.createObjectURL(file);
  outputSizeEl.textContent = "—";
  downloadReady = false;
  downloadLink.classList.add("hidden");
  downloadLink.removeAttribute("href");
  downloadLink.removeAttribute("download");
  if (downloadBtn) {
    downloadBtn.disabled = true;
  }
  origFileSizeEl.textContent = formatBytes(file.size);
  uploadMeta.textContent = file.name;

  if (currentIsVideo) {
    previewVideo.src = currentObjectUrl;
    previewVideo.load();
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
  if (sourceFpsEl) {
    sourceFpsEl.textContent = "—";
  }
});

preview.addEventListener("error", () => {
  showPreviewPlaceholder("Could not load GIF preview");
  setStatus("Could not load the selected GIF.", true);
});

previewVideo.addEventListener("loadedmetadata", () => {
  setSourceSize(previewVideo.videoWidth, previewVideo.videoHeight);
  sourceFps = detectSourceFps();
  if (sourceFpsEl) {
    sourceFpsEl.textContent = sourceFps ? `${sourceFps}` : "—";
  }
});

previewVideo.addEventListener("error", () => {
  showPreviewPlaceholder("Could not load video preview");
  setStatus("Could not load the selected video.", true);
});

blurRadius.addEventListener("input", () => {
  blurValue.textContent = blurRadius.value;
  if (blurEnable.checked && selection) {
    renderOverlay();
  }
});

blurStart.addEventListener("input", () => {
  if (selection) {
    renderOverlay();
  }
});

blurEnd.addEventListener("input", () => {
  if (selection) {
    renderOverlay();
  }
});

addBlurRegionBtn.addEventListener("click", () => {
  addBlurRegion();
});

clearBlurRegionsBtn.addEventListener("click", () => {
  clearBlurRegions();
});

addBoxRegionBtn.addEventListener("click", () => {
  addBoxRegion();
});

clearBoxRegionsBtn.addEventListener("click", () => {
  clearBoxRegions();
});

boxColor.addEventListener("input", () => {
  if (selection) {
    renderOverlay();
  }
});

boxThickness.addEventListener("input", () => {
  if (selection) {
    renderOverlay();
  }
});

boxStart.addEventListener("input", () => {
  if (selection) {
    renderOverlay();
  }
});

boxEnd.addEventListener("input", () => {
  if (selection) {
    renderOverlay();
  }
});

boxThickness.addEventListener("input", () => {
  if (selection) {
    renderOverlay();
  }
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
  if (blurEnable.checked) {
    startPreviewLoop();
  }
});

function stopDrag() {
  if (!isDragging) return;
  isDragging = false;
  drawSelection();
  if (blurEnable.checked) {
    startPreviewLoop();
  }
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

  if (!fpsToUse && currentIsVideo && sourceFps > 0) {
    fpsToUse = sourceFps;
  }

  const targetBytes = parseNumber(targetSize.value) * 1024;
  if (autoReduce.checked && targetBytes > 0 && currentFile && currentFile.size > 0) {
    const ratio = targetBytes / currentFile.size;
    if (!tw && !th && ratio < 0.95) {
      const scale = Math.max(0.3, Math.sqrt(ratio));
      outW = Math.max(1, Math.round(sourceWidth * scale));
      outH = Math.max(1, Math.round(sourceHeight * scale));
    }
    // Do not change FPS unless the user explicitly sets it.
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

function getRegionForOutput(region, outW, outH) {
  if (!region) return null;
  let x = Math.round(region.x * outW);
  let y = Math.round(region.y * outH);
  let w = Math.round(region.w * outW);
  let h = Math.round(region.h * outH);

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

  if (blurEnable.checked && blurRegions.length) {
    const radius = Math.max(1, Math.round(parseNumber(blurRadius.value)));

    blurRegions.forEach((region) => {
      const rect = getRegionForOutput(region, outW, outH);
      if (!rect) return;
      const base = nextLabel();
      const tmp = nextLabel();
      const blurred = nextLabel();
      const out = nextLabel();
      let enableExpr = "";
      if (region.start > 0 || region.end > 0) {
        const start = formatTimeValue(Math.max(0, region.start));
        const end =
          region.end > 0 ? formatTimeValue(region.end) : formatTimeValue(99999);
        enableExpr = `:enable='between(t,${start},${end})'`;
      }

      parts.push(`${current}split=2${base}${tmp}`);
      parts.push(
        `${tmp}crop=${rect.w}:${rect.h}:${rect.x}:${rect.y},boxblur=${radius}:1${blurred}`
      );
      parts.push(`${base}${blurred}overlay=${rect.x}:${rect.y}${enableExpr}${out}`);
      current = out;
    });
  }

  if (boxEnable.checked && boxRegions.length) {
    boxRegions.forEach((region) => {
      const rect = getRegionForOutput(region, outW, outH);
      if (!rect) return;
      const out = nextLabel();
      const colorValue = (region.color || "#4dd2b7").replace("#", "");
      const thickness = Math.max(1, Math.round(region.thickness || 2));
      let enableExpr = "";
      if (region.start > 0 || region.end > 0) {
        const start = formatTimeValue(Math.max(0, region.start));
        const end =
          region.end > 0 ? formatTimeValue(region.end) : formatTimeValue(99999);
        enableExpr = `:enable='between(t,${start},${end})'`;
      }
      parts.push(
        `${current}drawbox=x=${rect.x}:y=${rect.y}:w=${rect.w}:h=${rect.h}:color=0x${colorValue}@0.9:t=${thickness}${enableExpr}${out}`
      );
      current = out;
    });
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

  if (boxEnable.checked && !boxRegions.length) {
    setStatus("Add at least one highlight region before processing.", true);
    return;
  }

  if (blurEnable.checked && !blurRegions.length) {
    setStatus("Add at least one blur region before processing.", true);
    return;
  }

  downloadReady = false;
  downloadLink.classList.add("hidden");
  downloadLink.removeAttribute("href");
  downloadLink.removeAttribute("download");
  processBtn.disabled = true;
  if (downloadBtn) {
    downloadBtn.disabled = true;
  }
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
    downloadLink.classList.add("hidden");
    downloadReady = true;
    if (downloadBtn) {
      downloadBtn.disabled = false;
    }
    outputSizeEl.textContent = formatBytes(blob.size);
    setStatus("All set. Download your GIF.");
  } catch (error) {
    setStatus(`Processing failed: ${error.message || error}`, true);
    outputSizeEl.textContent = "—";
  } finally {
    processBtn.disabled = false;
  }
});

if (downloadBtn) {
  downloadBtn.addEventListener("click", () => {
    if (!downloadReady || !downloadLink.href) return;
    downloadLink.click();
  });
}

showPreviewPlaceholder("GIF or video preview");
updateOverlayActive();
renderBlurRegionList();
renderBoxRegionList();
