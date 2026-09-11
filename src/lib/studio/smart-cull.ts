import type { Verdict } from "@/lib/imaging";
import {
  firstPassVerdict,
  type FirstPassFrame,
  type FirstPassThresholds,
} from "@/lib/studio/first-pass";

export type SmartCullFrame = FirstPassFrame & { id: string };

export type BurstHint = {
  frameIds: readonly string[];
  recommendedId: string;
};

function rank(frame: SmartCullFrame): number {
  let score = Number.isFinite(frame.score) ? frame.score : 0;
  if (frame.flags.includes("eyes-closed")) score -= 40;
  if (frame.flags.includes("blur")) score -= 50;
  if (frame.flags.includes("face-soft")) score -= 15;
  if (frame.flags.includes("soft")) score -= 8;
  if (frame.flags.includes("underexposed") || frame.flags.includes("overexposed")) score -= 10;
  return score;
}

function pickBurstKeeper(frames: readonly SmartCullFrame[], recommendedId: string): string | undefined {
  const open = frames.filter((frame) => !frame.error && frame.verdict === "undecided");
  if (!open.length) return undefined;
  const recommended = open.find((frame) => frame.id === recommendedId);
  if (
    recommended &&
    !recommended.flags.includes("eyes-closed") &&
    !recommended.flags.includes("blur")
  )
    return recommended.id;
  return [...open].sort((a, b) => rank(b) - rank(a))[0]?.id;
}

/**
 * Suggest keep/reject for undecided frames only.
 * Blur, blinks, dups, and weak scores first; then one keeper per burst.
 * Existing photographer decisions are never overwritten.
 */
export function smartCullPass(
  frames: readonly SmartCullFrame[],
  bursts: readonly BurstHint[] = [],
  thresholds?: FirstPassThresholds,
): Map<string, Verdict> {
  const next = new Map<string, Verdict>();
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  for (const frame of frames) next.set(frame.id, firstPassVerdict(frame, thresholds));

  for (const burst of bursts) {
    const open = burst.frameIds
      .map((id) => byId.get(id))
      .filter((frame): frame is SmartCullFrame => {
        if (!frame || frame.error || frame.verdict !== "undecided") return false;
        const suggested = next.get(frame.id);
        return suggested === "keep" || suggested === "undecided";
      });
    if (open.length < 2) continue;
    const keeper = pickBurstKeeper(open, burst.recommendedId);
    if (!keeper) continue;
    next.set(keeper, "keep");
    for (const frame of open) if (frame.id !== keeper) next.set(frame.id, "reject");
  }
  return next;
}
