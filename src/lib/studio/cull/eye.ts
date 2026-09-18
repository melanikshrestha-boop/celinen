/** On-device taste: what this photographer keeps, never the original pixels. */
import { workspaceStorageKey } from "@/lib/workspace-storage";
import type { CullReading, CullVerdict } from "./engine";
import { readingHasFace } from "./portrait-face";

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
  warmth: number;
};

export type EyeMemory = {
  samples: EyeSample[];
};

const MAX = 400;
const KEY = "celinen.cull-eye.v1";

function clamp(value: number, lo = 0, hi = 1) {
  return Math.min(hi, Math.max(lo, value));
}

function num(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Mean red-minus-blue of the 4×4 grid: tungsten night is warm, open shade is cool. */
export function warmthOf(reading: CullReading): number {
  const color = reading.color;
  if (!color?.length) return 0;
  let r = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i + 2 < color.length; i += 3) {
    r += color[i]!;
    b += color[i + 2]!;
    n++;
  }
  return n ? clamp((r - b) / 255, -1, 1) : 0;
}

export function featuresFromReading(reading: CullReading): Omit<EyeSample, "keep"> {
  return {
    acuity: reading.acuitySubject,
    missed: Math.max(0, reading.acuityBest - reading.acuitySubject),
    luma: reading.subjectLuma / 255,
    motion: reading.motion,
    face: readingHasFace(reading) ? 1 : 0,
    x: reading.subjectX,
    y: reading.subjectY,
    texture: reading.texture,
    quality: reading.quality / 100,
    warmth: warmthOf(reading),
  };
}

function parseSample(row: unknown): EyeSample | null {
  if (!row || typeof row !== "object") return null;
  const sample = row as Record<string, unknown>;
  if (typeof sample.keep !== "boolean") return null;
  return {
    keep: sample.keep,
    acuity: num(sample.acuity),
    missed: num(sample.missed),
    luma: num(sample.luma),
    motion: num(sample.motion),
    face: num(sample.face),
    x: num(sample.x, 0.5),
    y: num(sample.y, 0.5),
    texture: num(sample.texture),
    quality: num(sample.quality),
    warmth: num(sample.warmth),
  };
}

export function loadEye(scope: string): EyeMemory {
  try {
    const raw = localStorage.getItem(workspaceStorageKey(KEY, scope));
    if (!raw) return { samples: [] };
    const parsed = JSON.parse(raw) as { samples?: unknown };
    if (!Array.isArray(parsed.samples)) return { samples: [] };
    const samples: EyeSample[] = [];
    for (const row of parsed.samples) {
      const sample = parseSample(row);
      if (sample) samples.push(sample);
    }
    return { samples: samples.slice(-MAX) };
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
    samples: [...memory.samples, { ...featuresFromReading(reading), keep: verdict === "keep" }].slice(
      -MAX,
    ),
  };
}

type SceneContext = "night-portrait" | "day-portrait" | "scene";

export function sceneContext(sample: Pick<EyeSample, "face" | "luma" | "warmth">): SceneContext {
  if (sample.face >= 0.5 && sample.luma < 0.48) return "night-portrait";
  if (sample.face >= 0.5) return "day-portrait";
  return "scene";
}

function dist(sample: Omit<EyeSample, "keep">, other: Omit<EyeSample, "keep">) {
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
    "warmth",
  ];
  let sum = 0;
  for (const key of keys) {
    const delta = sample[key] - other[key];
    const weight =
      key === "luma" || key === "face" || key === "warmth"
        ? 1.8
        : key === "acuity" || key === "missed"
          ? 1.2
          : 0.85;
    sum += delta * delta * weight;
  }
  return Math.sqrt(sum);
}

/** What this photographer tends to keep when there is not enough history yet.
 * Night portraits with a face are not "too dark." Max sharpness is not the art. */
