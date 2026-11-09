"use strict";

/* PhotoDateRenamer — «Revelado» interface controller.
   Views: idle · scanning · empty · nophotos · cancelled · error · unknown · preview ·
          applying · success · partial · total · restored · undo-partial */

const H = window.PDRHelpers;
const FIELD_LABELS = {
  date: "Fecha",
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
const PRESET_LABELS = {
  date_original: "Fecha + nombre",
  date_stem: "Fecha, sin extensión",
  original_date: "Nombre + fecha",
  custom: "A medida"
};
const STATUS_LABELS = {
  ready: "Se renombra",
  conflict: "Conflicto",
  skipped: "Omitida",
  unchanged: "Sin cambio",
  renamed: "Hecho",
  failed: "Falló",
  pending: "Sin restaurar"
};
/* Short visible labels for narrow screens: state is never conveyed by colour alone. */
const STATUS_SHORT = {
  ready: "Renombra",
  conflict: "Conflicto",
  skipped: "Omitida",
  unchanged: "Igual",
  renamed: "Hecho",
  failed: "Falló",
  pending: "Pendiente"
};
const FILTER_LABELS = {
  all: "Todas",
  ready: "Se renombran",
  dated: "Ya fechadas",
  filedate: "Fecha del archivo",
  conflict: "Conflictos",
  skipped: "Omitidas",
  unchanged: "Sin cambio",
  renamed: "Renombradas",
  failed: "Fallaron",
  pending: "Sin restaurar"
};
const SAMPLE = { name: "IMG_0412.jpg", date: new Date(2024, 7, 14) };
const INVALID_NAME_TEXT = /[<>:"/\\|?*\u0000-\u001f]/;
const RESULT_VIEWS = ["success", "partial", "total", "undo-partial"];
const BUSY_VIEWS = ["applying", "undoing"];
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const narrowScreen = window.matchMedia("(max-width: 960px)");
const numberFormat = new Intl.NumberFormat("es-ES", { useGrouping: "always" });
const $ = (selector) => document.querySelector(selector);

const ui = {
  body: document.body,
  hero: $("#hero"),
  heroForm: $("#hero-form"),
  heroPath: $("#hero-path"),
  heroBrowse: $("#hero-browse"),
  heroMessage: $("#hero-message"),
  workbench: $("#workbench"),
  folderTitle: $("#folder-title"),
  folderPath: $("#folder-path-display"),
  changeFolder: $("#change-folder"),
  recursiveInputs: [...document.querySelectorAll("[data-recursive]")],
  formatDetails: $("#format-details"),
  formatSummaryValue: $("#format-summary-value"),
  formatLock: $("#format-lock"),
  presets: [...document.querySelectorAll(".preset")],
  addPieces: [...document.querySelectorAll(".add-piece")],
  dateRadios: [...document.querySelectorAll('input[name="date-format"]')],
  tokens: $("#tokens"),
  exampleOld: $("#example-old"),
  exampleNew: $("#example-new"),
  sheet: $("#sheet"),
  sheetKicker: $("#sheet-kicker"),
  sheetTitle: $("#sheet-title"),
  sheetTools: $("#sheet-tools"),
  search: $("#search"),
  filters: $("#filters"),
  progressView: $("#progress-view"),
  progressCount: $("#progress-count"),
  progressTotal: $("#progress-total"),
  progressBar: $("#progress-bar"),
  progressLabel: $("#progress-label"),
  cancelScan: $("#cancel-scan"),
  applyWarning: $("#apply-warning"),
  messageView: $("#message-view"),
  messageArt: $("#message-art"),
  messageText: $("#message-text"),
  messagePrimary: $("#message-primary"),
  messageSecondary: $("#message-secondary"),
  resultView: $("#result-view"),
  resultCount: $("#result-count"),
  resultOf: $("#result-of"),
  resultTotal: $("#result-total"),
  resultText: $("#result-text"),
  resultPrimary: $("#result-primary"),
  undoButton: $("#undo-button"),
  resultBack: $("#result-back"),
  listView: $("#list-view"),
  listScroller: $("#list-scroller"),
  listEmpty: $("#list-empty"),
  loupe: $("#loupe"),
  loupeBody: $("#loupe-body"),
  loupeImage: $("#loupe-image"),
  loupeStamp: $("#loupe-stamp"),
  applyBox: $("#apply-box"),
  applyHint: $("#apply-hint"),
  applyButton: $("#apply-button"),
  announcer: $("#announcer"),
  toast: $("#toast"),
  textDialog: $("#text-dialog"),
  literalText: $("#literal-text"),
  literalError: $("#literal-error"),
  detailDialog: $("#detail-dialog"),
  detailBody: $("#detail-body"),
  detailImage: $("#detail-image"),
  detailStamp: $("#detail-stamp"),
  confirmDialog: $("#confirm-dialog"),
  confirmTitle: $("#confirm-title"),
  confirmCount: $("#confirm-count"),
  confirmText: $("#confirm-text"),
  confirmExample: $("#confirm-example"),
  confirmDated: $("#confirm-dated"),
  confirmApply: $("#confirm-apply"),
  wordmark: $(".wordmark"),
  lastRun: $("#last-run"),
  lastRunText: $("#last-run-text"),
  lastRunUndo: $("#last-run-undo")
};

const state = {
  mode: "idle",
  view: "idle",
  folder: "",
  recursive: false,
  components: PRESETS.date_original.map((part) => ({ ...part })),
  preset: "date_original",
  plan: null,
  planSettings: null,
  result: null,
  lastRun: null,
  filter: "all",
  query: ""
};
let scanGeneration = 0;
let activeScan = null;
let refreshTimer = null;
let toastTimer = null;
/* Lines the new name may use in a row (2 below 1280 px, set by CSS --name-lines). */
let nameLines = 1;

/* ---------------------------------------------------------------- helpers */

function h(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === "class") element.className = value;
    else element.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

/** "texto *énfasis*" → nodes with <em>. */
function rich(text) {
  return text.split(/(\*[^*]+\*)/).filter(Boolean).map((part) =>
    part.startsWith("*") ? h("em", {}, part.slice(1, -1)) : document.createTextNode(part)
  );
}

/** "texto **negrita**" and "*énfasis*" → nodes with <b> / <em>. */
function strong(text) {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).filter(Boolean).map((part) => {
    if (part.startsWith("**")) return h("b", {}, part.slice(2, -2));
    if (part.startsWith("*") && part.length > 2) return h("em", {}, part.slice(1, -1));
    return document.createTextNode(part);
  });
}

const count = (value) => numberFormat.format(value);
const plural = (value, one, many) => `${count(value)} ${value === 1 ? one : many}`;

function setSeg(element, value) {
  const text = H.segmentDigits(value);
  element.textContent = text;
  element.dataset.ghost = H.segmentGhost(text);
}

function announce(message) {
  ui.announcer.textContent = "";
  window.setTimeout(() => { ui.announcer.textContent = message; }, 30);
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  toastTimer = window.setTimeout(() => { ui.toast.hidden = true; }, 6000);
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

class RequestError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function post(path, data = {}, signal = undefined) {
  try {
    return await fetch(path, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "X-PhotoDateRenamer-Token": window.PDR_TOKEN
      },
      body: JSON.stringify(data)
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new RequestError("No hay conexión con la aplicación. ¿Se cerró la ventana del programa?", 0);
  }
}

async function request(path, data = {}) {
  const response = await post(path, data);
  let result = {};
  try {
    result = await response.json();
  } catch (error) {
    result = {};
  }
  if (!response.ok) {
    throw new RequestError(result.error || "No se pudo completar la operación.", response.status);
  }
  return result;
}

function splitPath(path) {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? ["", path] : [path.slice(0, slash + 1), path.slice(slash + 1)];
}

/** «name» in italics for titles and sentences, so a folder never reads as an ordinary word. */
function quoted(name) {
  return `*«${name}»*`;
}

function folderNameOf(path) {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed || path;
}

function formatDate(date, format) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  if (format === "yyyy-mm-dd") return `${year}-${month}-${day}`;
  if (format === "yyyymmdd") return `${year}${month}${day}`;
  return `${year}_${month}_${day}`;
}

function dateFormat() {
  return ui.dateRadios.find((radio) => radio.checked)?.value || "yyyy_mm_dd";
}

function sameSettings(left, right) {
  return Boolean(left && right) && JSON.stringify(left) === JSON.stringify(right);
}

function currentSettings() {
  return {
    folder: state.folder,
    components: state.components.map((part) => ({ ...part })),
    date_format: dateFormat(),
    recursive: state.recursive
  };
}

/* --------------------------------------------------------------- thumbnails */

class ThumbnailCache {
  constructor() {
    this.cache = new Map();
    this.pending = new Map();
    this.queue = [];
    this.active = 0;
    this.controller = new AbortController();
  }

  key(path, size) {
    return `${size}|${path}`;
  }

  peek(path, size) {
    return this.cache.get(this.key(path, size));
  }

  get(path, size, stillWanted = () => true) {
    const key = this.key(path, size);
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
    const waiting = this.pending.get(key);
    if (waiting) {
      // A second requester (e.g. a redrawn row) keeps the queued job alive.
      const previous = waiting.job.stillWanted;
      waiting.job.stillWanted = () => previous() || stillWanted();
      return waiting.promise;
    }
    const job = { key, path, size, stillWanted, resolve: null };
    const promise = new Promise((resolve) => { job.resolve = resolve; })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, { job, promise });
    this.queue.push(job);
    this.pump();
    return promise;
  }

  pump() {
    while (this.active < 4 && this.queue.length) {
      const job = this.queue.pop();
      if (!job.stillWanted()) {
        this.pending.delete(job.key);
        job.resolve(undefined);
        continue;
      }
      this.active += 1;
      this.fetch(job).finally(() => {
        this.active -= 1;
        this.pump();
      });
    }
  }

  async fetch(job) {
    let url = null;
    try {
      const { signal } = this.controller;
      const response = await post("/api/thumbnail", { path: job.path, size: job.size }, signal);
      if (response.status === 200) url = URL.createObjectURL(await response.blob());
      if (signal.aborted) {
        if (url) URL.revokeObjectURL(url);
        job.resolve(undefined);
        return;
      }
    } catch (error) {
      url = null;
      if (error.name === "AbortError") {
        job.resolve(undefined);
        return;
      }
    }
    this.store(job.key, url);
    job.resolve(url);
  }

  store(key, url) {
    this.cache.set(key, url);
    if (this.cache.size > 500) {
      const [oldestKey, oldestUrl] = this.cache.entries().next().value;
      this.cache.delete(oldestKey);
      if (oldestUrl) URL.revokeObjectURL(oldestUrl);
    }
  }

  /** Forget every preview: called when a new folder or format is analysed. */
  clear() {
    this.controller.abort();
    this.controller = new AbortController();
    for (const url of this.cache.values()) if (url) URL.revokeObjectURL(url);
    this.cache.clear();
    for (const job of this.queue) job.resolve(undefined);
    this.queue = [];
    this.pending.clear();
  }
}

