/** SETT/SRES v1: C++ photo usage tally. Counts only; no billing invention. */
export const SETTINGS_USAGE_MAX_ITEMS = 200_000;
const REQUEST_MAGIC = 0x53455454;
const RESULT_MAGIC = 0x53524553;
const VERSION = 1;

export type SettingsUsagePhoto = { bytes: number; kept: boolean };
export type SettingsUsageResult = {
  photos: number;
  kept: number;
  totalBytes: number;
  averageBytes: number;
};

function put32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value);
  return offset + 4;
}
function put64(view: DataView, offset: number, value: number) {
  const high = Math.floor(value / 0x1_0000_0000);
  const low = value >>> 0;
  view.setUint32(offset, high);
  view.setUint32(offset + 4, low);
  return offset + 8;
}
function read32(view: DataView, offset: { n: number }) {
  const value = view.getUint32(offset.n);
  offset.n += 4;
  return value;
}
function read64(view: DataView, offset: { n: number }) {
  const high = read32(view, offset);
  const low = read32(view, offset);
  return high * 0x1_0000_0000 + low;
}

export function encodeSettingsUsage(photos: SettingsUsagePhoto[]): Uint8Array {
  if (photos.length > SETTINGS_USAGE_MAX_ITEMS) throw new Error("Settings tally exceeds limits.");
  const packet = new Uint8Array(12 + photos.length * 9);
  const view = new DataView(packet.buffer);
  let offset = put32(view, 0, REQUEST_MAGIC);
  offset = put32(view, offset, VERSION);
  offset = put32(view, offset, photos.length);
  for (const photo of photos) {
    if (!Number.isSafeInteger(photo.bytes) || photo.bytes < 0 || photo.bytes > 2 ** 40)
      throw new Error("Settings photo is too large.");
    offset = put64(view, offset, photo.bytes);
    packet[offset++] = photo.kept ? 1 : 0;
  }
  return packet;
}

export function decodeSettingsUsage(bytes: Uint8Array): SettingsUsageResult {
  if (bytes.length !== 32) throw new Error("Settings result is invalid.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = { n: 0 };
  if (read32(view, offset) !== RESULT_MAGIC || read32(view, offset) !== VERSION)
    throw new Error("Settings result magic is invalid.");
  return {
    photos: read32(view, offset),
    kept: read32(view, offset),
    totalBytes: read64(view, offset),
    averageBytes: read64(view, offset),
  };
}

export function tallySettingsUsageLocal(photos: SettingsUsagePhoto[]): SettingsUsageResult {
  if (photos.length > SETTINGS_USAGE_MAX_ITEMS) throw new Error("Settings tally exceeds limits.");
  let total = 0;
  let kept = 0;
  for (const photo of photos) {
    if (!Number.isSafeInteger(photo.bytes) || photo.bytes < 0 || photo.bytes > 2 ** 40)
      throw new Error("Settings photo is too large.");
    total += photo.bytes;
    if (photo.kept) kept += 1;
  }
  return {
    photos: photos.length,
    kept,
    totalBytes: total,
    averageBytes: photos.length ? Math.floor(total / photos.length) : 0,
  };
}

export function formatUsageBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
