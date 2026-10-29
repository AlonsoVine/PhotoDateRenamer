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
  let rootHandle = null;
  let components = PRESETS.date_original.map((part) => ({ ...part }));
  let previewPlan = null;
  let lastRun = null;

  function invalidatePreview() {
    previewPlan = null;
    previewWrap.hidden = true;
    notice.hidden = true;
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

  function dateText(date) {
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const separator = {
      yyyy_mm_dd: "_",
      "yyyy-mm-dd": "-",
      yyyymmdd: ""
    }[document.querySelector("#date-format").value];
    return separator ? `${year}${separator}${month}${separator}${day}` : `${year}${month}${day}`;
  }

  function buildName(name, date) {
    const extension = extensionOf(name);
    const stem = extension ? name.slice(0, -extension.length) : name;
    const values = {
      date: dateText(date),
      original_name: name,
      original_stem: stem,
      extension
    };
    const result = components.map((part) =>
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

  async function collectFiles(directoryHandle, relativeDirectory, recursive, entries) {
    for await (const entry of directoryHandle.values()) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      entries.push({ handle: entry, parent: directoryHandle, relativePath });
      if (recursive && entry.kind === "directory") {
        await collectFiles(entry, relativePath, true, entries);
      }
    }
  }

  function renderPreview(items) {
    previewRows.replaceChildren();
    for (const item of items) {
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
    invalidatePreview();
    previewButton.disabled = true;
    previewButton.textContent = "Leyendo fotografías…";
    try {
      const entries = [];
      await collectFiles(rootHandle, "", recursiveInput.checked, entries);
      const photoEntries = entries.filter((entry) =>
        entry.handle.kind === "file" &&
        SUPPORTED_EXTENSIONS.has(extensionOf(entry.handle.name).toLowerCase())
      );
      const existingPaths = new Set(entries.map((entry) => entry.relativePath.toLowerCase()));
      const items = [];
      const destinations = new Map();
      for (const entry of photoEntries) {
        let file;
        let capture;
        try {
          file = await entry.handle.getFile();
          capture = await PhotoDateMetadata.readCaptureDate(file);
        } catch (error) {
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
          newName = buildName(entry.handle.name, capture.date);
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
          newName
        };
        items.push(item);
        const destinationKey = newPath.toLowerCase();
        if (!destinations.has(destinationKey)) destinations.set(destinationKey, []);
        destinations.get(destinationKey).push(item);
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
      renderPreview(items);
      previewPlan = items;
      confirmButton.disabled = renameCount === 0;
      previewWrap.hidden = false;
      showNotice("Vista previa lista. Comprueba los nombres y los avisos antes de confirmar.");
    } catch (error) {
      showNotice(`No se pudo leer la carpeta: ${error.message}`, true);
    } finally {
      previewButton.disabled = false;
      previewButton.innerHTML = 'Preparar vista previa <span aria-hidden="true">↗</span>';
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
    confirmButton.disabled = true;
    const renamed = [];
    try {
      for (const item of ready) {
        await renameItem(item);
        renamed.push(item);
      }
      lastRun = renamed;
      undoControl.hidden = false;
      previewPlan = null;
      previewWrap.hidden = true;
      showNotice(`${renamed.length} archivos renombrados. Puedes deshacer esta acción mientras esta página siga abierta.`);
    } catch (error) {
      previewPlan = null;
      previewWrap.hidden = true;
      let detail = `El renombrado se detuvo: ${error.message}`;
      if (renamed.length) {
        try {
          await undoRun(renamed);
          detail += ` Se revirtieron los ${renamed.length} cambios anteriores.`;
        } catch (rollbackError) {
          detail += ` Se habían completado ${renamed.length} cambios y no se pudieron revertir todos: ${rollbackError.message}`;
          lastRun = renamed;
          undoControl.hidden = false;
        }
      }
      showNotice(detail, true);
    } finally {
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
