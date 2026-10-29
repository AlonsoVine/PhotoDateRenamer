const FIELD_LABELS = {
  date: "Fecha de captura",
  original_name: "Nombre original",
  original_stem: "Nombre sin extensión",
  extension: "Extensión"
};

const PRESETS = {
  date_original: [
    { kind: "field", value: "date" },
    { kind: "text", value: "_" },
    { kind: "field", value: "original_name" }
  ],
  date_stem: [
    { kind: "field", value: "date" },
    { kind: "text", value: "_" },
    { kind: "field", value: "original_stem" }
  ],
  original_date: [
    { kind: "field", value: "original_stem" },
    { kind: "text", value: "_" },
    { kind: "field", value: "date" },
    { kind: "field", value: "extension" }
  ]
};
const PREVIEW_PAGE_SIZE = 100;

const folderInput = document.querySelector("#folder-path");
const notice = document.querySelector("#notice");
const undoControl = document.querySelector("#undo-control");
const tokensElement = document.querySelector("#tokens");
const previewWrap = document.querySelector("#preview-wrap");
const previewRows = document.querySelector("#preview-rows");
const previewSummary = document.querySelector("#preview-summary");
const previewButton = document.querySelector("#preview-button");
const confirmButton = document.querySelector("#confirm-button");
const operationProgress = document.querySelector("#operation-progress");
const operationProgressBar = document.querySelector("#operation-progress-bar");
const operationProgressLabel = document.querySelector("#operation-progress-label");
const cancelOperationButton = document.querySelector("#cancel-operation");
const previewPagination = document.querySelector("#preview-pagination");
const previewPageLabel = document.querySelector("#preview-page-label");
const previousPageButton = document.querySelector("#previous-page");
const nextPageButton = document.querySelector("#next-page");
let components = PRESETS.date_original.map((part) => ({ ...part }));
let currentPlanId = null;
let currentRunId = null;
let activeScanId = null;
let scanCancelled = false;
let previewItems = [];
let previewPage = 0;

function invalidatePreview() {
  currentPlanId = null;
  previewItems = [];
  previewWrap.hidden = true;
  notice.hidden = true;
}

function updateProgress(progress) {
  operationProgress.hidden = false;
  if (progress.phase === "indexing") {
    operationProgressLabel.textContent = `Indexando ${progress.scanned} elementos…`;
    operationProgressBar.removeAttribute("value");
  } else if (progress.phase === "scanning" && progress.total !== null) {
    operationProgressLabel.textContent =
      `Leyendo fotografía ${progress.scanned} de ${progress.total}…`;
    operationProgressBar.max = Math.max(progress.total, 1);
    operationProgressBar.value = progress.scanned;
  } else {
    operationProgressLabel.textContent = "Preparando el análisis…";
    operationProgressBar.removeAttribute("value");
  }
  cancelOperationButton.disabled = progress.phase === "pending" || progress.completed;
}

function finishProgress() {
  operationProgress.hidden = true;
  cancelOperationButton.disabled = true;
  operationProgressBar.removeAttribute("value");
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function monitorScan(scanId, isPreviewRequestSettled) {
  let progress;
  do {
    progress = await request("/api/progress", { scan_id: scanId });
    updateProgress(progress);
    if (progress.phase === "pending" && isPreviewRequestSettled()) return;
    if (!progress.completed) await wait(300);
  } while (!progress.completed);
}

async function request(path, data = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-PhotoDateRenamer-Token": window.PDR_TOKEN
    },
    body: JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "No se pudo completar la operación.");
  return result;
}

function showNotice(message, isError = false) {
  notice.replaceChildren();
  notice.classList.toggle("error", isError);
  notice.hidden = false;
  const text = document.createElement("span");
  text.textContent = message;
  notice.append(text);
}

