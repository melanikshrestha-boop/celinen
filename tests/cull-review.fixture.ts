import type { CullReading, CullRow } from "../src/lib/studio/cull/engine";
import type { CullFrame } from "../src/lib/studio/cull/session";

export function cullReading(overrides: Partial<CullReading> = {}): CullReading {
  return {
    acuitySubject: 0.7,
    acuityBest: 0.72,
    texture: 0.3,
    motion: 0.05,
    globalSmear: false,
    noise: 0.02,
    brightness: 120,
    subjectLuma: 128,
    clippedHighlights: 0,
    clippedShadows: 0,
    subjectClipped: 0,
    blackPoint: 4,
    median: 120,
    whitePoint: 250,
    subjectX: 0.5,
    subjectY: 0.5,
    hash: "0123456789abcdef",
    sharpness: 300,
    quality: 80,
    hasFace: true,
    eyesClosed: false,
    faceSoft: false,
    color: new Uint8Array(48),
    ...overrides,
  };
}

export function cullRow(overrides: Partial<CullRow> = {}): CullRow {
  return {
    verdict: "keep",
    reason: "strong-frame",
    score: 80,
    group: null,
    bestOfGroup: false,
    duplicate: false,
    ...overrides,
  };
}

export function cullFrame(
  id: string,
  suggestion?: Partial<CullRow> | null,
  extra: Partial<CullFrame> = {},
): CullFrame {
  return {
    id,
    name: `${id}.NEF`,
    width: 6048,
    height: 4024,
    bytes: 25_000_000,
    captureTimeMs: null,
    reading: cullReading(),
    ...(suggestion === null ? {} : { suggestion: cullRow(suggestion) }),
    verdict: "undecided",
    decided: false,
    ...extra,
  };
}

/**
 * A small game: two bursts and four singles, every filter represented.
 *   burst 1 (b1-*): best keep + 3 duplicates rejected
 *   burst 2 (b2-*): best keep + 1 duplicate rejected
 *   s-focus  engine reject, out of focus
 *   s-motion engine reject, motion blur
 *   s-eyes   engine reject, eyes closed — the photographer kept it anyway
 *   s-open   no suggestion yet
 */
export function smallGame(): CullFrame[] {
  return [
    cullFrame("b1-best", { group: 1, bestOfGroup: true, reason: "best-of-burst", score: 91 }),
    cullFrame("b1-2", {
      group: 1,
      duplicate: true,
      verdict: "reject",
      reason: "duplicate",
      score: 70,
    }),
    cullFrame("b1-3", {
      group: 1,
      duplicate: true,
      verdict: "reject",
      reason: "duplicate",
      score: 64,
    }),
    cullFrame("b1-4", {
      group: 1,
      duplicate: true,
      verdict: "reject",
      reason: "duplicate",
      score: 60,
    }),
    cullFrame("b2-best", { group: 2, bestOfGroup: true, reason: "best-of-burst", score: 88 }),
    cullFrame("b2-2", {
      group: 2,
      duplicate: true,
      verdict: "reject",
      reason: "duplicate",
      score: 71,
    }),
    cullFrame("s-focus", { verdict: "reject", reason: "out-of-focus", score: 12 }),
    cullFrame("s-motion", { verdict: "reject", reason: "motion-blur", score: 18 }),
    cullFrame(
      "s-eyes",
      { verdict: "reject", reason: "eyes-closed", score: 30 },
      { verdict: "keep", decided: true },
    ),
    cullFrame("s-open", null),
  ];
}

/** A full sports card: `count` frames, none grouped, so every frame is a cell. */
export function sportsCard(count: number): CullFrame[] {
  return Array.from({ length: count }, (_, index) =>
    cullFrame(
      `f${index}`,
      index % 3 === 0 ? { verdict: "reject", reason: "motion-blur", score: 20 } : { score: 75 },
    ),
  );
}
