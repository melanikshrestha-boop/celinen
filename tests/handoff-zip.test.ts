import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizeZipPath,
  ZipStreamWriter,
  ZipWriteError,
  type ZipSink,
} from "../src/lib/studio/cull/handoff/zip-stream";
import { crc32, crc32Update } from "../src/lib/zip";
import { bytes } from "./handoff-fs.fixture";

function memorySink(): ZipSink & { bytes(): Uint8Array } {
  const chunks: Uint8Array[] = [];
  return {
    write: async (chunk) => {
      chunks.push(chunk.slice());
    },
    close: async () => {},
    bytes() {
      const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
      let at = 0;
      for (const chunk of chunks) {
        out.set(chunk, at);
        at += chunk.length;
      }
      return out;
    },
  };
}

type ReadEntry = { name: string; crc: number; size: number; offset: number; zip64: boolean };

/** An independent central-directory reader, ZIP64-aware, that also checks
 * every entry's data against its CRC. */
function readZip(archive: Uint8Array): { entries: ReadEntry[]; data: Map<string, Uint8Array> } {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let eocd = -1;
  for (let i = archive.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("no end of central directory");
  let count = view.getUint16(eocd + 10, true);
  let centralSize = view.getUint32(eocd + 12, true);
  let centralOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff) {
    const locator = eocd - 20;
    if (view.getUint32(locator, true) !== 0x07064b50) throw new Error("missing zip64 locator");
    const record = Number(view.getBigUint64(locator + 8, true));
    if (view.getUint32(record, true) !== 0x06064b50) throw new Error("missing zip64 record");
    count = Number(view.getBigUint64(record + 32, true));
    centralSize = Number(view.getBigUint64(record + 40, true));
    centralOffset = Number(view.getBigUint64(record + 48, true));
  }
  const entries: ReadEntry[] = [];
  const data = new Map<string, Uint8Array>();
  let at = centralOffset;
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("bad central header");
    const flags = view.getUint16(at + 8, true);
    if (!(flags & 0x0800)) throw new Error("UTF-8 flag missing");
    const crc = view.getUint32(at + 16, true);
    let size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    let offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(archive.subarray(at + 46, at + 46 + nameLength));
    let zip64 = false;
    let extra = at + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra < extraEnd) {
      const id = view.getUint16(extra, true);
      const length = view.getUint16(extra + 2, true);
      if (id === 0x0001) {
        zip64 = true;
        let field = extra + 4;
        if (size === 0xffffffff) {
          size = Number(view.getBigUint64(field, true));
          field += 16; // uncompressed then compressed
        }
        if (offset === 0xffffffff) offset = Number(view.getBigUint64(field, true));
      }
      extra += 4 + length;
    }
    if (view.getUint32(offset, true) !== 0x04034b50)
      throw new Error(`bad local header for ${name}`);
    const localName = view.getUint16(offset + 26, true);
    const localExtra = view.getUint16(offset + 28, true);
    const start = offset + 30 + localName + localExtra;
    const body = archive.subarray(start, start + size);
    if (crc32(body) !== crc) throw new Error(`CRC mismatch for ${name}`);
    const descriptor = start + size;
    if (view.getUint32(descriptor, true) !== 0x08074b50) throw new Error("missing data descriptor");
    entries.push({ name, crc, size, offset, zip64 });
    data.set(name, body);
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (at !== centralOffset + centralSize) throw new Error("central directory size mismatch");
  return { entries, data };
}

function unzipTest(archive: Uint8Array): { status: number | null; output: string } | null {
  if (spawnSync("unzip", ["-v"]).error) return null;
  const dir = mkdtempSync(join(tmpdir(), "celinen-zip-"));
  const path = join(dir, "export.zip");
  writeFileSync(path, archive);
  const result = spawnSync("unzip", ["-t", path], { encoding: "utf8" });
  return { status: result.status, output: result.stdout + result.stderr };
}

