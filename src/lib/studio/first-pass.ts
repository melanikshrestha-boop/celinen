import type { Shot, Verdict } from "@/lib/imaging";

export interface FirstPassThresholds {
  /** Legacy configuration boundary; retained/validated, never authorizes rejection. */
  rejectBelow: number;
  keepAt: number;
}

export const DEFAULT_FIRST_PASS_THRESHOLDS: Readonly<FirstPassThresholds> = Object.freeze({
  rejectBelow: 45,
  keepAt: 70,
});

export type FirstPassFrame = Pick<Shot, "verdict" | "error" | "score" | "flags" | "develop">;

/** Preview diagnostics route to review; they cannot establish a bad photograph. */
export function firstPassVerdict(
  shot: FirstPassFrame,
  thresholds: Readonly<FirstPassThresholds> = DEFAULT_FIRST_PASS_THRESHOLDS,
): Verdict {
  // No provenance field distinguishes human/imported/earlier decisions here.
  // Protect every existing keep/reject instead of assuming it is safe to overwrite.
  if (shot.verdict !== "undecided") return shot.verdict;
  if (shot.error !== undefined) return "undecided";

  const { rejectBelow, keepAt } = thresholds;
  if (
    !Number.isFinite(rejectBelow) ||
    !Number.isFinite(keepAt) ||
    rejectBelow < 0 ||
    keepAt > 100 ||
    rejectBelow > keepAt
  )
    throw new RangeError("First-pass thresholds must satisfy 0 ≤ rejectBelow ≤ keepAt ≤ 100.");

  // A saved manual/XMP red label is an explicit review hold, not a quality score.
  // Only a photographer's Keep/Reject decision above can resolve that hold.
  if (shot.develop?.label?.toLowerCase() === "red") return "undecided";

  // An unreadable or incomplete analysis is not evidence that a photo is bad.
  if (!Number.isFinite(shot.score) || shot.score < 0 || shot.score > 100) return "undecided";
  if (
    shot.flags.includes("blur") ||
    shot.flags.includes("soft") ||
    shot.flags.includes("face-soft") ||
    shot.flags.includes("duplicate") ||
    shot.flags.includes("eyes-closed") ||
    shot.flags.includes("overexposed")
  )
    return "undecided";
  // Underexposure alone is not a defect. Low score also remains reviewable,
  // regardless of the backwards-compatible rejectBelow configuration value.
  return shot.score >= keepAt ? "keep" : "undecided";
}
