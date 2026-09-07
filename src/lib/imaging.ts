/**
 * LensLabs imaging core.
 * Runs entirely in the browser: decode, analyse, score, edit, export.
 */
import { validReviewRating } from "./studio/review-metadata";

export const RAW_EXTENSIONS = [
  "nef",
  "cr2",
  "cr3",
  "arw",
  "dng",
  "raf",
  "orf",
  "rw2",
  "pef",
  "srw",
  "raw",
];

export type Verdict = "keep" | "reject" | "undecided";

export type Flag =
  "soft" | "blur" | "underexposed" | "overexposed" | "duplicate" | "face-soft" | "eyes-closed";

export interface Edits {
  exposure: number; // -100..100
  contrast: number; // -100..100
  temp: number; // -100..100
  saturation: number; // -100..100
  highlights: number; // -100..100
  shadows: number; // -100..100
  crop: "orig" | "1:1" | "4:5" | "3:2" | "16:9";
}

export const DEFAULT_EDITS: Edits = {
  exposure: 0,
  contrast: 0,
  temp: 0,
  saturation: 0,
  highlights: 0,
  shadows: 0,
  crop: "orig",
};

export interface Shot {
  id: string;
  file: File;
  name: string;
  /** Stable path used to reconcile the same source after a reload/re-import. */
  relativePath?: string;
  /** Native EXIF evidence. Never synthesized from a file's modification time. */
  captureTimeMs?: number | undefined;
  captureTimeBasis?: "utc" | "camera_clock" | undefined;
  cameraKey?: string | undefined;
  analysisBackend?: "native-cpp" | "worker" | "main-thread" | undefined;
  isRaw: boolean;
  previewUrl: string | null;
  /** Small local preview. Named projects may also retain an explicitly saved original copy. */
  previewBlob?: Blob | undefined;
  /** False when a restored project needs its original folder reconnected. */
  sourceAvailable?: boolean | undefined;
  width: number;
  height: number;
  sizeMb: number;
  sharpness: number;
  brightness: number;
  clippedHighlights: number;
  clippedShadows: number;
  hash: string;
  /** measured tone statistics — feeds Auto Refine */
  tone?: ToneStats | undefined;
  score: number;
  flags: Flag[];
  verdict: Verdict;
  edits: Edits;
  faces?: FaceReading | undefined;
  /** Where this frame's develop state came from. */
  develop?:
    | {
        origin: "lightroom" | "sidecar" | "lens os";
        at: number;
        rating?: number | undefined;
        label?: string | null | undefined;
        caption?: string | undefined;
        cropped?: boolean | undefined;
        processVersion?: string | undefined;
      }
    | undefined;
  error?: string;
}

export function extension(name: string) {
  const parts = name.split(".");
  return parts.length > 1 ? parts[parts.length - 1]!.toLowerCase() : "";
}

export function isRawFile(file: File) {
  return RAW_EXTENSIONS.includes(extension(file.name));
}

/** RAW files embed a full-size JPEG preview. Pull out the largest one. */
async function extractEmbeddedJpeg(file: File): Promise<Blob | null> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let best: { start: number; end: number } | null = null;
  for (let i = 0; i < buf.length - 3; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
      for (let j = i + 2; j < buf.length - 1; j++) {
        if (buf[j] === 0xff && buf[j + 1] === 0xd9) {
          const len = j + 2 - i;
          if (!best || len > best.end - best.start) best = { start: i, end: j + 2 };
          i = j + 1;
          break;
        }
      }
    }
  }
  if (!best || best.end - best.start < 4096) return null;
  return new Blob([buf.slice(best.start, best.end)], { type: "image/jpeg" });
}

type OrientationTag = { value: number; offset: number; little: boolean };

function tiffOrientationTags(buf: Uint8Array, start = 0): OrientationTag[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (start + 8 > buf.length) return [];
  const order = view.getUint16(start, false);
  if (order !== 0x4949 && order !== 0x4d4d) return [];
  const little = order === 0x4949;
  // TIFF-based RAW containers can use a different magic with this same IFD layout.
  const ifd = start + view.getUint32(start + 4, little);
  if (ifd < start + 8 || ifd + 2 > buf.length) return [];
  const entries = view.getUint16(ifd, little);
  const tags: OrientationTag[] = [];
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > buf.length) break;
    if (
      view.getUint16(entry, little) === 0x0112 &&
      view.getUint16(entry + 2, little) === 3 &&
      view.getUint32(entry + 4, little) === 1
    ) {
      const value = view.getUint16(entry + 8, little);
      tags.push({ value: value >= 1 && value <= 8 ? value : 1, offset: entry + 8, little });
    }
  }
  return tags;
}

