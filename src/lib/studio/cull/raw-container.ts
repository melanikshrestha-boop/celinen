/** The pictures inside a RAW file, and which way up they belong.
 *
 * Typed face of the RAW container API in native/wasm/raw_wasm.cpp, which is
 * linked into celinen-ingest.wasm (the ingest lanes) and into the small
 * celinen-raw.wasm (the loupe and the preview worker). Every surface asks the
 * same C++ which embedded JPEG is best and how to turn it, so a thumbnail, a
 * review preview and the loupe can never disagree about a frame's orientation.
 *
 * Only the head of a RAW is read (its previews and IFDs sit near the front), and
 * previews are cut from the File lazily, so a 60 MB RAW is never copied whole.
 */

type RawExports = {
  memory: WebAssembly.Memory;
  celinen_raw_input: (size: number) => number;
  celinen_raw_inspect: (size: number, fileSize: number) => number;
  celinen_raw_kind: () => number;
  celinen_raw_container_orientation: () => number;
  celinen_raw_truncated: () => number;
  celinen_raw_candidate: (index: number) => number;
  celinen_raw_probe: (size: number) => number;
  celinen_raw_describe: (index: number, size: number) => number;
  celinen_raw_rank: () => number;
  celinen_raw_order: () => number;
  celinen_raw_orientation: (index: number) => number;
  celinen_raw_retag: (size: number, orientation: number) => number;
  celinen_raw_output: () => number;
  celinen_raw_output_size: () => number;
  celinen_raw_release: () => void;
};

export type RawContainerKind = "unknown" | "tiff" | "cr3" | "raf";

const KINDS: readonly RawContainerKind[] = ["unknown", "tiff", "cr3", "raf"];
const SOURCES = [
  "scan",
  "ifd",
  "sub-ifd",
  "cr3-thumbnail",
  "cr3-preview",
  "cr3-track",
  "raf",
  "rw2",
] as const;
export type RawPreviewSource = (typeof SOURCES)[number];

/** One embedded JPEG worth decoding. */
export type RawPreview = {
  /** Byte range inside the RAW file. */
  offset: number;
  length: number;
  /** Stored pixel size, before orientation. */
  width: number;
  height: number;
  source: RawPreviewSource;
  /** Which way up it belongs (TIFF 1..8), settled by the C++ precedence rule. */
  orientation: number;
};

export type RawInspection = {
  kind: RawContainerKind;
  /** The container's own orientation 1..8, 0 when it has none. */
  containerOrientation: number;
  /** Decodable previews, best first. Empty when the RAW holds none a browser can show. */
  previews: RawPreview[];
};

/** Bytes read first. Sony, Nikon, Canon and Fujifilm all keep their IFDs and
 * preview headers well inside this. */
export const RAW_HEAD_BYTES = 1024 * 1024;
/** Read when the first head pointed past itself and found nothing usable. */
export const RAW_HEAD_MAX_BYTES = 8 * 1024 * 1024;
/** Enough of a preview to read its EXIF (at most 64 KiB) and frame header. */
const PREVIEW_HEADER_BYTES = 256 * 1024;

type Candidate = { offset: number; length: number; described: boolean };

/** The synchronous calls. Each method leaves no state another call depends on
 * across an `await`, so concurrent inspections (the loupe warming neighbours)
 * cannot see each other's containers. */
export type RawApi = {
  /** Lists candidates for a head, without describing the ones past it. */
  list(head: Uint8Array, fileSize: number): { candidates: Candidate[]; truncated: boolean };
  /** Inspects again, describes past-the-head candidates from `probes`, ranks. */
  resolve(
    head: Uint8Array,
    fileSize: number,
    probes: ReadonlyMap<number, Uint8Array>,
  ): RawInspection & { truncated: boolean };
  /** The prefix that replaces the first `consumed` bytes of a JPEG so its EXIF
   * says `orientation`; null when `head` is not a JPEG. */
  retag(head: Uint8Array, orientation: number): { prefix: Uint8Array; consumed: number } | null;
  release(): void;
};

export function hasRawExports(exports: object): boolean {
  return "celinen_raw_inspect" in exports && "celinen_raw_retag" in exports;
}

