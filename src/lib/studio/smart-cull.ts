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

/**
 * Preserve strong candidates and route uncertain diagnostics to manual review.
 * Burst hints remain accepted for caller compatibility, but neither a preferred
 * hash neighbor nor its peers establish optical blur or the best sporting action.
 * They cannot promote uncertain frames or reject the other frames in a sequence.
 */
export function smartCullPass(
  frames: readonly SmartCullFrame[],
  _bursts: readonly BurstHint[] = [],
  thresholds?: FirstPassThresholds,
): Map<string, Verdict> {
  const next = new Map<string, Verdict>();
  for (const frame of frames) next.set(frame.id, firstPassVerdict(frame, thresholds));
  return next;
}
