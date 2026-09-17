/** Typed face of celinen-ingest.wasm (native/wasm/ingest_wasm.cpp): one call per
 * photo. The bytes go in; EXIF, a scaled decode, the cull measurement and a
 * filmstrip thumbnail come back. The browser never decodes the original, which
 * is what makes a ten-thousand frame card finish in minutes instead of an hour.
 */
import type { CullReading } from "./engine";

type Exports = {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  celinen_ingest_error: () => number;
  celinen_ingest_input: (size: number) => number;
  celinen_ingest_run: (
    size: number,
    measureEdge: number,
    thumbEdge: number,
    thumbQuality: number,
  ) => number;
  celinen_ingest_reading: () => number;
  celinen_ingest_capture_time: () => number;
  celinen_ingest_capture_utc: () => number;
  celinen_ingest_camera: () => number;
  celinen_ingest_source_width: () => number;
  celinen_ingest_source_height: () => number;
  celinen_ingest_frame_width: () => number;
  celinen_ingest_frame_height: () => number;
  celinen_ingest_thumbnail: () => number;
  celinen_ingest_thumbnail_size: () => number;
  celinen_ingest_pixels: () => number;
  celinen_ingest_release: () => void;
};

export type IngestResult = {
  reading: CullReading;
  /** The original's own pixel size, before the scaled decode. */
  width: number;
  height: number;
  /** Milliseconds, or null when the file carried no capture time. */
  captureTimeMs: number | null;
  /** Whether that time is a real instant or a reading of the camera's clock. */
  captureTimeBasis: "utc" | "camera_clock" | undefined;
  /** "make|model|serial" as the file spelled it, or undefined. */
  cameraKey: string | undefined;
  /** A JPEG for the filmstrip, made from the same decode. */
  thumbnail: Blob;
  /** The measured frame, for a caller that wants to look closer. */
  frame: { width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer> };
};

export type IngestOptions = {
  /** Long edge the focus measurement reads. */
  measureEdge?: number;
  /** Long edge of the thumbnail this returns. */
  thumbEdge?: number;
  thumbQuality?: number;
};

export type IngestEngine = {
  /** Reads one photo. Throws with the engine's own message on a file it cannot read. */
  read(bytes: Uint8Array, options?: IngestOptions): IngestResult;
  /** Hands every buffer back between cards. */
  release(): void;
};

const READING_FIELDS = 23;
const COLOR_BYTES = 48;
const WASI_ENOSYS = 52;

export async function instantiateIngestWasm(
  binary: BufferSource | WebAssembly.Module,
): Promise<IngestEngine> {
  const module = binary instanceof WebAssembly.Module ? binary : await WebAssembly.compile(binary);
  const imports: Record<string, Record<string, WebAssembly.ImportValue>> = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    if (entry.kind !== "function")
      throw new Error(`Ingest engine needs an unexpected import: ${entry.module}.${entry.name}`);
    (imports[entry.module] ??= {})[entry.name] = () => WASI_ENOSYS;
  }
  const wasm = (await WebAssembly.instantiate(module, imports)).exports as unknown as Exports;
  wasm._initialize?.();

  const text = (pointer: number) => {
    const bytes = new Uint8Array(wasm.memory.buffer, pointer);
    let end = 0;
    while (bytes[end]) end++;
    return new TextDecoder().decode(bytes.subarray(0, end));
  };

  return {
    read(bytes, options = {}) {
      const measureEdge = options.measureEdge ?? 640;
      const thumbEdge = options.thumbEdge ?? 320;
      const thumbQuality = options.thumbQuality ?? 72;
      const pointer = wasm.celinen_ingest_input(bytes.length);
      if (!pointer) throw new Error(text(wasm.celinen_ingest_error()) || "This photo is too large.");
      new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
      if (!wasm.celinen_ingest_run(bytes.length, measureEdge, thumbEdge, thumbQuality))
        throw new Error(text(wasm.celinen_ingest_error()) || "This photo could not be read.");

      const readingPointer = wasm.celinen_ingest_reading();
      if (!readingPointer) throw new Error("This photo could not be measured.");
      const v = new Float64Array(wasm.memory.buffer, readingPointer, READING_FIELDS + COLOR_BYTES);
      const hex = (high: number, low: number) =>
        (high >>> 0).toString(16).padStart(8, "0") + (low >>> 0).toString(16).padStart(8, "0");
      const reading: CullReading = {
        acuitySubject: v[0]!,
        acuityBest: v[1]!,
        texture: v[2]!,
        motion: v[3]!,
        globalSmear: v[4] === 1,
        noise: v[5]!,
        brightness: v[6]!,
        subjectLuma: v[7]!,
        clippedHighlights: v[8]!,
        clippedShadows: v[9]!,
        subjectClipped: v[10]!,
        blackPoint: v[11]!,
        median: v[12]!,
        whitePoint: v[13]!,
        subjectX: v[14]!,
        subjectY: v[15]!,
        hash: hex(v[16]!, v[17]!),
        sharpness: v[18]!,
        quality: v[19]!,
        hasFace: v[20] === 1,
        eyesClosed: v[21] === 1,
        faceSoft: v[22] === 1,
        color: Uint8Array.from(v.subarray(READING_FIELDS, READING_FIELDS + COLOR_BYTES)),
      };

      const thumbSize = wasm.celinen_ingest_thumbnail_size();
      // Copied out of wasm memory: the next photo reuses it, and growth detaches it.
      const thumbnail = new Uint8Array(
        new Uint8Array(wasm.memory.buffer, wasm.celinen_ingest_thumbnail(), thumbSize),
      );
      const frameWidth = wasm.celinen_ingest_frame_width();
      const frameHeight = wasm.celinen_ingest_frame_height();
      const pixels = new Uint8ClampedArray(frameWidth * frameHeight * 4);
      pixels.set(
        new Uint8ClampedArray(wasm.memory.buffer, wasm.celinen_ingest_pixels(), pixels.length),
      );
      const captureTimeMs = wasm.celinen_ingest_capture_time();
      const camera = text(wasm.celinen_ingest_camera());
      return {
        reading,
        width: wasm.celinen_ingest_source_width(),
        height: wasm.celinen_ingest_source_height(),
        captureTimeMs: captureTimeMs >= 0 ? captureTimeMs : null,
        captureTimeBasis:
          captureTimeMs < 0
            ? undefined
            : wasm.celinen_ingest_capture_utc() === 1
              ? "utc"
              : "camera_clock",
        cameraKey: camera || undefined,
        thumbnail: new Blob([thumbnail], { type: "image/jpeg" }),
        frame: { width: frameWidth, height: frameHeight, rgba: pixels },
      };
    },
    release: () => wasm.celinen_ingest_release(),
  };
}
