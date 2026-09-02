/**
 * LensLabs imaging core.
 * Runs entirely in the browser: decode, analyse, score, edit, export.
 */

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
  | "soft"
  | "blur"
  | "underexposed"
  | "overexposed"
  | "duplicate"
  | "face-soft"
  | "eyes-closed";

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
  isRaw: boolean;
  previewUrl: string | null;
  width: number;
  height: number;
  sizeMb: number;
  sharpness: number;
  brightness: number;
  clippedHighlights: number;
  clippedShadows: number;
  hash: string;
  score: number;
  flags: Flag[];
  verdict: Verdict;
  edits: Edits;
  faces?: FaceReading | undefined;
  /** Where this frame's develop state came from. */
  develop?: {
    origin: "lightroom" | "sidecar" | "lens os";
    at: number;
    rating?: number | undefined;
    label?: string | null | undefined;
    caption?: string | undefined;
    cropped?: boolean | undefined;
    processVersion?: string | undefined;
  } | undefined;
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

/**
 * Read the EXIF orientation flag (1-8) out of a JPEG/TIFF byte buffer.
 * Returns 1 (normal) when absent or unreadable.
 */
export function readExifOrientation(buf: Uint8Array): number {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let tiffStart = -1;

  if (buf[0] === 0xff && buf[1] === 0xd8) {
    // JPEG: walk the marker segments looking for APP1/Exif
    let offset = 2;
    while (offset + 4 < buf.length) {
      if (buf[offset] !== 0xff) break;
      const marker = buf[offset + 1]!;
      const size = view.getUint16(offset + 2, false);
      if (marker === 0xe1) {
        // "Exif\0\0"
        if (
          buf[offset + 4] === 0x45 &&
          buf[offset + 5] === 0x78 &&
          buf[offset + 6] === 0x69 &&
          buf[offset + 7] === 0x66
        ) {
          tiffStart = offset + 10;
        }
        break;
      }
      if (marker === 0xda) break; // start of scan
      offset += 2 + size;
    }
  } else if (
    (buf[0] === 0x49 && buf[1] === 0x49) ||
    (buf[0] === 0x4d && buf[1] === 0x4d)
  ) {
    tiffStart = 0; // bare TIFF (most RAW containers)
  }

  if (tiffStart < 0 || tiffStart + 8 > buf.length) return 1;

  const little = view.getUint16(tiffStart, false) === 0x4949;
  const ifdOffset = view.getUint32(tiffStart + 4, little);
  const ifd = tiffStart + ifdOffset;
  if (ifd + 2 > buf.length) return 1;

  const entries = view.getUint16(ifd, little);
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > buf.length) break;
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** Bake an EXIF orientation into pixels so every downstream step sees it upright. */
async function applyOrientation(bitmap: ImageBitmap, orientation: number): Promise<ImageBitmap> {
  if (orientation <= 1) return bitmap;
  const swap = orientation >= 5;
  const w = swap ? bitmap.height : bitmap.width;
  const h = swap ? bitmap.width : bitmap.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;
    case 3: ctx.transform(-1, 0, 0, -1, w, h); break;
    case 4: ctx.transform(1, 0, 0, -1, 0, h); break;
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.transform(0, 1, -1, 0, w, 0); break;
    case 7: ctx.transform(0, -1, -1, 0, w, h); break;
    case 8: ctx.transform(0, -1, 1, 0, 0, h); break;
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return createImageBitmap(canvas);
}

export async function decodeFile(file: File): Promise<ImageBitmap> {
  if (isRawFile(file)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const jpeg = await extractEmbeddedJpeg(file);
    if (!jpeg) throw new Error("No embedded preview found in this RAW file");
    const jpegBytes = new Uint8Array(await jpeg.arrayBuffer());
    let orientation = readExifOrientation(jpegBytes);
    // Most RAW previews carry no EXIF of their own — fall back to the container's.
    if (orientation === 1) orientation = readExifOrientation(bytes);
    const bitmap = await createImageBitmap(jpeg, { imageOrientation: "none" });
    return applyOrientation(bitmap, orientation);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const orientation = readExifOrientation(bytes);
  const bitmap = await createImageBitmap(file, { imageOrientation: "none" });
  return applyOrientation(bitmap, orientation);
}


function scratchCanvas(w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
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

export interface Analysis {
  sharpness: number;
  faces?: FaceReading | null;
  brightness: number;
  clippedHighlights: number;
  clippedShadows: number;
  hash: string;
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
  let sum = 0;
  let clipHi = 0;
  let clipLo = 0;
  for (let i = 0; i < w * h; i++) {
    const g = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
    gray[i] = g;
    sum += g;
    if (g > 250) clipHi++;
    if (g < 5) clipLo++;
  }
  const brightness = sum / (w * h);

  let lapSum = 0;
  let lapSq = 0;
  let count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v =
        4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - w]! - gray[i + w]!;
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
  };
}

export function hamming(a: string, b: string) {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++;
  return d;
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
  detector = Ctor
    ? (new Ctor({ fastMode: true, maxDetectedFaces: 12 }) as unknown as {
        detect: (s: CanvasImageSource) => Promise<DetectedFace[]>;
      })
    : null;
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
    a.boundingBox.width * a.boundingBox.height >= b.boundingBox.width * b.boundingBox.height ? a : b,
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
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/\.[^.]+$/, "")}_lensos.jpg`;
  a.click();
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

  const ratingRaw =
    /xmp:Rating="(-?\d+)"/.exec(xml)?.[1] ?? /<xmp:Rating>(-?\d+)<\/xmp:Rating>/.exec(xml)?.[1];
  const pickRaw = /crs:Pick="(-?\d+)"/.exec(xml)?.[1];
  return {
    edits,
    rating: ratingRaw === undefined ? null : Number(ratingRaw),
    pick: pickRaw === undefined ? null : Number(pickRaw),
  };
}

/** Write a Lightroom-readable .xmp sidecar from LensLabs edits. */
export function buildXmpSidecar(edits: Edits, verdict: Verdict, rating: number) {
  const kelvin = Math.round(5500 + (edits.temp / 100) * 4500);
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    xmp:Rating="${rating}"
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
