/** Typed face of celinen-ingest.wasm (native/wasm/ingest_wasm.cpp): one call per
 * photo. The bytes go in; EXIF, a scaled decode, the cull measurement and a
 * filmstrip thumbnail come back. The browser never decodes the original, which
 * is what makes a ten-thousand frame card finish in minutes instead of an hour.
 */
import { COLOR_BYTES, READING_FIELDS, readingFromLayout, type CullReading } from "./engine";
import { hasRawExports, rawApiFromExports, type RawApi } from "./raw-container";

type Exports = {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  celinen_ingest_error: () => number;
  /** Absent in binaries built before AF-area support. */
  celinen_ingest_metadata?: (size: number) => number;
  celinen_ingest_focus?: () => number;
  celinen_ingest_input: (size: number) => number;
  /** Absent in binaries built before the browser-decode fallback. */
  celinen_ingest_run_pixels?: (
    width: number,
    height: number,
    sourceWidth: number,
    sourceHeight: number,
    measureEdge: number,
    thumbEdge: number,
    thumbQuality: number,
    flags: number,
  ) => number;
  celinen_ingest_damaged?: () => number;
  // Absent in binaries built before the engine read faces.
  celinen_ingest_model_input?: (size: number) => number;
  celinen_ingest_load_model?: (kind: number, size: number) => number;
  celinen_ingest_faces_ready?: () => number;
  celinen_ingest_faces?: () => number;
  celinen_ingest_face_count?: () => number;
  celinen_ingest_face_fields?: () => number;
  celinen_ingest_reading_fields?: () => number;
  celinen_ingest_run: (
    size: number,
    measureEdge: number,
    thumbEdge: number,
    thumbQuality: number,
    flags: number,
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

/** A rectangle normalized to 0..1 of the upright frame. */
export type NormalizedRect = { x: number; y: number; w: number; h: number };

export type FocusHitVerdict = "on-subject" | "front-or-back-focus" | "missed" | "unjudged";

/** How the frame's sharpness sits against the camera's own AF area. */
export type FocusHit = {
  /** 0..1 confidence that focus landed inside the AF area; >= 0.5 is on subject. */
  hit: number;
  /** Resolving power inside the AF area, in CullReading acuity units. */
  afAcuity: number;
  /** Resolving power of the sharpest detail anywhere in the frame. */
  bestAcuity: number;
  /** Where that sharpest detail is. */
  bestRegion: NormalizedRect;
  verdict: FocusHitVerdict;
};

/** One face the engine found, most prominent first. */
export type FaceReading = {
  /** Normalized to the upright frame, 0..1. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Detector confidence 0..1. */
  score: number;
  /** The face's width in the original photograph's pixels. */
  pixels: number;
  /** Acuity across the eyes 0..1; negative when not measured. */
  sharpness: number;
  /** Probability the eyes are closed 0..1; negative when they were not judged. */
  closedProbability: number;
  /** How far closedProbability can be trusted, 0..1. */
  confidence: number;
  /** Blendshape eyeBlinkLeft / eyeBlinkRight (the subject's own sides); negative when not read. */
  blinkLeft: number;
  blinkRight: number;
  /** The landmark model's confidence that a face is there; negative when it did not run. */
  presence: number;
  /** Head pose in degrees; positive pitch looks down. */
  yaw: number;
  pitch: number;
  /** Pixels of real image detail across the face the eyes were read from. */
  detail: number;
  judged: boolean;
  /** The face the frame's eye verdict was taken from. */
  primary: boolean;
  /** A second landmark pass checked the first. */
  refined: boolean;
};

/** The model files, as fetched. See src/lib/studio/cull/models/THIRD-PARTY.md. */
export type FaceModelFiles = {
  detector: ArrayBuffer;
  landmarks: ArrayBuffer;
  blendshapes: ArrayBuffer;
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
  /** Faces, when the models are loaded and faces were asked for; null otherwise. */
  faces: FaceReading[] | null;
  /** The measured frame, for a caller that wants to look closer. */
  frame: { width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer> };
  /** The camera's AF area from its maker note (Sony, Nikon, Canon, Fujifilm),
   * normalized to the upright frame. Undefined when the file names none. */
  afPoint?: NormalizedRect | undefined;
  /** Whether the camera itself reported focus lock there; undefined when it did not say. */
  afConfirmed?: boolean | undefined;
  /** Present whenever afPoint is. */
  focusHit?: FocusHit | undefined;
  /** Set when the photo decoded but is not whole (a cut-off file, corrupt
   * data): why, in plain words. Its readings are over partly gray pixels. */
  damaged?: string | undefined;
};

/** A photo the browser decoded: upright RGBA plus the original's own size. */
export type DecodedPixels = {
  rgba: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
};

export type IngestOptions = {
  /** Long edge the focus measurement reads. */
  measureEdge?: number;
  /** Long edge of the thumbnail this returns. */
  thumbEdge?: number;
  thumbQuality?: number;
  /** Find faces and read eyes when the models are loaded. Defaults to true. */
  faces?: boolean;
  /** Decode with libjpeg's streaming decoder instead of keeping coefficients:
   * lower memory, no full-resolution face crops. For tests and diagnostics. */
  streamingDecode?: boolean;
};

export type IngestEngine = {
  /** Reads one photo. Throws with the engine's own message on a file it cannot read.
   * `container` is the RAW file `bytes` was extracted from (or its first
   * megabytes), read only for the camera's AF area. */
  read(bytes: Uint8Array, options?: IngestOptions, container?: Uint8Array): IngestResult;
  /** Measures a photo the browser decoded, with the same C++ as `read`.
   * `metadata` is the file's first bytes, for capture time, camera and AF area.
   * Undefined in binaries built before the browser-decode fallback. */
  readPixels?: (
    pixels: DecodedPixels,
    options?: IngestOptions,
    metadata?: Uint8Array,
  ) => IngestResult;
  /** The RAW container API linked into the same binary; null in older binaries. */
  raw: RawApi | null;
  /** Parses the face models into the engine; they stay loaded for every photo.
   * Throws when a file is not the model expected, or the binary is too old. */
  loadFaceModels(files: FaceModelFiles): void;
  /** Whether this engine can find faces, and whether it can read their eyes. */
  facesReady(): { detect: boolean; eyes: boolean };
  /** Hands every buffer back between cards. */
  release(): void;
};

const WASI_ENOSYS = 52;
const FOCUS_FIELDS = 13;
const FACE_FIELDS = 16;
const MODEL_KINDS = ["detector", "landmarks", "blendshapes"] as const;
const VERDICTS: readonly FocusHitVerdict[] = [
  "unjudged",
  "on-subject",
  "front-or-back-focus",
  "missed",
];

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
  const fields = wasm.celinen_ingest_reading_fields?.() ?? READING_FIELDS;
  if (fields !== READING_FIELDS || (wasm.celinen_ingest_face_fields?.() ?? FACE_FIELDS) !== FACE_FIELDS)
    throw new Error("The ingest engine's layout does not match this build.");

  const text = (pointer: number) => {
    const bytes = new Uint8Array(wasm.memory.buffer, pointer);
    let end = 0;
    while (bytes[end]) end++;
    return new TextDecoder().decode(bytes.subarray(0, end));
  };

  const edges = (options: IngestOptions) => ({
    measureEdge: options.measureEdge ?? 640,
    thumbEdge: options.thumbEdge ?? 320,
    thumbQuality: options.thumbQuality ?? 72,
    // Bit 1 reads faces, bit 2 forces libjpeg's streaming decoder.
    flags:
      ((options.faces ?? true) && ((wasm.celinen_ingest_faces_ready?.() ?? 0) & 1) === 1 ? 1 : 0) |
      (options.streamingDecode ? 2 : 0),
  });

  const loadMetadata = (container: Uint8Array | undefined) => {
    if (!container?.length || !wasm.celinen_ingest_metadata) return;
    // Copied before the photo is: allocating the photo may grow memory,
    // which detaches any view of it but never moves what was written.
    const metadataPointer = wasm.celinen_ingest_metadata(container.length);
    if (metadataPointer)
      new Uint8Array(wasm.memory.buffer, metadataPointer, container.length).set(container);
  };

  const loadInput = (bytes: Uint8Array) => {
    const pointer = wasm.celinen_ingest_input(bytes.length);
    if (!pointer) throw new Error(text(wasm.celinen_ingest_error()) || "This photo is too large.");
    new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
  };

  const readFaces = (): FaceReading[] | null => {
    if (!wasm.celinen_ingest_faces || !wasm.celinen_ingest_face_count) return null;
    const count = wasm.celinen_ingest_face_count();
    if (!count) return (wasm.celinen_ingest_faces_ready?.() ?? 0) & 1 ? [] : null;
    const v = new Float64Array(wasm.memory.buffer, wasm.celinen_ingest_faces(), count * FACE_FIELDS);
    return Array.from({ length: count }, (_, index) => {
      const at = index * FACE_FIELDS;
      const flags = v[at + 15]!;
      return {
        x: v[at]!,
        y: v[at + 1]!,
        width: v[at + 2]!,
        height: v[at + 3]!,
        score: v[at + 4]!,
        pixels: v[at + 5]!,
        sharpness: v[at + 6]!,
        closedProbability: v[at + 7]!,
        confidence: v[at + 8]!,
        blinkLeft: v[at + 9]!,
        blinkRight: v[at + 10]!,
        presence: v[at + 11]!,
        yaw: v[at + 12]!,
        pitch: v[at + 13]!,
        detail: v[at + 14]!,
        judged: (flags & 1) !== 0,
        primary: (flags & 2) !== 0,
        refined: (flags & 4) !== 0,
      };
    });
  };

  /** Everything the engine produced for the photo it just ran. */
  const collect = (): IngestResult => {
    const readingPointer = wasm.celinen_ingest_reading();
    if (!readingPointer) throw new Error("This photo could not be measured.");
    const reading = readingFromLayout(
      new Float64Array(wasm.memory.buffer, readingPointer, READING_FIELDS + COLOR_BYTES),
    );

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
    const damaged = wasm.celinen_ingest_damaged ? text(wasm.celinen_ingest_damaged()) : "";
    const focusPointer = wasm.celinen_ingest_focus?.() ?? 0;
    let afPoint: NormalizedRect | undefined;
    let afConfirmed: boolean | undefined;
    let focusHit: FocusHit | undefined;
    if (focusPointer) {
      const f = new Float64Array(wasm.memory.buffer, focusPointer, FOCUS_FIELDS);
      afPoint = { x: f[0]!, y: f[1]!, w: f[2]!, h: f[3]! };
      afConfirmed = f[4] === 1 ? true : f[4] === 0 ? false : undefined;
      focusHit = {
        hit: f[5]!,
        afAcuity: f[6]!,
        bestAcuity: f[7]!,
        bestRegion: { x: f[8]!, y: f[9]!, w: f[10]!, h: f[11]! },
        verdict: VERDICTS[f[12]!] ?? "unjudged",
      };
    }
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
      faces: readFaces(),
      frame: { width: frameWidth, height: frameHeight, rgba: pixels },
      ...(afPoint ? { afPoint, afConfirmed, focusHit } : {}),
      ...(damaged ? { damaged } : {}),
    };
  };

  const runPixels = wasm.celinen_ingest_run_pixels;
  return {
    read(bytes, options = {}, container) {
      const { measureEdge, thumbEdge, thumbQuality, flags } = edges(options);
      loadMetadata(container);
      loadInput(bytes);
      if (!wasm.celinen_ingest_run(bytes.length, measureEdge, thumbEdge, thumbQuality, flags))
        throw new Error(text(wasm.celinen_ingest_error()) || "This photo could not be read.");
      return collect();
    },
    ...(runPixels
      ? {
          readPixels(pixels: DecodedPixels, options: IngestOptions = {}, metadata?: Uint8Array) {
            const { measureEdge, thumbEdge, thumbQuality, flags } = edges(options);
            loadMetadata(metadata);
            loadInput(
              new Uint8Array(pixels.rgba.buffer, pixels.rgba.byteOffset, pixels.rgba.byteLength),
            );
            const ok = runPixels(
              pixels.width,
              pixels.height,
              pixels.sourceWidth,
              pixels.sourceHeight,
              measureEdge,
              thumbEdge,
              thumbQuality,
              flags,
            );
            if (!ok)
              throw new Error(text(wasm.celinen_ingest_error()) || "This photo could not be read.");
            return collect();
          },
        }
      : {}),
    raw: hasRawExports(wasm) ? rawApiFromExports(wasm) : null,
    loadFaceModels(files) {
      const room = wasm.celinen_ingest_model_input;
      const parse = wasm.celinen_ingest_load_model;
      if (!room || !parse) throw new Error("This cull engine cannot read faces.");
      MODEL_KINDS.forEach((kind, index) => {
        const bytes = new Uint8Array(files[kind]);
        const pointer = room(bytes.length);
        if (!pointer) throw new Error(text(wasm.celinen_ingest_error()) || "Face model too large.");
        new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
        if (!parse(index, bytes.length))
          throw new Error(text(wasm.celinen_ingest_error()) || `The ${kind} model could not be read.`);
      });
    },
    facesReady() {
      const ready = wasm.celinen_ingest_faces_ready?.() ?? 0;
      return { detect: (ready & 1) === 1, eyes: (ready & 2) === 2 };
    },
    release: () => wasm.celinen_ingest_release(),
  };
}
