const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

/* In-memory File System Access handles that fail like the browser does. */
function domError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

class MemoryFile {
  constructor(name, { size = 100, lastModified = 1, data = "photo", head } = {}) {
    this.name = name;
    this.size = size;
    this.lastModified = lastModified;
    this.data = data;
    this.head = head || (/\.png$/i.test(name) ? PNG : JPEG);
  }

  slice(start, end) {
    const bytes = Uint8Array.from(this.head).slice(start, end);
    return { arrayBuffer: async () => bytes.buffer };
  }
}

class MemoryFileHandle {
  constructor(parent, name, file) {
    this.kind = "file";
    this.parent = parent;
    this.name = name;
    this.file = file;
    this.locked = false;
  }

  async getFile() {
    return new MemoryFile(this.name, this.file);
  }

  async createWritable() {
    let next = null;
    return {
      write: async (file) => {
        next = file;
      },
      close: async () => {
        this.file = { size: next.size, lastModified: next.lastModified, data: next.data, head: next.head };
      }
    };
  }

  async isSameEntry(other) {
    return other === this;
  }
}

class MemoryDirectoryHandle {
  constructor(name = "Viaje") {
    this.kind = "directory";
    this.name = name;
    this.entries = new Map();
  }

  add(name, options) {
    const handle = new MemoryFileHandle(this, name, { size: 100, lastModified: 1, data: name, ...options });
    this.entries.set(name, handle);
    return handle;
  }

  addDirectory(name) {
    const directory = new MemoryDirectoryHandle(name);
    this.entries.set(name, directory);
    return directory;
  }

  async *values() {
    for (const entry of [...this.entries.values()]) yield entry;
  }

  find(name) {
    // Case-insensitive like Windows and macOS.
    for (const [key, entry] of this.entries) if (key.toLowerCase() === name.toLowerCase()) return entry;
    return undefined;
  }

  async getFileHandle(name, options = {}) {
    const existing = this.find(name);
    if (existing && existing.kind !== "file") throw domError("TypeMismatchError", "Not a file");
    if (existing) return existing;
    if (!options.create) throw domError("NotFoundError", `No such file: ${name}`);
    return this.add(name, { size: 0, lastModified: 0, data: "" });
  }

  async getDirectoryHandle(name) {
    const existing = this.find(name);
    if (!existing) throw domError("NotFoundError", `No such directory: ${name}`);
    if (existing.kind !== "directory") throw domError("TypeMismatchError", "Not a directory");
    return existing;
  }

  async removeEntry(name) {
    const entry = this.find(name);
    if (!entry) throw domError("NotFoundError", `No such entry: ${name}`);
    if (entry.locked) throw domError("NoModificationAllowedError", "locked");
    this.entries.delete(entry.name);
  }

  async isSameEntry(other) {
    return other === this;
  }

  names() {
    return [...this.entries.keys()].sort();
  }
}

function loadBackend(directory, readCaptureDate) {
  const modulePath = path.join(__dirname, "..", "site", "backend.js");
  delete require.cache[require.resolve(modulePath)];
  globalThis.isSecureContext = true;
  globalThis.showDirectoryPicker = async () => directory;
  globalThis.PhotoDateMetadata = {
    readCaptureDate: readCaptureDate || (async (file) => ({
      date: new Date(2024, 7, 14, 10, 0, 0),
      source: file.name.startsWith("scan") ? "Archivo · última modificación" : "EXIF · DateTimeOriginal"
    }))
  };
  return require(modulePath);
}

async function call(backend, route, data) {
  const response = await backend.post(route, data);
  return { status: response.status, body: await response.json() };
}

const FORMAT = [
  { kind: "field", value: "date" },
  { kind: "text", value: "_" },
  { kind: "field", value: "original_name" }
];

async function previewOf(backend, extra = {}) {
  const picked = await call(backend, "/api/select-folder");
  const result = await call(backend, "/api/preview", {
    folder: picked.body.folder, components: FORMAT, date_format: "yyyy_mm_dd", recursive: false,
    scan_id: "scan-1", ...extra
  });
  return { folder: picked.body.folder, ...result };
}

