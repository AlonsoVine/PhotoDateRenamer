(function (root) {
  "use strict";

  const PREFERRED_XMP_FIELDS = [
    "DateTimeOriginal",
    "DateCreated",
    "CreateDate",
    "DateTimeDigitized",
    "ModifyDate"
  ];

  function parseDate(value) {
    if (typeof value !== "string") return null;
    const match = value.trim().match(
      /^(\d{4})[:\-](\d{2})[:\-](\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/
    );
    if (!match) return null;
    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0)
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function tiffDates(bytes, start = 0) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (start + 8 > view.byteLength) return {};
    const order = String.fromCharCode(view.getUint8(start), view.getUint8(start + 1));
    if (order !== "II" && order !== "MM") return {};
    const littleEndian = order === "II";
    const read16 = (offset) => {
      if (offset < 0 || offset + 2 > view.byteLength) throw new RangeError();
      return view.getUint16(offset, littleEndian);
    };
    const read32 = (offset) => {
      if (offset < 0 || offset + 4 > view.byteLength) throw new RangeError();
      return view.getUint32(offset, littleEndian);
    };
    if (read16(start + 2) !== 42) return {};

    function readIfd(relativeOffset) {
      try {
        const ifdOffset = start + relativeOffset;
        const count = read16(ifdOffset);
        if (count > 4096 || ifdOffset + 2 + count * 12 > view.byteLength) return [];
        const values = [];
        for (let index = 0; index < count; index += 1) {
          const entry = ifdOffset + 2 + index * 12;
          const tag = read16(entry);
          const type = read16(entry + 2);
          const length = read32(entry + 4);
          if (type !== 2 || length < 2 || length > 128) {
            values.push({ tag, type, length, entry });
            continue;
          }
          const valueOffset = length <= 4 ? entry + 8 : start + read32(entry + 8);
          if (valueOffset < 0 || valueOffset + length > view.byteLength) continue;
          let value = "";
          for (let byte = 0; byte < length && view.getUint8(valueOffset + byte) !== 0; byte += 1) {
            value += String.fromCharCode(view.getUint8(valueOffset + byte));
          }
          values.push({ tag, value });
        }
        return values;
      } catch {
        return [];
      }
    }

    const firstIfd = read32(start + 4);
    const firstEntries = readIfd(firstIfd);
    const exifPointer = firstEntries.find((item) => item.tag === 0x8769);
    const exifEntries = exifPointer ? readIfd(read32(exifPointer.entry + 8)) : [];
    const dates = new Map();
    for (const item of [...exifEntries, ...firstEntries]) {
      if (item.value && [0x9003, 0x9004, 0x0132].includes(item.tag)) {
        dates.set(item.tag, item.value);
      }
    }
    return {
      original: dates.get(0x9003),
      digitized: dates.get(0x9004),
      general: dates.get(0x0132)
    };
  }

  function xmlDate(bytes) {
    const xml = new TextDecoder().decode(bytes);
    const document = new DOMParser().parseFromString(xml, "application/xml");
    if (document.querySelector("parsererror")) return null;
    const found = new Map();
    for (const element of document.getElementsByTagName("*")) {
      for (const attribute of element.attributes) {
        if (PREFERRED_XMP_FIELDS.includes(attribute.localName) && !found.has(attribute.localName)) {
          found.set(attribute.localName, attribute.value);
        }
      }
      if (PREFERRED_XMP_FIELDS.includes(element.localName) && !found.has(element.localName)) {
        found.set(element.localName, element.textContent.trim());
      }
    }
    for (const field of PREFERRED_XMP_FIELDS) {
      const date = parseDate(found.get(field));
      if (date) return { date, source: `XMP · ${field}` };
    }
    return null;
  }

  function imageMetadata(bytes, name) {
    const lowerName = name.toLowerCase();
    if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
      let offset = 2;
      while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
        const marker = bytes[offset + 1];
        if (marker === 0xda || marker === 0xd9) break;
        const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
        const dataStart = offset + 4;
        const dataEnd = offset + 2 + segmentLength;
        if (segmentLength < 2 || dataEnd > bytes.length) break;
        if (marker === 0xe1) {
          const header = new TextDecoder().decode(bytes.subarray(dataStart, Math.min(dataEnd, dataStart + 32)));
          if (header.startsWith("Exif\u0000\u0000")) {
            const dates = tiffDates(bytes.subarray(dataStart + 6, dataEnd));
            const choices = [
              ["original", "EXIF · DateTimeOriginal"],
              ["digitized", "EXIF · DateTimeDigitized"],
              ["general", "EXIF · DateTime"]
            ];
            for (const [field, source] of choices) {
              const date = parseDate(dates[field]);
              if (date) return { date, source };
            }
          }
          const xmpHeader = "http://ns.adobe.com/xap/1.0/\u0000";
          if (header.startsWith(xmpHeader)) {
            const xmp = xmlDate(bytes.subarray(dataStart + xmpHeader.length, dataEnd));
            if (xmp) return xmp;
          }
        }
        offset = dataEnd;
      }
    } else if (lowerName.endsWith(".png")) {
      let offset = 8;
      while (offset + 12 <= bytes.length) {
        const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
        const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        if (dataEnd + 4 > bytes.length) break;
        if (type === "eXIf") {
          const dates = tiffDates(bytes.subarray(dataStart, dataEnd));
          for (const [field, source] of [
            ["original", "EXIF · DateTimeOriginal"],
            ["digitized", "EXIF · DateTimeDigitized"],
            ["general", "EXIF · DateTime"]
          ]) {
            const date = parseDate(dates[field]);
            if (date) return { date, source };
          }
        } else if (type === "iTXt") {
          const chunk = bytes.subarray(dataStart, dataEnd);
          const keywordEnd = chunk.indexOf(0);
          if (keywordEnd > 0 && new TextDecoder().decode(chunk.subarray(0, keywordEnd)) === "XML:com.adobe.xmp") {
            let cursor = keywordEnd + 3;
            const languageEnd = chunk.indexOf(0, cursor);
            if (languageEnd < 0) break;
            cursor = chunk.indexOf(0, languageEnd + 1);
            if (cursor < 0) break;
            const xmp = xmlDate(chunk.subarray(cursor + 1));
            if (xmp) return xmp;
          }
        }
        offset = dataEnd + 4;
        if (type === "IEND") break;
      }
    } else if (lowerName.endsWith(".tif") || lowerName.endsWith(".tiff")) {
      const dates = tiffDates(bytes);
      for (const [field, source] of [
        ["original", "EXIF · DateTimeOriginal"],
        ["digitized", "EXIF · DateTimeDigitized"],
        ["general", "EXIF · DateTime"]
      ]) {
        const date = parseDate(dates[field]);
        if (date) return { date, source };
      }
    }
    return null;
  }

  async function readCaptureDate(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const metadataDate = imageMetadata(bytes, file.name);
    if (metadataDate) return metadataDate;
    if (file.lastModified > 0) {
      return { date: new Date(file.lastModified), source: "Archivo · última modificación" };
    }
    return null;
  }

  const api = { imageMetadata, parseDate, readCaptureDate };
  root.PhotoDateMetadata = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