const thumbnails = new ThumbnailCache();

/** Path where a sheet item currently lives on disk, for its thumbnail. */
function currentPathOf(item) {
  return item.status === "renamed" ? item.new_name : item.original_name;
}

function canShowThumbnail(item) {
  return Boolean(item) && item.status !== "skipped";
}

function fillFrame(image, stamp, item, size) {
  stamp.textContent = item ? H.stampFromDateText(item.date_text) : "";
  image.hidden = true;
  image.removeAttribute("src");
  delete image.dataset.path;
  if (!canShowThumbnail(item)) return;
  const path = currentPathOf(item);
  image.dataset.path = path;
  thumbnails.get(path, size, () => image.dataset.path === path).then((url) => {
    if (url && image.dataset.path === path) {
      image.src = url;
      image.hidden = false;
    }
  });
}

/* ------------------------------------------------------------ mode & view */

function transition(update) {
  if (typeof document.startViewTransition === "function" && !reduceMotion.matches) {
    document.startViewTransition(update);
  } else {
    update();
  }
}

function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  transition(() => {
    ui.body.dataset.mode = mode;
    ui.hero.hidden = mode !== "idle";
    ui.workbench.hidden = mode === "idle";
  });
  renderLastRun();
}

const VIEW_PANELS = {
  scanning: "progress",
  applying: "progress",
  undoing: "progress",
  empty: "message",
  nophotos: "message",
  cancelled: "message",
  error: "message",
  unknown: "message",
  restored: "message",
  preview: "list",
  success: "result",
  partial: "result",
  total: "result",
  "undo-partial": "result"
};

function setView(view) {
  state.view = view;
  ui.body.dataset.view = view;
  const panel = VIEW_PANELS[view];
  const hasList = panel === "list" || panel === "result";
  ui.progressView.hidden = panel !== "progress";
  ui.messageView.hidden = panel !== "message";
  ui.resultView.hidden = panel !== "result";
  ui.listView.hidden = !hasList;
  ui.filters.hidden = !hasList;
  ui.sheetTools.hidden = !hasList;
  if (hasList) list.measure();
  updateApplyPanel();
  updateControlsLock();
  renderLastRun();
}

function setSheetHeading(kicker, title) {
  ui.sheetKicker.textContent = kicker;
  ui.sheetTitle.replaceChildren(...rich(title));
}

/** Move focus to the state heading and, on small screens, bring it into view. */
function focusHeading() {
  window.requestAnimationFrame(() => {
    ui.sheetTitle.focus({ preventScroll: true });
    const box = ui.sheetTitle.getBoundingClientRect();
    if (box.top < 0 || box.bottom > window.innerHeight) {
      ui.sheet.scrollIntoView({ block: "start", behavior: reduceMotion.matches ? "auto" : "smooth" });
    }
  });
}

function isBusy() {
  return BUSY_VIEWS.includes(state.view);
}

function updateControlsLock() {
  const resultView = RESULT_VIEWS.includes(state.view);
  const locked = isBusy() || resultView;
  ui.formatLock.hidden = !resultView;
  const controls = [
    ...ui.presets, ...ui.addPieces, ...ui.dateRadios, ...ui.recursiveInputs,
    ...ui.tokens.querySelectorAll("button")
  ];
  const lockable = [...controls, ui.changeFolder];
  for (const element of lockable) {
    const shouldLock = element === ui.changeFolder ? isBusy() : locked;
    if (shouldLock) {
      if (!("lockedDisabled" in element.dataset)) element.dataset.lockedDisabled = element.disabled ? "1" : "";
      element.disabled = true;
    } else if ("lockedDisabled" in element.dataset) {
      element.disabled = element.dataset.lockedDisabled === "1";
      delete element.dataset.lockedDisabled;
    }
  }
}

/* ------------------------------------------------------------- last batch */

/** The last renamed batch stays undoable from anywhere until another batch is applied. */
function renderLastRun() {
  const run = state.lastRun;
  const ownUndo = state.mode !== "idle" && ["success", "partial", "undo-partial", "undoing"].includes(state.view);
  ui.lastRun.hidden = !run || ownUndo;
  ui.lastRunUndo.disabled = isBusy();
  if (!run) return;
  ui.lastRunText.replaceChildren(...strong(
    `Último lote: **${plural(run.count, "foto renombrada", "fotos renombradas")}** en ${quoted(run.folder_name)}. Puedes deshacerlo mientras la aplicación siga abierta.`
  ));
  ui.lastRunUndo.textContent = run.count === 1 ? "Deshacer" : `Deshacer ${count(run.count)}`;
}

async function refreshLastRun() {
  try {
    const run = await request("/api/last-run");
    state.lastRun = run.run_id ? run : null;
  } catch (error) {
    /* keep what we know */
  }
  renderLastRun();
}

/* ---------------------------------------------------------- folder panel */

function renderFolder() {
  ui.folderTitle.textContent = folderNameOf(state.folder) || "—";
  ui.folderPath.replaceChildren(h("bdi", {}, state.folder));
  ui.folderPath.title = state.folder;
  for (const input of ui.recursiveInputs) input.checked = state.recursive;
}

function showHeroMessage(message, isError) {
  ui.heroMessage.replaceChildren(...strong(message));
  ui.heroMessage.classList.toggle("is-error", Boolean(isError));
  ui.heroMessage.hidden = false;
}

async function pickFolder() {
  if (isBusy()) return;
  const button = state.mode === "idle" ? ui.heroBrowse : ui.changeFolder;
  button.disabled = true;
  try {
    const result = await request("/api/select-folder");
    if (!result.folder) {
      if (state.mode === "idle") {
        showHeroMessage("Selección cancelada. No se ha elegido ninguna carpeta; nada ha cambiado.", false);
      } else {
        showToast("Selección cancelada. Sigues trabajando con la misma carpeta.");
      }
      announce("Selección de carpeta cancelada.");
      return;
    }
    chooseFolder(result.folder);
  } catch (error) {
    if (state.mode === "idle") showHeroMessage(error.message, true);
    else showToast(error.message);
  } finally {
    button.disabled = false;
  }
}

function chooseFolder(folder) {
  state.folder = folder;
  ui.heroPath.value = folder;
  ui.heroMessage.hidden = true;
  renderFolder();
  startPreview({ origin: "folder" });
}

/* ----------------------------------------------------------- format panel */

