/** Typed face of celinen-raw-decode.wasm (native/wasm/raw_decode_wasm.cpp).
 *
 * The sensor data inside a RAW, at the resolution the sensor actually holds.
 * `raw-container.ts` answers which finished JPEG a RAW carries; this answers
 * what the photosites recorded, which on a Sony ARW is ten or twenty-four
 * million pixels next to a 1616x1080 preview.
 *
 * Environment-free on purpose: the Web Worker and the test suite drive the very
 * same compiled C++ through this one wrapper. The decode is stepped rather than
 * run to completion, so a caller owns the scheduling — a worker can yield
 * between bands, report progress and stop simply by not stepping again.
 */

type Exports = {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  celinen_rawdec_error: () => number;
  celinen_rawdec_input: (size: number) => number;
  celinen_rawdec_open: (size: number) => number;
  celinen_rawdec_describe: () => number;
  celinen_rawdec_begin: (
    quality: number,
    kelvin: number,
    tint: number,
    highlightRecovery: number,
    exposure: number,
    shoulder: number,
    band: number,
  ) => number;
  celinen_rawdec_step: () => number;
  celinen_rawdec_width: () => number;
  celinen_rawdec_height: () => number;
  celinen_rawdec_pixels: () => number;
  celinen_rawdec_resident: () => number;
  celinen_rawdec_white_balance: () => number;
  celinen_rawdec_release: () => void;
};

/** Matches `lenslabs::raw::Packing`. */
const PACKINGS = ["unknown", "uncompressed-16", "packed-bits", "sony-lossy", "lossless-jpeg"] as const;
export type RawPacking = (typeof PACKINGS)[number];

/** Matches `lenslabs::raw::ProfileSource`. */
const PROFILE_SOURCES = ["none", "file", "table"] as const;
export type RawProfileSource = (typeof PROFILE_SOURCES)[number];

/** Matches `lenslabs::raw::Demosaic`. Half is exact: each 2x2 quad becomes one
 * pixel, nothing is interpolated. Gradient is the print-quality one. */
export type RawDemosaic = "half" | "bilinear" | "gradient";
const DEMOSAICS: Record<RawDemosaic, number> = { half: 0, bilinear: 1, gradient: 2 };

export type RawSensorDescription = {
  /** Full-resolution picture area, before any orientation is applied. */
  width: number;
  height: number;
  /** The stored sensor raster, which includes the masked calibration border. */
  sensorWidth: number;
  sensorHeight: number;
  /** TIFF orientation 1..8, the way the camera held the sensor. */
  orientation: number;
  packing: RawPacking;
  bitsPerSample: number;
  /** True when the file records the camera's own white balance. */
  whiteBalanceFromFile: boolean;
  kelvin: number;
  tint: number;
  profileSource: RawProfileSource;
  /** Byte range of the largest embedded JPEG, 0 when the file names none. */
  previewOffset: number;
  previewLength: number;
};

export type RawDecodeRequest = {
  quality?: RawDemosaic;
  /** 0 keeps the camera's own white balance; otherwise an absolute Kelvin. */
  kelvin?: number;
  tint?: number;
  highlightRecovery?: boolean;
  /** Stops of baseline exposure applied in linear light. */
  exposure?: number;
  /** Highlight roll-off strength; 0 renders the transfer function alone. */
  shoulder?: number;
  /** Output rows per step. Smaller yields to the event loop more often. */
  band?: number;
};

export type RawDecodeResult = {
  width: number;
  height: number;
  /** An owned copy outside wasm memory, ready for ImageData. */
  rgba: Uint8ClampedArray<ArrayBuffer>;
  kelvin: number;
  tint: number;
  whiteBalanceFromFile: boolean;
};

export type RawDecodeEngine = {
  /** Copies a RAW into the engine and parses its container. Returns null when
   * the file's sensor data cannot be decoded — `lastError()` says why, and the
   * caller keeps whatever embedded JPEG it is already showing. */
  open(file: Uint8Array): RawSensorDescription | null;
  lastError(): string;
  /** Sizes the output and fixes the white balance. Call after `open`. */
  begin(request?: RawDecodeRequest): { width: number; height: number };
  /** One band. Returns progress from 0 to 1; 1 means the image is complete. */
  step(): number;
  /** The finished image, copied out of wasm memory. Call once step() hits 1. */
  finish(): RawDecodeResult;
  /** Bytes the engine is holding right now. */
  residentBytes(): number;
  /** Hands every buffer back. Safe at any point, including mid-decode. */
  release(): void;
};