test("the preview follows the engine's statuses, reasons and order", async () => {
  const directory = new MemoryDirectoryHandle();
  directory.add("IMG_0002.JPG");
  directory.add("scan.png");
  directory.add("notas.txt");
  directory.add("2024_08_14_IMG_0001.jpg");
  directory.add("IMG_0001.jpg");
  directory.add("dañada.jpg", { head: [0x6e, 0x6f, 0x20, 0x65, 0x73, 0x20, 0x75, 0x6e] });
  directory.add("sin fecha.jpg");
  const backend = loadBackend(directory, async (file) => {
    if (file.name === "sin fecha.jpg") return null;
    return {
      date: new Date(2024, 7, 14),
      source: file.name.startsWith("scan") ? "Archivo · última modificación" : "EXIF · DateTimeOriginal"
    };
  });

  const { status, body } = await previewOf(backend);

  assert.equal(status, 200);
  assert.equal(body.entry_count, 7);
  assert.deepEqual(body.items.map((item) => [item.original_name, item.status]), [
    ["2024_08_14_IMG_0001.jpg", "ready"],
    ["dañada.jpg", "skipped"],
    ["IMG_0001.jpg", "conflict"],
    ["IMG_0002.JPG", "ready"],
    ["scan.png", "ready"],
    ["sin fecha.jpg", "skipped"]
  ]);
  assert.equal(body.items[0].new_name, "2024_08_14_2024_08_14_IMG_0001.jpg");
  assert.equal(body.items[2].reason, "El nombre de destino ya existe o se repite en la vista previa.");
  assert.equal(body.items[1].reason, "No se pudieron leer los metadatos: el archivo no es una imagen reconocible.");
  assert.equal(body.items[5].reason, "No se encontró una fecha válida en los metadatos ni en el archivo.");
  assert.equal(body.items[3].new_name, "2024_08_14_IMG_0002.JPG");
  assert.equal(body.items[3].date_text, "2024_08_14");
  assert.equal(body.items[4].date_source, "Archivo · última modificación");
  assert.equal(body.rename_count, 3);
});

test("names match the 0.5.0 rules for every recipe and date format", () => {
  const backend = loadBackend(new MemoryDirectoryHandle());
  const date = new Date(2024, 4, 6);
  const stem = [{ kind: "field", value: "date" }, { kind: "text", value: "_" }, { kind: "field", value: "original_stem" }];
  const after = [
    { kind: "field", value: "original_stem" }, { kind: "text", value: "_" },
    { kind: "field", value: "date" }, { kind: "field", value: "extension" }
  ];
  assert.equal(backend.buildName("IMG.jpg", date, "yyyy_mm_dd", FORMAT), "2024_05_06_IMG.jpg");
  assert.equal(backend.buildName("IMG.jpg", date, "yyyy-mm-dd", stem), "2024-05-06_IMG");
  assert.equal(backend.buildName("IMG.JPG", date, "yyyymmdd", after), "IMG_20240506.JPG");
  assert.equal(backend.buildName(".oculta.jpg", date, "yyyy_mm_dd", stem), "2024_05_06_.oculta");
  assert.throws(() => backend.buildName("a.jpg", date, "yyyy_mm_dd", [{ kind: "text", value: "CON" }]), /no válido/);
  assert.throws(() => backend.validateComponents([{ kind: "text", value: "x".repeat(65) }]), /no válido/);
  assert.throws(() => backend.validateComponents([]), /al menos un elemento/);
});

test("names over 255 characters become conflicts before anything changes", async () => {
  const directory = new MemoryDirectoryHandle();
  directory.add(`${"a".repeat(250)}.jpg`);
  const backend = loadBackend(directory);

  const { body } = await previewOf(backend);

  assert.equal(body.items[0].status, "conflict");
  assert.match(body.items[0].reason, /255/);
});

test("confirming renames file by file, reports a locked file and undo restores the rest", async () => {
  const directory = new MemoryDirectoryHandle();
  directory.add("a.jpg");
  directory.add("b.jpg").locked = true;
  directory.add("c.jpg");
  const backend = loadBackend(directory);
  const { body: plan } = await previewOf(backend);

  const { body: result } = await call(backend, "/api/confirm", { plan_id: plan.plan_id });

  assert.equal(result.renamed_count, 2);
  assert.equal(result.failed_count, 1);
  assert.equal(result.failures[0].original_name, "b.jpg");
  assert.match(result.failures[0].reason, /otro programa|solo lectura/);
  assert.deepEqual(directory.names(), ["2024_08_14_a.jpg", "2024_08_14_c.jpg", "b.jpg"]);
  assert.equal(directory.find("2024_08_14_a.jpg").file.data, "a.jpg");

  const { body: last } = await call(backend, "/api/last-run");
  assert.equal(last.count, 2);
  assert.equal(last.folder_name, "Viaje");

  const { body: undone } = await call(backend, "/api/undo", { run_id: last.run_id });
  assert.equal(undone.restored_count, 2);
  assert.equal(undone.run_id, null);
  assert.deepEqual(directory.names(), ["a.jpg", "b.jpg", "c.jpg"]);
  assert.equal((await call(backend, "/api/last-run")).body.run_id, null);
});