function renderTokens() {
  const nodes = state.components.map((component, index) => {
    const isText = component.kind === "text";
    const label = isText ? `“${component.value}”` : FIELD_LABELS[component.value];
    const spoken = isText ? `texto ${component.value}` : FIELD_LABELS[component.value];
    const move = (direction, symbol, text) => {
      const button = h("button", { type: "button", "aria-label": `${text}: ${spoken}` }, symbol);
      button.disabled = index + direction < 0 || index + direction >= state.components.length;
      button.addEventListener("click", () => {
        const [part] = state.components.splice(index, 1);
        state.components.splice(index + direction, 0, part);
        formatChanged("custom", `${spoken} movida a la posición ${index + direction + 1}.`);
        const moved = ui.tokens.children[index + direction];
        const same = moved?.querySelectorAll("button")[direction < 0 ? 0 : 1];
        (same && !same.disabled ? same : moved?.querySelector("button:not(:disabled)"))?.focus();
      });
      return button;
    };
    const remove = h("button", { type: "button", "aria-label": `Quitar: ${spoken}` }, "×");
    remove.addEventListener("click", () => {
      state.components.splice(index, 1);
      formatChanged("custom", `${spoken} quitada.`);
      const next = ui.tokens.children[Math.min(index, ui.tokens.children.length - 1)];
      (next?.querySelector("button:last-child") || ui.addPieces[0]).focus();
    });
    const kind = isText ? "token-text" : component.value === "date" ? "token-date" : "";
    return h("li", { class: `token ${kind}` }, h("span", { class: "token-label" }, label),
      move(-1, "←", "Mover a la izquierda"), move(1, "→", "Mover a la derecha"), remove);
  });
  if (!nodes.length) nodes.push(h("li", { class: "tokens-empty" }, "Añade al menos una pieza para formar el nombre."));
  ui.tokens.replaceChildren(...nodes);
  for (const button of ui.presets) {
    button.setAttribute("aria-pressed", String(button.dataset.preset === state.preset));
  }
  ui.formatSummaryValue.textContent = `${PRESET_LABELS[state.preset]} · ${formatDate(SAMPLE.date, dateFormat())}`;
  renderExample();
  updateControlsLock();
}

function sampleForExample() {
  const items = state.plan?.items || [];
  const fresh = state.plan && sameSettings(state.planSettings, currentSettings());
  const item = fresh && (
    items.find((entry) => entry.status === "ready" && !entry.dated) ||
    items.find((entry) => entry.status === "ready")
  );
  if (item) return { name: splitPath(item.original_name)[1], date: item.date_text };
  return { name: SAMPLE.name, date: formatDate(SAMPLE.date, dateFormat()) };
}

function renderExample() {
  const sample = sampleForExample();
  const dot = sample.name.lastIndexOf(".");
  const extension = dot > 0 ? sample.name.slice(dot) : "";
  const stem = extension ? sample.name.slice(0, -extension.length) : sample.name;
  const values = { original_name: sample.name, original_stem: stem, extension };
  const nodes = state.components.map((part) => {
    if (part.kind === "text") return document.createTextNode(part.value);
    if (part.value === "date") return h("mark", { class: "stamp" }, sample.date);
    return document.createTextNode(values[part.value]);
  });
  ui.exampleOld.textContent = sample.name;
  ui.exampleNew.replaceChildren(
    h("span", { class: "arrow", "aria-hidden": "true" }, "→ "),
    h("span", { class: "sr-only" }, "se llamará "),
    ...(nodes.length ? nodes : [document.createTextNode("—")])
  );
}

function formatChanged(preset, message) {
  state.preset = preset;
  renderTokens();
  if (message) announce(message);
  scheduleRefresh();
}

function scheduleRefresh() {
  updateApplyPanel();
  if (state.mode === "idle" || !state.folder || isBusy() || RESULT_VIEWS.includes(state.view)) return;
  window.clearTimeout(refreshTimer);
  if (!state.components.length) {
    scanGeneration += 1;
    cancelActiveScan();
    ui.body.classList.remove("is-refreshing");
    showEmptyFormat();
    return;
  }
  refreshTimer = window.setTimeout(() => startPreview({ origin: "format" }), 320);
}

function showEmptyFormat() {
  state.plan = null;
  setSheetHeading("Falta el formato", "Añade al menos *una pieza*");
  showMessage({
    view: "error",
    art: "nophotos",
    text: "Elige una receta o añade la fecha, el nombre original o un texto. La vista previa se actualizará sola.",
    primary: { label: "Usar «Fecha + nombre»", action: () => applyPreset("date_original") }
  });
}

function applyPreset(preset) {
  if (preset !== "custom") state.components = PRESETS[preset].map((part) => ({ ...part }));
  formatChanged(preset, preset === "custom" ? "Formato a medida: añade o mueve piezas." : `Receta ${PRESET_LABELS[preset]}.`);
}

/* --------------------------------------------------------------- scanning */

async function cancelActiveScan() {
  const scan = activeScan;
  if (!scan) return;
  scan.cancelled = true;
  try {
    await request("/api/cancel", { scan_id: scan.id });
  } catch (error) {
    /* the scan already finished; nothing to cancel */
  }
  await scan.done;
}

function updateScanProgress(progress) {
  if (state.view !== "scanning") return;
  const indeterminate = progress.phase !== "scanning" || progress.total === null;
  ui.progressBar.parentElement.classList.toggle("is-indeterminate", indeterminate);
  if (progress.phase === "indexing") {
    setSeg(ui.progressCount, progress.scanned);
    ui.progressLabel.textContent = `Contando archivos… ${count(progress.scanned)} por ahora.`;
  } else if (!indeterminate) {
    setSeg(ui.progressCount, progress.scanned);
    setSeg(ui.progressTotal, progress.total);
    ui.progressBar.style.transform = `scaleX(${progress.total ? progress.scanned / progress.total : 1})`;
    ui.progressLabel.textContent = `Leyendo la fecha de la foto ${count(progress.scanned)} de ${count(progress.total)}.`;
  }
}

async function monitorScan(scan) {
  while (!scan.settled) {
    try {
      const progress = await request("/api/progress", { scan_id: scan.id });
      if (scan.settled) return;
      updateScanProgress(progress);
      if (progress.completed) return;
    } catch (error) {
      return;
    }
    await wait(220);
  }
}

function resetProgress(total) {
  setSeg(ui.progressCount, 0);
  setSeg(ui.progressTotal, total);
  ui.progressBar.style.transform = "scaleX(0)";
}

function showScanning() {
  setSheetHeading("Analizando la carpeta", `Revelando ${quoted(folderNameOf(state.folder))}`);
  resetProgress(0);
  ui.progressBar.parentElement.classList.add("is-indeterminate");
  ui.progressLabel.textContent = "Preparando el análisis…";
  ui.cancelScan.hidden = false;
  ui.cancelScan.disabled = false;
  ui.applyWarning.hidden = true;
  setView("scanning");
}

async function startPreview({ origin }) {
  window.clearTimeout(refreshTimer);
  const generation = ++scanGeneration;
  if (activeScan) await cancelActiveScan();
  if (generation !== scanGeneration) return;
  if (!state.folder.trim()) {
    setMode("idle");
    showHeroMessage("Elige una carpeta o pega su ruta para empezar.", true);
    ui.heroPath.focus();
    return;
  }
  if (!state.components.length) {
    showEmptyFormat();
    return;
  }

  const fromIdle = state.mode === "idle";
  let check;
  try {
    check = await request("/api/check-folder", { folder: state.folder });
  } catch (error) {
    check = { ok: false, error: error.message };
  }
  if (generation !== scanGeneration) return;
  if (!check.ok) {
    if (fromIdle) {
      showHeroMessage(check.error, true);
      ui.heroPath.focus();
    } else {
      showError("No encuentro *esa carpeta*", check.error, () => startPreview({ origin: "retry" }));
    }
    return;
  }
  state.folder = check.folder;
  ui.heroPath.value = check.folder;

  const settings = currentSettings();
  const scan = { id: crypto.randomUUID(), cancelled: false, settled: false, done: null };
  activeScan = scan;
  // A format change keeps the sheet on screen (dimmed), with its filter and search.
  const inPlace = origin === "format" && state.view === "preview" && state.plan?.folder === state.folder;
  state.plan = null;
  state.planSettings = null;
  state.result = null;
  if (!inPlace) {
    state.filter = "all";
    state.query = "";
    ui.search.value = "";
    thumbnails.clear();
    list.setItems([]);
  }

  let revealTimer = null;
  if (fromIdle) {
    ui.heroBrowse.setAttribute("aria-busy", "true");
    revealTimer = window.setTimeout(() => {
      if (!scan.settled && generation === scanGeneration) {
        renderFolder();
        setMode("workbench");
        showScanning();
        focusHeading();
      }
    }, 260);
  } else if (inPlace) {
    ui.body.classList.add("is-refreshing");
    ui.sheetKicker.textContent = "Actualizando la vista previa…";
    updateApplyPanel();
  } else {
    renderFolder();
    showScanning();
    if (origin !== "format") focusHeading();
  }

  const preview = request("/api/preview", { ...settings, scan_id: scan.id });
  scan.done = preview.then(() => {}, () => {}).finally(() => { scan.settled = true; });
  monitorScan(scan);

  try {
    const result = await preview;
    if (generation !== scanGeneration) return;
    if (result.cancelled) {
      renderFolder();
      setMode("workbench");
      showCancelled();
      return;
    }
    if (!sameSettings(settings, currentSettings())) {
      scheduleRefresh();
      return;
    }
    state.plan = result;
    state.planSettings = settings;
    renderFolder();
    setMode("workbench");
    showPlan(result, origin);
  } catch (error) {
    if (generation !== scanGeneration) return;
    setMode("workbench");
    showError("No se pudo leer *la carpeta*", error.message, () => startPreview({ origin: "retry" }));
  } finally {
    window.clearTimeout(revealTimer);
    if (generation === scanGeneration) ui.body.classList.remove("is-refreshing");
    ui.heroBrowse.removeAttribute("aria-busy");
    if (activeScan === scan) activeScan = null;
  }
}

