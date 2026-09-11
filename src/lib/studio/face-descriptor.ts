/**
 * Local 512-d face descriptor when an InsightFace recognizer is not loaded.
 * Same dimensionality as ArcFace so the C++ clusterer can consume either source.
 * This is not buffalo_l quality and is labeled source: "local-descriptor".
 */
import { INSIGHTFACE_EMBEDDING_DIM, type FaceObservation } from "./insightface";

const CELL = 8;
const BINS = 8;
const ALIGN = 112;

export type DetectedBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  eyes?: { x: number; y: number }[] | undefined;
};

function luminance(data: Uint8ClampedArray, index: number): number {
  return 0.299 * data[index]! + 0.587 * data[index + 1]! + 0.114 * data[index + 2]!;
}

/** 8×8 cells × 8 orientation bins = 512, matching InsightFace embedding width. */
export function hogDescriptor(data: Uint8ClampedArray, width: number, height: number): number[] {
  const cellW = Math.max(1, width / CELL);
  const cellH = Math.max(1, height / CELL);
  const bins = new Array<number>(INSIGHTFACE_EMBEDDING_DIM).fill(0);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      const gx = luminance(data, i + 4) - luminance(data, i - 4);
      const gy = luminance(data, (y + 1) * width * 4 + x * 4) - luminance(data, (y - 1) * width * 4 + x * 4);
      const mag = Math.hypot(gx, gy);
      if (mag < 1e-6) continue;
      let angle = Math.atan2(gy, gx);
      if (angle < 0) angle += Math.PI;
      const bin = Math.min(BINS - 1, Math.floor((angle / Math.PI) * BINS));
      const cx = Math.min(CELL - 1, Math.floor(x / cellW));
      const cy = Math.min(CELL - 1, Math.floor(y / cellH));
      bins[(cy * CELL + cx) * BINS + bin]! += mag;
    }
  }
  let norm = 0;
  for (const value of bins) norm += value * value;
  if (norm < 1e-12) return bins;
  const scale = 1 / Math.sqrt(norm);
  return bins.map((value) => value * scale);
}

function cropAligned(
  bitmap: ImageBitmap,
  box: DetectedBox,
): { data: Uint8ClampedArray; width: number; height: number } | null {
  const canvas = document.createElement("canvas");
  canvas.width = ALIGN;
  canvas.height = ALIGN;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const pad = Math.max(box.width, box.height) * 0.18;
  const sx = Math.max(0, box.x - pad);
  const sy = Math.max(0, box.y - pad);
  const sw = Math.min(bitmap.width - sx, box.width + pad * 2);
  const sh = Math.min(bitmap.height - sy, box.height + pad * 2);
  if (sw < 8 || sh < 8) return null;
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, ALIGN, ALIGN);
  const image = ctx.getImageData(0, 0, ALIGN, ALIGN);
  return { data: image.data, width: ALIGN, height: ALIGN };
}

export function descriptorFromBox(bitmap: ImageBitmap, box: DetectedBox): number[] | null {
  const crop = cropAligned(bitmap, box);
  if (!crop) return null;
  const values = hogDescriptor(crop.data, crop.width, crop.height);
  const energy = values.reduce((sum, value) => sum + Math.abs(value), 0);
  return energy < 1e-6 ? null : values;
}

type FaceDetectorLike = {
  detect(image: ImageBitmap): Promise<
    {
      boundingBox: { x: number; y: number; width: number; height: number };
      landmarks?: { type: string; locations: { x: number; y: number }[] }[];
    }[]
  >;
};

function getDetector(): FaceDetectorLike | null {
  const Ctor = (
    globalThis as typeof globalThis & {
      FaceDetector?: new (options: { fastMode: boolean; maxDetectedFaces: number }) => FaceDetectorLike;
    }
  ).FaceDetector;
  if (!Ctor) return null;
  try {
    return new Ctor({ fastMode: false, maxDetectedFaces: 32 });
  } catch {
    return null;
  }
}

export async function observationsFromBitmap(
  bitmap: ImageBitmap,
  frameId: string,
): Promise<FaceObservation[]> {
  const detector = getDetector();
  if (!detector) return [];
  let faces: Awaited<ReturnType<FaceDetectorLike["detect"]>> = [];
  try {
    faces = await detector.detect(bitmap);
  } catch {
    return [];
  }
  const observations: FaceObservation[] = [];
  for (let i = 0; i < faces.length; i++) {
    const face = faces[i]!;
    const eyes = (face.landmarks ?? [])
      .filter((landmark) => landmark.type === "eye")
      .flatMap((landmark) => landmark.locations.slice(0, 1));
    const embedding = descriptorFromBox(bitmap, { ...face.boundingBox, eyes });
    if (!embedding) continue;
    observations.push({
      id: `${frameId}:face:${i}`,
      frameId,
      source: "local-descriptor",
      detScore: 0.5,
      embedding,
    });
  }
  return observations;
}

export async function observationsFromPreviewUrl(
  previewUrl: string,
  frameId: string,
): Promise<FaceObservation[]> {
  const response = await fetch(previewUrl);
  if (!response.ok) return [];
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    return await observationsFromBitmap(bitmap, frameId);
  } finally {
    bitmap.close();
  }
}