test("a destination that appears after the preview is never overwritten", async () => {
  const directory = new MemoryDirectoryHandle();
  directory.add("a.jpg", { data: "original" });
  const backend = loadBackend(directory);
  const { body: plan } = await previewOf(backend);
  directory.add("2024_08_14_a.jpg", { data: "intruso" });

  const { body: result } = await call(backend, "/api/confirm", { plan_id: plan.plan_id });

  assert.equal(result.renamed_count, 0);
  assert.equal(result.run_id, null);
  assert.match(result.failures[0].reason, /Ya existe/);
  assert.equal(directory.find("2024_08_14_a.jpg").file.data, "intruso");
  assert.equal(directory.find("a.jpg").file.data, "original");
});

test("a file changed after the preview is reported and left alone", async () => {
  const directory = new MemoryDirectoryHandle();
  const photo = directory.add("a.jpg");
  const backend = loadBackend(directory);
  const { body: plan } = await previewOf(backend);
  photo.file.lastModified = 99;

  const { body: result } = await call(backend, "/api/confirm", { plan_id: plan.plan_id });

  assert.equal(result.failed_count, 1);
  assert.match(result.failures[0].reason, /cambió desde la vista previa/);
  assert.deepEqual(directory.names(), ["a.jpg"]);
});

test("a real move is used when the browser offers it", async () => {
  const directory = new MemoryDirectoryHandle();
  const photo = directory.add("a.jpg", { lastModified: 7 });
  photo.move = async (name) => {
    directory.entries.delete(photo.name);
    photo.name = name;
    directory.entries.set(name, photo);
  };
  const backend = loadBackend(directory);
  const { body: plan } = await previewOf(backend);

  await call(backend, "/api/confirm", { plan_id: plan.plan_id });

  assert.deepEqual(directory.names(), ["2024_08_14_a.jpg"]);
  assert.equal(directory.find("2024_08_14_a.jpg"), photo);
  assert.equal(photo.file.lastModified, 7);
});

test("a batch that renames nothing keeps the previous batch undoable", async () => {
  const directory = new MemoryDirectoryHandle();
  directory.add("a.jpg");
  const backend = loadBackend(directory);
  const { body: first } = await previewOf(backend);
  await call(backend, "/api/confirm", { plan_id: first.plan_id });
  const other = new MemoryDirectoryHandle("Otra");
  other.add("b.jpg").locked = true;
  globalThis.showDirectoryPicker = async () => other;
  const { body: second } = await previewOf(backend, { scan_id: "scan-2" });

  const { body: result } = await call(backend, "/api/confirm", { plan_id: second.plan_id });

  assert.equal(result.renamed_count, 0);
  const { body: last } = await call(backend, "/api/last-run");
  assert.equal(last.count, 1);
  assert.equal(last.folder_name, "Viaje");
});

test("subfolders are included only when asked, with their relative paths", async () => {
  const directory = new MemoryDirectoryHandle();
  directory.add("a.jpg");
  directory.addDirectory("Día 2").add("b.jpg");
  const backend = loadBackend(directory);

  const flat = await previewOf(backend);
  const deep = await call(backend, "/api/preview", {
    folder: flat.folder, components: FORMAT, date_format: "yyyy_mm_dd", recursive: true, scan_id: "scan-2"
  });

  assert.deepEqual(flat.body.items.map((item) => item.original_name), ["a.jpg"]);
  assert.deepEqual(deep.body.items.map((item) => item.new_name), ["2024_08_14_a.jpg", "Día 2/2024_08_14_b.jpg"]);
});

test("cancelling a scan reports it and changes nothing", async () => {
  const directory = new MemoryDirectoryHandle();
  for (let index = 0; index < 50; index += 1) directory.add(`p${index}.jpg`);
  let reads = 0;
  let backend;
  backend = loadBackend(directory, async () => {
    reads += 1;
    if (reads === 5) await backend.post("/api/cancel", { scan_id: "scan-1" });
    return { date: new Date(2024, 7, 14), source: "EXIF · DateTimeOriginal" };
  });

  const { body } = await previewOf(backend);

  assert.deepEqual(body, { cancelled: true, scan_id: "scan-1" });
  assert.equal(directory.names().length, 50);
  assert.ok(directory.names().every((name) => /^p\d+\.jpg$/.test(name)));
});

test("a page without folder access explains which browsers work", async () => {
  const backend = loadBackend(new MemoryDirectoryHandle());
  globalThis.showDirectoryPicker = undefined;

  const { status, body } = await call(backend, "/api/select-folder");

  assert.equal(status, 400);
  assert.match(body.error, /Chrome o Edge/);
});

test("a typed path is not accepted: only folders chosen with the picker", async () => {
  const backend = loadBackend(new MemoryDirectoryHandle());

  const { body } = await call(backend, "/api/check-folder", { folder: "C:\\Fotos" });

  assert.equal(body.ok, false);
});