function showCancelled() {
  state.plan = null;
  setSheetHeading("Análisis cancelado", "Revelado *interrumpido*");
  showMessage({
    view: "cancelled",
    art: "cancelled",
    text: "Has detenido el análisis. **No se ha modificado ningún archivo**; puedes volver a analizar cuando quieras.",
    primary: { label: "Volver a analizar", action: () => startPreview({ origin: "retry" }) },
    secondary: { label: "Elegir otra carpeta", action: pickFolder }
  });
  announce("Análisis cancelado. No se modificó ningún archivo.");
  focusHeading();
}

function showError(title, message, retry) {
  setSheetHeading("Algo no salió bien", title);
  showMessage({
    view: "error",
    art: "fogged",
    text: message,
    primary: { label: "Reintentar", action: retry },
    secondary: { label: "Elegir otra carpeta", action: pickFolder }
  });
  announce(`${title.replace(/\*/g, "")}. ${message}`);
  focusHeading();
}

function showMessage({ view, art, text, primary, secondary }) {
  ui.messageArt.dataset.art = art;
  ui.messageText.replaceChildren(...strong(text));
  ui.messagePrimary.textContent = primary.label;
  ui.messagePrimary.onclick = primary.action;
  ui.messageSecondary.hidden = !secondary;
  if (secondary) {
    ui.messageSecondary.textContent = secondary.label;
    ui.messageSecondary.onclick = secondary.action;
  }
  setView(view);
}

/* ------------------------------------------------------------ the preview */

function countsOf(items) {
  return items.reduce((summary, item) => {
    summary[item.status] = (summary[item.status] || 0) + 1;
    if (item.dated) summary.dated = (summary.dated || 0) + 1;
    if (item.fileDate) summary.filedate = (summary.filedate || 0) + 1;
    return summary;
  }, {});
}

function isFileDate(source) {
  return typeof source === "string" && source.startsWith("Archivo");
}

/** Client-side notes that never change a proposed name: dated names, file dates, clashes. */
function annotate(items) {
  const byDestination = new Map();
  const originals = new Map();
  for (const item of items) {
    originals.set(item.original_name.toLocaleLowerCase(), item.original_name);
    if (item.new_name && item.status !== "unchanged") {
      const key = item.new_name.toLocaleLowerCase();
      if (!byDestination.has(key)) byDestination.set(key, []);
      byDestination.get(key).push(item.original_name);
    }
  }
  const frames = new Map(items.map((item, position) => [item.original_name, position + 1]));
  for (const [position, item] of items.entries()) {
    item.frame = position + 1;
    item.dated = item.status === "ready" && H.looksDated(item.original_name);
    item.fileDate = item.status !== "skipped" && isFileDate(item.date_source);
    if (item.status === "conflict" && item.new_name) {
      const key = item.new_name.toLocaleLowerCase();
      const others = (byDestination.get(key) || []).filter((name) => name !== item.original_name);
      const existing = originals.get(key);
      item.clashWith = existing && existing !== item.original_name ? [existing, ...others.filter((name) => name !== existing)] : others;
      item.clashExists = Boolean(existing && existing !== item.original_name);
      item.clashFrame = item.clashWith.length ? frames.get(item.clashWith[0]) : undefined;
    }
  }
}

function showPlan(plan, origin) {
  const folderName = folderNameOf(plan.folder);
  if (!plan.items.length) {
    state.plan = null;
    if (plan.entry_count === 0) {
      setSheetHeading("Carpeta vacía", `Carrete vacío en ${quoted(folderName)}`);
      showMessage({
        view: "empty",
        art: "empty",
        text: "Esta carpeta está vacía: no hay nada que revelar. Elige otra carpeta con fotografías.",
        primary: { label: "Elegir otra carpeta", action: pickFolder }
      });
      announce("La carpeta está vacía.");
    } else {
      const found = plan.entry_count === 1 ? "**1 elemento**" : `**${count(plan.entry_count)} elementos**`;
      setSheetHeading("Ninguna foto compatible", "Hay archivos, pero *ninguna foto*");
      showMessage({
        view: "nophotos",
        art: "nophotos",
        text: `En ${quoted(folderName)} hay ${found}, pero ninguno es JPG, PNG o TIFF.` +
          (state.recursive ? "" : " Si tus fotos están dentro de subcarpetas, inclúyelas."),
        primary: state.recursive
          ? { label: "Elegir otra carpeta", action: pickFolder }
          : { label: "Incluir subcarpetas", action: () => setRecursive(true) },
        secondary: state.recursive ? null : { label: "Elegir otra carpeta", action: pickFolder }
      });
      announce("La carpeta no contiene fotografías compatibles.");
    }
    renderExample();
    if (origin !== "format") focusHeading();
    return;
  }

  annotate(plan.items);
  const counts = countsOf(plan.items);
  setSheetHeading(`Hoja de contactos · ${folderName}`, `*${count(plan.items.length)}* ${plan.items.length === 1 ? "foto revisada" : "fotos revisadas"}`);
  setView("preview");
  renderFilters(counts, ["all", "ready", "dated", "filedate", "conflict", "skipped", "unchanged"]);
  list.setItems(filteredItems(), { develop: origin !== "format", keepScroll: origin === "format" });
  renderExample();
  const ready = counts.ready || 0;
  announce(
    `Vista previa lista: ${plural(ready, "foto se renombrará", "fotos se renombrarán")}` +
    `${counts.conflict ? `, ${plural(counts.conflict, "conflicto", "conflictos")}` : ""}` +
    `${counts.skipped ? `, ${plural(counts.skipped, "omitida", "omitidas")}` : ""}` +
    `${counts.dated ? `, ${plural(counts.dated, "ya parece fechada", "ya parecen fechadas")}` : ""}.`
  );
  if (origin !== "format") focusHeading();
}

function renderFilters(counts, keys) {
  const total = sourceItems().length;
  const shown = keys.filter((key) => key === "all" || counts[key]);
  if (!shown.includes(state.filter)) state.filter = "all";
  // A single category that covers everything adds nothing to «Todas».
  const informative = shown.filter((key) => key !== "all" && counts[key] !== total);
  ui.filters.hidden = shown.length <= 2 && !informative.length;
  const buttons = shown
    .map((key) => {
      const button = h(
        "button",
        { type: "button", class: `filter filter-${key}`, "data-filter": key, "aria-pressed": String(state.filter === key) },
        key === "all" ? null : h("span", { class: "filter-dot", "aria-hidden": "true" }),
        FILTER_LABELS[key],
        h("span", { class: "filter-count" }, count(key === "all" ? total : counts[key]))
      );
      button.addEventListener("click", () => {
        state.filter = key;
        for (const other of ui.filters.children) other.setAttribute("aria-pressed", String(other === button));
        list.setItems(filteredItems());
        announce(`${FILTER_LABELS[key]}: ${plural(list.items.length, "archivo", "archivos")}.`);
      });
      return button;
    });
  ui.filters.replaceChildren(...buttons);
}

function sourceItems() {
  if (state.view === "preview") return state.plan ? state.plan.items : [];
  if (state.result) return state.result.items;
  return [];
}

function filteredItems() {
  const query = state.query.trim().toLocaleLowerCase("es");
  return sourceItems().filter((item) => {
    if (state.filter === "dated") {
      if (!item.dated) return false;
    } else if (state.filter === "filedate") {
      if (!item.fileDate) return false;
    } else if (state.filter !== "all" && item.status !== state.filter) {
      return false;
    }
    if (!query) return true;
    return (
      item.original_name.toLocaleLowerCase("es").includes(query) ||
      (item.new_name || "").toLocaleLowerCase("es").includes(query)
    );
  });
}

