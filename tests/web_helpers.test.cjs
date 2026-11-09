const assert = require("node:assert/strict");
const test = require("node:test");
const {
  looksDated,
  middleEllipsis,
  segmentDigits,
  segmentGhost,
  stampFromDateText
} = require("../src/photodaterenamer/web/helpers.js");

test("detects names that already start with a date in any supported format", () => {
  for (const name of ["2024_08_14_IMG.jpg", "2024-08-14 viaje.png", "20240814.tif", "sub/2019_01_31.jpg"]) {
    assert.equal(looksDated(name), true, name);
  }
  for (const name of ["IMG_0412.jpg", "PXL_20220611.jpg", "2024_13_01_x.jpg", "2024_08_32.jpg", "202408145.jpg", "2024_08-14.jpg"]) {
    assert.equal(looksDated(name), false, name);
  }
});

test("middle ellipsis keeps the date at the start and the extension at the end", () => {
  const name = "2024_08_14_un nombre de archivo realmente largo de vacaciones.jpeg";
  const short = middleEllipsis(name, 30);
  assert.equal(short.length, 30);
  assert.ok(short.startsWith("2024_08_14"));
  assert.ok(short.endsWith(".jpeg"));
  assert.ok(short.includes("…"));
  assert.equal(middleEllipsis("corto.jpg", 30), "corto.jpg");
});

test("seven-segment digits group thousands with a dot and ghosts match their width", () => {
  assert.equal(segmentDigits(3000), "3.000");
  assert.equal(segmentDigits(1234567), "1.234.567");
  assert.equal(segmentDigits(91), "91");
  assert.equal(segmentGhost("3.000"), "8.888");
});

test("date stamps are built from any supported date format", () => {
  assert.equal(stampFromDateText("2024_08_14"), "'24 08 14");
  assert.equal(stampFromDateText("2024-08-14"), "'24 08 14");
  assert.equal(stampFromDateText("20240814"), "'24 08 14");
  assert.equal(stampFromDateText(null), "");
});
