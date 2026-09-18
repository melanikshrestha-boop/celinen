/** Minimal store-only ZIP writer (no dependencies) — enough for a .lrplugin bundle. */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array) {
  return crc32Update(0, bytes);
}

/** Continues a CRC-32 over another chunk: `crc32Update(crc32(a), b) === crc32(a + b)`.
 * Start from 0. Lets a streaming writer checksum a file it never holds whole. */
export function crc32Update(crc: number, bytes: Uint8Array) {
  const t = SLICE_TABLES;
  let c = (crc ^ 0xffffffff) >>> 0;
  let i = 0;
  const n = bytes.length;
  // Slicing-by-8: eight bytes per table round instead of one. A multi-GB
  // export zip is checksummed on the page, so the hot loop matters.
  for (; i + 8 <= n; i += 8) {
    c ^= bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24);
    c =
      t[1792 + (c & 0xff)]! ^
      t[1536 + ((c >>> 8) & 0xff)]! ^
      t[1280 + ((c >>> 16) & 0xff)]! ^
      t[1024 + (c >>> 24)]! ^
      t[768 + bytes[i + 4]!]! ^
      t[512 + bytes[i + 5]!]! ^
      t[256 + bytes[i + 6]!]! ^
      t[bytes[i + 7]!]!;
  }
  for (; i < n; i++) c = TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Eight 256-entry tables, back to back; table k extends table k-1 by one byte. */
const SLICE_TABLES = (() => {
  const t = new Uint32Array(256 * 8);
  t.set(TABLE);
  for (let k = 1; k < 8; k++) {
    for (let i = 0; i < 256; i++) {
      const prev = t[(k - 1) * 256 + i]!;
      t[k * 256 + i] = (prev >>> 8) ^ TABLE[prev & 0xff]!;
    }
  }
  return t;
})();

export interface ZipEntry {
  path: string;
  /** Text payload. Ignored when `bytes` is provided. */
  text?: string;
  /** Raw bytes — used for binary files (originals, RAW, etc). */
  bytes?: Uint8Array;
}

export function makeZip(entries: ZipEntry[]): Blob {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
  const u32 = (n: number) =>
    new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
  const join = (parts: Uint8Array[]) => {
    const size = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(size);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };

  for (const entry of entries) {
    const name = enc.encode(entry.path);
    const data = entry.bytes ?? enc.encode(entry.text ?? "");
    const crc = crc32(data);

    const local = join([
      u32(0x04034b50),
      u16(20),
      u16(0x0800), // entry names are UTF-8
      u16(0), // stored
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ]);
    chunks.push(local);

    central.push(
      join([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800), // must match the local header's UTF-8 flag
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += local.length;
  }

  const dir = join(central);
  const end = join([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(dir.length),
    u32(offset),
    u16(0),
  ]);

  return new Blob([join(chunks) as BlobPart, dir as BlobPart, end as BlobPart], {
    type: "application/zip",
  });
}