function isExif(buf: Uint8Array, offset: number): boolean {
  return [0x45, 0x78, 0x69, 0x66, 0, 0].every((byte, i) => buf[offset + i] === byte);
}

/** Read EXIF orientation (1-8) from JPEG/TIFF bytes; absent/unreadable means 1. */
export function readExifOrientation(buf: Uint8Array): number {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return tiffOrientationTags(buf)[0]?.value ?? 1;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let offset = 2; offset + 4 <= buf.length;) {
    if (buf[offset] !== 0xff) break;
    const marker = buf[offset + 1]!;
    if (marker === 0xff) {
      offset++;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break;
    const size = view.getUint16(offset + 2, false);
    if (size < 2 || offset + 2 + size > buf.length) break;
    if (marker === 0xe1 && isExif(buf, offset + 4)) {
      const tag = tiffOrientationTags(buf.subarray(offset + 10, offset + 2 + size))[0];
      if (tag) return tag.value;
    }
    offset += 2 + size;
  }
  return 1;
}

/** Neutralize only orientation tags in a temporary decode blob, never the source file.
 * Some browsers ignore imageOrientation:"none". Metadata-free orientation makes
 * manual transforms deterministic, including mirrored and square photographs.
 */
async function orientationDecodeSource(file: Blob) {
  const prefix = await headerBytes(file, 64 * 1024);
  const tags: OrientationTag[] = [];
  if (prefix[0] === 0xff && prefix[1] === 0xd8) {
    // Read only metadata segments, including EXIF following large ICC/XMP blocks.
    for (let offset = 2; offset + 4 <= file.size;) {
      const header =
        offset + 4 <= prefix.length
          ? prefix.subarray(offset, offset + 4)
          : new Uint8Array(await file.slice(offset, offset + 4).arrayBuffer());
      if (header[0] !== 0xff) break;
      const marker = header[1]!;
      if (marker === 0xff) {
        offset++;
        continue;
      }
      if (marker === 0xda || marker === 0xd9) break;
      const size = (header[2]! << 8) | header[3]!;
      if (size < 2 || offset + 2 + size > file.size) break;
      if (marker === 0xe1) {
        const segment =
          offset + 2 + size <= prefix.length
            ? prefix.subarray(offset + 4, offset + 2 + size)
            : new Uint8Array(await file.slice(offset + 4, offset + 2 + size).arrayBuffer());
        if (isExif(segment, 0))
          tags.push(
            ...tiffOrientationTags(segment, 6).map((tag) => ({
              ...tag,
              offset: offset + 4 + tag.offset,
            })),
          );
      }
      offset += 2 + size;
    }
  } else {
    // A TIFF/RAW IFD can live well beyond the first header block. Read that
    // directory only (at most 65,535 entries), never allocate up to its offset.
    const order = prefix.length >= 8 ? new DataView(prefix.buffer).getUint16(0) : 0;
    if (order === 0x4949 || order === 0x4d4d) {
      const little = order === 0x4949;
      const ifd = new DataView(prefix.buffer).getUint32(4, little);
      if (ifd >= 8 && ifd + 2 <= file.size) {
        const countBytes =
          ifd + 2 <= prefix.length
            ? prefix.subarray(ifd, ifd + 2)
            : new Uint8Array(await file.slice(ifd, ifd + 2).arrayBuffer());
        const count = new DataView(countBytes.buffer, countBytes.byteOffset, 2).getUint16(
          0,
          little,
        );
        const end = Math.min(file.size, ifd + 2 + count * 12);
        if (end <= prefix.length) tags.push(...tiffOrientationTags(prefix));
        else {
          const directory = new Uint8Array(await file.slice(ifd, end).arrayBuffer());
          const compact = new Uint8Array(8 + directory.length);
          compact.set(prefix.subarray(0, 8));
          new DataView(compact.buffer).setUint32(4, 8, little);
          compact.set(directory, 8);
          tags.push(
            ...tiffOrientationTags(compact).map((tag) => ({
              ...tag,
              offset: tag.offset + ifd - 8,
            })),
          );
        }
      }
    }
  }
  if (!tags.length) return { blob: file, orientation: null };
  const parts: BlobPart[] = [];
  let cursor = 0;
  for (const tag of tags) {
    parts.push(file.slice(cursor, tag.offset), new Uint8Array(tag.little ? [1, 0] : [0, 1]));
    cursor = tag.offset + 2;
  }
  parts.push(file.slice(cursor));
  return { blob: new Blob(parts, { type: file.type }), orientation: tags[0]!.value };
}

