/** Typed face of celinen-cull.wasm (native/wasm/cull_wasm.cpp): the C++ cull
 * engine. Environment-free, so the analysis worker, the page and the test suite
 * drive the same compiled binary.
 *
 * Frames cross as flat double arrays; the layout below mirrors the one in
 * cull_wasm.cpp and the two must change together.
 */

type Exports = {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  celinen_cull_error: () => number;
  celinen_cull_reading_size: () => number;
  celinen_cull_frame_size: () => number;
  celinen_cull_row_size: () => number;
  celinen_cull_source: (width: number, height: number) => number;
  celinen_cull_faces: (count: number) => number;
  celinen_cull_measure: (faceCount: number) => number;
  celinen_cull_judge_eyes: (
    faceCount: number,
    frameAspect: number,
    closedProbability: number,
    minConfidence: number,
    uncertainProbability: number,
    companionProminence: number,
  ) => number;
  celinen_cull_frames: (count: number) => number;
  celinen_cull_shoot: (
    count: number,
    keepBias: number,
    burstGapMs: number,
    hashTolerance: number,
  ) => number;
  celinen_cull_release: () => void;
};

/** Face evidence for one frame: the ingest pass's own detector and eye reader,
 * or, on older Studio paths, the browser's face detector. */
export type CullFace = {
  /** Normalized to the frame, 0..1. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Acuity at the eyes, 0..1; negative when it was not measured. */
  sharpness: number;
  /** A browser detector's open/closed guess; null when it gave none. */
  eyesOpen: boolean | null;
  /** Detector confidence 0..1. */
  score?: number | undefined;
  /** Probability the eyes are closed, 0..1; absent or negative when not judged. */
  closedProbability?: number | undefined;
  /** How far closedProbability can be trusted, 0..1. */
  confidence?: number | undefined;
};

/** The engine's decision about a frame's eyes. */
export type EyesState = "unknown" | "open" | "uncertain" | "closed";

/** When a closed call is trusted. Defaults are the engine's own (native/include/lenslabs/cull.hpp). */
export type EyeThresholds = {
  closedProbability: number;
  minConfidence: number;
  uncertainProbability: number;
  companionProminence: number;
};

export const DEFAULT_EYE_THRESHOLDS: Readonly<EyeThresholds> = {
  closedProbability: 0.55,
  minConfidence: 0.6,
  uncertainProbability: 0.4,
  companionProminence: 0.6,
};

/** One frame's measured evidence. Measurements, never judgments. */
export type CullReading = {
  /** Contrast-invariant focus over the subject, 0 (mush) .. 1 (crisp). */
  acuitySubject: number;
  /** The sharpest textured region anywhere; well above the subject means the focus missed. */
  acuityBest: number;
  texture: number;
  motion: number;
  /** Detail lost in one direction across the whole frame: shake, not defocus. */
  globalSmear: boolean;
  noise: number;
  brightness: number;
  subjectLuma: number;
  clippedHighlights: number;
  clippedShadows: number;
  subjectClipped: number;
  blackPoint: number;
  median: number;
  whitePoint: number;
  subjectX: number;
  subjectY: number;
  /** 64-bit perceptual hash as 16 hex characters. */
  hash: string;
  /** Laplacian variance, kept so saved sessions keep their existing field. */
  sharpness: number;
  /** 0..100 before the rest of the shoot is taken into account. */
  quality: number;
  hasFace: boolean;
  /** The primary subject's eyes are confidently closed. */
  eyesClosed: boolean;
  faceSoft: boolean;
  /** Normalized box of the measured face, when one was found. */
  faceBox?: { x: number; y: number; width: number; height: number };
  /** Camera AF area, same space as the working frame. */
  afBox?: { x: number; y: number; w: number; h: number };
  /** 4x4 grid of mean RGB. */
  color: Uint8Array;
  // Absent on readings saved before the engine read eyes.
  faceCount?: number | undefined;
  /** Possibly closed, not confidently: never rejected. */
  eyesUncertain?: boolean | undefined;
  /** The primary face's evidence; negative probability when its eyes were not judged. */
  eyesClosedProbability?: number | undefined;
  eyesConfidence?: number | undefined;
};

export type CullFrameInput = {
  reading: CullReading;
  /** Milliseconds; null when the file carried no capture time. */
  captureTimeMs?: number | null | undefined;
  /** What the photographer already chose, if anything. Never overruled, and a
   * frame they rejected is never the keeper its burst is judged against. */
  verdict?: CullVerdict;
  unreadable?: boolean;
};

