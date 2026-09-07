import type { Shot, Verdict } from "../imaging";

/** XMP permits -1 (rejected), or a real rating from 0 (unrated) through 5. */
export function validReviewRating(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    (value === -1 || (value >= 0 && value <= 5))
  );
}

/** Explicit photographer flags take precedence over the existing star-based import fallback. */
export function importedReviewVerdict(
  metadata: { pick?: number | null; rating?: number | null } | null,
  fallback: Verdict = "undecided",
): Verdict {
  if (metadata?.pick === -1) return "reject";
  if (metadata?.pick === 1) return "keep";
  if (validReviewRating(metadata?.rating)) {
    if (metadata.rating === -1) return "reject";
    if (metadata.rating >= 3) return "keep";
  }
  return fallback;
}

/** A machine quality score is not a photographer's star rating. Never convert one to the other. */
export function exportedReviewMetadata(shot: Pick<Shot, "develop" | "verdict">) {
  const previous = shot.develop?.rating;
  // Rejection travels as the pick flag; Lightroom's catalog rating field accepts stars, not -1.
  const rating = validReviewRating(previous) && previous >= 0 ? previous : 0;
  const label = shot.develop?.label;
  return {
    rating,
    label:
      typeof label === "string"
        ? label
        : label === null
          ? null
          : shot.verdict === "keep"
            ? "Green"
            : shot.verdict === "reject"
              ? "Red"
              : null,
  };
}
