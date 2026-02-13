const ZIP_VERSION = 20;
const textEncoder = new TextEncoder();

let crcTable = null;

function ensureCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      if ((value & 1) === 1) {
        value = 0xedb88320 ^ (value >>> 1);
      } else {
        value >>>= 1;
      }
    }
    crcTable[index] = value >>> 0;
  }
  return crcTable;
}

function computeCrc32(bytes) {
  const table = ensureCrcTable();
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (crc >>> 8) ^ table[(crc ^ bytes[index]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(input) {
  const date = input instanceof Date ? input : new Date(input || Date.now());
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = Math.max(1980, safe.getFullYear());
  const month = Math.max(1, safe.getMonth() + 1);
  const day = Math.max(1, safe.getDate());
  const hours = safe.getHours();
  const minutes = safe.getMinutes();
  const seconds = Math.floor(safe.getSeconds() / 2);
  const dosTime = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f);
  return { dosTime, dosDate };
}

function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    out.set(chunk, offset);
    offset += chunk.length;
  });
  return out;
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value & 0xffff, true);
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

function buildLocalHeader(meta) {
  const header = new Uint8Array(30 + meta.nameBytes.length);
  const view = new DataView(header.buffer);
  writeUint32(view, 0, 0x04034b50);
  writeUint16(view, 4, ZIP_VERSION);
  writeUint16(view, 6, 0); // flags
  writeUint16(view, 8, 0); // compression store
  writeUint16(view, 10, meta.dosTime);
  writeUint16(view, 12, meta.dosDate);
  writeUint32(view, 14, meta.crc32);
  writeUint32(view, 18, meta.data.length);
  writeUint32(view, 22, meta.data.length);
  writeUint16(view, 26, meta.nameBytes.length);
  writeUint16(view, 28, 0); // extra length
  header.set(meta.nameBytes, 30);
  return header;
}

function buildCentralHeader(meta) {
  const header = new Uint8Array(46 + meta.nameBytes.length);
  const view = new DataView(header.buffer);
  writeUint32(view, 0, 0x02014b50);
  writeUint16(view, 4, ZIP_VERSION); // version made by
  writeUint16(view, 6, ZIP_VERSION); // version needed
  writeUint16(view, 8, 0); // flags
  writeUint16(view, 10, 0); // compression
  writeUint16(view, 12, meta.dosTime);
  writeUint16(view, 14, meta.dosDate);
  writeUint32(view, 16, meta.crc32);
  writeUint32(view, 20, meta.data.length);
  writeUint32(view, 24, meta.data.length);
  writeUint16(view, 28, meta.nameBytes.length);
  writeUint16(view, 30, 0); // extra
  writeUint16(view, 32, 0); // file comment len
  writeUint16(view, 34, 0); // disk number start
  writeUint16(view, 36, 0); // int file attrs
  writeUint32(view, 38, 0); // ext file attrs
  writeUint32(view, 42, meta.localHeaderOffset);
  header.set(meta.nameBytes, 46);
  return header;
}

function buildEndOfCentralDirectory(entryCount, centralSize, centralOffset) {
  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);
  writeUint32(view, 0, 0x06054b50);
  writeUint16(view, 4, 0); // disk number
  writeUint16(view, 6, 0); // central dir start disk
  writeUint16(view, 8, entryCount);
  writeUint16(view, 10, entryCount);
  writeUint32(view, 12, centralSize);
  writeUint32(view, 16, centralOffset);
  writeUint16(view, 20, 0); // comment length
  return record;
}

async function toUint8(data) {
  if (data == null) return new Uint8Array();
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    const buffer = await data.arrayBuffer();
    return new Uint8Array(buffer);
  }
  return textEncoder.encode(String(data));
}

function normalizeName(name) {
  const raw = String(name || "").replace(/^\/+/, "").trim();
  if (!raw) return null;
  return raw.replace(/\\/g, "/");
}

export function textToUint8(value) {
  return textEncoder.encode(String(value ?? ""));
}

export async function buildZipUint8(entries = []) {
  const validEntries = [];
  for (const entry of entries) {
    const name = normalizeName(entry?.name);
    if (!name) continue;
    const bytes = await toUint8(entry?.data);
    const nameBytes = textToUint8(name);
    const { dosDate, dosTime } = toDosDateTime(entry?.lastModified);
    validEntries.push({
      name,
      nameBytes,
      data: bytes,
      crc32: computeCrc32(bytes),
      dosDate,
      dosTime,
      localHeaderOffset: 0,
    });
  }

  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  validEntries.forEach((entry) => {
    entry.localHeaderOffset = offset;
    const localHeader = buildLocalHeader(entry);
    localChunks.push(localHeader, entry.data);
    offset += localHeader.length + entry.data.length;
    centralChunks.push(buildCentralHeader(entry));
  });

  const centralOffset = offset;
  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const eocd = buildEndOfCentralDirectory(validEntries.length, centralSize, centralOffset);
  return concatBytes([...localChunks, ...centralChunks, eocd]);
}

export async function buildZipBlob(entries = [], mimeType = "application/zip") {
  const bytes = await buildZipUint8(entries);
  return new Blob([bytes], { type: mimeType });
}

export async function triggerBlobDownload(blob, fileName) {
  const safeName = String(fileName || "download.bin").trim() || "download.bin";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function monthFileStamp(month) {
  if (/^\d{4}-\d{2}$/.test(String(month || ""))) return String(month);
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