export function rawApiFromExports(exports: object): RawApi {
  const wasm = exports as RawExports;
  const load = (bytes: Uint8Array, reserve: (size: number) => number) => {
    const pointer = reserve(bytes.length);
    if (!pointer) throw new Error("This RAW file is too large for the browser's memory.");
    new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
  };
  const inspect = (head: Uint8Array, fileSize: number) => {
    load(head, wasm.celinen_raw_input);
    const count = wasm.celinen_raw_inspect(head.length, fileSize);
    if (count < 0) throw new Error("This RAW file could not be inspected.");
    return count;
  };
  const candidate = (index: number) => {
    const pointer = wasm.celinen_raw_candidate(index);
    const f = new Float64Array(wasm.memory.buffer, pointer, 8);
    return {
      offset: f[0]!,
      length: f[1]!,
      source: SOURCES[f[2]!] ?? "scan",
      described: f[3] === 1,
      width: f[4]!,
      height: f[5]!,
    };
  };

  return {
    list(head, fileSize) {
      const count = inspect(head, fileSize);
      const candidates: Candidate[] = [];
      for (let i = 0; i < count; i++) {
        const { offset, length, described } = candidate(i);
        candidates.push({ offset, length, described });
      }
      return { candidates, truncated: wasm.celinen_raw_truncated() === 1 };
    },
    resolve(head, fileSize, probes) {
      const count = inspect(head, fileSize);
      for (const [index, bytes] of probes) {
        if (index >= count || !bytes.length) continue;
        load(bytes, wasm.celinen_raw_probe);
        wasm.celinen_raw_describe(index, bytes.length);
      }
      const ranked = wasm.celinen_raw_rank();
      const order = Array.from(new Int32Array(wasm.memory.buffer, wasm.celinen_raw_order(), ranked));
      const previews = order.map((index) => {
        const { offset, length, width, height, source } = candidate(index);
        return { offset, length, width, height, source, orientation: wasm.celinen_raw_orientation(index) };
      });
      return {
        kind: KINDS[wasm.celinen_raw_kind()] ?? "unknown",
        containerOrientation: wasm.celinen_raw_container_orientation(),
        previews,
        truncated: wasm.celinen_raw_truncated() === 1,
      };
    },
    retag(head, orientation) {
      if (!head.length) return null;
      load(head, wasm.celinen_raw_probe);
      const consumed = wasm.celinen_raw_retag(head.length, orientation);
      if (consumed < 0) return null;
      const size = wasm.celinen_raw_output_size();
      const prefix = new Uint8Array(size);
      if (size) prefix.set(new Uint8Array(wasm.memory.buffer, wasm.celinen_raw_output(), size));
      return { prefix, consumed };
    },
    release: () => wasm.celinen_raw_release(),
  };
}

const WASI_ENOSYS = 52;

export async function instantiateRawWasm(binary: BufferSource | WebAssembly.Module): Promise<RawApi> {
  const module = binary instanceof WebAssembly.Module ? binary : await WebAssembly.compile(binary);
  const imports: Record<string, Record<string, WebAssembly.ImportValue>> = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    if (entry.kind !== "function")
      throw new Error(`RAW engine needs an unexpected import: ${entry.module}.${entry.name}`);
    (imports[entry.module] ??= {})[entry.name] = () => WASI_ENOSYS;
  }
  const instance = await WebAssembly.instantiate(module, imports);
  const exports = instance.exports as unknown as RawExports & { _initialize?: () => void };
  exports._initialize?.();
  return rawApiFromExports(exports);
}

let loading: Promise<RawApi> | null = null;

/** The small RAW module for this context, loaded once. A failed download is not
 * cached, so a dropped connection does not disable RAW previews for good. */
export function rawApi(): Promise<RawApi> {
  loading ??= fetch(new URL("./celinen-raw.wasm", import.meta.url))
    .then((response) => {
      if (!response.ok) throw new Error(`RAW engine download failed (${response.status}).`);
      return response.arrayBuffer();
    })
    .then(instantiateRawWasm)
    .catch((error: unknown) => {
      loading = null;
      throw error;
    });
  return loading;
}

async function read(file: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(start, Math.min(end, file.size)).arrayBuffer());
}

/**
 * Finds the previews of a RAW file, best first, each with the orientation it
 * belongs in. Reads the head (1 MB, then 8 MB if the structure pointed past it
 * and nothing usable was found) and the first bytes of any preview whose header
 * lies beyond the head. `head` may be passed when the caller already has it.
 */
export async function inspectRawFile(
  file: Blob,
  api: RawApi,
  head?: Uint8Array,
): Promise<RawInspection> {
  const limits = [
    head ? head.length : Math.min(file.size, RAW_HEAD_BYTES),
    Math.min(file.size, RAW_HEAD_MAX_BYTES),
  ];
  let inspection: (RawInspection & { truncated: boolean }) | null = null;
  for (let attempt = 0; attempt < limits.length; attempt++) {
    const size = limits[attempt]!;
    if (attempt > 0 && size <= limits[attempt - 1]!) break;
    const bytes = attempt === 0 && head ? head : await read(file, 0, size);
    const listing = api.list(bytes, file.size);
    const probes = new Map<number, Uint8Array>();
    for (const [index, candidate] of listing.candidates.entries()) {
      if (candidate.described) continue;
      const end = candidate.offset + Math.min(candidate.length, PREVIEW_HEADER_BYTES);
      probes.set(index, await read(file, candidate.offset, end));
    }
    inspection = api.resolve(bytes, file.size, probes);
    if (inspection.previews.length || !inspection.truncated) break;
  }
  const { kind, containerOrientation, previews } = inspection ?? {
    kind: "unknown",
    containerOrientation: 0,
    previews: [],
  };
  return { kind, containerOrientation, previews };
}

/**
 * One preview as a JPEG Blob whose EXIF says which way up it belongs, so any
 * browser decoder (ImageBitmap with "from-image", an <img>) turns it. Only the
 * header is rewritten; the picture data stays a lazy slice of the RAW file.
 */
export async function orientedPreview(file: Blob, preview: RawPreview, api: RawApi): Promise<Blob> {
  const end = preview.offset + preview.length;
  const head = await read(file, preview.offset, preview.offset + Math.min(preview.length, PREVIEW_HEADER_BYTES));
  const retagged = api.retag(head, preview.orientation);
  if (!retagged) throw new Error("The preview inside this RAW file is not a JPEG.");
  const body = file.slice(preview.offset + retagged.consumed, end);
  const parts: BlobPart[] = retagged.prefix.length
    ? [retagged.prefix as Uint8Array<ArrayBuffer>, body]
    : [body];
  return new Blob(parts, { type: "image/jpeg" });
}
