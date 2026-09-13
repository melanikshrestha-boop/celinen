/** Exact UI intents only. Opening a review dialog never authorizes picks or downloads. */
export type StudioWorkflowIntent =
  { kind: "people" } | { kind: "bursts" } | { kind: "deadline"; count: number } | { kind: "refusal"; reason: string };
export function parseStudioWorkflowIntent(input: string): StudioWorkflowIntent | null {
  const text = input.trim().replace(/\s+/g, " ");
  if (/^(?:(?:show|open)(?: the)? (?:people|jersey|bib|tagging)(?: tools| panel)?|tag (?:jerseys?|bibs?)|group faces)[.!]?$/i.test(text))
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
