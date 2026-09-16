/** Route a photographer message before the model answers. */

export type AssistantIntent = "knowledge" | "creative" | "action" | "diagnostic" | "research";

export function classifyAssistantIntent(text: string): AssistantIntent {
  const value = text.toLowerCase();
  if (
    /\b(soft|blur|blurry|missed focus|can't focus|cannot focus|struggling to focus|overexposed|underexposed|too orange|too warm|noise|grain|banding)\b/.test(
      value,
    ) &&
    /\b(why|all my|every|these|photos?|frames?|images?)\b/.test(value)
  )
    return "diagnostic";
  if (
    /\b(find|upcoming|events?|games?|gigs?|schedule|sideline)\b/.test(value) &&
    /\b(help|need|looking|dont|don't|got no|where|when)\b/.test(value)
  )
    return "research";
  if (
    /\b(remove|cull|keep|reject|crop|export|publish|gallery|mask|retouch|apply|undo|make it|moodier|warmer|cooler|exposure|white balance)\b/.test(
      value,
    ) &&
    !/\b(what does|what is|why is|how does|explain)\b/.test(value)
  )
    return "action";
  if (
    /\b(which|favorite|prefer|better|like|pick|choose|vs\.?|versus)\b/.test(value) ||
    /\b(edit looks|photograph out of|which image|which frame)\b/.test(value)
  )
    return "creative";
  return "knowledge";
}