function shorten(path, maxChars) {
  const [directory, fullBase] = splitPath(path);
  if (!Number.isFinite(maxChars)) return [directory, fullBase];
  const room = Math.max(10, maxChars - directory.length);
  const shortDirectory = directory.length > maxChars * 0.4 ? H.middleEllipsis(directory, Math.max(6, Math.floor(maxChars * 0.4))) : directory;
  return [shortDirectory, H.middleEllipsis(fullBase, Math.max(10, maxChars - shortDirectory.length, room > 10 ? 10 : room))];
}

/** Destination name with the date highlighted; optionally shortened in the middle. */
function nameWithStamp(path, dateText, maxChars = Infinity) {
  const [directory, base] = shorten(path, maxChars);
  const nodes = [];
  if (directory) nodes.push(h("span", { class: "dir" }, directory));
  const at = dateText ? base.indexOf(dateText) : -1;
  if (at === -1) nodes.push(base);
  else nodes.push(base.slice(0, at), h("mark", { class: "stamp" }, dateText), base.slice(at + dateText.length));
  return nodes;
}

function pathNodes(path, maxChars = Infinity) {
  const [directory, base] = shorten(path, maxChars);
  return [directory ? h("span", { class: "dir" }, directory) : null, base];
}

function shortReason(item) {
  if (item.status === "unchanged") return "Ya tiene ese nombre.";
  if (item.status === "conflict" && item.new_name) return "ese nombre ya existe o se repite";
  return item.reason || "—";
}

function renderRow(item, index, chars) {
  const thumb = h("span", { class: "row-thumb", "aria-hidden": "true" },
    h("img", { alt: "", hidden: true, decoding: "async" }),
    h("span", { class: "row-frame" }, String(item.frame || index + 1).padStart(4, "0")),
    item.fileDate ? h("span", { class: "row-src" }, item.date_source.includes("creación") ? "CREA" : "MOD") : null);
  let second;
  if (item.status === "ready" || item.status === "renamed") {
    second = h("span", { class: "row-new" },
      h("span", { class: "arrow", "aria-hidden": "true" }, "→ "),
      h("span", { class: "sr-only" }, item.status === "renamed" ? "ahora se llama " : "pasará a llamarse "),
      ...nameWithStamp(item.new_name, item.date_text, chars * nameLines - 3));
  } else if (item.status === "conflict" && item.new_name) {
    const where = item.clashFrame ? ` (fotograma ${String(item.clashFrame).padStart(4, "0")})` : "";
    const clash = item.clashExists ? ` · ya existe${where}` : item.clashWith?.length ? ` · también lo pide el ${String(item.clashFrame).padStart(4, "0")}` : " · ya existe";
    const wide = chars > 48;
    const room = Math.max(14, chars - 2 - (wide ? Math.min(clash.length, 26) : 0));
    second = h("span", { class: "row-new row-clash" },
      h("span", { class: "arrow", "aria-hidden": "true" }, "⨯ "),
      h("span", { class: "sr-only" }, "chocaría con el nombre "),
      ...pathNodes(item.new_name, room),
      wide ? h("span", { class: "row-why" }, clash) : null);
  } else if (item.status === "pending") {
    second = h("span", { class: "row-new row-pending" },
      h("span", { class: "arrow", "aria-hidden": "true" }, "↺ "),
      h("span", { class: "sr-only" }, "debía volver a "),
      ...pathNodes(item.new_name, Math.max(12, chars - 2)));
  } else if (item.status === "failed") {
    second = h("span", { class: "row-new row-reason" }, item.reason || "—");
  } else {
    second = h("span", { class: "row-new row-reason" }, shortReason(item));
  }
  const tags = [h("span", { class: `badge badge-${item.status}` },
    h("span", { class: "sr-only" }, ". "),
    h("span", { class: "badge-text" }, STATUS_LABELS[item.status]),
    h("span", { class: "badge-abbr", "aria-hidden": "true" }, STATUS_SHORT[item.status]))];
  if (item.fileDate) tags.push(h("span", { class: "sr-only" }, ", fecha tomada del archivo"));
  if (item.date_source && item.status !== "skipped") {
    tags.push(h("span", { class: `row-origin${item.fileDate ? " is-file" : ""}`, "aria-hidden": "true" },
      item.fileDate ? "Archivo" : item.date_source.split(" ·")[0]));
  }
  if (item.dated) {
    tags.push(h("span", { class: "badge badge-dated" },
      h("span", { class: "sr-only" }, ", "),
      h("span", { class: "badge-text" }, "ya fechada")));
  }
  return [
    thumb,
    h("span", { class: "row-names" }, h("span", { class: "row-old" }, ...pathNodes(item.original_name, chars)), second),
    h("span", { class: "row-tags" }, ...tags)
  ];
}

function loupeContent(item) {
  const mono = (...children) => h("span", { class: "mono" }, ...children);
  const rows = [];
  if (item.status === "renamed") {
    rows.push(["Antes", mono(item.original_name)]);
    rows.push(["Ahora se llama", mono(...nameWithStamp(item.new_name, item.date_text))]);
  } else if (item.status === "pending") {
    rows.push(["Ahora", mono(item.original_name)]);
    rows.push(["Debía volver a", mono(item.new_name)]);
  } else {
    rows.push(["Ahora", mono(item.original_name)]);
    if (item.status === "ready") {
      rows.push(["Pasará a", mono(...nameWithStamp(item.new_name, item.date_text))]);
    } else if (item.status === "failed") {
      rows.push(["Destino previsto", h("span", { class: "mono loupe-strike" }, item.new_name, h("span", { class: "sr-only" }, " (no aplicado)"))]);
    } else if (item.status === "conflict" && item.new_name) {
      rows.push(["Nombre propuesto", mono(item.new_name)]);
      if (item.clashWith?.length) {
        const first = item.clashWith[0];
        const frame = item.clashFrame ? ` (fotograma ${String(item.clashFrame).padStart(4, "0")})` : "";
        rows.push(["Choca con", h("span", {}, h("span", { class: "mono" }, first), item.clashExists
          ? `${frame}, que ya se llama así.`
          : `${frame}, que pediría el mismo nombre.`)]);
      }
    }
  }
  if (item.date_source) rows.push(["Origen de la fecha", item.date_source]);
  if (item.fileDate) rows.push(["Aviso", "La foto no guarda la fecha de captura; se usa la del archivo, que puede ser la de una copia."]);
  if (item.reason) rows.push(["Motivo", h("span", { class: "loupe-reason" }, item.reason)]);
  if (item.dated) rows.push(["Aviso", "El nombre ya empieza por una fecha; recibirá otra."]);
  rows.push(["Estado", STATUS_LABELS[item.status]]);
  return h("dl", {}, ...rows.flatMap(([term, value]) => [h("dt", {}, term), h("dd", {}, value)]));
}

function renderLoupe(item) {
  fillFrame(ui.loupeImage, ui.loupeStamp, item, 360);
  ui.loupe.dataset.status = item ? item.status : "";
  if (!item) {
    ui.loupeBody.replaceChildren(h("p", { class: "loupe-empty" }, "Pasa el cursor o usa ↑ ↓ en la hoja para ver un archivo completo."));
    return;
  }
  ui.loupeBody.replaceChildren(loupeContent(item));
}

function loupeVisible() {
  return getComputedStyle(ui.loupe).display !== "none" && !ui.listView.hidden;
}

function openDetail(item) {
  if (!item || loupeVisible()) return;
  ui.detailBody.replaceChildren(loupeContent(item));
  fillFrame(ui.detailImage, ui.detailStamp, item, 360);
  ui.detailDialog.showModal();
}

/* ------------------------------------------------- virtualised contact sheet */

class VirtualList {
  constructor(scroller, emptyNote) {
    this.scroller = scroller;
    this.emptyNote = emptyNote;
    this.spacer = h("div", { class: "list-spacer", role: "presentation" });
    this.scroller.append(this.spacer);
    this.items = [];
    this.rows = new Map();
    this.active = -1;
    this.hover = -1;
    this.rowHeight = 64;
    this.viewport = 400;
    this.chars = 60;
    this.charWidth = 0;
    this.frame = 0;
    this.scroller.addEventListener("scroll", () => this.schedule(), { passive: true });
    this.scroller.addEventListener("keydown", (event) => this.onKey(event));
    this.scroller.addEventListener("pointerover", (event) => {
      const row = event.target.closest(".row");
      if (row) this.setHover(Number(row.dataset.index));
    });
    this.scroller.addEventListener("pointerleave", () => this.setHover(-1));
    this.scroller.addEventListener("click", (event) => {
      const row = event.target.closest(".row");
      if (!row) return;
      this.setActive(Number(row.dataset.index), false);
      openDetail(this.items[this.active]);
    });
    new ResizeObserver(() => this.measure()).observe(this.scroller);
  }

