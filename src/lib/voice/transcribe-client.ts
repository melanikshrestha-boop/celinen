import { transcribeUtterance } from "@/lib/voice/stt.functions";
import { blobToBase64 } from "@/lib/voice/pcm";

export async function voiceSessionToken(): Promise<string | null> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Grok STT on the Worker, then the local lab bridge. Null keeps live speech if any. */
export async function transcribeBlob(blob: Blob): Promise<string | null> {
  if (blob.size < 80) return null;
  try {
    const token = await voiceSessionToken();
    const headers: Record<string, string> = {
      "content-type": blob.type || "application/octet-stream",
    };
    if (token) headers["authorization"] = `Bearer ${token}`;
    const res = await fetch("/api/voice/stt", { method: "POST", headers, body: blob });
    if (res.ok) {
      const json = (await res.json()) as { text?: string };
      if (json.text?.trim()) return json.text.trim();
    }
  } catch {
    /* fall through */
  }
  if (blob.type === "audio/wav" || blob.type === "audio/wave") {
    try {
      const result = await transcribeUtterance({ data: { wav: await blobToBase64(blob) } });
      if (result && "text" in result && result.text.trim()) return result.text.trim();
    } catch {
      /* hosted fn missing */
    }
  }
  try {
    const res = await fetch("/__voice/stt", { method: "POST", body: blob });
    if (!res.ok) return null;
    const json = (await res.json()) as { text?: string };
    return json.text?.trim() || null;
  } catch {
    return null;
  }
}

export function transcribeWav(wav: Blob): Promise<string | null> {
  return transcribeBlob(wav);
}
