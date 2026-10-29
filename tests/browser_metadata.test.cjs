const assert = require("node:assert/strict");
const test = require("node:test");
const { imageMetadata, parseDate, readCaptureDate } = require("../site/metadata.js");

function makeExifTiff() {
  const bytes = new Uint8Array(160);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49], 0);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 2, true);

  function asciiEntry(offset, tag, valueOffset, value) {
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, 2, true);
    view.setUint32(offset + 4, 20, true);
    view.setUint32(offset + 8, valueOffset, true);
    for (let index = 0; index < value.length; index += 1) {
      bytes[valueOffset + index] = value.charCodeAt(index);
    }
    bytes[valueOffset + value.length] = 0;
  }

  view.setUint16(10, 0x8769, true);
  view.setUint16(12, 4, true);
  view.setUint32(14, 1, true);
  view.setUint32(18, 38, true);
  asciiEntry(22, 0x0132, 80, "2020:02:03 04:05:06");
  view.setUint16(38, 2, true);
  asciiEntry(40, 0x9003, 100, "2019:01:02 03:04:05");
  asciiEntry(52, 0x9004, 120, "2021:06:07 08:09:10");
  return bytes;
}

function makeJpegWithExif(tiff) {
  const signature = new Uint8Array([0xff, 0xd8]);
  const header = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0]);
  const payload = new Uint8Array(header.length + tiff.length);
  payload.set(header);
  payload.set(tiff, header.length);
  const segmentLength = payload.length + 2;
  const segment = new Uint8Array(4 + payload.length);
  segment.set([0xff, 0xe1, segmentLength >> 8, segmentLength & 0xff]);
  segment.set(payload, 4);
  return new Uint8Array([...signature, ...segment, 0xff, 0xd9]);
}

function makePngWithExif(tiff) {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = new Uint8Array(12 + tiff.length);
  new DataView(chunk.buffer).setUint32(0, tiff.length);
  chunk.set([0x65, 0x58, 0x49, 0x66], 4);
  chunk.set(tiff, 8);
  const end = new Uint8Array([
    0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0
  ]);
  return new Uint8Array([...signature, ...chunk, ...end]);
}

test("prefers EXIF capture date over digitized and general dates", () => {
  const result = imageMetadata(makeExifTiff(), "photo.tif");
  assert.equal(result.source, "EXIF · DateTimeOriginal");
  assert.equal(result.date.getFullYear(), 2019);
  assert.equal(result.date.getMonth(), 0);
  assert.equal(result.date.getDate(), 2);
});

test("reads EXIF capture dates from JPEG and PNG containers", () => {
  const tiff = makeExifTiff();
  for (const [name, bytes] of [
    ["photo.jpg", makeJpegWithExif(tiff)],
    ["photo.png", makePngWithExif(tiff)]
  ]) {
    const result = imageMetadata(bytes, name);
    assert.equal(result.source, "EXIF · DateTimeOriginal");
    assert.equal(result.date.getFullYear(), 2019);
  }
});

test("parses filesystem fallback dates as local calendar dates", async () => {
  const expected = new Date(2023, 3, 5, 6, 7, 8);
  const result = await readCaptureDate({
    name: "photo.png",
    lastModified: expected.getTime(),
    arrayBuffer: async () => new Uint8Array([0, 1, 2]).buffer
  });
  assert.equal(result.source, "Archivo · última modificación");
  assert.equal(result.date.getFullYear(), 2023);
  assert.equal(result.date.getMonth(), 3);
  assert.equal(result.date.getDate(), 5);
});

test("ignores malformed metadata and rejects invalid date strings", () => {
  assert.equal(imageMetadata(new Uint8Array([1, 2, 3]), "photo.tiff"), null);
  assert.equal(parseDate("not a date"), null);
});