/** Bake an EXIF orientation into pixels so every downstream step sees it upright. */
async function applyOrientation(bitmap: ImageBitmap, orientation: number): Promise<ImageBitmap> {
  if (orientation <= 1) return bitmap;
  const swap = orientation >= 5;
  const w = swap ? bitmap.height : bitmap.width;
  const h = swap ? bitmap.width : bitmap.height;
  const { canvas, ctx } = scratchCanvas(w, h);

  switch (orientation) {
    case 2:
      ctx.transform(-1, 0, 0, 1, w, 0);
      break;
    case 3:
      ctx.transform(-1, 0, 0, -1, w, h);
      break;
    case 4:
      ctx.transform(1, 0, 0, -1, 0, h);
      break;
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      ctx.transform(0, 1, -1, 0, w, 0);
      break;
    case 7:
      ctx.transform(0, -1, -1, 0, w, h);
      break;
    case 8:
      ctx.transform(0, -1, 1, 0, 0, h);
      break;
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return createImageBitmap(canvas);
}

/** EXIF lives in the first blocks of the file — never read the whole thing for it. */
async function headerBytes(file: Blob, bytes = 256 * 1024) {
  return new Uint8Array(await file.slice(0, bytes).arrayBuffer());
}

/**
 * Decode a frame. `maxEdge` decodes straight to a smaller bitmap, which is what
 * makes culling fast: analysis never needs 45 megapixels.
 */
async function shrink(bitmap: ImageBitmap, maxEdge?: number): Promise<ImageBitmap> {
  if (!maxEdge) return bitmap;
  const s = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  if (s >= 1) return bitmap;
  const w = Math.max(1, Math.round(bitmap.width * s));
  const h = Math.max(1, Math.round(bitmap.height * s));
  const small = await createImageBitmap(bitmap, {
    resizeWidth: w,
    resizeHeight: h,
    resizeQuality: "low",
  });
  bitmap.close?.();
  return small;
}

export async function decodeFile(file: File, maxEdge?: number): Promise<ImageBitmap> {
  if (isRawFile(file)) {
    const jpeg = await extractEmbeddedJpeg(file);
    if (!jpeg) throw new Error("No embedded preview found in this RAW file");
    const source = await orientationDecodeSource(jpeg);
    // An explicit upright preview must not inherit the container's rotation.
    const orientation =
      source.orientation ?? (await orientationDecodeSource(file)).orientation ?? 1;
    const bitmap = await createImageBitmap(source.blob, { imageOrientation: "from-image" });
    return applyOrientation(await shrink(bitmap, maxEdge), orientation);
  }

  const source = await orientationDecodeSource(file);
  const bitmap = await createImageBitmap(source.blob, { imageOrientation: "from-image" });
  return applyOrientation(await shrink(bitmap, maxEdge), source.orientation ?? 1);
}

function scratchCanvas(w: number, h: number) {
  // The worker uses the same drawing/measurement code without touching the DOM.
  if (typeof document === "undefined") {
    if (typeof OffscreenCanvas === "undefined") {
      throw new Error("This browser does not support offscreen image analysis.");
    }
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Could not create an image analysis canvas.");
    return { canvas, ctx };
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not create an image analysis canvas.");
  return { canvas, ctx };
}

export interface FaceReading {
  /** number of faces the browser detector found */
  count: number;
  /** laplacian variance measured inside the largest face box */
  faceSharpness: number;
  /** null when the browser reported no eye landmarks */
  eyesOpen: boolean | null;
  /** normalised (0-1) centre of the largest face — used to bias smart crops */
  center?: { x: number; y: number } | undefined;
}

/** Tone statistics used by Auto Refine (Lightroom's "Auto" equivalent). */
export interface ToneStats {
  /** 2nd percentile luma — the real black point */
  black: number;
  /** 98th percentile luma — the real white point */
  white: number;
  /** median luma */
  median: number;
  rMean: number;
  gMean: number;
  bMean: number;
  /** mean HSL-ish saturation, 0..1 */
  satMean: number;
}

export interface Analysis {
  sharpness: number;
  faces?: FaceReading | null;
  brightness: number;
  clippedHighlights: number;
  clippedShadows: number;
  hash: string;
  tone: ToneStats;
}

export interface FileAnalysisPreview {
  width: number;
  height: number;
  analysis: Analysis;
  previewBlob: Blob;
  faceDetectionAvailable: boolean;
}

/** Shared worker/fallback pipeline. The original file is never uploaded or modified. */
export async function analyseFilePreview(file: File): Promise<FileAnalysisPreview> {
  const bitmap = await decodeFile(file, 1280);
  try {
    const analysis = analyseBitmap(bitmap);
    analysis.faces = await analyseFaces(bitmap);
    const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
    const { canvas, ctx } = scratchCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    );
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const previewBlob =
      "convertToBlob" in canvas
        ? await canvas.convertToBlob({ type: "image/jpeg", quality: 0.72 })
        : await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
              (blob) => {
                if (blob) resolve(blob);
                else reject(new Error("Could not create the photo preview."));
              },
              "image/jpeg",
              0.72,
            );
          });
    return {
      width: bitmap.width,
      height: bitmap.height,
      analysis,
      previewBlob,
      faceDetectionAvailable: faceDetectionAvailable(),
    };
  } finally {
    bitmap.close();
  }
}

