/** A streaming, store-only ZIP writer with ZIP64, for browsers that cannot
 * write into a folder (Safari, Firefox): the keepers leave as one download.
 *
 * Photos are already compressed, so entries are stored, not deflated — that
 * keeps the writer small and the throughput at disk speed. Each file is
 * streamed through once: its CRC is computed on the way and written after the
 * data in a data descriptor, so nothing is held in memory but one chunk.
 * ZIP64 records are written only when an entry, an offset or the entry count
 * outgrows the classic format, so ordinary archives stay readable by old tools.
 */
import { crc32Update } from "@/lib/zip";

export type ZipSink = {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
};

export type ZipEntryOptions = {
  /** Modification time for the entry, ms since epoch. Defaults to now. */
  lastModified?: number | undefined;
  signal?: AbortSignal | undefined;
  /** Called with the byte count of every chunk as it is written. */
  onBytes?: ((bytes: number) => void) | undefined;
};

export type ZipWriterOptions = {
  /** Always write ZIP64 records. For tests of the ZIP64 path without 4 GB of data. */
  forceZip64?: boolean | undefined;
};

type CentralRecord = {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  dosTime: number;
  dosDate: number;
};

const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
const FLAG_DATA_DESCRIPTOR = 0x0008;
const FLAG_UTF8 = 0x0800;
const UNIX_FILE_MODE = 0o100644; // regular file, rw-r--r--

export class ZipWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipWriteError";
  }
}

/** Entry names: forward slashes, no leading slash, no `..`, no empty segments. */
export function normalizeZipPath(path: string): string {
  const segments = path
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment && segment !== ".");
  if (!segments.length || segments.some((segment) => segment === ".."))
    throw new ZipWriteError(`Unsafe path in archive: ${path}`);
  return segments.join("/");
}

export class ZipStreamWriter {
  private offset = 0;
  private readonly records: CentralRecord[] = [];
  private readonly names = new Set<string>();
  private busy = false;
  private finished = false;

  constructor(
    private readonly sink: ZipSink,
    private readonly options: ZipWriterOptions = {},
  ) {}

  /** Bytes written to the sink so far. */
  get bytesWritten(): number {
    return this.offset;
  }

  has(path: string): boolean {
    return this.names.has(normalizeZipPath(path).toLowerCase());
  }

