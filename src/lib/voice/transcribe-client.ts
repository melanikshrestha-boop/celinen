import { transcribeUtterance } from "@/lib/voice/stt.functions";
import { blobToBase64 } from "@/lib/voice/pcm";

/** Grok STT first (server fn or local lab bridge). Null means keep the live transcript. */
export async function transcribeWav(wav: Blob): Promise<string | null> {
  if (wav.size < 80) return null;
  try {
    const result = await transcribeUtterance({ data: { wav: await blobToBase64(wav) } });
    if (result && "text" in result && result.text.trim()) return result.text.trim();
  } catch {
    /* hosted fn missing on this machine — try the lab bridge */
  }
  try {
    const res = await fetch("/__voice/stt", { method: "POST", body: wav });
    if (!res.ok) return null;
    const json = (await res.json()) as { text?: string };
    return json.text?.trim() || null;
  } catch {
    return null;
  }
}