/** Laplacian variance for focus, histogram stats for exposure, aHash for dupes. */
export function analyseBitmap(bitmap: ImageBitmap): Analysis {
  const side = 256;
  const scale = Math.min(side / bitmap.width, side / bitmap.height);
  const w = Math.max(8, Math.round(bitmap.width * scale));
  const h = Math.max(8, Math.round(bitmap.height * scale));
  const { ctx } = scratchCanvas(w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const gray = new Float32Array(w * h);
  const hist = new Uint32Array(256);
  let sum = 0;
  let clipHi = 0;
  let clipLo = 0;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let satSum = 0;
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4]!;
    const gc = data[i * 4 + 1]!;
    const b = data[i * 4 + 2]!;
    const g = 0.299 * r + 0.587 * gc + 0.114 * b;
    gray[i] = g;
    hist[Math.min(255, Math.max(0, Math.round(g)))]!++;
    sum += g;
    rSum += r;
    gSum += gc;
    bSum += b;
    const mx = Math.max(r, gc, b);
    const mn = Math.min(r, gc, b);
    satSum += mx === 0 ? 0 : (mx - mn) / mx;
    if (g > 250) clipHi++;
    if (g < 5) clipLo++;
  }
  const n = w * h;
  const brightness = sum / n;

  const percentile = (p: number) => {
    const want = p * n;
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v]!;
      if (acc >= want) return v;
    }
    return 255;
  };
  const tone: ToneStats = {
    black: percentile(0.02),
    white: percentile(0.98),
    median: Math.max(1, percentile(0.5)),
    rMean: rSum / n,
    gMean: gSum / n,
    bMean: bSum / n,
    satMean: satSum / n,
  };

  let lapSum = 0;
  let lapSq = 0;
  let count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - w]! - gray[i + w]!;
      lapSum += v;
      lapSq += v * v;
      count++;
    }
  }
  const mean = lapSum / count;
  const sharpness = lapSq / count - mean * mean;

  // 8x8 average hash
  const { ctx: hctx } = scratchCanvas(8, 8);
  hctx.drawImage(bitmap, 0, 0, 8, 8);
  const hd = hctx.getImageData(0, 0, 8, 8).data;
  const vals: number[] = [];
  for (let i = 0; i < 64; i++) {
    vals.push(0.299 * hd[i * 4]! + 0.587 * hd[i * 4 + 1]! + 0.114 * hd[i * 4 + 2]!);
  }
  const avg = vals.reduce((a, b) => a + b, 0) / 64;
  const hash = vals.map((v) => (v >= avg ? "1" : "0")).join("");

  return {
    sharpness,
    brightness,
    clippedHighlights: (clipHi / (w * h)) * 100,
    clippedShadows: (clipLo / (w * h)) * 100,
    hash,
    tone,
  };
}

