const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class MockElement {
  constructor(tagName = "div") {
    this.tagName = tagName;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.classes = new Set();
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = "";
    this.textHistory = [];
    this.classList = {
      toggle: (name, force) => {
        const enabled = force === undefined ? !this.classes.has(name) : force;
        if (enabled) this.classes.add(name);
        else this.classes.delete(name);
        return enabled;
      }
    };
  }

  set textContent(value) {
    this._textContent = String(value);
    this.textHistory.push(this._textContent);
  }

  get textContent() {
    return this._textContent || "";
  }

  addEventListener(name, callback) {
    this.listeners.set(name, callback);
  }

  async click() {
    if (this.disabled) return;
    const callback = this.listeners.get("click");
    if (callback) {
      return callback({
        target: this,
        preventDefault() {}
      });
    }
  }

  async change(value) {
    this.value = value;
    const callback = this.listeners.get("change");
    if (callback) return callback({ target: this });
  }

  append(...elements) {
    this.children.push(...elements);
  }

  replaceChildren(...elements) {
    this.children = elements;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  showModal() {}

  close() {}
}

class MemoryFileHandle {
  constructor(name, file) {
    this.name = name;
    this.kind = "file";
    this.file = file;
  }

  async getFile() {
    return { ...this.file, name: this.name };
  }

  async createWritable() {
    let nextFile;
    return {
      write: async (file) => {
        nextFile = file;
      },
      close: async () => {
        this.file = nextFile;
      }
    };
  }
}

class MemoryDirectoryHandle {
  constructor(entries = []) {
    this.name = "Test photos";
    this.kind = "directory";
    this.entries = new Map(entries.map((entry) => [entry.name, entry]));
  }

  async *values() {
    for (const entry of this.entries.values()) yield entry;
  }

  async getFileHandle(name, options = {}) {
    const existing = this.entries.get(name);
    if (existing) return existing;
    if (!options.create) throw new Error(`No such file: ${name}`);
    const handle = new MemoryFileHandle(name, { size: 0, lastModified: 0 });
    this.entries.set(name, handle);
    return handle;
  }

  async removeEntry(name) {
    if (!this.entries.delete(name)) throw new Error(`No such entry: ${name}`);
  }
}

function createHarness(fileCount, cancelAtProgress) {
  const selectors = [
    "folder-name", "notice", "undo-control", "tokens", "preview-wrap",
    "preview-rows", "preview-summary", "preview-button", "confirm-button",
    "recursive", "operation-progress", "operation-progress-bar",
    "operation-progress-label", "cancel-operation", "preview-pagination",
    "preview-page-label", "previous-page", "next-page", "add-element",
    "literal-text", "text-dialog", "add-text-button", "browse-button",
    "date-format", "undo-button", "browser-note"
  ];
  const elements = new Map(selectors.map((name) => [`#${name}`, new MockElement()]));
  const presets = ["date_original", "date_stem", "original_date", "custom"].map((preset) => {
    const button = new MockElement("button");
    button.dataset.preset = preset;
    return button;
  });
  elements.get("#date-format").value = "yyyy_mm_dd";

  const photos = Array.from({ length: fileCount }, (_, index) => {
    const name = `photo-${String(index).padStart(3, "0")}.jpg`;
    return new MemoryFileHandle(name, { size: 100, lastModified: 1 });
  });
  const directory = new MemoryDirectoryHandle(photos);
  const document = {
    querySelector(selector) {
      const element = elements.get(selector);
      if (!element) throw new Error(`Unexpected selector: ${selector}`);
      return element;
    },
    querySelectorAll(selector) {
      if (selector !== ".preset") throw new Error(`Unexpected selector: ${selector}`);
      return presets;
    },
    createElement(tagName) {
      return new MockElement(tagName);
    }
  };
  let cancelSent = false;
  const window = {
    isSecureContext: true,
    confirm: () => true,
    showDirectoryPicker: async () => directory
  };
  const appPath = path.join(__dirname, "..", "site", "app.js");
  const appSource = fs.readFileSync(appPath, "utf8");
  vm.runInNewContext(appSource, {
    document,
    window,
    PhotoDateMetadata: {
      readCaptureDate: async () => ({
        date: new Date(2020, 0, 2, 3, 4, 5),
        source: "EXIF · DateTimeOriginal"
      })
    },
    setTimeout(callback) {
      if (
        cancelAtProgress &&
        !cancelSent &&
        elements.get("#operation-progress-label").textContent.startsWith(cancelAtProgress)
      ) {
        cancelSent = true;
        void elements.get("#cancel-operation").click();
      }
      setImmediate(callback);
    }
  });
  return { directory, elements };
}

test("paginates a large preview, renames after confirmation, and supports undo", async () => {
  const { directory, elements } = createHarness(101);

  await elements.get("#browse-button").click();
  await elements.get("#preview-button").click();

  assert.equal(elements.get("#preview-wrap").hidden, false);
  assert.equal(elements.get("#preview-rows").children.length, 100);
  assert.equal(elements.get("#preview-page-label").textContent, "Mostrando 1–100 de 101");
  assert.ok(elements.get("#operation-progress-label").textHistory.some((label) => label.startsWith("Indexando")));
  assert.ok(elements.get("#operation-progress-label").textHistory.some((label) => label.startsWith("Leyendo fotografía")));

  await elements.get("#next-page").click();
  assert.equal(elements.get("#preview-rows").children.length, 1);
  assert.equal(elements.get("#preview-page-label").textContent, "Mostrando 101–101 de 101");
  await elements.get("#previous-page").click();
  assert.equal(elements.get("#preview-rows").children.length, 100);

  await elements.get("#confirm-button").click();
  assert.equal(directory.entries.size, 101);
  assert.ok([...directory.entries.keys()].every((name) => name.startsWith("2020_01_02_photo-")));
  assert.match(elements.get("#notice").textContent, /101 archivos renombrados/);

  await elements.get("#undo-button").click();
  assert.deepEqual([...directory.entries.keys()].sort(), Array.from(
    { length: 101 },
    (_, index) => `photo-${String(index).padStart(3, "0")}.jpg`
  ).sort());
});

test("cancels a long folder scan without changing any files", async () => {
  const { directory, elements } = createHarness(150, "Indexando 100 elementos");
  const originalNames = [...directory.entries.keys()];

  await elements.get("#browse-button").click();
  await elements.get("#preview-button").click();

  assert.equal(directory.entries.size, 150);
  assert.deepEqual([...directory.entries.keys()], originalNames);
  assert.match(elements.get("#notice").textContent, /Análisis cancelado/);
  assert.equal(elements.get("#preview-wrap").hidden, true);
  assert.equal(elements.get("#operation-progress").hidden, true);
});
