/** Replies Llama should never see. Greetings and noise stay in-product. */

const PHOTO =
  /\b(photo|photograph|shoot|edit|cull|lens|camera|raw|event|game|sideline|light|exposure|crop|gallery|client|preset|wb|iso|shutter|helmet|hss|develop|mask)\b/i;

export function fastTalk(text: string): string | null {
  const line = text.trim();
  if (!line) return null;
  const words = line.split(/\s+/).filter(Boolean).length;
  if (PHOTO.test(line)) return null;
  if (/^(hey|hi|hello|yo|sup|hey gang|hiya|morning|evening|what'?s up)\b/i.test(line) && words <= 6)
    return "Hey. What's the shoot?";
  if (words <= 4) return "What do you need — cull, an edit, events, or a lens?";
  return null;
}