/**
 * Auto Refine — the LensLabs answer to Lightroom's Auto button.
 * Everything below is derived from the frame's own measured histogram:
 * exposure targets a mid-grey median, highlights/shadows recover the real
 * clipping points, contrast fills the tonal range, temp neutralises a colour
 * cast (grey-world), saturation nudges flat frames back to life.
 */
export function autoRefine(tone: ToneStats, base: Edits = DEFAULT_EDITS): Edits {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const round = (v: number) => Math.round(v);

  // exposure: pull the median toward 118 (mid grey), gently
  const gain = 118 / tone.median;
  const exposure = clamp((gain - 1) * 70, -55, 55);
  const g = 1 + exposure / 100;

  const whiteAfter = tone.white * g;
  const blackAfter = tone.black * g;

  // highlights: recover anything that would blow out after the exposure move
  const highlights = whiteAfter > 242 ? -clamp((whiteAfter - 242) * 2.2, 0, 70) : 0;
  // shadows: open crushed blacks, but keep some depth
  const shadows = blackAfter < 14 ? clamp((14 - blackAfter) * 3.2, 0, 60) : 0;

  // contrast: fill the range when the frame is flat, ease off when it is harsh
  const spread = whiteAfter - blackAfter;
  const contrast =
    spread < 170 ? clamp((170 - spread) * 0.22, 0, 32) : clamp((spread - 235) * -0.5, -18, 0);

  // white balance: grey-world cast correction (blue cast -> warm up)
  const temp = clamp((tone.bMean - tone.rMean) * 1.5, -45, 45);

  // saturation: bring flat frames up, pull back anything already loud
  const saturation = clamp((0.24 - tone.satMean) * 150, -18, 30);

  return {
    ...base,
    exposure: round(exposure),
    contrast: round(contrast),
    temp: round(temp),
    saturation: round(saturation),
    highlights: round(highlights),
    shadows: round(shadows),
  };
}

export function hamming(a: string, b: string) {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++;
  return d;
}

type DupeCandidate = {
  hash: string;
  faces?: FaceReading | null | undefined;
};

/**
 * Two frames only count as duplicates when the pixels AND the subject match.
 * Near-identical frames where one has closed eyes (or a clearly softer face)
 * are different moments, not dupes — that is exactly the pair you must keep.
 */
export function isDuplicatePair(a: DupeCandidate, b: DupeCandidate, tolerance = 5): boolean {
  if (!a.hash || !b.hash) return false;
  if (hamming(a.hash, b.hash) > tolerance) return false;

  const fa = a.faces;
  const fb = b.faces;
  if (fa && fb && fa.count > 0 && fb.count > 0) {
    // eyes open in one, closed in the other -> keep both
    if (fa.eyesOpen !== null && fb.eyesOpen !== null && fa.eyesOpen !== fb.eyesOpen) return false;
    // one frame's face is meaningfully sharper -> keep both, they aren't interchangeable
    const top = Math.max(fa.faceSharpness, fb.faceSharpness);
    if (top > 0 && Math.abs(fa.faceSharpness - fb.faceSharpness) / top > 0.35) return false;
  }
  return true;
}

/* ---------------- faces + eyes ---------------- */

type DetectedFace = {
  boundingBox: { x: number; y: number; width: number; height: number };
  landmarks?: { type: string; locations: { x: number; y: number }[] }[];
};

let detector: { detect: (s: CanvasImageSource) => Promise<DetectedFace[]> } | null | undefined;

function getDetector() {
  if (detector !== undefined) return detector;
  const Ctor = (globalThis as unknown as { FaceDetector?: new (o: object) => never }).FaceDetector;
  try {
    detector = Ctor
      ? (new Ctor({ fastMode: true, maxDetectedFaces: 12 }) as unknown as {
          detect: (s: CanvasImageSource) => Promise<DetectedFace[]>;
        })
      : null;
  } catch {
    detector = null;
  }
  return detector;
}

