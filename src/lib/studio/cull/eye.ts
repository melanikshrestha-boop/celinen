/** On-device taste: what this photographer keeps, never the original pixels. */
import { workspaceStorageKey } from "@/lib/workspace-storage";
import type { CullReading, CullVerdict } from "./engine";

export type EyeSample = {
  keep: boolean;
  acuity: number;
  missed: number;
  luma: number;
  motion: number;
  face: number;
  x: number;
  y: number;
  texture: number;
  quality: number;
};

export type EyeMemory = {
  samples: EyeSample[];
};

const MAX = 400;
const KEY = "celinen.cull-eye.v1";

function clamp(value: number, lo = 0, hi = 1) {
  return Math.min(hi, Math.max(lo, value));
}

export function featuresFromReading(reading: CullReading): Omit<EyeSample, "keep"> {
  return {
    acuity: reading.acuitySubject,
    missed: Math.max(0, reading.acuityBest - reading.acuitySubject),
    luma: reading.subjectLuma / 255,
    motion: reading.motion,
    face: reading.hasFace ? 1 : 0,
    x: reading.subjectX,
    y: reading.subjectY,
    texture: reading.texture,
    quality: reading.quality / 100,
  };
}

export function loadEye(scope: string): EyeMemory {
  try {
    const raw = localStorage.getItem(workspaceStorageKey(KEY, scope));
    if (!raw) return { samples: [] };
    const parsed = JSON.parse(raw) as EyeMemory;
    if (!Array.isArray(parsed.samples)) return { samples: [] };
    return { samples: parsed.samples.slice(-MAX) };
  } catch {
    return { samples: [] };
  }
}

export function saveEye(scope: string, memory: EyeMemory) {
  try {
    localStorage.setItem(
      workspaceStorageKey(KEY, scope),
      JSON.stringify({ samples: memory.samples.slice(-MAX) }),
    );
  } catch {
    /* private mode */
  }
}

export function rememberDecision(
  memory: EyeMemory,
  reading: CullReading,
  verdict: CullVerdict,
): EyeMemory {
  if (verdict === "undecided") return memory;
  return {
    samples: [
      ...memory.samples,
      { ...featuresFromReading(reading), keep: verdict === "keep" },
    ].slice(-MAX),
  };
}

function mean(rows: EyeSample[], key: keyof Omit<EyeSample, "keep">) {
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + Number(row[key]), 0) / rows.length;
}

function dist(sample: Omit<EyeSample, "keep">, center: Omit<EyeSample, "keep">) {
  const keys: (keyof Omit<EyeSample, "keep">)[] = [
    "acuity",
    "missed",
    "luma",
    "motion",
    "face",
    "x",
    "y",
    "texture",
    "quality",
  ];
  let sum = 0;
  for (const key of keys) {
    const delta = sample[key] - center[key];
    const weight = key === "acuity" || key === "face" || key === "luma" ? 1.4 : 1;
    sum += delta * delta * weight;
  }
  return Math.sqrt(sum);
}

/** What this photographer tends to keep when there is not enough history yet.
 * Night portraits with a face are not "too dark." Max sharpness is not the art. */
export function artfulPrior(reading: CullReading): number {
  let score = 0.5;
  if (reading.hasFace) score += 0.16;
  else score -= 0.08;
  if (reading.eyesClosed) score -= 0.28;
  if (reading.globalSmear) score -= 0.14;
  const missed = reading.acuityBest - reading.acuitySubject;
  if (missed > 0.22) score -= 0.18;
  // A cinematic night frame (street fashion, tungsten) is often luma 40–110.
  if (reading.hasFace && reading.subjectLuma >= 32 && reading.subjectLuma <= 125) score += 0.12;
  if (reading.acuitySubject >= 0.32 && reading.acuitySubject < 0.55 && reading.hasFace) score += 0.08;
  if (reading.acuitySubject < 0.26) score -= 0.2;
  if (!reading.hasFace && reading.texture < 0.08) score -= 0.1;
  return clamp(score);
}

export function tasteKeep(reading: CullReading, memory: EyeMemory): number {
  const prior = artfulPrior(reading);
  const keeps = memory.samples.filter((row) => row.keep);
  const rejects = memory.samples.filter((row) => !row.keep);
  if (keeps.length < 4 || rejects.length < 4) return prior;
  const center = (rows: EyeSample[]): Omit<EyeSample, "keep"> => ({
    acuity: mean(rows, "acuity"),
    missed: mean(rows, "missed"),
    luma: mean(rows, "luma"),
    motion: mean(rows, "motion"),
    face: mean(rows, "face"),
    x: mean(rows, "x"),
    y: mean(rows, "y"),
    texture: mean(rows, "texture"),
    quality: mean(rows, "quality"),
  });
  const sample = featuresFromReading(reading);
  const towardKeep = dist(sample, center(rejects)) - dist(sample, center(keeps));
  const learned = clamp(0.5 + towardKeep * 0.55);
  return clamp(0.28 * prior + 0.72 * learned);
}

export function keepBiasFromEye(memory: EyeMemory): number {
  if (memory.samples.length < 8) return 0.55;
  const rate = memory.samples.filter((row) => row.keep).length / memory.samples.length;
  return clamp(0.32 + rate * 0.4, 0.28, 0.78);
}

export function applyTaste(reading: CullReading, memory: EyeMemory): CullReading {
  const keep = tasteKeep(reading, memory);
  return {
    ...reading,
    quality: Math.min(100, Math.max(0, reading.quality * (0.38 + 0.62 * keep))),
  };
}