function renderPreview(items) {
  previewRows.replaceChildren();
  const pageCount = Math.max(1, Math.ceil(items.length / PREVIEW_PAGE_SIZE));
  previewPage = Math.min(previewPage, pageCount - 1);
  const start = previewPage * PREVIEW_PAGE_SIZE;
  for (const item of items.slice(start, start + PREVIEW_PAGE_SIZE)) {
    const row = document.createElement("tr");
    row.className = `is-${item.status}`;
    const oldName = document.createElement("td");
    oldName.textContent = item.original_name;
    const dateSource = document.createElement("td");
    dateSource.textContent = item.date_source || "—";
    const status = document.createElement("td");
    status.className = "status";
    status.textContent = {
      ready: "Lista",
      unchanged: "Sin cambio",
      skipped: "Omitida",
      conflict: "Conflicto"
    }[item.status] || item.status;
    status.title = item.reason || "";
    const newName = document.createElement("td");
    newName.textContent = item.new_name || item.reason || "—";
    row.append(oldName, dateSource, status, newName);
    previewRows.append(row);
  }
  previewPagination.hidden = items.length <= PREVIEW_PAGE_SIZE;
  previewPageLabel.textContent =
    `Mostrando ${start + 1}–${Math.min(start + PREVIEW_PAGE_SIZE, items.length)} de ${items.length}`;
  previousPageButton.disabled = previewPage === 0;
  nextPageButton.disabled = previewPage >= pageCount - 1;
}

function updateTokens() {
  tokensElement.replaceChildren();
  components.forEach((component, index) => {
    const chip = document.createElement("span");
    chip.className = `token ${component.kind === "text" ? "text-token" : ""}`;
    const title = document.createElement("span");
    title.textContent = component.kind === "text" ? `“${component.value}”` : FIELD_LABELS[component.value];
    chip.append(title);
    for (const [direction, label, symbol] of [
      [-1, "Mover a la izquierda", "←"],
      [1, "Mover a la derecha", "→"]
    ]) {
      const moveButton = document.createElement("button");
      moveButton.type = "button";
      moveButton.setAttribute("aria-label", label);
      moveButton.textContent = symbol;
      moveButton.disabled = index + direction < 0 || index + direction >= components.length;
      moveButton.addEventListener("click", () => {
        const [part] = components.splice(index, 1);
        components.splice(index + direction, 0, part);
        setCustomPreset();
      });
      chip.append(moveButton);
    }
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", "Eliminar elemento");
    removeButton.textContent = "×";
    removeButton.addEventListener("click", () => {
      components.splice(index, 1);
      setCustomPreset();
    });
    chip.append(removeButton);
    tokensElement.append(chip);
  });
}

function setCustomPreset() {
  document.querySelectorAll(".preset").forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === "custom");
  });
  updateTokens();
  invalidatePreview();
}

document.querySelectorAll(".preset").forEach((button) => {
  button.addEventListener("click", () => {
    const preset = button.dataset.preset;
    components = (PRESETS[preset] || []).map((part) => ({ ...part }));
    document.querySelectorAll(".preset").forEach((item) => item.classList.toggle("active", item === button));
    updateTokens();
    invalidatePreview();
  });
});

document.querySelector("#add-element").addEventListener("change", (event) => {
  const value = event.target.value;
  if (value === "text") {
    document.querySelector("#literal-text").value = "";
    document.querySelector("#text-dialog").showModal();
  } else {
    components.push({ kind: "field", value });
    setCustomPreset();
  }
  event.target.value = "";
});

document.querySelector("#add-text-button").addEventListener("click", (event) => {
  event.preventDefault();
  const value = document.querySelector("#literal-text").value;
  if (!value) {
    document.querySelector("#text-dialog").close();
    return;
  }
  components.push({ kind: "text", value });
  document.querySelector("#text-dialog").close();
  setCustomPreset();
});

document.querySelector("#browse-button").addEventListener("click", async () => {
  try {
    const result = await request("/api/select-folder");
    if (result.folder) {
      folderInput.value = result.folder;
      invalidatePreview();
    }
  } catch (error) {
    showNotice(error.message, true);
  }
});

folderInput.addEventListener("input", invalidatePreview);
document.querySelector("#date-format").addEventListener("change", invalidatePreview);
document.querySelector("#recursive").addEventListener("change", invalidatePreview);