export function faceDetectionAvailable() {
  return getDetector() !== null;
}

function lapVariance(data: Uint8ClampedArray, w: number, h: number) {
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
  }
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - w]! - gray[i + w]!;
      sum += v;
      sq += v * v;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sq / n - mean * mean;
}

/**
 * Real measurement, no invention: uses the browser FaceDetector when the
 * engine ships one. Face sharpness is a laplacian variance inside the face
 * box; eye state is the local contrast around each reported eye landmark
 * (an open eye contains a dark iris against a bright sclera, a closed lid
 * is flat). Returns null when the browser has no detector.
 */
export async function analyseFaces(bitmap: ImageBitmap): Promise<FaceReading | null> {
  const det = getDetector();
  if (!det) return null;
  let faces: DetectedFace[] = [];
  try {
    faces = await det.detect(bitmap);
  } catch {
    return null;
  }
  if (!faces.length) return { count: 0, faceSharpness: 0, eyesOpen: null, center: undefined };

  const biggest = faces.reduce((a, b) =>
    a.boundingBox.width * a.boundingBox.height >= b.boundingBox.width * b.boundingBox.height
      ? a
      : b,
  );
  const box = biggest.boundingBox;
  const bw = Math.max(8, Math.round(box.width));
  const bh = Math.max(8, Math.round(box.height));
  const { ctx } = scratchCanvas(bw, bh);
  ctx.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, bw, bh);
  const faceData = ctx.getImageData(0, 0, bw, bh).data;
  const faceSharpness = lapVariance(faceData, bw, bh);

  const eyes = (biggest.landmarks ?? []).filter((l) => l.type === "eye");
  let eyesOpen: boolean | null = null;
  if (eyes.length) {
    const patch = Math.max(6, Math.round(box.width * 0.16));
    let openCount = 0;
    for (const eye of eyes) {
      const pt = eye.locations[0];
      if (!pt) continue;
      const { ctx: ectx } = scratchCanvas(patch, patch);
      ectx.drawImage(bitmap, pt.x - patch / 2, pt.y - patch / 2, patch, patch, 0, 0, patch, patch);
      const d = ectx.getImageData(0, 0, patch, patch).data;
      let min = 255;
      let max = 0;
      for (let i = 0; i < patch * patch; i++) {
        const g = 0.299 * d[i * 4]! + 0.587 * d[i * 4 + 1]! + 0.114 * d[i * 4 + 2]!;
        if (g < min) min = g;
        if (g > max) max = g;
      }
      if (max - min > 60) openCount++;
    }
    eyesOpen = openCount === eyes.length;
  }
  const center = {
    x: (box.x + box.width / 2) / bitmap.width,
    // biased slightly up so the crop keeps headroom, not chin
    y: (box.y + box.height * 0.42) / bitmap.height,
  };
  return { count: faces.length, faceSharpness, eyesOpen, center };
}

export function scoreOf(a: Analysis): { score: number; flags: Flag[] } {
  const flags: Flag[] = [];
  // Sharpness typically 0 (mush) .. 900+ (crisp)
  const focus = Math.max(0, Math.min(1, Math.log10(1 + a.sharpness) / 2.9));
  if (a.sharpness < 40) flags.push("blur");
  else if (a.sharpness < 130) flags.push("soft");

  let exposure = 1;
  if (a.brightness < 55) {
    exposure = Math.max(0.2, a.brightness / 55);
    flags.push("underexposed");
  } else if (a.brightness > 200 || a.clippedHighlights > 12) {
    exposure = 0.55;
    flags.push("overexposed");
  }
  if (a.clippedShadows > 25) exposure *= 0.8;

  let base = focus * 0.72 + exposure * 0.28;

  const f = a.faces;
  if (f && f.count > 0) {
    // When there is a subject, the face is what has to be sharp.
    const faceFocus = Math.max(0, Math.min(1, Math.log10(1 + f.faceSharpness) / 2.9));
    base = base * 0.45 + (faceFocus * 0.72 + exposure * 0.28) * 0.55;
    if (f.faceSharpness < 90) flags.push("face-soft");
    if (f.eyesOpen === false) {
      flags.push("eyes-closed");
      base *= 0.6;
    }
  }

  const score = Math.round(Math.max(1, Math.min(99, base * 100)));
  return { score, flags };
}