  measure() {
    const value = parseFloat(getComputedStyle(this.scroller).getPropertyValue("--row-h"));
    const lines = parseInt(getComputedStyle(this.scroller).getPropertyValue("--name-lines"), 10) || 1;
    if (lines !== nameLines) {
      nameLines = lines;
      this.redraw();
    }
    if (value && value !== this.rowHeight) {
      this.rowHeight = value;
      this.spacer.style.height = `${this.items.length * this.rowHeight}px`;
      this.redraw();
    }
    this.viewport = this.scroller.clientHeight || 400;
    if (!this.charWidth) {
      const context = document.createElement("canvas").getContext("2d");
      context.font = "13px 'JetBrains Mono', monospace";
      this.charWidth = context.measureText("0000000000").width / 10 || 7.8;
    }
    const sample = this.spacer.querySelector(".row-names");
    // One character of margin so the CSS ellipsis never has to cut a shortened name again.
    const chars = sample ? Math.max(14, Math.floor(sample.clientWidth / this.charWidth) - 1) : this.chars;
    if (chars !== this.chars) {
      this.chars = chars;
      this.redraw();
    }
    this.schedule();
  }

  /** Let the film strip shrink to its rows, so a short result leaves no black void. */
  fitHeight() {
    const height = Math.max(this.items.length * this.rowHeight + 2, 140);
    (this.scroller.closest(".list-view") || this.scroller.parentElement).style.setProperty("--content-h", `${height}px`);
  }

  redraw() {
    this.fitHeight();
    for (const row of this.rows.values()) row.remove();
    this.rows.clear();
    this.render();
  }

  setItems(items, { develop = false, keepScroll = false } = {}) {
    const previousActive = keepScroll ? this.active : -1;
    const previousScroll = this.scroller.scrollTop;
    this.items = items;
    this.spacer.style.height = `${items.length * this.rowHeight}px`;
    this.scroller.scrollTop = keepScroll ? previousScroll : 0;
    this.emptyNote.hidden = items.length > 0;
    this.active = -1;
    this.hover = -1;
    this.scroller.removeAttribute("aria-activedescendant");
    this.redraw();
    this.measure();
    this.setActive(items.length ? Math.min(Math.max(previousActive, 0), items.length - 1) : -1, false);
    if (develop) this.develop();
  }

  schedule() {
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  render() {
    const overscan = 6;
    const first = Math.max(0, Math.floor(this.scroller.scrollTop / this.rowHeight) - overscan);
    const last = Math.min(this.items.length - 1, Math.ceil((this.scroller.scrollTop + this.viewport) / this.rowHeight) + overscan);
    for (const [index, row] of this.rows) {
      if (index < first || index > last) {
        row.remove();
        this.rows.delete(index);
      }
    }
    for (let index = first; index <= last; index += 1) {
      if (this.rows.has(index)) continue;
      const item = this.items[index];
      const row = h(
        "div",
        {
          class: `row is-${item.status}${item.dated ? " is-dated" : ""}${index === this.active ? " is-active" : ""}${index === this.hover ? " is-hover" : ""}`,
          role: "option",
          id: `frame-${index}`,
          "data-index": index,
          "aria-setsize": this.items.length,
          "aria-posinset": index + 1,
          "aria-selected": String(index === this.active)
        },
        ...renderRow(item, index, this.chars)
      );
      row.style.transform = `translateY(${index * this.rowHeight}px)`;
      row.style.setProperty("--order", String(Math.min(index, 14)));
      this.spacer.append(row);
      this.rows.set(index, row);
      this.loadThumb(row, item, index);
    }
  }

  loadThumb(row, item, index) {
    if (!canShowThumbnail(item)) return;
    const image = row.querySelector(".row-thumb img");
    const path = currentPathOf(item);
    const show = (url) => {
      if (url && this.rows.get(index) === row) {
        image.src = url;
        image.hidden = false;
        row.classList.add("has-thumb");
      }
    };
    const cached = thumbnails.peek(path, 96);
    if (cached !== undefined) {
      show(cached);
      return;
    }
    thumbnails.get(path, 96, () => this.rows.get(index) === row).then(show);
  }

  setHover(index) {
    if (index === this.hover) return;
    this.rows.get(this.hover)?.classList.remove("is-hover");
    this.hover = index;
    this.rows.get(index)?.classList.add("is-hover");
  }

  setActive(index, scroll) {
    const previous = this.rows.get(this.active);
    if (previous) {
      previous.classList.remove("is-active");
      previous.setAttribute("aria-selected", "false");
    }
    this.active = index;
    if (index < 0) {
      renderLoupe(null);
      return;
    }
    if (scroll) {
      const top = index * this.rowHeight;
      if (top < this.scroller.scrollTop) this.scroller.scrollTop = top;
      else if (top + this.rowHeight > this.scroller.scrollTop + this.viewport) {
        this.scroller.scrollTop = top + this.rowHeight - this.viewport;
      }
      this.render();
    }
    const row = this.rows.get(index);
    if (row) {
      row.classList.add("is-active");
      row.setAttribute("aria-selected", "true");
    }
    this.scroller.setAttribute("aria-activedescendant", `frame-${index}`);
    renderLoupe(this.items[index]);
  }

  onKey(event) {
    if (!this.items.length) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetail(this.items[this.active]);
      return;
    }
    const page = Math.max(1, Math.floor(this.viewport / this.rowHeight) - 1);
    const moves = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page, Home: -Infinity, End: Infinity };
    if (!(event.key in moves)) return;
    event.preventDefault();
    this.setHover(-1);
    const target = Math.min(this.items.length - 1, Math.max(0, (this.active < 0 ? 0 : this.active) + moves[event.key]));
    this.setActive(target, true);
  }

  /** Renamed frames turn from negative to positive and receive their date stamp. */
  fix() {
    if (reduceMotion.matches) return;
    this.scroller.classList.remove("is-fixing");
    void this.scroller.offsetWidth;
    this.scroller.classList.add("is-fixing");
    window.setTimeout(() => this.scroller.classList.remove("is-fixing"), 2200);
  }

  develop() {
    if (reduceMotion.matches || typeof Element.prototype.animate !== "function") return;
    const visible = [...this.rows.entries()].sort(([a], [b]) => a - b).slice(0, 14);
    visible.forEach(([, row], order) => {
      row.animate(
        [
          { opacity: 0, transform: `${row.style.transform} translateX(-6px)` },
          { opacity: 1, transform: row.style.transform }
        ],
        { duration: 520, delay: order * 30, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" }
      );
    });
  }
}

const list = new VirtualList(ui.listScroller, ui.listEmpty);
// Character width depends on JetBrains Mono: measure again once the font has loaded.
document.fonts?.ready.then(() => {
  list.charWidth = 0;
  list.measure();
});

/* ------------------------------------------------------------ apply panel */

function updateApplyPanel() {
  ui.applyBox.hidden = state.view !== "preview";
  const plan = state.plan;
  const counts = plan ? countsOf(plan.items) : {};
  const ready = counts.ready || 0;
  const fresh = plan && sameSettings(state.planSettings, currentSettings());
  let hint;
  if (!plan) hint = "Cuando haya una vista previa, aquí podrás aplicarla.";
  else if (!fresh) hint = "El formato cambió: actualizando la vista previa…";
  else if (!ready) hint = "Ninguna foto puede renombrarse con este formato. Revisa los conflictos o prueba otra receta.";
  else {
    const rest = plan.items.length - ready;
    hint = `**${plural(ready, "foto", "fotos")}** ${ready === 1 ? "cambiará" : "cambiarán"} de nombre.` +
      (rest ? ` ${plural(rest, "se queda", "se quedan")} como ${rest === 1 ? "está" : "están"}.` : "") +
      (counts.dated ? ` ${plural(counts.dated, "ya parece fechada", "ya parecen fechadas")}.` : "");
  }
  ui.applyHint.replaceChildren(...strong(hint));
  const enabled = state.view === "preview" && fresh && ready > 0;
  ui.applyButton.disabled = !enabled;
  ui.applyButton.textContent = enabled ? `Renombrar ${plural(ready, "foto", "fotos")}` : "Renombrar";
}