// The engine is pure computation. Its only imports are the WASI stubs libc++
// links for a console it never opens; answering ENOSYS is truthful.
const WASI_ENOSYS = 52;

export async function instantiateRawDecodeWasm(
  binary: BufferSource | WebAssembly.Module,
): Promise<RawDecodeEngine> {
  const module = binary instanceof WebAssembly.Module ? binary : await WebAssembly.compile(binary);
  const imports: Record<string, Record<string, WebAssembly.ImportValue>> = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    if (entry.kind !== "function")
      throw new Error(`The RAW decoder needs an unexpected import: ${entry.module}.${entry.name}`);
    (imports[entry.module] ??= {})[entry.name] = () => WASI_ENOSYS;
  }
  const instance = await WebAssembly.instantiate(module, imports);
  const wasm = instance.exports as unknown as Exports;
  wasm._initialize?.();

  const text = (pointer: number) => {
    const bytes = new Uint8Array(wasm.memory.buffer, pointer);
    let end = 0;
    while (bytes[end]) end++;
    return new TextDecoder().decode(bytes.subarray(0, end));
  };
  const lastError = () => text(wasm.celinen_rawdec_error());
  const failure = () => new Error(lastError() || "This RAW could not be decoded.");

  return {
    lastError,
    open(file) {
      const pointer = wasm.celinen_rawdec_input(file.length);
      if (!pointer) throw failure();
      new Uint8Array(wasm.memory.buffer, pointer, file.length).set(file);
      if (!wasm.celinen_rawdec_open(file.length)) return null;
      const fields = new Float64Array(wasm.memory.buffer, wasm.celinen_rawdec_describe(), 14);
      if (fields[13] !== 1) return null;
      return {
        width: fields[0]!,
        height: fields[1]!,
        sensorWidth: fields[2]!,
        sensorHeight: fields[3]!,
        orientation: fields[4]!,
        packing: PACKINGS[fields[5]!] ?? "unknown",
        bitsPerSample: fields[6]!,
        whiteBalanceFromFile: fields[7] === 1,
        kelvin: fields[8]!,
        tint: fields[9]!,
        profileSource: PROFILE_SOURCES[fields[10]!] ?? "none",
        previewOffset: fields[11]!,
        previewLength: fields[12]!,
      };
    },
    begin(request = {}) {
      const ok = wasm.celinen_rawdec_begin(
        DEMOSAICS[request.quality ?? "gradient"],
        request.kelvin ?? 0,
        request.tint ?? 0,
        request.highlightRecovery === false ? 0 : 1,
        request.exposure ?? 0,
        request.shoulder ?? 1,
        Math.max(8, Math.min(512, Math.round(request.band ?? 64))),
      );
      if (!ok) throw failure();
      return { width: wasm.celinen_rawdec_width(), height: wasm.celinen_rawdec_height() };
    },
    step() {
      const progress = wasm.celinen_rawdec_step();
      if (progress < 0) throw failure();
      return progress / 1000;
    },
    finish() {
      const width = wasm.celinen_rawdec_width(),
        height = wasm.celinen_rawdec_height();
      const pointer = wasm.celinen_rawdec_pixels();
      if (!width || !height || !pointer) throw failure();
      // Copied out before anything else touches the engine: wasm memory can
      // grow, which detaches every view onto it.
      const rgba = new Uint8ClampedArray(width * height * 4);
      rgba.set(new Uint8ClampedArray(wasm.memory.buffer, pointer, rgba.length));
      const wb = new Float64Array(wasm.memory.buffer, wasm.celinen_rawdec_white_balance(), 3);
      return {
        width,
        height,
        rgba,
        kelvin: wb[0]!,
        tint: wb[1]!,
        whiteBalanceFromFile: wb[2] === 1,
      };
    },
    residentBytes: () => wasm.celinen_rawdec_resident(),
    release: () => wasm.celinen_rawdec_release(),
  };
}
