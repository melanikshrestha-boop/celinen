import { shouldPolishDictation } from "@/lib/voice/polish";
import { voiceSessionToken } from "@/lib/voice/transcribe-client";

/** Organized rewrite of a finished dictation. Null keeps the text as spoken:
 * signed out, offline, slow, or a rewrite the server refused to trust.
 */
export async function polishDictation(text: string): Promise<string | null> {
  if (!shouldPolishDictation(text)) return null;
  try {
    const token = await voiceSessionToken();
    if (!token) return null;
    const res = await fetch("/api/voice/polish", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ text }),
      // Past this the pause is worse than unpolished text.
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { text?: unknown; polished?: unknown };
    return json.polished === true && typeof json.text === "string" && json.text.trim()
      ? json.text
      : null;
  } catch {
    return null;
  }
}