function openConfirm() {
  if (ui.applyButton.disabled || !state.plan) return;
  const counts = countsOf(state.plan.items);
  const ready = counts.ready || 0;
  const rest = state.plan.items.length - ready;
  setSeg(ui.confirmCount, ready);
  ui.confirmTitle.textContent = ready === 1 ? "¿Renombrar esta foto?" : "¿Renombrar estas fotos?";
  ui.confirmText.replaceChildren(...strong(
    `Se cambiará el nombre de **${plural(ready, "archivo", "archivos")}** en **${folderNameOf(state.plan.folder)}**` +
    `${state.recursive ? " y sus subcarpetas" : ""}.` +
    (rest ? ` ${plural(rest, "archivo se queda", "archivos se quedan")} como ${rest === 1 ? "está" : "están"}.` : "")
  ));
  const sample = state.plan.items.find((item) => item.status === "ready" && !item.dated) ||
    state.plan.items.find((item) => item.status === "ready");
  ui.confirmExample.replaceChildren(
    h("span", { class: "example-old" }, splitPath(sample.original_name)[1]),
    h("span", { class: "arrow", "aria-hidden": "true" }, " → "),
    h("span", { class: "sr-only" }, " pasará a llamarse "),
    h("span", { class: "example-new" }, ...nameWithStamp(splitPath(sample.new_name)[1], sample.date_text))
  );
  const readyFileDates = state.plan.items.filter((item) => item.status === "ready" && item.fileDate).length;
  const warnings = [];
  if (counts.dated) {
    warnings.push(`**${plural(counts.dated, "foto ya empieza", "fotos ya empiezan")}** por una fecha y ${counts.dated === 1 ? "recibirá" : "recibirán"} otra (filtro «Ya fechadas»).`);
  }
  if (readyFileDates) {
    warnings.push(`**${plural(readyFileDates, "foto usa", "fotos usan")}** la fecha del archivo porque no guarda la de captura (filtro «Fecha del archivo»).`);
  }
  if (state.lastRun) {
    warnings.push(`El lote anterior (**${plural(state.lastRun.count, "foto", "fotos")}** en ${quoted(state.lastRun.folder_name)}) dejará de poder deshacerse en cuanto este renombre una foto.`);
  }
  ui.confirmDated.hidden = !warnings.length;
  if (warnings.length) ui.confirmDated.replaceChildren(...strong(`Revisa antes: ${warnings.join(" ")}`));
  ui.confirmApply.textContent = `Renombrar ${count(ready)}`;
  ui.confirmDialog.returnValue = "";
  ui.confirmDialog.showModal();
  ui.confirmDialog.scrollTop = 0;
}

async function applyPlan() {
  const plan = state.plan;
  if (!plan || !sameSettings(state.planSettings, currentSettings())) return;
  const total = plan.rename_count;
  setSheetHeading("Renombrando", `Fijando los nombres de ${quoted(folderNameOf(plan.folder))}`);
  resetProgress(total);
  ui.progressBar.parentElement.classList.remove("is-indeterminate");
  ui.progressLabel.textContent = `Renombrando 0 de ${count(total)}…`;
  ui.cancelScan.hidden = true;
  ui.applyWarning.hidden = false;
  setView("applying");
  focusHeading();

  let settled = false;
  const confirm = request("/api/confirm", { plan_id: plan.plan_id });
  confirm.then(() => { settled = true; }, () => { settled = true; });
  (async () => {
    while (!settled) {
      try {
        const progress = await request("/api/apply-progress", { plan_id: plan.plan_id });
        if (settled || state.view !== "applying") return;
        if (progress.total) {
          setSeg(ui.progressCount, progress.done);
          ui.progressBar.style.transform = `scaleX(${progress.done / progress.total})`;
          ui.progressLabel.textContent = `Renombrando ${count(progress.done)} de ${count(progress.total)}…`;
        }
      } catch (error) {
        return;
      }
      await wait(200);
    }
  })();

  try {
    const result = await confirm;
    state.plan = null;
    state.planSettings = null;
    showResult(plan, result);
  } catch (error) {
    state.plan = null;
    state.planSettings = null;
    if (error.status >= 400 && error.status < 500) {
      // The server rejected the plan before touching any file.
      showError("No se aplicó *ningún cambio*", `${error.message} Ningún archivo se ha modificado.`, () => startPreview({ origin: "retry" }));
    } else {
      showUnknown(error.message);
      refreshLastRun();
    }
  }
}

/** The apply request failed: some files may have been renamed. Never claim otherwise. */
function showUnknown(message) {
  setSheetHeading("Resultado sin confirmar", "Revisa la carpeta *antes de seguir*");
  showMessage({
    view: "unknown",
    art: "fogged",
    text: `La aplicación no pudo confirmar el resultado: ${message.replace(/[.?!]?$/, ".")} Algunos archivos pueden haber cambiado de nombre. **Vuelve a analizar la carpeta** para ver su estado real; si se renombró alguno, podrás deshacerlo desde «Último lote».`,
    primary: { label: "Volver a analizar", action: () => startPreview({ origin: "retry" }) }
  });
  announce("Resultado desconocido. Vuelve a analizar la carpeta para comprobar su estado.");
  focusHeading();
}

function showResult(plan, result) {
  const byOriginal = new Map(plan.items.map((item) => [item.original_name, item]));
  const failures = result.failures.map((failure) => ({
    original_name: failure.original_name,
    new_name: failure.new_name,
    status: "failed",
    reason: failure.reason,
    date_text: byOriginal.get(failure.original_name)?.date_text,
    date_source: byOriginal.get(failure.original_name)?.date_source
  }));
  const renamed = result.renamed.map((entry) => ({
    original_name: entry.old_name,
    new_name: entry.new_name,
    status: "renamed",
    date_text: byOriginal.get(entry.old_name)?.date_text,
    date_source: byOriginal.get(entry.old_name)?.date_source
  }));
  state.result = { items: [...failures, ...renamed] };
  if (result.run_id) {
    state.lastRun = { run_id: result.run_id, count: result.renamed_count, folder: plan.folder, folder_name: folderNameOf(plan.folder) };
  } else {
    refreshLastRun();
  }
  const renamedCount = result.renamed_count;
  const failedCount = result.failed_count;
  let view;
  if (!failedCount) {
    view = "success";
    setSheetHeading("Renombrado completo", renamedCount === 1 ? "*1 foto*, en su sitio" : `*${count(renamedCount)} fotos*, en su sitio`);
    const untouched = plan.items.length - renamedCount;
    ui.resultText.replaceChildren(...strong(
      "Todos los cambios previstos se aplicaron y **ningún archivo se ha sobrescrito**." +
      (untouched ? ` ${plural(untouched, "archivo con conflicto u omitido sigue", "archivos con conflicto u omitidos siguen")} como ${untouched === 1 ? "estaba" : "estaban"}.` : "") +
      " Si algo no te convence, puedes deshacer el lote mientras la aplicación siga abierta."
    ));
  } else if (renamedCount) {
    view = "partial";
    setSheetHeading(`Resultado: ${plural(failedCount, "fallo", "fallos")}`, `Revelado con velos: *${count(renamedCount)}* renombradas, *${count(failedCount)}* sin cambiar`);
    ui.resultText.replaceChildren(...strong(`${failedCount === 1 ? "**1 archivo** no se pudo renombrar y conserva" : `**${count(failedCount)} archivos** no se pudieron renombrar y conservan`} su nombre original; el motivo está en la lista. El resto se aplicó correctamente.`));
  } else {
    view = "total";
    setSheetHeading("Ningún archivo cambió", "Película *velada*");
    ui.resultText.replaceChildren(...strong(`${failedCount === 1 ? "El archivo falló y conserva" : `Los **${count(failedCount)} archivos** fallaron y conservan`} su nombre original; el motivo de cada uno está en la lista. Suele deberse a un archivo abierto en otro programa o a una carpeta sin permiso de escritura: corrígelo y vuelve a analizar.`));
  }
  setSeg(ui.resultCount, renamedCount);
  ui.resultOf.hidden = view === "success";
  setSeg(ui.resultTotal, renamedCount + failedCount);
  ui.undoButton.hidden = !result.run_id;
  ui.undoButton.textContent = renamedCount === 1 ? "Deshacer este cambio" : `Deshacer ${count(renamedCount)} cambios`;
  configureResultPrimary(view === "success"
    ? { label: "Elegir otra carpeta", action: pickFolder, back: true }
    : { label: "Volver a analizar", action: () => startPreview({ origin: "retry" }), back: false });
  state.filter = "all";
  state.query = "";
  ui.search.value = "";
  setView(view);
  renderFilters({ renamed: renamedCount, failed: failedCount }, ["all", "failed", "renamed"]);
  list.setItems(filteredItems(), { develop: true });
  list.fix();
  focusHeading();
  announce(
    view === "success"
      ? `${plural(renamedCount, "foto renombrada", "fotos renombradas")}. Puedes deshacer el lote.`
      : `${plural(renamedCount, "foto renombrada", "fotos renombradas")} y ${plural(failedCount, "fallo", "fallos")}.`
  );
}

function configureResultPrimary({ label, action, back }) {
  ui.resultPrimary.textContent = label;
  ui.resultPrimary.onclick = action;
  ui.resultBack.hidden = !back;
}