previewButton.addEventListener("click", async () => {
  invalidatePreview();
  scanCancelled = false;
  activeScanId = crypto.randomUUID();
  const scanSettings = {
    folder: folderInput.value,
    components: components.map((part) => ({ ...part })),
    date_format: document.querySelector("#date-format").value,
    recursive: document.querySelector("#recursive").checked
  };
  previewButton.disabled = true;
  previewButton.textContent = "Preparando…";
  updateProgress({ phase: "pending", scanned: 0, total: null, completed: false });
  try {
    let previewRequestSettled = false;
    const previewRequest = request("/api/preview", {
      ...scanSettings,
      scan_id: activeScanId
    }).finally(() => {
      previewRequestSettled = true;
    });
    const progressRequest = monitorScan(activeScanId, () => previewRequestSettled);
    const result = await previewRequest;
    await progressRequest;
    if (
      folderInput.value !== scanSettings.folder ||
      document.querySelector("#date-format").value !== scanSettings.date_format ||
      document.querySelector("#recursive").checked !== scanSettings.recursive ||
      JSON.stringify(components) !== JSON.stringify(scanSettings.components)
    ) {
      throw new Error("La configuración cambió durante el análisis. Prepara una vista previa nueva.");
    }
    currentPlanId = result.plan_id;
    const counts = result.items.reduce((summary, item) => {
      summary[item.status] = (summary[item.status] || 0) + 1;
      return summary;
    }, {});
    previewSummary.textContent =
      `${result.items.length} fotografías revisadas · ${result.rename_count} listas para renombrar` +
      `${counts.conflict ? ` · ${counts.conflict} conflictos` : ""}` +
      `${counts.skipped ? ` · ${counts.skipped} sin fecha válida` : ""}`;
    previewItems = result.items;
    previewPage = 0;
    renderPreview(previewItems);
    confirmButton.disabled = result.rename_count === 0;
    previewWrap.hidden = false;
    showNotice("Vista previa lista. Comprueba los nombres y los avisos antes de confirmar.");
  } catch (error) {
    if (scanCancelled) {
      showNotice("Análisis cancelado. No se modificó ningún archivo.");
    } else {
      showNotice(error.message, true);
    }
  } finally {
    activeScanId = null;
    finishProgress();
    previewButton.disabled = false;
    previewButton.textContent = "Preparar vista previa ↗";
  }
});

cancelOperationButton.addEventListener("click", async () => {
  if (!activeScanId) return;
  scanCancelled = true;
  cancelOperationButton.disabled = true;
  try {
    await request("/api/cancel", { scan_id: activeScanId });
  } catch (error) {
    scanCancelled = false;
    cancelOperationButton.disabled = false;
    showNotice(`No se pudo cancelar el análisis: ${error.message}`, true);
  }
});

previousPageButton.addEventListener("click", () => {
  if (previewPage > 0) {
    previewPage -= 1;
    renderPreview(previewItems);
  }
});

nextPageButton.addEventListener("click", () => {
  if ((previewPage + 1) * PREVIEW_PAGE_SIZE < previewItems.length) {
    previewPage += 1;
    renderPreview(previewItems);
  }
});

confirmButton.addEventListener("click", async () => {
  const scope = document.querySelector("#recursive").checked
    ? "la carpeta seleccionada y sus subcarpetas"
    : "la carpeta seleccionada";
  if (!currentPlanId || !window.confirm(`Se cambiarán los nombres de los archivos de ${scope}. ¿Continuar?`)) return;
  confirmButton.disabled = true;
  try {
    const result = await request("/api/confirm", { plan_id: currentPlanId });
    currentPlanId = null;
    currentRunId = result.run_id;
    undoControl.hidden = false;
    showNotice(`${result.renamed_count} archivos renombrados. Puedes deshacer esta acción.`);
    previewWrap.hidden = true;
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    confirmButton.disabled = false;
  }
});

async function undoRenames() {
  if (!currentRunId) return;
  try {
    const result = await request("/api/undo", { run_id: currentRunId });
    currentRunId = null;
    undoControl.hidden = true;
    showNotice(`${result.restored_count} archivos han recuperado su nombre original.`);
  } catch (error) {
    showNotice(error.message, true);
  }
}

document.querySelector("#undo-button").addEventListener("click", undoRenames);
updateTokens();
