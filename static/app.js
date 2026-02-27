const fileInput = document.getElementById("gifInput");
const uploadCard = document.querySelector(".upload-card");
const preview = document.getElementById("preview");
const previewPlaceholder = document.querySelector(".preview-placeholder");
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
const processBtn = document.getElementById("processBtn");
const statusEl = document.getElementById("status");
const downloadLink = document.getElementById("downloadLink");

let naturalWidth = 0;
let naturalHeight = 0;
let currentFile = null;
let currentObjectUrl = null;

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

function loadFile(file) {
  if (!file) return;
  currentFile = file;
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
  }
  currentObjectUrl = URL.createObjectURL(file);
  preview.src = currentObjectUrl;
  preview.classList.remove("hidden");
  previewPlaceholder.classList.add("hidden");
  downloadLink.classList.add("hidden");
  outputSizeEl.textContent = "—";
  setStatus("GIF loaded.");
  origFileSizeEl.textContent = formatBytes(file.size);
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  loadFile(file);
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
  naturalWidth = preview.naturalWidth;
  naturalHeight = preview.naturalHeight;
  origSizeEl.textContent = `${naturalWidth} x ${naturalHeight}`;
});

preview.addEventListener("error", () => {
  preview.classList.add("hidden");
  previewPlaceholder.classList.remove("hidden");
  setStatus("Could not load the selected GIF.", true);
});

processBtn.addEventListener("click", async () => {
  const file = currentFile || (fileInput.files && fileInput.files[0]);
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