  /**
   * Streams one file into the archive and resolves with its size and CRC.
   * Entries are written one at a time; ZIP is a sequential format.
   */
  async add(
    path: string,
    source: Blob | Uint8Array | ReadableStream<Uint8Array>,
    options: ZipEntryOptions = {},
  ): Promise<{ size: number; crc: number }> {
    if (this.finished) throw new ZipWriteError("The archive is already finished.");
    if (this.busy) throw new ZipWriteError("Zip entries must be added one at a time.");
    const normalized = normalizeZipPath(path);
    // Case-insensitive, as the folders it will be extracted into usually are.
    const key = normalized.toLowerCase();
    if (this.names.has(key)) throw new ZipWriteError(`Duplicate path in archive: ${normalized}`);
    this.busy = true;
    try {
      options.signal?.throwIfAborted();
      const name = new TextEncoder().encode(normalized);
      if (name.length > MAX16) throw new ZipWriteError(`Path too long for a zip entry: ${path}`);
      const { dosTime, dosDate } = dosDateTime(options.lastModified ?? Date.now());
      const offset = this.offset;

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 45, true); // version needed: 4.5 (ZIP64-capable)
      local.setUint16(6, FLAG_DATA_DESCRIPTOR | FLAG_UTF8, true);
      local.setUint16(8, 0, true); // stored
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      // CRC and sizes are zero here and follow the data in the descriptor.
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      await this.emit(new Uint8Array(local.buffer));
      await this.emit(name);

      let crc = 0;
      let size = 0;
      const stream =
        source instanceof Uint8Array
          ? new Blob([source as BlobPart]).stream()
          : source instanceof Blob
            ? source.stream()
            : source;
      const reader = stream.getReader();
      try {
        for (;;) {
          options.signal?.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          if (!value?.length) continue;
          crc = crc32Update(crc, value);
          size += value.length;
          await this.emit(value);
          options.onBytes?.(value.length);
        }
      } catch (error) {
        await reader.cancel(error).catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }

      const zip64 = this.options.forceZip64 || size >= MAX32;
      const descriptor = new DataView(new ArrayBuffer(zip64 ? 24 : 16));
      descriptor.setUint32(0, 0x08074b50, true);
      descriptor.setUint32(4, crc, true);
      if (zip64) {
        descriptor.setBigUint64(8, BigInt(size), true);
        descriptor.setBigUint64(16, BigInt(size), true);
      } else {
        descriptor.setUint32(8, size, true);
        descriptor.setUint32(12, size, true);
      }
      await this.emit(new Uint8Array(descriptor.buffer));

      this.records.push({ name, crc, size, offset, dosTime, dosDate });
      this.names.add(key);
      return { size, crc };
    } finally {
      this.busy = false;
    }
  }

  /** Writes the central directory and closes the sink. */
  async finish(): Promise<{ bytes: number; entries: number }> {
    if (this.finished) throw new ZipWriteError("The archive is already finished.");
    if (this.busy) throw new ZipWriteError("An entry is still being written.");
    this.finished = true;
    const force = Boolean(this.options.forceZip64);
    const centralStart = this.offset;

    for (const record of this.records) {
      const needsSize = force || record.size >= MAX32;
      const needsOffset = force || record.offset >= MAX32;
      const extraLength =
        needsSize || needsOffset ? 4 + (needsSize ? 16 : 0) + (needsOffset ? 8 : 0) : 0;
      const header = new DataView(new ArrayBuffer(46 + extraLength));
      header.setUint32(0, 0x02014b50, true);
      header.setUint16(4, (3 << 8) | 45, true); // made by: UNIX, spec 4.5
      header.setUint16(6, extraLength ? 45 : 20, true);
      header.setUint16(8, FLAG_DATA_DESCRIPTOR | FLAG_UTF8, true);
      header.setUint16(10, 0, true);
      header.setUint16(12, record.dosTime, true);
      header.setUint16(14, record.dosDate, true);
      header.setUint32(16, record.crc, true);
      header.setUint32(20, needsSize ? MAX32 : record.size, true);
      header.setUint32(24, needsSize ? MAX32 : record.size, true);
      header.setUint16(28, record.name.length, true);
      header.setUint16(30, extraLength, true);
      header.setUint16(32, 0, true); // comment
      header.setUint16(34, 0, true); // disk
      header.setUint16(36, 0, true); // internal attributes
      header.setUint32(38, (UNIX_FILE_MODE << 16) >>> 0, true);
      header.setUint32(42, needsOffset ? MAX32 : record.offset, true);
      if (extraLength) {
        // ZIP64 extended information: only the fields set to 0xFFFFFFFF, in order.
        let at = 46;
        header.setUint16(at, 0x0001, true);
        header.setUint16(at + 2, extraLength - 4, true);
        at += 4;
        if (needsSize) {
          header.setBigUint64(at, BigInt(record.size), true);
          header.setBigUint64(at + 8, BigInt(record.size), true);
          at += 16;
        }
        if (needsOffset) header.setBigUint64(at, BigInt(record.offset), true);
      }
      const bytes = new Uint8Array(header.buffer);
      await this.emit(bytes.subarray(0, 46));
      await this.emit(record.name);
      if (extraLength) await this.emit(bytes.subarray(46));
    }

    const centralSize = this.offset - centralStart;
    const count = this.records.length;
    const zip64End = force || count >= MAX16 || centralStart >= MAX32 || centralSize >= MAX32;
    if (zip64End) {
      const zip64RecordOffset = this.offset;
      const record = new DataView(new ArrayBuffer(56));
      record.setUint32(0, 0x06064b50, true);
      record.setBigUint64(4, 44n, true); // size of the rest of this record
      record.setUint16(12, (3 << 8) | 45, true);
      record.setUint16(14, 45, true);
      record.setUint32(16, 0, true);
      record.setUint32(20, 0, true);
      record.setBigUint64(24, BigInt(count), true);
      record.setBigUint64(32, BigInt(count), true);
      record.setBigUint64(40, BigInt(centralSize), true);
      record.setBigUint64(48, BigInt(centralStart), true);
      await this.emit(new Uint8Array(record.buffer));

      const locator = new DataView(new ArrayBuffer(20));
      locator.setUint32(0, 0x07064b50, true);
      locator.setUint32(4, 0, true);
      locator.setBigUint64(8, BigInt(zip64RecordOffset), true);
      locator.setUint32(16, 1, true);
      await this.emit(new Uint8Array(locator.buffer));
    }

    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, zip64End ? MAX16 : count, true);
    end.setUint16(10, zip64End ? MAX16 : count, true);
    end.setUint32(12, zip64End ? MAX32 : centralSize, true);
    end.setUint32(16, zip64End ? MAX32 : centralStart, true);
    await this.emit(new Uint8Array(end.buffer));
    await this.sink.close();
    return { bytes: this.offset, entries: count };
  }

  /** Abandons the archive and aborts the sink. */
  async abort(reason?: unknown): Promise<void> {
    this.finished = true;
    await this.sink.abort?.(reason);
  }

  private async emit(bytes: Uint8Array) {
    await this.sink.write(bytes);
    this.offset += bytes.length;
  }
}

/** A sink over a WritableStream (a file's writable, a download stream, a TransformStream). */
export function writableZipSink(stream: WritableStream<Uint8Array>): ZipSink {
  const writer = stream.getWriter();
  return {
    write: (chunk) => writer.write(chunk),
    close: () => writer.close(),
    abort: (reason) => writer.abort(reason),
  };
}

/** MS-DOS date/time in local time, as unzip tools display it. Clamped to 1980..2107. */
function dosDateTime(ms: number): { dosTime: number; dosDate: number } {
  const date = new Date(Number.isFinite(ms) ? ms : Date.now());
  let year = date.getFullYear();
  if (year < 1980) return { dosTime: 0, dosDate: (1 << 5) | 1 };
  if (year > 2107) year = 2107;
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}
