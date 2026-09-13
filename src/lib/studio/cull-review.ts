import type { Shot } from "@/lib/imaging";
import type { StudioFilter } from "./session";

export type CullDot = "review" | "keep" | "reject" | "pending";

const REVIEW_REASONS = {
  blur: "Possible blur",
  soft: "Check focus",
  "face-soft": "Check face focus",
  "eyes-closed": "Check eyes",
  duplicate: "Similar frame",
  overexposed: "Check highlights",
} as const;

/** Review signals, not aesthetic scores or a claim that faces/expressions were checked. */
export function cullReview(
  shot: Pick<Shot, "verdict" | "error" | "hash" | "score" | "flags" | "develop">,
): {
  dot: CullDot;
  label: string;
} {
  // Preserve saved photographer/import decisions, including earlier automatic suggestions.
  // They have no provenance field, so never describe every reject as an automatic rejection.
  if (shot.verdict === "keep") return { dot: "keep", label: "Kept" };
  if (shot.verdict === "reject") return { dot: "reject", label: "Rejected" };
  if (shot.error) return { dot: "review", label: "Source needs attention" };
  if (shot.develop?.label?.toLowerCase() === "red")
    return { dot: "review", label: "Marked for review" };
  if (!shot.hash || !Number.isFinite(shot.score) || shot.score < 0 || shot.score > 100)
    return { dot: "pending", label: "Analysis pending" };
  const reasons = shot.flags.flatMap((flag) =>
    flag in REVIEW_REASONS ? [REVIEW_REASONS[flag as keyof typeof REVIEW_REASONS]] : [],
  );
  if (reasons.length) return { dot: "review", label: reasons.join(" · ") };
  // Deliberate low-key light is not a flaw, even if it lowered the mechanical score.
  if (shot.score < 70 && !shot.flags.includes("underexposed"))
    return { dot: "review", label: "Check this frame" };
  return { dot: "pending", label: "Not yet picked" };
}

export function filterCullFrames(shots: readonly Shot[], filter: StudioFilter): Shot[] {
  switch (filter) {
    case "flagged":
      return shots.filter((shot) => cullReview(shot).dot === "review");
    case "keepers":
      return shots.filter((shot) => shot.verdict === "keep");
    case "rejected":
      return shots.filter((shot) => shot.verdict === "reject");
    case "todo":
      return shots.filter((shot) => shot.verdict === "undecided");
    default:
      return [...shots];
  }
}

/** Advance in the displayed queue only. At its end, do not wrap into other photos. */
export function nextCullReviewId(
  shots: readonly Pick<Shot, "id">[],
  selectedId: string,
): string | null {
  const index = shots.findIndex((shot) => shot.id === selectedId);
  return index < 0 ? null : (shots[index + 1]?.id ?? null);
}
