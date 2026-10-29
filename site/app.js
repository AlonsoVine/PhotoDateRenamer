(function () {
  "use strict";

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
  const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".tif", ".tiff"]);
  const INVALID_NAME = /[<>:"/\\|?*\u0000-\u001f]/;
  const RESERVED_NAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;
  const folderName = document.querySelector("#folder-name");
  const notice = document.querySelector("#notice");
  const undoControl = document.querySelector("#undo-control");
  const tokensElement = document.querySelector("#tokens");
  const previewWrap = document.querySelector("#preview-wrap");
  const previewRows = document.querySelector("#preview-rows");
  const previewSummary = document.querySelector("#preview-summary");
  const previewButton = document.querySelector("#preview-button");
  const confirmButton = document.querySelector("#confirm-button");
  const recursiveInput = document.querySelector("#recursive");
  const operationProgress = document.querySelector("#operation-progress");
  const operationProgressBar = document.querySelector("#operation-progress-bar");
  const operationProgressLabel = document.querySelector("#operation-progress-label");
  const cancelOperationButton = document.querySelector("#cancel-operation");
  const previewPagination = document.querySelector("#preview-pagination");
  const previewPageLabel = document.querySelector("#preview-page-label");
  const previousPageButton = document.querySelector("#previous-page");
  const nextPageButton = document.querySelector("#next-page");
  let rootHandle = null;
  let components = PRESETS.date_original.map((part) => ({ ...part }));
  let previewPlan = null;
  let lastRun = null;
  let operationCancelled = false;
  let previewPage = 0;
  let previewItems = [];

  function invalidatePreview() {
    previewPlan = null;
    previewItems = [];
    previewWrap.hidden = true;
    notice.hidden = true;
  }

  function updateProgress(label, value, max = 100) {
    operationProgressLabel.textContent = label;
    operationProgress.hidden = false;
    if (value === null) {
      operationProgressBar.removeAttribute("value");
    } else {
      operationProgressBar.max = max;
      operationProgressBar.value = value;
    }
  }

  function finishProgress() {
    operationProgress.hidden = true;
    cancelOperationButton.disabled = false;
    operationProgressBar.removeAttribute("value");
  }

  function yieldToBrowser() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function throwIfCancelled() {
    if (operationCancelled) throw new Error("Operación cancelada.");
  }

  function showNotice(message, isError = false) {
    notice.textContent = message;
    notice.classList.toggle("error", isError);
    notice.hidden = false;
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

  function extensionOf(name) {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot) : "";
  }

  function dateText(date, format) {
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const separator = {
      yyyy_mm_dd: "_",
      "yyyy-mm-dd": "-",
      yyyymmdd: ""
    }[format];
    return separator ? `${year}${separator}${month}${separator}${day}` : `${year}${month}${day}`;
  }

  function buildName(name, date, selectedComponents, dateFormat) {
    const extension = extensionOf(name);
    const stem = extension ? name.slice(0, -extension.length) : name;
    const values = {
      date: dateText(date, dateFormat),
      original_name: name,
      original_stem: stem,
      extension
    };
    const result = selectedComponents.map((part) =>
      part.kind === "field" ? values[part.value] : part.value
    ).join("");
    if (
      !result ||
      result === "." ||
      result === ".." ||
      INVALID_NAME.test(result) ||
      result.endsWith(" ") ||
      result.endsWith(".") ||
      RESERVED_NAME.test(result)
    ) {
      throw new Error("El formato genera un nombre de archivo no válido.");
    }
    return result;
  }

  async function* walkEntries(directoryHandle, relativeDirectory, recursive) {
    for await (const entry of directoryHandle.values()) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      yield { handle: entry, parent: directoryHandle, relativePath };
      if (recursive && entry.kind === "directory") {
        yield* walkEntries(entry, relativePath, true);
      }
    }
  }

  function renderPreview(items) {
    previewRows.replaceChildren();
    const pageCount = Math.max(1, Math.ceil(items.length / PREVIEW_PAGE_SIZE));
    previewPage = Math.min(previewPage, pageCount - 1);
    const start = previewPage * PREVIEW_PAGE_SIZE;
    const visibleItems = items.slice(start, start + PREVIEW_PAGE_SIZE);
    for (const item of visibleItems) {
      const row = document.createElement("tr");
      row.className = `is-${item.status}`;
      const oldName = document.createElement("td");
      oldName.textContent = item.originalPath;
      const source = document.createElement("td");
      source.textContent = item.dateSource || "—";
      const status = document.createElement("td");
      status.className = "status";
      status.textContent = {
        ready: "Lista",
        unchanged: "Sin cambio",
        skipped: "Omitida",
        conflict: "Conflicto"
      }[item.status];
      status.title = item.reason || "";
      const newName = document.createElement("td");
      newName.textContent = item.newPath || item.reason || "—";
      row.append(oldName, source, status, newName);
      previewRows.append(row);
    }
    previewPagination.hidden = items.length <= PREVIEW_PAGE_SIZE;
    previewPageLabel.textContent =
      `Mostrando ${start + 1}–${Math.min(start + PREVIEW_PAGE_SIZE, items.length)} de ${items.length}`;
    previousPageButton.disabled = previewPage === 0;
    nextPageButton.disabled = previewPage >= pageCount - 1;
  }

  async function createPreview() {
    if (!rootHandle) {
      showNotice("Selecciona una carpeta antes de crear la vista previa.", true);
      return;
    }
    if (components.length === 0) {
      showNotice("Añade al menos una pieza al formato del nombre.", true);
      return;
    }
    const selectedComponents = components.map((part) => ({ ...part }));
    const selectedDateFormat = document.querySelector("#date-format").value;
    const selectedRecursive = recursiveInput.checked;
    const selectedRoot = rootHandle;
    invalidatePreview();
    operationCancelled = false;
    previewButton.disabled = true;
    confirmButton.disabled = true;
    previewButton.textContent = "Leyendo fotografías…";
    updateProgress("Indexando archivos…", null);
    try {
      const existingPaths = new Set();
      let entryCount = 0;
      let photoCount = 0;
      for await (const entry of walkEntries(selectedRoot, "", selectedRecursive)) {
        throwIfCancelled();
        existingPaths.add(entry.relativePath.toLowerCase());
        entryCount += 1;
        if (
          entry.handle.kind === "file" &&
          SUPPORTED_EXTENSIONS.has(extensionOf(entry.handle.name).toLowerCase())
        ) {
          photoCount += 1;
        }
        if (entryCount % 100 === 0) {
          updateProgress(`Indexando ${entryCount} elementos…`, null);
          await yieldToBrowser();
        }
      }

      const items = [];
      const destinations = new Map();
      let processedCount = 0;
      for await (const entry of walkEntries(selectedRoot, "", selectedRecursive)) {
        throwIfCancelled();
        if (
          entry.handle.kind !== "file" ||
          !SUPPORTED_EXTENSIONS.has(extensionOf(entry.handle.name).toLowerCase())
        ) {
          continue;
        }
        processedCount += 1;
        if (processedCount % 10 === 1 || processedCount === photoCount) {
          updateProgress(`Leyendo fotografía ${processedCount} de ${photoCount}…`, processedCount, photoCount || 1);
          await yieldToBrowser();
        }
        let file;
        let capture;
        try {
          file = await entry.handle.getFile();
          capture = await PhotoDateMetadata.readCaptureDate(file);
        } catch (error) {
          throwIfCancelled();
          items.push({
            originalPath: entry.relativePath,
            newPath: null,
            status: "skipped",
            reason: `No se pudieron leer los metadatos: ${error.message}`
          });
          continue;
        }
        if (!capture) {
          items.push({
            originalPath: entry.relativePath,
            newPath: null,
            status: "skipped",
            reason: "No se encontró una fecha válida en los metadatos ni en el archivo."
          });
          continue;
        }
        let newName;
        try {
          newName = buildName(entry.handle.name, capture.date, selectedComponents, selectedDateFormat);
        } catch (error) {
          items.push({
            originalPath: entry.relativePath,
            newPath: null,
            status: "conflict",
            reason: error.message,
            dateSource: capture.source
          });
          continue;
        }
        const relativeDirectory = entry.relativePath.includes("/")
          ? entry.relativePath.slice(0, entry.relativePath.lastIndexOf("/") + 1)
          : "";
        const newPath = `${relativeDirectory}${newName}`;
        if (newPath === entry.relativePath) {
          items.push({ originalPath: entry.relativePath, newPath, status: "unchanged", dateSource: capture.source });
          continue;
        }
        const item = {
          originalPath: entry.relativePath,
          newPath,
          status: "ready",
          dateSource: capture.source,
          sourceHandle: entry.handle,
          parentHandle: entry.parent,
          oldName: entry.handle.name,
          newName,
          sourceSize: file.size,
          sourceLastModified: file.lastModified
        };
        items.push(item);
        const destinationKey = newPath.toLowerCase();
        if (!destinations.has(destinationKey)) destinations.set(destinationKey, []);
        destinations.get(destinationKey).push(item);
        if (processedCount % 10 === 0) await yieldToBrowser();
      }
      throwIfCancelled();
      if (
        rootHandle !== selectedRoot ||
        recursiveInput.checked !== selectedRecursive ||
        document.querySelector("#date-format").value !== selectedDateFormat ||
        JSON.stringify(components) !== JSON.stringify(selectedComponents)
      ) {
        throw new Error("La configuración cambió durante el análisis. Prepara una vista previa nueva.");
      }
      for (const [destination, collisions] of destinations) {
        if (existingPaths.has(destination) || collisions.length > 1) {
          for (const item of collisions) {
            item.status = "conflict";
            item.reason = "El nombre de destino ya existe o se repite en la vista previa.";
          }
        }
      }
      items.sort((left, right) => left.originalPath.localeCompare(right.originalPath));
      const counts = items.reduce((result, item) => {
        result[item.status] = (result[item.status] || 0) + 1;
        return result;
      }, {});
      const renameCount = counts.ready || 0;
      previewSummary.textContent =
        `${items.length} fotografías revisadas · ${renameCount} listas para renombrar` +
        `${counts.conflict ? ` · ${counts.conflict} conflictos` : ""}` +
        `${counts.skipped ? ` · ${counts.skipped} sin fecha válida` : ""}`;
      previewItems = items;
      previewPage = 0;
      renderPreview(previewItems);
      previewPlan = items;
      confirmButton.disabled = renameCount === 0;
      previewWrap.hidden = false;
      showNotice("Vista previa lista. Comprueba los nombres y los avisos antes de confirmar.");
    } catch (error) {
      previewPlan = null;
      previewWrap.hidden = true;
      if (operationCancelled) {
        showNotice("Análisis cancelado. No se modificó ningún archivo.");
      } else {
        showNotice(`No se pudo leer la carpeta: ${error.message}`, true);
      }
    } finally {
      finishProgress();
      previewButton.disabled = false;
      previewButton.textContent = "Preparar vista previa ↗";
    }
  }

  async function ensureDestinationIsFree(directoryHandle, name) {
    for await (const entry of directoryHandle.values()) {
      if (entry.name.toLowerCase() === name.toLowerCase()) {
        throw new Error(`El destino ya existe: ${name}`);
      }
    }
  }

  async function writeCopy(directoryHandle, name, file) {
    await ensureDestinationIsFree(directoryHandle, name);
    const newHandle = await directoryHandle.getFileHandle(name, { create: true });
    try {
      const writable = await newHandle.createWritable();
      await writable.write(file);
      await writable.close();
      return newHandle;
    } catch (error) {
      try {
        await directoryHandle.removeEntry(name);
      } catch (cleanupError) {
        throw new Error(`${error.message}. Tampoco se pudo limpiar el archivo parcial ${name}: ${cleanupError.message}`);
      }
      throw error;
    }
  }

  async function renameItem(item) {
    const originalFile = await item.sourceHandle.getFile();
    if (
      originalFile.size !== item.sourceSize ||
      originalFile.lastModified !== item.sourceLastModified
    ) {
      throw new Error(`El archivo cambió desde la vista previa: ${item.originalPath}`);
    }
    await writeCopy(item.parentHandle, item.newName, originalFile);
    try {
      await item.parentHandle.removeEntry(item.oldName);
    } catch (error) {
      try {
        await item.parentHandle.removeEntry(item.newName);
      } catch (cleanupError) {
        throw new Error(
          `No se pudo retirar ${item.oldName}; el original sigue en su sitio. ` +
          `Tampoco se pudo retirar la copia ${item.newName}: ${cleanupError.message}`
        );
      }
      throw new Error(`No se pudo retirar ${item.oldName}; se conservó el original y se limpió la copia: ${error.message}`);
    }
  }

  async function undoRun(run) {
    for (let index = run.length - 1; index >= 0; index -= 1) {
      const item = run[index];
      const renamedHandle = await item.parentHandle.getFileHandle(item.newName);
      const renamedFile = await renamedHandle.getFile();
      await writeCopy(item.parentHandle, item.oldName, renamedFile);
      try {
        await item.parentHandle.removeEntry(item.newName);
      } catch (error) {
        try {
          await item.parentHandle.removeEntry(item.oldName);
        } catch (cleanupError) {
          throw new Error(
            `No se pudo retirar ${item.newName}; se mantuvieron ambos archivos. ` +
            `Tampoco se pudo limpiar ${item.oldName}: ${cleanupError.message}`
          );
        }
        throw new Error(`No se pudo retirar ${item.newName}; se restauró la copia original: ${error.message}`);
      }
      run.splice(index, 1);
    }
  }

  async function confirmRenames() {
    if (!previewPlan) return;
    const ready = previewPlan.filter((item) => item.status === "ready");
    if (!ready.length) return;
    const scope = recursiveInput.checked ? "en la carpeta y sus subcarpetas" : "en la carpeta seleccionada";
    if (!window.confirm(`Se cambiarán ${ready.length} nombres ${scope}. No se sobrescribirán archivos. ¿Continuar?`)) return;
    operationCancelled = false;
    confirmButton.disabled = true;
    const renamed = [];
    updateProgress("Preparando cambios…", 0, ready.length);
    try {
      for (let index = 0; index < ready.length; index += 1) {
        throwIfCancelled();
        const item = ready[index];
        await renameItem(item);
        renamed.push(item);
        updateProgress(`Renombrando ${renamed.length} de ${ready.length}…`, renamed.length, ready.length);
        if (renamed.length % 10 === 0) await yieldToBrowser();
      }
      lastRun = renamed;
      undoControl.hidden = false;
      previewPlan = null;
      previewWrap.hidden = true;
      showNotice(`${renamed.length} archivos renombrados. Puedes deshacer esta acción mientras esta página siga abierta.`);
    } catch (error) {
      previewPlan = null;
      previewWrap.hidden = true;
      const renamedCount = renamed.length;
      let rollbackFailed = false;
      let detail = operationCancelled
        ? `Operación cancelada después de ${renamedCount} cambios.`
        : `El renombrado se detuvo: ${error.message}`;
      if (renamed.length) {
        try {
          updateProgress(`Restaurando ${renamed.length} cambios…`, null);
          await undoRun(renamed);
          detail += ` Se revirtieron los ${renamedCount} cambios anteriores.`;
        } catch (rollbackError) {
          rollbackFailed = true;
          detail += ` Se habían completado ${renamedCount} cambios y no se pudieron revertir todos: ${rollbackError.message}`;
          lastRun = renamed;
          undoControl.hidden = false;
        }
      }
      showNotice(detail, !operationCancelled || rollbackFailed);
    } finally {
      finishProgress();
      confirmButton.disabled = false;
    }
  }

  async function selectFolder() {
    if (!window.isSecureContext || typeof window.showDirectoryPicker !== "function") {
      showNotice("Este navegador no permite modificar carpetas desde esta página. Usa la última versión de Chrome o Edge, o descarga la aplicación para Windows.", true);
      return;
    }
    try {
      rootHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      folderName.textContent = rootHandle.name;
      lastRun = null;
      undoControl.hidden = true;
      invalidatePreview();
    } catch (error) {
      if (error.name !== "AbortError") showNotice(`No se pudo abrir la carpeta: ${error.message}`, true);
    }
  }

  document.querySelectorAll(".preset").forEach((button) => {
    button.addEventListener("click", () => {
      components = (PRESETS[button.dataset.preset] || []).map((part) => ({ ...part }));
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
    } else if (value) {
      components.push({ kind: "field", value });
      setCustomPreset();
    }
    event.target.value = "";
  });
  document.querySelector("#add-text-button").addEventListener("click", (event) => {
    event.preventDefault();
    const value = document.querySelector("#literal-text").value;
    if (value) {
      components.push({ kind: "text", value });
      setCustomPreset();
    }
    document.querySelector("#text-dialog").close();
  });

  document.querySelector("#browse-button").addEventListener("click", selectFolder);
  document.querySelector("#preview-button").addEventListener("click", createPreview);
  document.querySelector("#confirm-button").addEventListener("click", confirmRenames);
  cancelOperationButton.addEventListener("click", () => {
    operationCancelled = true;
    cancelOperationButton.disabled = true;
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
  document.querySelector("#recursive").addEventListener("change", invalidatePreview);
  document.querySelector("#date-format").addEventListener("change", invalidatePreview);
  document.querySelector("#undo-button").addEventListener("click", async () => {
    if (!lastRun) return;
    try {
      const count = lastRun.length;
      await undoRun(lastRun);
      lastRun = null;
      undoControl.hidden = true;
      showNotice(`${count} archivos han recuperado su nombre original.`);
    } catch (error) {
      showNotice(`No se pudo completar el deshacer: ${error.message}`, true);
    }
  });

  const browserNote = document.querySelector("#browser-note");
  if (!window.isSecureContext || typeof window.showDirectoryPicker !== "function") {
    browserNote.textContent = "Para renombrar carpetas desde el navegador necesitas Chrome o Edge actualizado. En otros navegadores puedes descargar la aplicación para Windows.";
    document.querySelector("#browse-button").disabled = true;
  } else {
    browserNote.textContent = "La selección y escritura de carpetas está disponible en navegadores Chromium actuales. El acceso solo se concede cuando eliges una carpeta.";
  }
  updateTokens();
})();
