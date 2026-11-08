"use strict";

/* PhotoDateRenamer — interface controller.
   Views: idle · scanning · empty · nophotos · cancelled · error · preview ·
          applying · success · partial · total · restored */

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
const STATUS_LABELS = {
  ready: "Se renombra",
  conflict: "Conflicto",
  skipped: "Omitida",
  unchanged: "Sin cambio",
  renamed: "Hecho",
  failed: "Falló"
};
const FILTER_LABELS = {
  all: "Todas",
  ready: "Se renombran",
  conflict: "Conflictos",
  skipped: "Omitidas",
  unchanged: "Sin cambio",
  renamed: "Renombradas",
  failed: "Fallaron"
};
const INVALID_NAME_TEXT = /[<>:"/\\|?*\u0000-\u001f]/;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const numberFormat = new Intl.NumberFormat("es-ES", { useGrouping: "always" });
const $ = (selector) => document.querySelector(selector);

const ui = {
  body: document.body,
  hero: $("#hero"),
  heroForm: $("#hero-form"),
  heroPath: $("#hero-path"),
  heroBrowse: $("#hero-browse"),
  heroMessage: $("#hero-message"),
  heroStamp: $("#hero-stamp"),
  workbench: $("#workbench"),
  folderTitle: $("#folder-title"),
  folderPath: $("#folder-path-display"),
  changeFolder: $("#change-folder"),
  recursiveInputs: [...document.querySelectorAll("[data-recursive]")],
  presets: [...document.querySelectorAll(".preset")],
  tokens: $("#tokens"),
  addElement: $("#add-element"),
  dateFormat: $("#date-format"),
  exampleOld: $("#example-old"),
  exampleNew: $("#example-new"),
  applyBox: $("#apply-box"),
  applyHint: $("#apply-hint"),
  applyButton: $("#apply-button"),
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
  messageKicker: $("#message-kicker"),
  messageTitle: $("#message-title"),
  messageText: $("#message-text"),
  messagePrimary: $("#message-primary"),
  messageSecondary: $("#message-secondary"),
  resultView: $("#result-view"),
  resultCount: $("#result-count"),
  resultOf: $("#result-of"),
  resultTotal: $("#result-total"),
  resultKicker: $("#result-kicker"),
  resultTitle: $("#result-title"),
  resultText: $("#result-text"),
  undoButton: $("#undo-button"),
  resultBack: $("#result-back"),
  resultNew: $("#result-new"),
  listView: $("#list-view"),
  listScroller: $("#list-scroller"),
  listEmpty: $("#list-empty"),
  loupe: $("#loupe"),
  loupeBody: $("#loupe-body"),
  detailDialog: $("#detail-dialog"),
  detailBody: $("#detail-body"),
  announcer: $("#announcer"),
  toast: $("#toast"),
  textDialog: $("#text-dialog"),
  literalText: $("#literal-text"),
  literalError: $("#literal-error"),
  confirmDialog: $("#confirm-dialog"),
  confirmTitle: $("#confirm-title"),
  confirmText: $("#confirm-text"),
  confirmApply: $("#confirm-apply"),
  wordmark: $(".wordmark")
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
  lastRunId: null,
  filter: "all",
  query: ""
};
let scanGeneration = 0;
let activeScan = null;
let refreshTimer = null;
let toastTimer = null;

/* ---------------------------------------------------------------- helpers */

function h(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === "class") element.className = value;
    else if (name === "text") element.textContent = value;
    else element.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

/** Render "texto *énfasis* texto" into nodes, with *…* as <em>. */
function rich(text) {
  return text.split(/(\*[^*]+\*)/).filter(Boolean).map((part) =>
    part.startsWith("*") ? h("em", {}, part.slice(1, -1)) : document.createTextNode(part)
  );
}

/** Render "texto **negrita** texto" into nodes, with **…** as <b>. */
function strong(text) {
  return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part) =>
    part.startsWith("**") ? h("b", {}, part.slice(2, -2)) : document.createTextNode(part)
  );
}

const count = (value) => numberFormat.format(value);
const plural = (value, one, many) => `${count(value)} ${value === 1 ? one : many}`;