async function buildArchive(forceZip64: boolean) {
  const sink = memorySink();
  const writer = new ZipStreamWriter(sink, { forceZip64 });
  const big = bytes(300_000, 7);
  let streamed = 0;
  await writer.add("Finals/_DSC5098.ARW", new Blob([big as BlobPart]), {
    lastModified: new Date(2026, 8, 17, 18, 4, 6).getTime(),
    onBytes: (n) => (streamed += n),
  });
  await writer.add("Finals/_DSC5098.xmp", new TextEncoder().encode("<x:xmpmeta/>"));
  await writer.add("Finals/Zoë — 🏐.jpg", bytes(1234, 3));
  await writer.add("empty.txt", new Uint8Array());
  const result = await writer.finish();
  return { archive: sink.bytes(), big, streamed, result };
}

describe("crc32Update", () => {
  test("matches the check value and is split-invariant", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const data = bytes(10_007, 5);
    const whole = crc32(data);
    for (const cut of [0, 1, 7, 8, 9, 4096, 10_006]) {
      expect(crc32Update(crc32Update(0, data.subarray(0, cut)), data.subarray(cut))).toBe(whole);
    }
    // Slicing-by-8 agrees with the byte-at-a-time definition.
    let reference = 0xffffffff;
    for (const byte of data) {
      reference ^= byte;
      for (let k = 0; k < 8; k++)
        reference = reference & 1 ? 0xedb88320 ^ (reference >>> 1) : reference >>> 1;
    }
    expect(whole).toBe((reference ^ 0xffffffff) >>> 0);
  });
});

describe("ZipStreamWriter", () => {
  for (const forceZip64 of [false, true]) {
    test(`writes an archive unzip accepts (${forceZip64 ? "ZIP64" : "classic"})`, async () => {
      const { archive, big, streamed, result } = await buildArchive(forceZip64);
      expect(result).toEqual({ bytes: archive.length, entries: 4 });
      expect(streamed).toBe(big.length);

      const { entries, data } = readZip(archive);
      expect(entries.map((e) => e.name)).toEqual([
        "Finals/_DSC5098.ARW",
        "Finals/_DSC5098.xmp",
        "Finals/Zoë — 🏐.jpg",
        "empty.txt",
      ]);
      expect(entries.every((e) => e.zip64 === forceZip64)).toBe(true);
      expect([...data.get("Finals/_DSC5098.ARW")!]).toEqual([...big]);
      expect(data.get("empty.txt")!.length).toBe(0);

      const unzip = unzipTest(archive);
      // Info-ZIP ships with macOS; elsewhere the JS reader above still verifies.
      if (process.platform === "darwin") expect(unzip).not.toBeNull();
      if (unzip) {
        expect(unzip.output).toContain("No errors detected");
        expect(unzip.status).toBe(0);
      }
    });
  }

  test("refuses unsafe, duplicate and concurrent entries", async () => {
    expect(() => normalizeZipPath("../evil")).toThrow(ZipWriteError);
    expect(normalizeZipPath("\\a\\.\\b//c")).toBe("a/b/c");
    const writer = new ZipStreamWriter(memorySink());
    await writer.add("A.jpg", new Uint8Array([1]));
    await expect(writer.add("a.JPG", new Uint8Array([1]))).rejects.toThrow("Duplicate");
    const slow = writer.add("b.jpg", new Blob([bytes(10)]));
    await expect(writer.add("c.jpg", new Uint8Array([1]))).rejects.toThrow("one at a time");
    await slow;
    await writer.finish();
    await expect(writer.add("d.jpg", new Uint8Array([1]))).rejects.toThrow("finished");
  });

  test("stops mid-entry when cancelled", async () => {
    const controller = new AbortController();
    const writer = new ZipStreamWriter(memorySink());
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(bytes(1024));
        controller.abort();
      },
    });
    await expect(writer.add("x.bin", stream, { signal: controller.signal })).rejects.toThrow();
  });
});
