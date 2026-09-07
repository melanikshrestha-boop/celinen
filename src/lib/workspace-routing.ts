export type WorkspaceDestination =
  "/studio" | "/video" | "/deliver" | "/clients" | "/earnings" | "/adobe";

export function destinationPathFor(text: string): WorkspaceDestination {
  const value = text.toLowerCase();

  // Strong actions beat incidental media or client nouns. "Send these video
  // clips" belongs at delivery; "invoice this shoot" belongs in earnings.
  if (
    /\b(earning|earnings|income|expense|invoice|invoicing|bill|billing|money|revenue|tax)\b/.test(
      value,
    )
  ) {
    return "/earnings";
  }
  if (/\b(lightroom|photoshop|adobe|xmp|sidecar|bridge)\b/.test(value)) return "/adobe";
  if (/\b(deliver|delivery|gallery|proof|send|share|package)\b/.test(value)) return "/deliver";
  if (/\b(client|clients|contact|customer|booking)\b/.test(value)) return "/clients";
  if (/\b(video|footage|clip|clips|reel|timeline|b-roll|film)\b/.test(value)) return "/video";
  return "/studio";
}
