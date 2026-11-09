/*
 * Browser backend for the published web version.
 *
 * The interface (app.js) talks to the local Python server through `post(path, data)`.
 * On GitHub Pages there is no server: this file answers the same requests inside the
 * page, with the File System Access API and the metadata reader in metadata.js.
 * Photos are read and renamed on the user's device; nothing is sent over the network.
 *
 * The naming rules mirror src/photodaterenamer/renamer.py (statuses, reasons,
 * collisions and the 255-character limit), and a confirmed batch is applied file by
 * file: a file that fails is reported with its reason and the rest continue.
 */
(function (root) {
  "use strict";

  const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".tif", ".tiff"]);
  const FIELDS = new Set(["date", "original_name", "original_stem", "extension"]);
  const DATE_SEPARATORS = { yyyy_mm_dd: "_", "yyyy-mm-dd": "-", yyyymmdd: "" };
  const INVALID_NAME = /[<>:"/\\|?*\u0000-\u001f]/;
  const RESERVED_NAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;
  const MAX_NAME_LENGTH = 255;
  const THUMBNAIL_SIZES = new Set([96, 360]);

  class BackendError extends Error {
    constructor(message, status = 400) {
      super(message);
      this.status = status;
    }
  }

  const state = {
    folders: new Map(), // label -> directory handle
    scan: null,
    plans: new Map(),
    apply: null,
    run: null, // { id, folder, pairs: [{ parent, oldName, newName, oldPath, newPath }] }
    gallery: { folder: null, files: new Map() }, // relative path -> file handle
    dateCache: { folder: null, dates: new Map() }
  };

  /* ------------------------------------------------------------ helpers */

  function supported() {
    return Boolean(root.isSecureContext && typeof root.showDirectoryPicker === "function");
  }

  function extensionOf(name) {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot) : "";
  }

  function isPhoto(name) {
    return SUPPORTED_EXTENSIONS.has(extensionOf(name).toLowerCase());
  }

  function formatDate(date, format) {
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const separator = DATE_SEPARATORS[format];
    return `${year}${separator}${month}${separator}${day}`;
  }

  function validateComponents(components) {
    if (!Array.isArray(components) || !components.length) {
      throw new BackendError("Añade al menos un elemento al formato del nombre.");
    }
    return components.map((component) => {
      const kind = component && component.kind;
      const value = component && component.value !== undefined ? component.value : "";
      if (kind === "field" && FIELDS.has(value)) return { kind, value };
      if (kind === "text" && typeof value === "string" && value.length <= 64) return { kind, value };
      throw new BackendError("El formato contiene un elemento no válido.");
    });
  }

  function buildName(name, date, dateFormat, components) {
    const extension = extensionOf(name);
    const values = {
      date: formatDate(date, dateFormat),
      original_name: name,
      original_stem: extension ? name.slice(0, -extension.length) : name,
      extension
    };
    const result = components.map((part) => (part.kind === "field" ? values[part.value] : part.value)).join("");
    if (
      !result || result === "." || result === ".." || INVALID_NAME.test(result) ||
      result.endsWith(" ") || result.endsWith(".") || RESERVED_NAME.test(result)
    ) {
      throw new Error("El formato genera un nombre de archivo no válido.");
    }
    return result;
  }

  function nameIsTooLong(name) {
    // Windows counts UTF-16 units; Linux and macOS count UTF-8 bytes.
    const windows = /Windows/i.test((root.navigator && root.navigator.userAgent) || "");
    return windows ? name.length > MAX_NAME_LENGTH : new TextEncoder().encode(name).length > MAX_NAME_LENGTH;
  }

  function folderLabel(handle) {
    for (const [label, known] of state.folders) {
      if (known === handle) return label;
    }
    let label = handle.name || "Carpeta";
    for (let copy = 2; state.folders.has(label); copy += 1) label = `${handle.name} (${copy})`;
    state.folders.set(label, handle);
    return label;
  }

  async function sameEntry(left, right) {
    return typeof left.isSameEntry === "function" ? left.isSameEntry(right) : left === right;
  }

  async function registerFolder(handle) {
    for (const [label, known] of state.folders) {
      if (await sameEntry(known, handle)) {
        state.folders.set(label, handle);
        return label;
      }
    }
    return folderLabel(handle);
  }

  function folderFor(label) {
    const handle = typeof label === "string" ? state.folders.get(label) : undefined;
    if (!handle) throw new BackendError("La carpeta seleccionada no existe o no es una carpeta.");
    return handle;
  }

  /** Entries in the same order as the Python engine: case-folded names, depth first. */
  async function* walk(directory, prefix, recursive) {
    const entries = [];
    for await (const entry of directory.values()) entries.push(entry);
    entries.sort((left, right) => {
      const a = left.name.toLowerCase();
      const b = right.name.toLowerCase();
      return a < b ? -1 : a > b ? 1 : 0;
    });
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      yield { entry, parent: directory, path };
      if (recursive && entry.kind === "directory") yield* walk(entry, path, true);
    }
  }

  async function exists(directory, name) {
    try {
      await directory.getFileHandle(name);
      return true;
    } catch (error) {
      if (error.name === "TypeMismatchError") return true;
      if (error.name !== "NotFoundError") throw error;
    }
    try {
      await directory.getDirectoryHandle(name);
      return true;
    } catch (error) {
      if (error.name === "TypeMismatchError") return true;
      if (error.name === "NotFoundError") return false;
      throw error;
    }
  }

  function describe(error) {
    if (!error) return "Error desconocido.";
    if (error.name === "NotAllowedError") return "El navegador no tiene permiso para modificar este archivo.";
    if (error.name === "NoModificationAllowedError") return "El archivo está abierto en otro programa o es de solo lectura.";
    if (error.name === "NotFoundError") return "El archivo ya no está en la carpeta.";
    if (error.name === "QuotaExceededError") return "No queda espacio suficiente en el disco.";
    return error.message || String(error);
  }

  /** Rename without ever overwriting: a real move when the browser offers it, otherwise copy then remove. */
  async function renameFile(parent, handle, oldName, newName) {
    if (await exists(parent, newName)) throw new Error(`Ya existe un archivo llamado ${newName}.`);
    if (typeof handle.move === "function") {
      try {
        await handle.move(newName);
        return handle;
      } catch (error) {
        if (!(error instanceof TypeError) && error.name !== "NotSupportedError" && error.name !== "InvalidModificationError") {
          throw error;
        }
        if (await exists(parent, newName)) throw new Error(`Ya existe un archivo llamado ${newName}.`);
      }
    }
    const file = await handle.getFile();
    const copy = await parent.getFileHandle(newName, { create: true });
    try {
      const writable = await copy.createWritable({ keepExistingData: false });
      await writable.write(file);
      await writable.close();
    } catch (error) {
      await parent.removeEntry(newName).catch(() => {});
      throw error;
    }
    try {
      await parent.removeEntry(oldName);
    } catch (error) {
      await parent.removeEntry(newName).catch(() => {});
      throw new Error(`No se pudo retirar ${oldName}; el original sigue en su sitio. ${describe(error)}`);
    }
    return copy;
  }

  /** Same check as the engine (Pillow): a file that is not really a JPEG, PNG or TIFF is skipped. */
  async function looksLikeImage(file) {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const jpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => head[index] === byte);
    const tiff = (head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a && head[3] === 0x00) ||
      (head[0] === 0x4d && head[1] === 0x4d && head[2] === 0x00 && head[3] === 0x2a);
    return jpeg || png || tiff;
  }

  function relativeParent(path) {
    const slash = path.lastIndexOf("/");
    return slash === -1 ? "" : path.slice(0, slash + 1);
  }

  /* ----------------------------------------------------------- handlers */

  async function selectFolder() {
    if (!supported()) {
      throw new BackendError(
        "Este navegador no permite elegir carpetas. Usa Chrome o Edge en un ordenador, o descarga la aplicación para Windows."
      );
    }
    let handle;
    try {
      handle = await root.showDirectoryPicker({ id: "photodaterenamer", mode: "readwrite" });
    } catch (error) {
      if (error.name === "AbortError") return { folder: "" };
      throw new BackendError(`No se pudo abrir el selector de carpetas: ${describe(error)}`);
    }
    return { folder: await registerFolder(handle) };
  }

  async function checkFolder({ folder }) {
    if (typeof folder !== "string" || !folder.trim()) return { ok: false, error: "Elige una carpeta." };
    if (!state.folders.has(folder)) {
      return { ok: false, error: "En la versión web hay que elegir la carpeta con el botón «Elegir carpeta»." };
    }
    return { ok: true, folder };
  }

  async function ensureWritable(handle) {
    if (typeof handle.queryPermission !== "function") return;
    const options = { mode: "readwrite" };
    if ((await handle.queryPermission(options)) === "granted") return;
    if ((await handle.requestPermission(options)) !== "granted") {
      throw new BackendError("Sin permiso para modificar la carpeta: el navegador no lo concedió.");
    }
  }

  async function preview(payload) {
    const handle = folderFor(payload.folder);
    const components = validateComponents(payload.components);
    const dateFormat = payload.date_format || "yyyy_mm_dd";
    if (!(dateFormat in DATE_SEPARATORS)) throw new BackendError("El formato de fecha no es válido.");
    const recursive = payload.recursive === true;
    if (state.scan && !state.scan.completed) throw new BackendError("Ya hay un análisis en curso.");
    const scan = {
      scan_id: payload.scan_id || crypto.randomUUID(),
      phase: "starting",
      completed: false,
      scanned: 0,
      total: null,
      cancelled: false
    };
    state.scan = scan;
    if (state.dateCache.folder !== handle || state.dateCache.dates.size > 200000) {
      state.dateCache = { folder: handle, dates: new Map() };
    }
    const cache = state.dateCache.dates;
    const check = () => {
      if (scan.cancelled) throw new BackendError("Análisis cancelado.", 499);
    };
    try {
      const existing = new Set();
      let entryCount = 0;
      let photoCount = 0;
      scan.phase = "indexing";
      for await (const { entry, path } of walk(handle, "", recursive)) {
        check();
        entryCount += 1;
        existing.add(path.toLowerCase());
        if (entry.kind === "file" && isPhoto(entry.name)) photoCount += 1;
        if (entryCount % 100 === 0) scan.scanned = entryCount;
      }
      scan.phase = "scanning";
      scan.scanned = 0;
      scan.total = photoCount;
      const items = [];
      const destinations = new Map();
      const files = new Map();
      for await (const { entry, parent, path } of walk(handle, "", recursive)) {
        check();
        if (entry.kind !== "file" || !isPhoto(entry.name)) continue;
        scan.scanned += 1;
        files.set(path, entry);
        let file;
        let capture;
        try {
          file = await entry.getFile();
          if (!(await looksLikeImage(file))) {
            items.push({
              original_name: path, new_name: null, status: "skipped",
              reason: "No se pudieron leer los metadatos: el archivo no es una imagen reconocible."
            });
            continue;
          }
          const key = `${path}\u0000${file.size}\u0000${file.lastModified}`;
          if (cache.has(key)) {
            capture = cache.get(key);
          } else {
            capture = await root.PhotoDateMetadata.readCaptureDate(file);
            cache.set(key, capture);
          }
        } catch (error) {
          items.push({ original_name: path, new_name: null, status: "skipped", reason: `No se pudieron leer los metadatos: ${describe(error)}` });
          continue;
        }
        if (!capture) {
          items.push({
            original_name: path, new_name: null, status: "skipped",
            reason: "No se encontró una fecha válida en los metadatos ni en el archivo."
          });
          continue;
        }
        const dateText = formatDate(capture.date, dateFormat);
        const base = { original_name: path, date_source: capture.source, date_text: dateText };
        let newName;
        try {
          newName = buildName(entry.name, capture.date, dateFormat, components);
        } catch (error) {
          items.push({ ...base, new_name: null, status: "conflict", reason: error.message });
          continue;
        }
        if (newName === entry.name) {
          items.push({ ...base, new_name: path, status: "unchanged", reason: null });
          continue;
        }
        if (nameIsTooLong(newName)) {
          items.push({
            ...base, new_name: null, status: "conflict",
            reason: `El nombre resultante supera los ${MAX_NAME_LENGTH} caracteres permitidos.`
          });
          continue;
        }
        const destination = `${relativeParent(path)}${newName}`;
        const item = {
          ...base, new_name: destination, status: "ready", reason: null,
          _parent: parent, _handle: entry, _oldName: entry.name, _newName: newName,
          _size: file.size, _modified: file.lastModified
        };
        items.push(item);
        const key = destination.toLowerCase();
        if (!destinations.has(key)) destinations.set(key, []);
        destinations.get(key).push(item);
      }
      check();
      for (const [key, clashing] of destinations) {
        if (existing.has(key) || clashing.length > 1) {
          for (const item of clashing) {
            item.status = "conflict";
            item.reason = "El nombre de destino ya existe o se repite en la vista previa.";
          }
        }
      }
      items.sort((left, right) => {
        const a = left.original_name.toLowerCase();
        const b = right.original_name.toLowerCase();
        return a < b ? -1 : a > b ? 1 : 0;
      });
      const planId = crypto.randomUUID().replace(/-/g, "");
      const folder = folderLabel(handle);
      state.plans.clear();
      state.plans.set(planId, { id: planId, folder, handle, items });
      state.gallery = { folder: handle, files };
      return {
        plan_id: planId,
        folder,
        folder_name: handle.name || folder,
        scan_id: scan.scan_id,
        entry_count: entryCount,
        rename_count: items.filter((item) => item.status === "ready").length,
        items: items.map(({ original_name, new_name, status, reason, date_source, date_text }) => ({
          original_name, new_name, status, reason: reason || null,
          date_source: date_source || null, date_text: date_text || null
        }))
      };
    } catch (error) {
      if (scan.cancelled) return { cancelled: true, scan_id: scan.scan_id };
      if (error instanceof BackendError) throw error;
      throw new BackendError(`No se pudo leer la carpeta: ${describe(error)}`);
    } finally {
      scan.completed = true;
    }
  }

  function progress({ scan_id }) {
    const scan = state.scan;
    if (!scan || scan.scan_id !== scan_id) {
      return { scan_id, phase: "pending", completed: false, scanned: 0, total: null, cancelled: false };
    }
    const { phase, completed, scanned, total, cancelled } = scan;
    return { scan_id, phase, completed, scanned, total, cancelled };
  }

  function cancel({ scan_id }) {
    const scan = state.scan;
    if (!scan || scan.scan_id !== scan_id || scan.completed) {
      return { cancelled: false, reason: "El análisis ya terminó o no existe." };
    }
    scan.cancelled = true;
    return { cancelled: true };
  }

  async function confirm({ plan_id }) {
    if (typeof plan_id !== "string") throw new BackendError("El identificador de vista previa no es válido.");
    const plan = state.plans.get(plan_id);
    if (!plan) throw new BackendError("La vista previa ya se aplicó o ha caducado.");
    if (state.apply && !state.apply.completed) throw new BackendError("Ya se están aplicando cambios.");
    await ensureWritable(plan.handle);
    state.plans.delete(plan_id);
    const ready = plan.items.filter((item) => item.status === "ready");
    const apply = { plan_id, completed: false, done: 0, total: ready.length };
    state.apply = apply;
    const run = { id: plan_id, folder: plan.folder, handle: plan.handle, pairs: [] };
    const renamed = [];
    const failures = [];
    try {
      for (const item of ready) {
        try {
          const file = await item._handle.getFile();
          if (file.size !== item._size || file.lastModified !== item._modified) {
            throw new Error("El archivo cambió desde la vista previa.");
          }
          const handle = await renameFile(item._parent, item._handle, item._oldName, item._newName);
          // The previous batch stays undoable until this one actually renames a file.
          if (!run.pairs.length) state.run = run;
          run.pairs.push({ parent: item._parent, oldName: item._oldName, newName: item._newName, oldPath: item.original_name, newPath: item.new_name });
          renamed.push({ old_name: item.original_name, new_name: item.new_name });
          if (state.gallery.folder === plan.handle) state.gallery.files.set(item.new_name, handle);
        } catch (error) {
          failures.push({ original_name: item.original_name, new_name: item.new_name, reason: describe(error) });
        }
        apply.done += 1;
      }
    } finally {
      apply.completed = true;
    }
    return {
      run_id: renamed.length ? plan_id : null,
      renamed_count: renamed.length,
      failed_count: failures.length,
      renamed,
      failures
    };
  }

  function applyProgress({ plan_id }) {
    const apply = state.apply;
    if (!apply || apply.plan_id !== plan_id) return { plan_id, completed: false, done: 0, total: null };
    return { ...apply };
  }

  function lastRun() {
    const run = state.run;
    if (!run || !run.pairs.length) return { run_id: null };
    return { run_id: run.id, count: run.pairs.length, folder: run.folder, folder_name: run.handle.name || run.folder };
  }

  async function undo({ run_id }) {
    if (typeof run_id !== "string") throw new BackendError("El identificador del renombrado no es válido.");
    if (state.apply && !state.apply.completed) throw new BackendError("Espera a que terminen de aplicarse los cambios.");
    const run = state.run;
    if (!run || run.id !== run_id) throw new BackendError("No hay un renombrado disponible para deshacer.");
    await ensureWritable(run.handle);
    const pending = [];
    const failures = [];
    let restored = 0;
    for (const pair of [...run.pairs].reverse()) {
      try {
        const handle = await pair.parent.getFileHandle(pair.newName);
        const back = await renameFile(pair.parent, handle, pair.newName, pair.oldName);
        restored += 1;
        if (state.gallery.folder === run.handle) state.gallery.files.set(pair.oldPath, back);
      } catch (error) {
        pending.unshift(pair);
        failures.push({ original_name: pair.oldPath, current_name: pair.newPath, reason: describe(error) });
      }
    }
    if (pending.length) run.pairs = pending;
    else state.run = null;
    return {
      run_id: pending.length ? run_id : null,
      folder: run.folder,
      restored_count: restored,
      failed_count: failures.length,
      failures
    };
  }

  async function thumbnail({ path, size }) {
    if (typeof path !== "string" || !THUMBNAIL_SIZES.has(size)) {
      throw new BackendError("La petición de miniatura no es válida.");
    }
    const handle = state.gallery.files.get(path);
    if (!handle) throw new BackendError("Esa imagen no forma parte de la carpeta analizada.");
    let bitmap;
    try {
      const file = await handle.getFile();
      if (/\.tiff?$/i.test(file.name)) return new Response(null, { status: 204 });
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = typeof OffscreenCanvas === "function"
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement("canvas"), { width, height });
      canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
      const blob = canvas.convertToBlob
        ? await canvas.convertToBlob({ type: "image/jpeg", quality: 0.78 })
        : await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.78));
      return new Response(blob, { status: 200, headers: { "Content-Type": "image/jpeg" } });
    } catch (error) {
      return new Response(null, { status: 204 });
    } finally {
      if (bitmap) bitmap.close();
    }
  }

  /* ------------------------------------------------------------- router */

  const ROUTES = {
    "/api/select-folder": selectFolder,
    "/api/check-folder": checkFolder,
    "/api/preview": preview,
    "/api/progress": progress,
    "/api/cancel": cancel,
    "/api/confirm": confirm,
    "/api/apply-progress": applyProgress,
    "/api/last-run": lastRun,
    "/api/undo": undo
  };

  function json(status, data) {
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  }

  async function post(path, data = {}, signal = undefined) {
    if (signal && signal.aborted) throw new DOMException("Petición cancelada.", "AbortError");
    try {
      if (path === "/api/thumbnail") return await thumbnail(data);
      const handler = ROUTES[path];
      if (!handler) return json(404, { error: "Operación desconocida." });
      return json(200, await handler(data || {}));
    } catch (error) {
      if (error instanceof BackendError) return json(error.status === 499 ? 200 : error.status, { error: error.message });
      return json(500, { error: `Error interno de la página: ${describe(error)}` });
    }
  }

  root.PDR_BACKEND = { post, supported, platform: "web" };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { post, buildName, formatDate, validateComponents, nameIsTooLong, state };
  }
})(globalThis);