export type CullVerdict = "undecided" | "keep" | "reject";
export type CullReason =
  | "none"
  | "out-of-focus"
  | "motion-blur"
  | "missed-focus"
  | "eyes-closed"
  | "exposure"
  | "duplicate"
  | "best-of-burst"
  | "strong-frame"
  | "eyes-uncertain";

export type CullRow = {
  verdict: CullVerdict;
  reason: CullReason;
  /** 1..99, calibrated against this shoot's own range. */
  score: number;
  /** Burst/duplicate group, null when the frame stands alone. */
  group: number | null;
  bestOfGroup: boolean;
  duplicate: boolean;
};

export type CullOptions = {
  /** 0.5 is neutral; higher keeps more. */
  keepBias?: number;
  burstGapMs?: number;
  hashTolerance?: number;
};

export type CullEngine = {
  /** Measures one decoded frame. The pixels are copied into the engine. */
  measure(
    rgba: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    faces?: readonly CullFace[],
  ): CullReading;
  /** Ranks and groups a whole shoot from measurements it already has. */
  shoot(frames: readonly CullFrameInput[], options?: CullOptions): CullRow[];
  /** The engine's eye rule for one frame's faces, at any thresholds. `primary`
   * indexes `faces`, -1 when there are none. */
  judgeEyes(
    faces: readonly CullFace[],
    frameAspect: number,
    thresholds?: Partial<EyeThresholds>,
  ): { state: EyesState; primary: number };
  /** Hands the retained frame and buffers back between shoots. */
  release(): void;
};

const VERDICTS: readonly CullVerdict[] = ["undecided", "keep", "reject"];
const REASONS: readonly CullReason[] = [
  "none",
  "out-of-focus",
  "motion-blur",
  "missed-focus",
  "eyes-closed",
  "exposure",
  "duplicate",
  "best-of-burst",
  "strong-frame",
  "eyes-uncertain",
];
const EYES_STATES: readonly EyesState[] = ["unknown", "open", "uncertain", "closed"];
export const READING_FIELDS = 27;
export const COLOR_BYTES = 48;
const FACE_DOUBLES = 9;
// The engine is pure computation; its only imports are the WASI stubs libc++
// links for a console it never opens, and answering ENOSYS is truthful.
const WASI_ENOSYS = 52;

function hex(high: number, low: number) {
  return (high >>> 0).toString(16).padStart(8, "0") + (low >>> 0).toString(16).padStart(8, "0");
}

/** One reading from the packed layout both engine modules write (cull_wasm.cpp
 * and ingest_wasm.cpp): READING_FIELDS doubles, then COLOR_BYTES. */
export function readingFromLayout(v: Float64Array): CullReading {
  return {
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
    faceCount: v[23]!,
    eyesUncertain: v[24] === 1,
    eyesClosedProbability: v[25]!,
    eyesConfidence: v[26]!,
    // Copied out: the next call reuses this memory, and growth detaches it.
    color: Uint8Array.from(v.subarray(READING_FIELDS, READING_FIELDS + COLOR_BYTES)),
  };
}

