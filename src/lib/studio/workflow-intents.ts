/** Exact UI intents only. Opening a review dialog never authorizes picks or downloads. */
export type StudioWorkflowIntent =
  | { kind: "people" }
  | { kind: "scenes" }
  | { kind: "bursts" }
  | { kind: "deadline"; count: number }
  | { kind: "refusal"; reason: string };

/** A deadline count narrows existing keepers, never makes new keep/reject decisions.
 * IDs remain Studio IDs until openDevelop resolves them in its exact canonical owner.
 */
export function selectDeadlineKeepers(
  shots: readonly { id: string; verdict: string }[],
  count: number,
) {
  if (!Number.isInteger(count) || count < 1 || count > 200)
    throw new Error("Choose between 1 and 200 already-kept photos for a deadline set.");
  if (
    shots.some((shot) => typeof shot.id !== "string" || !shot.id.trim()) ||
    new Set(shots.map((shot) => shot.id)).size !== shots.length
  )
    throw new Error(
      "This photo scope has ambiguous identities. Reopen the shoot before exporting.",
    );
  const keepers = shots.filter((shot) => shot.verdict === "keep");
  const ids = Object.freeze(keepers.slice(0, count).map((shot) => shot.id));
  const note = !ids.length
    ? "No keepers are available in this scope. Keep the photos you want first; no photos were selected or exported."
    : keepers.length < count
      ? `Only ${keepers.length} of ${count} requested keepers are available. The set includes all ${keepers.length}, in shoot order; no additional photos were selected.`
      : `${ids.length} already-kept photo${ids.length === 1 ? "" : "s"}, in shoot order. Your picks are unchanged.`;
  return Object.freeze({ ids, requestedCount: count, availableCount: keepers.length, note });
}

export function parseStudioWorkflowIntent(input: string): StudioWorkflowIntent | null {
  const text = input.trim().replace(/\s+/g, " ");
  if (
    /^(?:find|show|review|group|open)(?: my| the)? (?:scenes|scene changes|location changes|subject changes|unrelated photos|outliers)[.!]?$/i.test(
      text,
    )
  )
    return { kind: "scenes" };
  if (
    /^(?:(?:show|open)(?: the)? (?:people|jersey|bib|tagging)(?: tools| panel)?|tag (?:jerseys?|bibs?)|group faces)[.!]?$/i.test(
      text,
    )
  )
    return { kind: "people" };
  if (/^(?:review|compare|show)(?: my| the)? (?:bursts|similar frames)[.!]?$/i.test(text))
    return { kind: "bursts" };
  if (/^(?:prepare|open)(?: a| the)? deadline (?:set|export)[.!]?$/i.test(text))
    return { kind: "deadline", count: 20 };
  const match = /^(?:prepare|export) (\d+) (?:press|deadline) (?:photos|frames|images)[.!]?$/i.exec(
    text,
  );
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isInteger(count) && count >= 1 && count <= 200
    ? { kind: "deadline", count }
    : {
        kind: "refusal",
        reason: "A deadline set can contain 1–200 already-kept photos. Nothing was exported.",
      };
}