async function undoLastRun() {
  const run = state.lastRun;
  if (!run || isBusy()) return;
  window.clearTimeout(refreshTimer);
  if (activeScan) await cancelActiveScan();
  scanGeneration += 1;
  ui.body.classList.remove("is-refreshing");
  if (state.mode === "idle") setMode("workbench");
  setSheetHeading("Deshaciendo el lote", `Devolviendo sus nombres en ${quoted(run.folder_name)}`);
  resetProgress(run.count);
  ui.progressBar.parentElement.classList.add("is-indeterminate");
  ui.progressLabel.textContent = `Restaurando ${plural(run.count, "archivo", "archivos")}…`;
  ui.cancelScan.hidden = true;
  ui.applyWarning.hidden = false;
  setView("undoing");
  focusHeading();
  const backToFolder = () => {
    state.folder = run.folder;
    renderFolder();
    startPreview({ origin: "retry" });
  };
  try {
    const result = await request("/api/undo", { run_id: run.run_id });
    state.lastRun = result.run_id ? { ...run, count: result.failed_count } : null;
    state.folder = run.folder;
    ui.heroPath.value = run.folder;
    renderFolder();
    if (!result.failed_count) {
      state.result = null;
      thumbnails.clear();
      setSheetHeading("Restaurado", result.restored_count === 1
        ? "*1 archivo* vuelve a su nombre"
        : `*${count(result.restored_count)} archivos* vuelven a su nombre`);
      showMessage({
        view: "restored",
        art: "restored",
        text: `La carpeta ${quoted(run.folder_name)} está como antes de renombrar. Puedes preparar otra vista previa o elegir otra carpeta.`,
        primary: { label: "Volver a analizar", action: backToFolder },
        secondary: { label: "Elegir otra carpeta", action: pickFolder }
      });
      announce("Lote deshecho. Los archivos han recuperado su nombre original.");
    } else {
      showUndoPartial(result, run);
    }
  } catch (error) {
    if (error.status >= 400 && error.status < 500) {
      state.lastRun = null;
      showError("No se pudo *deshacer*", `${error.message} Ningún archivo se ha modificado.`, backToFolder);
    } else {
      setSheetHeading("Resultado sin confirmar", "Revisa la carpeta *antes de seguir*");
      showMessage({
        view: "unknown",
        art: "fogged",
        text: "La aplicación no pudo confirmar el resultado del deshacer. Algunos archivos pueden haber recuperado su nombre. **Vuelve a analizar la carpeta** para ver su estado real; lo que siga pendiente aparecerá en «Último lote».",
        primary: { label: "Volver a analizar", action: backToFolder }
      });
      refreshLastRun();
    }
  }
  focusHeading();
}

function showUndoPartial(result, run) {
  state.result = {
    items: result.failures.map((failure) => ({
      original_name: failure.current_name,
      new_name: failure.original_name,
      status: "pending",
      reason: failure.reason
    }))
  };
  setSheetHeading("Deshacer incompleto", `*${count(result.failed_count)}* sin restaurar`);
  ui.resultText.replaceChildren(...strong(
    `Se restauraron **${plural(result.restored_count, "archivo", "archivos")}**, pero ${result.failed_count === 1 ? "**1** sigue" : `**${count(result.failed_count)}** siguen`} con el nombre nuevo. El motivo está en la lista: cierra el programa que lo use y vuelve a intentarlo. No se ha sobrescrito nada.`
  ));
  setSeg(ui.resultCount, result.restored_count);
  ui.resultOf.hidden = false;
  setSeg(ui.resultTotal, result.restored_count + result.failed_count);
  ui.undoButton.hidden = true;
  state.folder = run.folder;
  renderFolder();
  configureResultPrimary(state.lastRun
    ? { label: "Reintentar deshacer", action: undoLastRun, back: true }
    : { label: "Volver a analizar", action: () => startPreview({ origin: "retry" }), back: false });
  state.filter = "all";
  state.query = "";
  ui.search.value = "";
  setView("undo-partial");
  renderFilters({ pending: result.failed_count }, ["all", "pending"]);
  list.setItems(filteredItems());
  announce(`${plural(result.failed_count, "archivo no se pudo", "archivos no se pudieron")} restaurar.`);
}

function setRecursive(value) {
  state.recursive = value;
  for (const input of ui.recursiveInputs) input.checked = value;
  if (state.mode !== "idle") startPreview({ origin: "recursive" });
}

/* ------------------------------------------------------------- listeners */

ui.heroBrowse.addEventListener("click", pickFolder);
ui.changeFolder.addEventListener("click", pickFolder);
ui.heroForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const folder = ui.heroPath.value.trim();
  if (!folder) {
    showHeroMessage("Pega la ruta de una carpeta o pulsa **Elegir carpeta**.", true);
    ui.heroPath.focus();
    return;
  }
  chooseFolder(folder);
});
ui.heroPath.addEventListener("input", () => { ui.heroMessage.hidden = true; });
for (const input of ui.recursiveInputs) input.addEventListener("change", () => setRecursive(input.checked));
for (const button of ui.presets) button.addEventListener("click", () => applyPreset(button.dataset.preset));
for (const radio of ui.dateRadios) {
  radio.addEventListener("change", () => {
    renderTokens();
    announce(`Formato de fecha ${radio.closest("label")?.textContent.trim() || radio.value}.`);
    scheduleRefresh();
  });
}
for (const button of ui.addPieces) {
  button.addEventListener("click", () => {
    const value = button.dataset.piece;
    if (value === "text") {
      ui.literalText.value = "";
      ui.literalError.hidden = true;
      ui.textDialog.returnValue = "";
      ui.textDialog.showModal();
      return;
    }
    state.components.push({ kind: "field", value });
    formatChanged("custom", `${FIELD_LABELS[value]} añadida al final.`);
  });
}
ui.textDialog.addEventListener("submit", (event) => {
  if (event.submitter?.value !== "add") return;
  const value = ui.literalText.value;
  let problem = "";
  if (!value) problem = "Escribe algún texto o pulsa Cancelar.";
  else if (INVALID_NAME_TEXT.test(value)) problem = "Un nombre de archivo no puede contener < > : \" / \\ | ? *";
  if (problem) {
    event.preventDefault();
    ui.literalError.textContent = problem;
    ui.literalError.hidden = false;
    ui.literalText.focus();
    return;
  }
  state.components.push({ kind: "text", value });
  formatChanged("custom", `Texto «${value}» añadido al final.`);
});
ui.textDialog.addEventListener("close", () => {
  const textButton = ui.addPieces.find((button) => button.dataset.piece === "text");
  (textButton || ui.addPieces[0]).focus();
});
ui.detailDialog.addEventListener("close", () => ui.listScroller.focus());

ui.applyButton.addEventListener("click", openConfirm);
ui.confirmDialog.addEventListener("close", () => {
  if (ui.confirmDialog.returnValue === "apply") applyPlan();
  else ui.applyButton.focus();
});
ui.cancelScan.addEventListener("click", async () => {
  ui.cancelScan.disabled = true;
  ui.progressLabel.textContent = "Cancelando…";
  await cancelActiveScan();
});
ui.undoButton.addEventListener("click", undoLastRun);
ui.lastRunUndo.addEventListener("click", undoLastRun);
ui.resultBack.addEventListener("click", () => startPreview({ origin: "retry" }));

let searchTimer = null;
ui.search.addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    state.query = ui.search.value;
    list.setItems(filteredItems());
    announce(`${plural(list.items.length, "archivo coincide", "archivos coinciden")}.`);
  }, 120);
});

ui.wordmark.addEventListener("click", (event) => {
  event.preventDefault();
  if (isBusy()) return;
  window.clearTimeout(refreshTimer);
  if (activeScan) cancelActiveScan();
  scanGeneration += 1;
  setMode("idle");
  ui.heroMessage.hidden = true;
  ui.heroBrowse.focus();
});

/* Shortcuts use Alt so they never fire while typing or reading (WCAG 2.1.4). */
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
document.addEventListener("keydown", (event) => {
  if (!event.altKey || event.ctrlKey || event.metaKey || document.querySelector("dialog[open]")) return;
  // On macOS Option+letter types characters (ø, ∫): never steal it from a text field.
  if (isMac && event.target.closest?.("input, textarea, [contenteditable]")) return;
  if (event.code === "KeyO") {
    event.preventDefault();
    pickFolder();
  } else if (event.code === "KeyB" && !ui.sheetTools.hidden && state.mode !== "idle") {
    event.preventDefault();
    ui.search.focus();
  }
});

function syncFormatDisclosure() {
  ui.formatDetails.open = !narrowScreen.matches;
}
narrowScreen.addEventListener("change", syncFormatDisclosure);
ui.formatDetails.addEventListener("toggle", () => {
  if (!narrowScreen.matches && !ui.formatDetails.open) ui.formatDetails.open = true;
});

syncFormatDisclosure();
renderTokens();
renderLoupe(null);
updateApplyPanel();
refreshLastRun();