/* ---------------- editing ---------------- */

const CROPS: Record<Edits["crop"], number | null> = {
  orig: null,
  "1:1": 1,
  "4:5": 4 / 5,
  "3:2": 3 / 2,
  "16:9": 16 / 9,
};

/**
 * Aspect-ratio crop. When `focus` (normalised 0-1 subject point, usually the
 * detected face) is supplied the window slides toward the subject instead of
 * cutting dead centre.
 */
export function cropRect(
  w: number,
  h: number,
  crop: Edits["crop"],
  focus?: { x: number; y: number } | null,
) {
  const target = CROPS[crop];
  if (!target) return { sx: 0, sy: 0, sw: w, sh: h };
  const current = w / h;
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));
  if (current > target) {
    const sw = Math.round(h * target);
    const want = focus ? focus.x * w - sw / 2 : (w - sw) / 2;
    return { sx: clamp(want, w - sw), sy: 0, sw, sh: h };
  }
  const sh = Math.round(w / target);
  const want = focus ? focus.y * h - sh / 2 : (h - sh) / 2;
  return { sx: 0, sy: clamp(want, h - sh), sw: w, sh };
}

function applyPixels(data: Uint8ClampedArray, e: Edits) {
  const exposure = 1 + e.exposure / 100;
  const contrast = 1 + e.contrast / 100;
  const sat = 1 + e.saturation / 100;
  const warm = e.temp / 100;
  const hi = e.highlights / 100;
  const sh = e.shadows / 100;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]! * exposure;
    let g = data[i + 1]! * exposure;
    let b = data[i + 2]! * exposure;

    // white balance
    r += warm * 26;
    b -= warm * 26;

    // contrast around mid grey
    r = (r - 128) * contrast + 128;
    g = (g - 128) * contrast + 128;
    b = (b - 128) * contrast + 128;

    // tone regions
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (hi !== 0) {
      const wgt = Math.max(0, (lum - 128) / 127);
      const amt = hi * 70 * wgt;
      r += amt;
      g += amt;
      b += amt;
    }
    if (sh !== 0) {
      const wgt = Math.max(0, (128 - lum) / 128);
      const amt = sh * 70 * wgt;
      r += amt;
      g += amt;
      b += amt;
    }

    // saturation
    const l2 = 0.299 * r + 0.587 * g + 0.114 * b;
    r = l2 + (r - l2) * sat;
    g = l2 + (g - l2) * sat;
    b = l2 + (b - l2) * sat;

    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

export function renderToCanvas(
  canvas: HTMLCanvasElement,
  bitmap: ImageBitmap,
  edits: Edits,
  maxSide = 1400,
  focus?: { x: number; y: number } | null,
) {
  const { sx, sy, sw, sh } = cropRect(bitmap.width, bitmap.height, edits.crop, focus);
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  applyPixels(img.data, edits);
  ctx.putImageData(img, 0, 0);
}

export async function exportShot(
  bitmap: ImageBitmap,
  edits: Edits,
  name: string,
  focus?: { x: number; y: number } | null,
) {
  const canvas = document.createElement("canvas");
  renderToCanvas(canvas, bitmap, edits, 4000, focus);
  const blob: Blob | null = await new Promise((res) =>
    canvas.toBlob((b) => res(b), "image/jpeg", 0.92),
  );
  if (!blob) throw new Error("Could not render the JPEG export.");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/\.[^.]+$/, "")}_lensos.jpg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function histogram(canvas: HTMLCanvasElement): number[] {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || !canvas.width) return new Array(32).fill(0);
  const step = Math.max(1, Math.floor(canvas.width / 200));
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const bins = new Array(32).fill(0);
  for (let i = 0; i < data.length; i += 4 * step) {
    const l = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    bins[Math.min(31, Math.floor((l / 256) * 32))]++;
  }
  const max = Math.max(...bins, 1);
  return bins.map((b) => b / max);
}

/* ---------------- Lightroom sidecar sync ---------------- */