export function artfulPrior(reading: CullReading): number {
  const faced = readingHasFace(reading);
  let score = 0.5;
  if (faced) score += 0.18;
  else score -= 0.1;
  if (reading.eyesClosed) score -= 0.28;
  if (reading.globalSmear) score -= 0.14;
  const missed = reading.acuityBest - reading.acuitySubject;
  if (missed > 0.22) score -= 0.18;
  else if (faced && missed > 0.08) score += 0.05;
  if (faced && reading.subjectLuma >= 22 && reading.subjectLuma <= 130) score += 0.14;
  if (faced && reading.acuitySubject >= 0.28 && reading.acuitySubject < 0.58) score += 0.08;
  if (!faced && reading.acuitySubject < 0.26) score -= 0.2;
  if (!faced && reading.texture < 0.08) score -= 0.1;
  const dx = Math.abs(reading.subjectX - 0.5);
  if (faced && dx > 0.08 && dx < 0.3) score += 0.04;
  return clamp(score);
}

function knnKeep(sample: Omit<EyeSample, "keep">, memory: EyeMemory): number | null {
  const keeps = memory.samples.filter((row) => row.keep);
  const rejects = memory.samples.filter((row) => !row.keep);
  if (keeps.length < 2 || rejects.length < 2) return null;
  const ctx = sceneContext(sample);
  const same = memory.samples.filter((row) => sceneContext(row) === ctx);
  const pool = same.length >= 3 ? same : memory.samples;
  const k = Math.min(7, pool.length);
  const nearest = pool
    .map((row) => ({ row, d: dist(sample, row) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k);
  let keepW = 0;
  let w = 0;
  for (const { row, d } of nearest) {
    const sameCtx = sceneContext(row) === ctx ? 1.7 : 1;
    const ww = (sameCtx / (0.07 + d)) * (row.keep ? 1 : 1);
    w += ww;
    if (row.keep) keepW += ww;
  }
  return w ? clamp(keepW / w) : null;
}

export function tasteKeep(reading: CullReading, memory: EyeMemory): number {
  const prior = artfulPrior(reading);
  const learned = knnKeep(featuresFromReading(reading), memory);
  if (learned === null) return prior;
  const n = memory.samples.length;
  const trust = clamp((n - 3) / 18, 0.45, 0.84);
  return clamp((1 - trust) * prior + trust * learned);
}

export function keepBiasFromEye(memory: EyeMemory): number {
  if (memory.samples.length < 6) return 0.55;
  const rate = memory.samples.filter((row) => row.keep).length / memory.samples.length;
  return clamp(0.32 + rate * 0.4, 0.28, 0.78);
}

/** Rank the way a photographer does: a face in tungsten light beats a sharp empty wall. */
export function photographerQuality(reading: CullReading, keep: number): number {
  const faced = readingHasFace(reading);
  let q = reading.acuitySubject * 100;
  if (faced) q += 10;
  else q -= 8;
  if (reading.eyesClosed) q *= 0.45;
  if (reading.globalSmear) q *= 0.84;
  const missed = reading.acuityBest - reading.acuitySubject;
  if (missed > 0.22) q *= 0.72;
  else if (faced && missed > 0.08) q += 4;
  const luma = reading.subjectLuma;
  if (faced) {
    if (luma < 16) q *= 0.88;
    else if (luma <= 125) q += 7;
    if (luma > 242) q *= 0.7;
  } else {
    if (luma < 42) q *= 0.66;
    if (luma > 225) q *= 0.72;
    if (reading.texture < 0.08) q *= 0.75;
  }
  const dx = Math.abs(reading.subjectX - 0.5);
  if (faced && dx > 0.08 && dx < 0.3) q += 3;
  q *= 0.3 + 0.7 * keep;
  return Math.min(99, Math.max(1, q));
}

export function applyTaste(reading: CullReading, memory: EyeMemory): CullReading {
  const keep = tasteKeep(reading, memory);
  return {
    ...reading,
    quality: photographerQuality(reading, keep),
  };
}
