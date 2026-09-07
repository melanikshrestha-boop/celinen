/**
 * A conservative boundary in front of every Studio command router, including
 * the hosted planner. The legacy router finds verbs; it cannot interpret a
 * negation or condition around those verbs. Never execute a matched fragment.
 */
export function studioCommandRefusal(input: string): string | null {
  if (input.length > 1000) {
    return "Please ask for one short action at a time. Nothing was run.";
  }
  let text = input.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
  if (/^(?:discard(?: it| that| the preview)?|cancel(?: it| that| the preview)?)\.?$/.test(text)) {
    return null;
  }

  // These exact restrictions have an unambiguous implementation. Do not
  // generalize this to “only the sky”, “keep skin unchanged”, or other masks.
  text = text.replace(/\bonly\s+((?:(?:my|the)\s+)?(?:keepers|picks|selects))\b/g, "$1");
  text = text.replace(/^(keep) only ((?:the )?top \d+)[.!?]?$/, "$1 $2");
  text = text.replace(
    /\s+(?:but|and)\s+keep\s+(?:it|them|this|these|the photos)\s+(?:looking\s+)?natural[.!?]*$/,
    "",
  );

  if (
    /\b(?:not|no|never|without|except|unless|avoid|don't|dont|can't|cant|cannot|won't|wont|shouldn't|shouldnt|mustn't|mustnt|unchanged|untouched|preserve|protect|only|skip|prevent|stop|cancel|abort|if|until|before|after|once|when|later|tomorrow|tonight|but|however|instead|maybe|possibly)\b|\brather than\b|\bleave .{0,60} alone\b/.test(
      text,
    )
  ) {
    return "That request includes a restriction or condition I can't safely interpret yet. Nothing was run. Ask for one explicit action, such as “show keepers”, “export keepers”, or “make only my keepers warmer”.";
  }
  return null;
}

/** A failed or proposed step must never fall through into a later export. */
export function studioToolBoundary(result: string): "preview" | "failed" | null {
  const normalized = result.trim().toLowerCase();
  if (normalized.startsWith("preview ready:")) return "preview";
  if (normalized.startsWith("failed:")) return "failed";
  return null;
}