function announce(message) {
  ui.announcer.textContent = "";
  window.setTimeout(() => { ui.announcer.textContent = message; }, 30);
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  toastTimer = window.setTimeout(() => { ui.toast.hidden = true; }, 4200);
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

async function request(path, data = {}) {
  let response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PhotoDateRenamer-Token": window.PDR_TOKEN
      },
      body: JSON.stringify(data)
    });
  } catch (error) {
    throw new RequestError("No hay conexión con la aplicación. ¿Se cerró la ventana del programa?", 0);
  }
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

function sameSettings(left, right) {
  return Boolean(left && right) && JSON.stringify(left) === JSON.stringify(right);
}

function currentSettings() {
  return {
    folder: state.folder,
    components: state.components.map((part) => ({ ...part })),
    date_format: ui.dateFormat.value,
    recursive: state.recursive
  };
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
  transition(() => {
    state.mode = mode;
    ui.body.dataset.mode = mode;
    ui.hero.hidden = mode !== "idle";
    ui.workbench.hidden = mode === "idle";
  });
}

const VIEW_PANELS = {
  scanning: "progress",
  applying: "progress",
  empty: "message",
  nophotos: "message",
  cancelled: "message",
  error: "message",
  restored: "message",
  preview: "list",
  success: "result",
  partial: "result",
  total: "result"
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
}

function setSheetHeading(kicker, title) {
  ui.sheetKicker.textContent = kicker;
  ui.sheetTitle.replaceChildren(...rich(title));
}

function focusHeading() {
  ui.sheetTitle.focus({ preventScroll: false });
}

function updateControlsLock() {
  const locked = state.view === "applying";
  for (const element of [
    ui.changeFolder, ui.addElement, ui.dateFormat, ...ui.recursiveInputs, ...ui.presets,
    ...ui.tokens.querySelectorAll("button")
  ]) {
    if (locked) {
      element.dataset.lockedDisabled = element.disabled ? "1" : "";
      element.disabled = true;
    } else if ("lockedDisabled" in element.dataset) {
      element.disabled = element.dataset.lockedDisabled === "1";
      delete element.dataset.lockedDisabled;
    }
  }
}

/* ---------------------------------------------------------- folder panel */

function renderFolder() {
  ui.folderTitle.textContent = folderNameOf(state.folder) || "—";
  ui.folderTitle.title = state.folder;
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
  if (state.view === "applying") return;
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
        formatChanged("custom", `${spoken} movida.`);
        const again = ui.tokens.children[index + direction]?.querySelectorAll("button")[direction < 0 ? 0 : 1];
        (again && !again.disabled ? again : ui.tokens.children[index + direction]?.querySelector("button:not(:disabled)"))?.focus();
      });
      return button;
    };
    const remove = h("button", { type: "button", "aria-label": `Quitar: ${spoken}` }, "×");
    remove.addEventListener("click", () => {
      state.components.splice(index, 1);
      formatChanged("custom", `${spoken} quitada.`);
      const next = ui.tokens.children[Math.min(index, ui.tokens.children.length - 1)];
      (next?.querySelector("button:last-child") || ui.addElement).focus();
    });
    return h(
      "li",
      { class: `token ${isText ? "token-text" : ""} ${component.value === "date" && !isText ? "token-date" : ""}` },
      h("span", { class: "token-label" }, label),
      move(-1, "←", "Mover a la izquierda"),
      move(1, "→", "Mover a la derecha"),
      remove
    );
  });
  if (!nodes.length) nodes.push(h("li", { class: "tokens-empty" }, "Añade al menos una pieza para formar el nombre."));
  ui.tokens.replaceChildren(...nodes);
  for (const button of ui.presets) {
    button.setAttribute("aria-pressed", String(button.dataset.preset === state.preset));
  }
  renderExample();
}

function sampleForExample() {
  const items = state.plan?.items || [];
  const item =
    items.find((entry) => entry.status === "ready" && !entry.original_name.includes(entry.date_text)) ||
    items.find((entry) => entry.date_text && entry.status !== "skipped");
  if (item) return { name: splitPath(item.original_name)[1], date: item.date_text };
  return { name: "IMG_0412.jpg", date: formatDate(new Date(), ui.dateFormat.value) };
}

