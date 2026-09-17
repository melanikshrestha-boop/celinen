/** The shoot-level pass: hands every frame the C++ engine measured back to it,
 * so bursts, duplicates and the keep/reject line are decided by comparing the
 * frames with each other rather than against fixed thresholds.
 */
import type { Shot, Verdict } from "@/lib/imaging";
import { cullEngine } from "./client";
import type { CullOptions, CullReason, CullRow } from "./engine";

export type CullSuggestion = {
  verdict: Verdict;
  /** Why, in the engine's own words. Empty when it made no suggestion. */
  reason: CullReason;
  /** 1..99, calibrated against this shoot. */
  score: number;
  /** Burst or near-duplicate group; null when the frame stands alone. */
  group: number | null;
  bestOfGroup: boolean;
  duplicate: boolean;
};

type Candidate = Pick<Shot, "id" | "cull" | "verdict" | "error" | "captureTimeMs">;

/**
 * Null when the engine is unavailable or no frame in this shoot carries its
 * measurements — the caller then keeps the existing browser pass. Frames
 * without a measurement are left out of the result entirely rather than being
 * judged on evidence that was never taken.
 */
export async function cullShootSuggestions(
  frames: readonly Candidate[],
  options: CullOptions = {},
): Promise<Map<string, CullSuggestion> | null> {
  const measured = frames.filter((frame) => frame.cull && !frame.error);
  if (!measured.length) return null;
  const engine = await cullEngine();
  if (!engine) return null;

  let rows: CullRow[];
  try {
    rows = engine.shoot(
      measured.map((frame) => ({
        reading: frame.cull!,
        captureTimeMs: frame.captureTimeMs ?? null,
        verdict: frame.verdict,
      })),
      options,
    );
  } catch {
    // A failed pass leaves the shoot exactly as the photographer left it.
    return null;
  }

  const suggestions = new Map<string, CullSuggestion>();
  rows.forEach((row, index) => {
    const frame = measured[index];
    if (!frame) return;
    suggestions.set(frame.id, {
      verdict: row.verdict,
      reason: row.reason,
      score: row.score,
      group: row.group,
      bestOfGroup: row.bestOfGroup,
      duplicate: row.duplicate,
    });
  });
  return suggestions;
}
