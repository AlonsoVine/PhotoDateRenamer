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

const folderInput = document.querySelector("#folder-path");
const notice = document.querySelector("#notice");
const undoControl = document.querySelector("#undo-control");
const tokensElement = document.querySelector("#tokens");
const previewWrap = document.querySelector("#preview-wrap");
const previewRows = document.querySelector("#preview-rows");
const previewSummary = document.querySelector("#preview-summary");
const previewButton = document.querySelector("#preview-button");
const confirmButton = document.querySelector("#confirm-button");
let components = PRESETS.date_original.map((part) => ({ ...part }));
let currentPlanId = null;
let currentRunId = null;

function invalidatePreview() {
  currentPlanId = null;
  previewWrap.hidden = true;
  notice.hidden = true;
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
  previewButton.disabled = true;
  previewButton.textContent = "Preparando…";
  try {
    const result = await request("/api/preview", {
      folder: folderInput.value,
      components,
      date_format: document.querySelector("#date-format").value,
      recursive: document.querySelector("#recursive").checked
    });
    currentPlanId = result.plan_id;
    const counts = result.items.reduce((summary, item) => {
      summary[item.status] = (summary[item.status] || 0) + 1;
      return summary;
    }, {});
    previewSummary.textContent =
      `${result.items.length} fotografías revisadas · ${result.rename_count} listas para renombrar` +
      `${counts.conflict ? ` · ${counts.conflict} conflictos` : ""}` +
      `${counts.skipped ? ` · ${counts.skipped} sin fecha válida` : ""}`;
    previewRows.replaceChildren();
    result.items.forEach((item) => {
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
    });
    confirmButton.disabled = result.rename_count === 0;
    previewWrap.hidden = false;
    showNotice("Vista previa lista. Comprueba los nombres y los avisos antes de confirmar.");
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    previewButton.disabled = false;
    previewButton.innerHTML = 'Preparar vista previa <span aria-hidden="true">↗</span>';
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