export async function instantiateCullWasm(
  binary: BufferSource | WebAssembly.Module,
): Promise<CullEngine> {
  const module = binary instanceof WebAssembly.Module ? binary : await WebAssembly.compile(binary);
  const imports: Record<string, Record<string, WebAssembly.ImportValue>> = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    if (entry.kind !== "function")
      throw new Error(`Cull engine needs an unexpected import: ${entry.module}.${entry.name}`);
    (imports[entry.module] ??= {})[entry.name] = () => WASI_ENOSYS;
  }
  const wasm = (await WebAssembly.instantiate(module, imports)).exports as unknown as Exports;
  wasm._initialize?.();

  const readingSize = wasm.celinen_cull_reading_size();
  const frameSize = wasm.celinen_cull_frame_size();
  const rowSize = wasm.celinen_cull_row_size();
  if (
    readingSize !== READING_FIELDS + COLOR_BYTES ||
    frameSize !== readingSize + 3 ||
    rowSize !== 6
  )
    throw new Error("The cull engine's frame layout does not match this build.");

  const failure = () => {
    const bytes = new Uint8Array(wasm.memory.buffer, wasm.celinen_cull_error());
    let end = 0;
    while (bytes[end]) end++;
    return new Error(new TextDecoder().decode(bytes.subarray(0, end)) || "Cull failed.");
  };

  const writeReading = (reading: CullReading, out: Float64Array, at: number) => {
    out[at] = reading.acuitySubject;
    out[at + 1] = reading.acuityBest;
    out[at + 2] = reading.texture;
    out[at + 3] = reading.motion;
    out[at + 4] = reading.globalSmear ? 1 : 0;
    out[at + 5] = reading.noise;
    out[at + 6] = reading.brightness;
    out[at + 7] = reading.subjectLuma;
    out[at + 8] = reading.clippedHighlights;
    out[at + 9] = reading.clippedShadows;
    out[at + 10] = reading.subjectClipped;
    out[at + 11] = reading.blackPoint;
    out[at + 12] = reading.median;
    out[at + 13] = reading.whitePoint;
    out[at + 14] = reading.subjectX;
    out[at + 15] = reading.subjectY;
    out[at + 16] = Number.parseInt(reading.hash.slice(0, 8), 16) || 0;
    out[at + 17] = Number.parseInt(reading.hash.slice(8, 16), 16) || 0;
    out[at + 18] = reading.sharpness;
    out[at + 19] = reading.quality;
    out[at + 20] = reading.hasFace ? 1 : 0;
    out[at + 21] = reading.eyesClosed ? 1 : 0;
    out[at + 22] = reading.faceSoft ? 1 : 0;
    out[at + 23] = reading.faceCount ?? (reading.hasFace ? 1 : 0);
    out[at + 24] = reading.eyesUncertain ? 1 : 0;
    out[at + 25] = reading.eyesClosedProbability ?? -1;
    out[at + 26] = reading.eyesConfidence ?? 0;
    for (let i = 0; i < COLOR_BYTES; i++) out[at + READING_FIELDS + i] = reading.color[i] ?? 0;
  };

  const writeFaces = (faces: readonly CullFace[]) => {
    const pointer = wasm.celinen_cull_faces(faces.length);
    if (!faces.length) return;
    if (!pointer) throw failure();
    const view = new Float64Array(wasm.memory.buffer, pointer, faces.length * FACE_DOUBLES);
    faces.forEach((face, index) => {
      view.set(
        [
          face.x,
          face.y,
          face.width,
          face.height,
          face.sharpness,
          face.eyesOpen === null ? -1 : face.eyesOpen ? 1 : 0,
          face.score ?? -1,
          face.closedProbability ?? -1,
          face.confidence ?? 0,
        ],
        index * FACE_DOUBLES,
      );
    });
  };

  return {
    measure(rgba, width, height, faces = []) {
      if (rgba.length !== width * height * 4) throw new Error("Cull received an incomplete frame.");
      const pointer = wasm.celinen_cull_source(width, height);
      if (!pointer) throw failure();
      new Uint8ClampedArray(wasm.memory.buffer, pointer, rgba.length).set(rgba);
      writeFaces(faces);
      const result = wasm.celinen_cull_measure(faces.length);
      if (!result) throw failure();
      const v = new Float64Array(wasm.memory.buffer, result, readingSize);
      return readingFromLayout(v);
    },
    shoot(frames, options = {}) {
      if (!frames.length) return [];
      const pointer = wasm.celinen_cull_frames(frames.length);
      if (!pointer) throw failure();
      const view = new Float64Array(wasm.memory.buffer, pointer, frames.length * frameSize);
      frames.forEach((frame, index) => {
        const at = index * frameSize;
        writeReading(frame.reading, view, at);
        view[at + readingSize] = frame.captureTimeMs ?? -1;
        view[at + readingSize + 1] = VERDICTS.indexOf(frame.verdict ?? "undecided");
        view[at + readingSize + 2] = frame.unreadable ? 1 : 0;
      });
      const result = wasm.celinen_cull_shoot(
        frames.length,
        options.keepBias ?? 0.5,
        options.burstGapMs ?? 2000,
        options.hashTolerance ?? 6,
      );
      if (!result) throw failure();
      const rows = new Int32Array(wasm.memory.buffer, result, frames.length * rowSize);
      return frames.map((_, index) => {
        const at = index * rowSize;
        return {
          verdict: VERDICTS[rows[at]!] ?? "undecided",
          reason: REASONS[rows[at + 1]!] ?? "none",
          score: rows[at + 2]!,
          group: rows[at + 3]! < 0 ? null : rows[at + 3]!,
          bestOfGroup: rows[at + 4] === 1,
          duplicate: rows[at + 5] === 1,
        };
      });
    },
    judgeEyes(faces, frameAspect, thresholds = {}) {
      const t = { ...DEFAULT_EYE_THRESHOLDS, ...thresholds };
      writeFaces(faces);
      const packed = wasm.celinen_cull_judge_eyes(
        faces.length,
        frameAspect,
        t.closedProbability,
        t.minConfidence,
        t.uncertainProbability,
        t.companionProminence,
      );
      if (packed < 0) throw failure();
      return { state: EYES_STATES[packed >> 8] ?? "unknown", primary: (packed & 255) - 1 };
    },
    release: () => wasm.celinen_cull_release(),
  };
}