function renderExample() {
  const sample = sampleForExample();
  const sampleDate = state.plan && sameSettings(state.planSettings, currentSettings())
    ? sample.date
    : formatDate(dateFromText(sample.date), ui.dateFormat.value);
  const dot = sample.name.lastIndexOf(".");
  const extension = dot > 0 ? sample.name.slice(dot) : "";
  const stem = extension ? sample.name.slice(0, -extension.length) : sample.name;
  const values = { original_name: sample.name, original_stem: stem, extension };
  const nodes = state.components.map((part) => {
    if (part.kind === "text") return document.createTextNode(part.value);
    if (part.value === "date") return h("mark", { class: "stamp" }, sampleDate);
    return document.createTextNode(values[part.value]);
  });
  ui.exampleOld.textContent = sample.name;
  ui.exampleNew.replaceChildren(...(nodes.length ? nodes : [document.createTextNode("—")]));
}

function dateFromText(text) {
  const digits = (text || "").replace(/\D/g, "");
  if (digits.length !== 8) return new Date();
  return new Date(Number(digits.slice(0, 4)), Number(digits.slice(4, 6)) - 1, Number(digits.slice(6, 8)));
}

function formatChanged(preset, message) {
  state.preset = preset;
  renderTokens();
  if (message) announce(message);
  scheduleRefresh();
}

function scheduleRefresh() {
  if (state.mode === "idle" || !state.folder || state.view === "applying") return;
  window.clearTimeout(refreshTimer);
  if (!state.components.length) {
    cancelActiveScan();
    showEmptyFormat();
    return;
  }
  refreshTimer = window.setTimeout(() => startPreview({ origin: "format" }), 320);
}

function showEmptyFormat() {
  state.plan = null;
  setSheetHeading("Formato vacío", "Sin piezas no hay *nombre*");
  showMessage({
    view: "error",
    art: "nophotos",
    kicker: "Falta el formato",
    title: "Añade al menos *una pieza*",
    text: "Elige una receta o añade la fecha, el nombre original o un texto. La vista previa se actualizará sola.",
    primary: { label: "Usar «Fecha + nombre»", action: () => applyPreset("date_original") }
  });
}

function applyPreset(preset) {
  if (preset !== "custom") state.components = PRESETS[preset].map((part) => ({ ...part }));
  formatChanged(preset, preset === "custom" ? "Formato a medida: añade o mueve piezas." : null);
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
  await scan.done.catch(() => {});
}

function updateScanProgress(progress) {
  if (state.view !== "scanning") return;
  const indeterminate = progress.phase !== "scanning" || progress.total === null;
  ui.progressBar.parentElement.classList.toggle("is-indeterminate", indeterminate);
  if (progress.phase === "indexing") {
    ui.progressCount.textContent = String(progress.scanned);
    ui.progressTotal.textContent = "—";
    ui.progressLabel.textContent = `Contando archivos… ${count(progress.scanned)} por ahora.`;
  } else if (!indeterminate) {
    ui.progressCount.textContent = String(progress.scanned);
    ui.progressTotal.textContent = String(progress.total);
    ui.progressBar.style.transform = `scaleX(${progress.total ? progress.scanned / progress.total : 1})`;
    ui.progressLabel.textContent = `Leyendo la fecha de la foto ${count(progress.scanned)} de ${count(progress.total)}.`;
  } else {
    ui.progressLabel.textContent = "Preparando el análisis…";
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

function showScanning() {
  setSheetHeading("Revelando", `Leyendo *${folderNameOf(state.folder)}*`);
  ui.progressCount.textContent = "0";
  ui.progressTotal.textContent = "—";
  ui.progressBar.style.transform = "scaleX(0)";
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
      showError("No encuentro esa carpeta", check.error, () => startPreview({ origin: "retry" }));
    }
    return;
  }
  state.folder = check.folder;
  ui.heroPath.value = check.folder;

  const settings = currentSettings();
  const scan = { id: crypto.randomUUID(), cancelled: false, settled: false, done: null };
  activeScan = scan;
  state.plan = null;
  state.planSettings = null;
  state.filter = "all";
  state.query = "";
  ui.search.value = "";

  let revealTimer = null;
  if (fromIdle) {
    ui.heroBrowse.setAttribute("aria-busy", "true");
    revealTimer = window.setTimeout(() => {
      if (!scan.settled && generation === scanGeneration) {
        renderFolder();
        setMode("workbench");
        showScanning();
      }
    }, 260);
  } else {
    renderFolder();
    showScanning();
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
    ui.body.dataset.planFolder = result.folder;
    renderFolder();
    setMode("workbench");
    showPlan(result, origin);
  } catch (error) {
    if (generation !== scanGeneration) return;
    setMode("workbench");
    showError("No se pudo leer la carpeta", error.message, () => startPreview({ origin: "retry" }));
  } finally {
    window.clearTimeout(revealTimer);
    ui.heroBrowse.removeAttribute("aria-busy");
    if (activeScan === scan) activeScan = null;
  }
}