export interface SidecarSettings {
  edits: Partial<Edits>;
  rating: number | null;
  /** Lightroom pick flag: 1 = flagged/pick, -1 = rejected */
  pick: number | null;
  /** Preserve user-defined labels independently of LensLabs keep/reject decisions. */
  label?: string;
}

/** Read the canonical Adobe scalar forms without evaluating entities or fetching any resources. */
function sidecarValue(xml: string, key: string): string | undefined {
  const clean = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const attr = new RegExp(`(?:^|\\s)${key}\\s*=\\s*(["'])([\\s\\S]*?)\\1`).exec(clean);
  return attr?.[2] ?? new RegExp(`<${key}\\s*>([^<]*)</${key}\\s*>`).exec(clean)?.[1];
}

function sidecarNumber(raw: string | undefined): number | null {
  if (raw === undefined || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function decodeSidecarText(raw: string): string {
  return raw.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (named[entity]) return named[entity];
    const code = entity.startsWith("#x") ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 32 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff)
      ? String.fromCodePoint(code)
      : match;
  });
}

function encodeSidecarText(value: string): string {
  return value.replace(
    /[&<>"'\t\r\n]/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
        "\t": "&#9;",
        "\r": "&#13;",
        "\n": "&#10;",
      })[char]!,
  );
}

function num(xml: string, key: string): number | null {
  const attr = new RegExp(`crs:${key}="([+-]?[0-9.]+)"`).exec(xml);
  const tag = new RegExp(`<crs:${key}>([+-]?[0-9.]+)</crs:${key}>`).exec(xml);
  const raw = attr?.[1] ?? tag?.[1];
  return raw === undefined ? null : Number(raw);
}

/** Parse a Lightroom .xmp sidecar into LensLabs edit values. */
export function parseXmpSidecar(xml: string): SidecarSettings {
  const edits: Partial<Edits> = {};
  const exposure = num(xml, "Exposure2012");
  if (exposure !== null) edits.exposure = Math.max(-100, Math.min(100, exposure * 20));
  const contrast = num(xml, "Contrast2012");
  if (contrast !== null) edits.contrast = contrast;
  const highlights = num(xml, "Highlights2012");
  if (highlights !== null) edits.highlights = highlights;
  const shadows = num(xml, "Shadows2012");
  if (shadows !== null) edits.shadows = shadows;
  const sat = num(xml, "Saturation");
  if (sat !== null) edits.saturation = sat;
  const temp = num(xml, "Temperature");
  if (temp !== null) {
    // Lightroom stores kelvin; 5500K is neutral for LensLabs.
    edits.temp = Math.max(-100, Math.min(100, ((temp - 5500) / 4500) * 100));
  }

  const rating = sidecarNumber(sidecarValue(xml, "xmp:Rating"));
  const pick = sidecarNumber(sidecarValue(xml, "crs:Pick"));
  const label = sidecarValue(xml, "xmp:Label");
  return {
    edits,
    rating: validReviewRating(rating) ? rating : null,
    pick: pick === -1 || pick === 0 || pick === 1 ? pick : null,
    ...(label !== undefined ? { label: decodeSidecarText(label) } : {}),
  };
}

/** Write a Lightroom-readable .xmp sidecar from LensLabs edits. */
export function buildXmpSidecar(
  edits: Edits,
  verdict: Verdict,
  rating: number,
  label?: string | null,
) {
  const kelvin = Math.round(5500 + (edits.temp / 100) * 4500);
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    xmp:Rating="${validReviewRating(rating) && rating >= 0 ? rating : 0}"
    ${typeof label === "string" ? `xmp:Label="${encodeSidecarText(label)}"` : ""}
    crs:Pick="${verdict === "keep" ? 1 : verdict === "reject" ? -1 : 0}"
    crs:Exposure2012="${(edits.exposure / 20).toFixed(2)}"
    crs:Contrast2012="${Math.round(edits.contrast)}"
    crs:Highlights2012="${Math.round(edits.highlights)}"
    crs:Shadows2012="${Math.round(edits.shadows)}"
    crs:Saturation="${Math.round(edits.saturation)}"
    crs:Temperature="${kelvin}"
    crs:ProcessVersion="11.0"/>
 </rdf:RDF>
</x:xmpmeta>`;
}

export function baseName(name: string) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}
