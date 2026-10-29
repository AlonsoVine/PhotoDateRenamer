(function (root) {
  "use strict";

  const PREFERRED_XMP_FIELDS = [
    "DateTimeOriginal",
    "DateCreated",
    "CreateDate",
    "DateTimeDigitized",
    "ModifyDate"
  ];
  const MAX_METADATA_CHUNK_SIZE = 16 * 1024 * 1024;
  const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

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
    if (
      Number.isNaN(date.getTime()) ||
      date.getFullYear() !== Number(match[1]) ||
      date.getMonth() !== Number(match[2]) - 1 ||
      date.getDate() !== Number(match[3]) ||
      date.getHours() !== Number(match[4] || 0) ||
      date.getMinutes() !== Number(match[5] || 0) ||
      date.getSeconds() !== Number(match[6] || 0)
    ) {
      return null;
    }
    return date;
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

  async function readRange(blob, start, end) {
    return new Uint8Array(await blob.slice(start, end).arrayBuffer());
  }

  async function readTiffDatesFromBlob(blob) {
    if (blob.size < 8) return {};
    const header = await readRange(blob, 0, 8);
    if (header.length < 8) return {};
    const order = String.fromCharCode(header[0], header[1]);
    if (order !== "II" && order !== "MM") return {};
    const littleEndian = order === "II";
    const headerView = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (headerView.getUint16(2, littleEndian) !== 42) return {};
    const firstIfdOffset = headerView.getUint32(4, littleEndian);

    async function readIfd(relativeOffset) {
      if (relativeOffset + 2 > blob.size) return [];
      const countBytes = await readRange(blob, relativeOffset, relativeOffset + 2);
      if (countBytes.length < 2) return [];
      const count = new DataView(countBytes.buffer, countBytes.byteOffset, 2).getUint16(0, littleEndian);
      const entriesStart = relativeOffset + 2;
      const entriesEnd = entriesStart + count * 12;
      if (count > 4096 || entriesEnd > blob.size) return [];
      const bytes = await readRange(blob, entriesStart, entriesEnd);
      if (bytes.length < count * 12) return [];
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const entries = [];
      for (let index = 0; index < count; index += 1) {
        const entry = index * 12;
        const tag = view.getUint16(entry, littleEndian);
        const type = view.getUint16(entry + 2, littleEndian);
        const length = view.getUint32(entry + 4, littleEndian);
        const valueOffset = view.getUint32(entry + 8, littleEndian);
        let value;
        if (type === 2 && length > 0 && length <= 128) {
          const valueStart = length <= 4 ? entriesStart + entry + 8 : valueOffset;
          if (valueStart + length <= blob.size) {
            const valueBytes = await readRange(blob, valueStart, valueStart + length);
            if (valueBytes.length === length) {
              value = new TextDecoder().decode(valueBytes).replace(/\0.*$/s, "");
            }
          }
        }
        entries.push({ tag, type, length, valueOffset, value });
      }
      return entries;
    }

    const firstEntries = await readIfd(firstIfdOffset);
    const exifPointer = firstEntries.find((entry) => entry.tag === 0x8769 && entry.type === 4);
    const exifEntries = exifPointer ? await readIfd(exifPointer.valueOffset) : [];
    const dates = new Map();
    for (const entry of [...exifEntries, ...firstEntries]) {
      if (entry.value && [0x9003, 0x9004, 0x0132].includes(entry.tag)) {
        dates.set(entry.tag, entry.value);
      }
    }
    return {
      original: dates.get(0x9003),
      digitized: dates.get(0x9004),
      general: dates.get(0x0132)
    };
  }

  async function jpegMetadataFromFile(file) {
    const signature = await readRange(file, 0, Math.min(2, file.size));
    if (signature.length < 2 || signature[0] !== 0xff || signature[1] !== 0xd8) return null;
    let offset = 2;
    while (offset + 4 <= file.size) {
      const header = await readRange(file, offset, offset + 4);
      if (header[0] !== 0xff) return null;
      const marker = header[1];
      if (marker === 0xda || marker === 0xd9) break;
      const segmentLength = (header[2] << 8) | header[3];
      const segmentEnd = offset + 2 + segmentLength;
      if (segmentLength < 2 || segmentEnd > file.size) return null;
      if (marker === 0xe1) {
        const payload = await readRange(file, offset + 4, segmentEnd);
        const segment = new Uint8Array(6 + payload.length);
        segment.set([0xff, 0xd8, 0xff, marker, header[2], header[3]]);
        segment.set(payload, 6);
        const metadata = imageMetadata(segment, file.name);
        if (metadata) return metadata;
      }
      offset = segmentEnd;
    }
    return null;
  }

  async function pngMetadataFromFile(file) {
    const signature = await readRange(file, 0, Math.min(8, file.size));
    if (!PNG_SIGNATURE.every((byte, index) => signature[index] === byte)) return null;
    let offset = 8;
    while (offset + 12 <= file.size) {
      const header = await readRange(file, offset, offset + 8);
      const length = new DataView(header.buffer, header.byteOffset, 4).getUint32(0);
      const type = new TextDecoder().decode(header.subarray(4, 8));
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd + 4 > file.size) return null;
      if (type === "eXIf") {
        if (length > MAX_METADATA_CHUNK_SIZE) {
          throw new RangeError("El bloque EXIF supera el límite seguro de lectura de 16 MiB.");
        }
        const dates = await readTiffDatesFromBlob(file.slice(dataStart, dataEnd));
        for (const [field, source] of [
          ["original", "EXIF · DateTimeOriginal"],
          ["digitized", "EXIF · DateTimeDigitized"],
          ["general", "EXIF · DateTime"]
        ]) {
          const date = parseDate(dates[field]);
          if (date) return { date, source };
        }
      } else if (type === "iTXt" && length > MAX_METADATA_CHUNK_SIZE) {
        throw new RangeError("El bloque XMP supera el límite seguro de lectura de 16 MiB.");
      } else if (type === "iTXt") {
        const data = await readRange(file, dataStart, dataEnd);
        const chunk = new Uint8Array(20 + data.length);
        chunk.set(PNG_SIGNATURE);
        new DataView(chunk.buffer).setUint32(8, data.length);
        chunk.set([0x69, 0x54, 0x58, 0x74], 12);
        chunk.set(data, 16);
        const metadata = imageMetadata(chunk, file.name);
        if (metadata) return metadata;
      }
      offset = dataEnd + 4;
      if (type === "IEND") break;
    }
    return null;
  }

  async function tiffMetadataFromFile(file) {
    const dates = await readTiffDatesFromBlob(file);
    for (const [field, source] of [
      ["original", "EXIF · DateTimeOriginal"],
      ["digitized", "EXIF · DateTimeDigitized"],
      ["general", "EXIF · DateTime"]
    ]) {
      const date = parseDate(dates[field]);
      if (date) return { date, source };
    }
    return null;
  }

  async function readCaptureDate(file) {
    const lowerName = file.name.toLowerCase();
    let metadataDate = null;
    if (typeof file.slice === "function") {
      if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
        metadataDate = await jpegMetadataFromFile(file);
      } else if (lowerName.endsWith(".png")) {
        metadataDate = await pngMetadataFromFile(file);
      } else if (lowerName.endsWith(".tif") || lowerName.endsWith(".tiff")) {
        metadataDate = await tiffMetadataFromFile(file);
      }
    } else if (typeof file.arrayBuffer === "function") {
      metadataDate = imageMetadata(new Uint8Array(await file.arrayBuffer()), file.name);
    }
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