function showCancelled() {
  state.plan = null;
  setSheetHeading("Análisis detenido", "Revelado *interrumpido*");
  showMessage({
    view: "cancelled",
    art: "cancelled",
    kicker: "Cancelado",
    title: "Has detenido el *análisis*",
    text: "No se ha modificado ningún archivo. Puedes volver a analizar la carpeta cuando quieras.",
    primary: { label: "Volver a analizar", action: () => startPreview({ origin: "retry" }) },
    secondary: { label: "Elegir otra carpeta", action: pickFolder }
  });
  announce("Análisis cancelado. No se modificó ningún archivo.");
}

function showError(title, message, retry) {
  setSheetHeading("Algo no salió bien", "Película *velada*");
  showMessage({
    view: "error",
    art: "fogged",
    kicker: "Error",
    title,
    text: message,
    primary: { label: "Reintentar", action: retry },
    secondary: { label: "Elegir otra carpeta", action: pickFolder }
  });
  announce(`${title}. ${message}`);
}

function showMessage({ view, art, kicker, title, text, primary, secondary }) {
  ui.messageArt.dataset.art = art;
  ui.messageKicker.textContent = kicker;
  ui.messageTitle.replaceChildren(...rich(title));
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
    return summary;
  }, {});
}

function showPlan(plan, origin) {
  const folderName = folderNameOf(plan.folder);
  if (!plan.items.length) {
    state.plan = null;
    if (plan.entry_count === 0) {
      setSheetHeading("Carrete vacío", `*${folderName}* está vacía`);
      showMessage({
        view: "empty",
        art: "empty",
        kicker: "Carpeta vacía",
        title: "Aquí no hay *nada* que revelar",
        text: "La carpeta no contiene ningún archivo. Elige otra carpeta con fotografías.",
        primary: { label: "Elegir otra carpeta", action: pickFolder }
      });
      announce("La carpeta está vacía.");
    } else {
      const suggestion = state.recursive
        ? ""
        : " Si tus fotos están dentro de subcarpetas, activa **Subcarpetas**.";
      setSheetHeading("Sin fotografías", `Ninguna foto en *${folderName}*`);
      showMessage({
        view: "nophotos",
        art: "nophotos",
        kicker: "Sin imágenes compatibles",
        title: "Hay archivos, pero *ninguna foto*",
        text: `Encontré ${plan.entry_count === 1 ? "**1 elemento**" : `**${count(plan.entry_count)} elementos**`}, pero ninguno es JPG, PNG o TIFF.${suggestion}`,
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

  const counts = countsOf(plan.items);
  setSheetHeading("Hoja de contactos", `*${count(plan.items.length)}* ${plan.items.length === 1 ? "foto revisada" : "fotos revisadas"}`);
  renderFilters(counts, ["all", "ready", "conflict", "skipped", "unchanged"]);
  setView("preview");
  list.setItems(filteredItems(), { develop: origin !== "format" });
  renderExample();
  const ready = counts.ready || 0;
  announce(
    `Vista previa lista: ${plural(ready, "foto se renombrará", "fotos se renombrarán")}` +
    `${counts.conflict ? `, ${plural(counts.conflict, "conflicto", "conflictos")}` : ""}` +
    `${counts.skipped ? `, ${plural(counts.skipped, "omitida", "omitidas")}` : ""}.`
  );
  if (origin !== "format") focusHeading();
}

function renderFilters(counts, keys) {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const buttons = keys
    .filter((key) => key === "all" || counts[key])
    .map((key) => {
      const button = h(
        "button",
        { type: "button", class: "filter", "data-filter": key, "aria-pressed": String(state.filter === key) },
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
    if (state.filter !== "all" && item.status !== state.filter) return false;
    if (!query) return true;
    return (
      item.original_name.toLocaleLowerCase("es").includes(query) ||
      (item.new_name || "").toLocaleLowerCase("es").includes(query)
    );
  });
}

/** Highlight the date inside a destination file name. */
function nameWithStamp(path, dateText) {
  const [directory, base] = splitPath(path);
  const nodes = [];
  if (directory) nodes.push(h("span", { class: "dir" }, directory));
  const at = dateText ? base.indexOf(dateText) : -1;
  if (at === -1) {
    nodes.push(base);
  } else {
    nodes.push(base.slice(0, at), h("mark", { class: "stamp" }, dateText), base.slice(at + dateText.length));
  }
  return nodes;
}

function pathNodes(path) {
  const [directory, base] = splitPath(path);
  return [directory ? h("span", { class: "dir" }, directory) : null, base];
}

function shortSource(source) {
  if (!source) return "—";
  if (source.startsWith("EXIF")) return "EXIF";
  if (source.startsWith("XMP")) return "XMP";
  return "ARCHIVO";
}

function renderRow(item, index) {
  const showsName = item.status === "ready" || item.status === "renamed";
  const second = showsName
    ? h("span", { class: "row-new" }, h("span", { class: "arrow", "aria-hidden": "true" }, "→"), h("span", { class: "sr-only" }, item.status === "renamed" ? " ahora se llama " : " pasará a llamarse "), ...nameWithStamp(item.new_name, item.date_text))
    : h("span", { class: "row-new row-reason" }, item.reason || (item.status === "unchanged" ? "Ya tiene ese nombre." : "—"));
  return [
    h("span", { class: "row-frame", "aria-hidden": "true" }, String(index + 1).padStart(4, "0"), h("small", {}, shortSource(item.date_source))),
    h("span", { class: "row-names" }, h("span", { class: "row-old" }, ...pathNodes(item.original_name)), second),
    h("span", { class: `badge badge-${item.status}` }, h("span", { class: "sr-only" }, ". "), STATUS_LABELS[item.status])
  ];
}

function loupeContent(item) {
  const rows = [["Ahora", h("span", { class: "mono" }, item.original_name)]];
  if (item.new_name && item.status !== "unchanged") {
    rows.push([item.status === "renamed" ? "Ahora se llama" : "Será", h("span", { class: "mono" }, ...nameWithStamp(item.new_name, item.date_text))]);
  }
  if (item.date_source) rows.push(["Fecha de", item.date_source]);
  if (item.reason) rows.push(["Motivo", h("span", { class: "loupe-reason" }, item.reason)]);
  rows.push(["Estado", STATUS_LABELS[item.status]]);
  return h("dl", {}, ...rows.flatMap(([term, value]) => [h("dt", {}, term), h("dd", {}, value)]));
}

function renderLoupe(item) {
  if (!item) {
    ui.loupeBody.replaceChildren(h("span", {}, "Pasa el cursor o usa ↑ ↓ en la hoja para ver un archivo completo."));
    return;
  }
  ui.loupeBody.replaceChildren(loupeContent(item));
}

function openDetail(item) {
  if (!item || getComputedStyle(ui.loupe).display !== "none") return;
  ui.detailBody.replaceChildren(loupeContent(item));
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
    this.rowHeight = 62;
    this.viewport = 400;
    this.frame = 0;
    this.scroller.addEventListener("scroll", () => this.schedule(), { passive: true });
    this.scroller.addEventListener("keydown", (event) => this.onKey(event));
    this.scroller.addEventListener("pointermove", (event) => {
      const row = event.target.closest(".row");
      if (row) this.setActive(Number(row.dataset.index), false);
    });
    this.scroller.addEventListener("click", (event) => {
      const row = event.target.closest(".row");
      if (!row) return;
      this.setActive(Number(row.dataset.index), false);
      openDetail(this.items[this.active]);
    });
    new ResizeObserver(() => this.measure()).observe(this.scroller);
  }

  measure() {
    const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--row-h"));
    if (value) this.rowHeight = value;
    this.viewport = this.scroller.clientHeight || 400;
    this.schedule();
  }

  setItems(items, { develop = false } = {}) {
    this.items = items;
    for (const row of this.rows.values()) row.remove();
    this.rows.clear();
    this.spacer.style.height = `${items.length * this.rowHeight}px`;
    this.scroller.scrollTop = 0;
    this.emptyNote.hidden = items.length > 0;
    this.active = -1;
    this.scroller.removeAttribute("aria-activedescendant");
    this.render();
    this.setActive(items.length ? 0 : -1, false);
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
          class: `row is-${item.status}${index === this.active ? " is-active" : ""}`,
          role: "option",
          id: `frame-${index}`,
          "data-index": index,
          "aria-setsize": this.items.length,
          "aria-posinset": index + 1,
          "aria-selected": String(index === this.active)
        },
        ...renderRow(item, index)
      );
      row.style.transform = `translateY(${index * this.rowHeight}px)`;
      this.spacer.append(row);
      this.rows.set(index, row);
    }
  }

  setActive(index, scroll) {
    if (index === this.active) return;
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
    const moves = {
      ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page,
      Home: -Infinity, End: Infinity
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const target = Math.min(this.items.length - 1, Math.max(0, (this.active < 0 ? 0 : this.active) + moves[event.key]));
    this.setActive(target, true);
  }

  develop() {
    if (reduceMotion.matches || typeof Element.prototype.animate !== "function") return;
    const visible = [...this.rows.entries()].sort(([a], [b]) => a - b).slice(0, 14);
    visible.forEach(([, row], order) => {
      row.animate(
        [
          { opacity: 0, filter: "brightness(2.2) sepia(1) blur(3px)" },
          { opacity: 1, filter: "none" }
        ],
        { duration: 700, delay: order * 35, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" }
      );
    });
  }
}

const list = new VirtualList(ui.listScroller, ui.listEmpty);

/* ------------------------------------------------------------ apply panel */

function updateApplyPanel() {
  const plan = state.plan;
  const counts = plan ? countsOf(plan.items) : {};
  const ready = counts.ready || 0;
  const fresh = plan && sameSettings(state.planSettings, currentSettings());
  let hint;
  if (state.view === "scanning") hint = "Analizando la carpeta…";
  else if (state.view === "applying") hint = "Aplicando los cambios…";
  else if (["success", "partial", "total"].includes(state.view)) hint = "Lote aplicado. Revisa el resumen a la derecha.";
  else if (!plan) hint = "Cuando haya una vista previa, aquí podrás aplicarla.";
  else if (!fresh) hint = "El formato cambió: actualizando la vista previa…";
  else if (!ready) hint = "Ninguna foto puede renombrarse con este formato. Revisa los conflictos o prueba otra receta.";
  else {
    const rest = plan.items.length - ready;
    hint = `**${plural(ready, "foto", "fotos")}** ${ready === 1 ? "cambiará" : "cambiarán"} de nombre.` +
      (rest ? ` ${plural(rest, "se queda", "se quedan")} como ${rest === 1 ? "está" : "están"}.` : "");
  }
  ui.applyHint.replaceChildren(...strong(hint));
  ui.applyBox.hidden = state.view !== "preview";
  const enabled = state.view === "preview" && fresh && ready > 0;
  ui.applyButton.disabled = !enabled;
  ui.applyButton.textContent = enabled ? `Renombrar ${plural(ready, "foto", "fotos")}` : "Renombrar";
}

function openConfirm() {
  if (ui.applyButton.disabled || !state.plan) return;
  const counts = countsOf(state.plan.items);
  const ready = counts.ready || 0;
  const rest = state.plan.items.length - ready;
  ui.confirmTitle.replaceChildren("¿Renombrar ", h("span", { class: "seg" }, String(ready)), ready === 1 ? " foto?" : " fotos?");
  ui.confirmText.replaceChildren(...strong(
    `Se cambiará el nombre de **${plural(ready, "archivo", "archivos")}** en **${folderNameOf(state.plan.folder)}**` +
    `${state.recursive ? " y sus subcarpetas" : ""}.` +
    (rest ? ` ${plural(rest, "archivo con conflicto u omitido se queda", "archivos con conflicto u omitidos se quedan")} como ${rest === 1 ? "está" : "están"}.` : "")
  ));
  ui.confirmApply.textContent = `Renombrar ${count(ready)}`;
  ui.confirmDialog.returnValue = "";
  ui.confirmDialog.showModal();
}

async function applyPlan() {
  const plan = state.plan;
  if (!plan || !sameSettings(state.planSettings, currentSettings())) return;
  const total = plan.rename_count;
  setSheetHeading("Fijando", `Renombrando *${folderNameOf(plan.folder)}*`);
  ui.progressCount.textContent = "0";
  ui.progressTotal.textContent = String(total);
  ui.progressBar.style.transform = "scaleX(0)";
  ui.progressBar.parentElement.classList.remove("is-indeterminate");
  ui.progressLabel.textContent = `Renombrando 0 de ${count(total)}…`;
  ui.cancelScan.hidden = true;
  ui.applyWarning.hidden = false;
  setView("applying");
  focusHeading();

  let settled = false;
  const confirm = request("/api/confirm", { plan_id: plan.plan_id }).finally(() => { settled = true; });
  (async () => {
    while (!settled) {
      try {
        const progress = await request("/api/apply-progress", { plan_id: plan.plan_id });
        if (settled || state.view !== "applying") return;
        if (progress.total) {
          ui.progressCount.textContent = String(progress.done);
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
    showError("No se aplicó ningún cambio", error.message, () => startPreview({ origin: "retry" }));
  }
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
  state.result = { runId: result.run_id, items: [...failures, ...renamed] };
  state.lastRunId = result.run_id || null;
  state.filter = "all";
  state.query = "";
  ui.search.value = "";
  const renamedCount = result.renamed_count;
  const failedCount = result.failed_count;
  let view;
  if (!failedCount) {
    view = "success";
    setSheetHeading("Revelado completo", "Todo *en su sitio*");
    ui.resultKicker.textContent = "Hecho";
    ui.resultTitle.replaceChildren(...rich(`${renamedCount === 1 ? "*1 foto* renombrada" : `*${count(renamedCount)} fotos* renombradas`}`));
    ui.resultText.replaceChildren(...strong("Ningún archivo se ha sobrescrito. Si algo no te convence, puedes **deshacer el lote** mientras la aplicación siga abierta."));
  } else if (renamedCount) {
    view = "partial";
    setSheetHeading("Revelado con velos", "Casi *todo* listo");
    ui.resultKicker.textContent = "Error parcial";
    ui.resultTitle.replaceChildren(...rich(`*${count(renamedCount)}* renombradas, *${count(failedCount)}* sin cambiar`));
    ui.resultText.replaceChildren(...strong(`${failedCount === 1 ? "**1 archivo** no se pudo renombrar" : `**${count(failedCount)} archivos** no se pudieron renombrar`} y ${failedCount === 1 ? "conserva" : "conservan"} su nombre original. Abajo verás el motivo de cada uno; el resto se aplicó correctamente.`));
  } else {
    view = "total";
    setSheetHeading("Película velada", "No se pudo *renombrar*");
    ui.resultKicker.textContent = "Error";
    ui.resultTitle.replaceChildren(...rich("Ningún archivo ha *cambiado*"));
    ui.resultText.replaceChildren(...strong(`${failedCount === 1 ? "El único archivo falló" : `Los **${count(failedCount)} archivos** fallaron`}; todos conservan su nombre original. Revisa los motivos abajo — a menudo es un archivo abierto en otro programa — y vuelve a intentarlo.`));
  }
  ui.resultCount.textContent = String(renamedCount);
  ui.resultOf.hidden = view === "success";
  ui.resultTotal.textContent = String(renamedCount + failedCount);
  ui.undoButton.hidden = !state.lastRunId;
  ui.undoButton.textContent = renamedCount === 1 ? "Deshacer este cambio" : `Deshacer ${count(renamedCount)} cambios`;
  renderFilters(
    { renamed: renamedCount, failed: failedCount },
    ["all", "failed", "renamed"]
  );
  setView(view);
  list.setItems(filteredItems(), { develop: true });
  focusHeading();
  announce(
    view === "success"
      ? `${plural(renamedCount, "foto renombrada", "fotos renombradas")}. Puedes deshacer el lote.`
      : `${plural(renamedCount, "foto renombrada", "fotos renombradas")} y ${plural(failedCount, "fallo", "fallos")}.`
  );
}

async function undoLastRun() {
  const runId = state.lastRunId;
  if (!runId) return;
  ui.undoButton.disabled = true;
  try {
    const result = await request("/api/undo", { run_id: runId });
    state.lastRunId = null;
    state.result = null;
    setSheetHeading("Restaurado", "Como *estaba*");
    showMessage({
      view: "restored",
      art: "restored",
      kicker: "Deshecho",
      title: `${result.restored_count === 1 ? "*1 archivo* ha" : `*${count(result.restored_count)} archivos* han`} recuperado su nombre`,
      text: "La carpeta vuelve a estar como antes de renombrar. Puedes preparar otra vista previa.",
      primary: { label: "Volver a analizar", action: () => startPreview({ origin: "retry" }) },
      secondary: { label: "Elegir otra carpeta", action: pickFolder }
    });
    announce("Lote deshecho. Los archivos han recuperado su nombre original.");
    focusHeading();
  } catch (error) {
    showToast(`No se pudo deshacer: ${error.message}`);
    announce(`No se pudo deshacer: ${error.message}`);
  } finally {
    ui.undoButton.disabled = false;
  }
}

function setRecursive(value) {
  state.recursive = value;
  for (const input of ui.recursiveInputs) input.checked = value;
  if (state.mode !== "idle") startPreview({ origin: "format" });
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
for (const input of ui.recursiveInputs) {
  input.addEventListener("change", () => setRecursive(input.checked));
}
for (const button of ui.presets) {
  button.addEventListener("click", () => applyPreset(button.dataset.preset));
}
ui.dateFormat.addEventListener("change", () => {
  renderExample();
  scheduleRefresh();
});
ui.addElement.addEventListener("change", () => {
  const value = ui.addElement.value;
  ui.addElement.value = "";
  if (!value) return;
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
ui.textDialog.addEventListener("close", () => ui.addElement.focus());
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
ui.resultBack.addEventListener("click", () => startPreview({ origin: "retry" }));
ui.resultNew.addEventListener("click", pickFolder);

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
  if (state.view === "applying") return;
  window.clearTimeout(refreshTimer);
  if (activeScan) cancelActiveScan();
  setMode("idle");
  ui.heroMessage.hidden = true;
  ui.heroBrowse.focus();
});

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (target.closest("input, select, textarea, dialog[open]") || document.querySelector("dialog[open]")) return;
  if (event.key === "o" || event.key === "O") {
    event.preventDefault();
    pickFolder();
  } else if (event.key === "/" && !ui.sheetTools.hidden && state.mode !== "idle") {
    event.preventDefault();
    ui.search.focus();
  }
});

/* ------------------------------------------------------------ atmosphere */

function stampToday() {
  const today = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  ui.heroStamp.textContent = `'${pad(today.getFullYear() % 100)} ${pad(today.getMonth() + 1)} ${pad(today.getDate())}`;
}

function followPointer() {
  let frame = 0;
  let x = 0;
  let y = 0;
  window.addEventListener("pointermove", (event) => {
    if (reduceMotion.matches || event.pointerType !== "mouse") return;
    x = event.clientX;
    y = event.clientY;
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      document.documentElement.style.setProperty("--pointer-x", `${(x / window.innerWidth) * 100}%`);
      document.documentElement.style.setProperty("--pointer-y", `${(y / window.innerHeight) * 100}%`);
    });
  }, { passive: true });
}

stampToday();
followPointer();
renderTokens();
renderLoupe(null);
updateApplyPanel();
