/** Server-side Grok speech-to-text. Key stays on the machine — never in the browser bundle. */

const STT_URL = "https://api.x.ai/v1/stt";
const KEYTERMS = ["celinen", "Pick", "Lightroom", "gallery", "Develop"];

function fileNameFor(mime: string): string {
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "speech.m4a";
  if (mime.includes("webm")) return "speech.webm";
  if (mime.includes("ogg")) return "speech.ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "speech.mp3";
  return "speech.wav";
}

export async function grokTranscribeAudio(
  bytes: Uint8Array,
  mime = "audio/wav",
): Promise<string> {
  const key = process.env["XAI_API_KEY"];
  if (!key) throw new Error("XAI_API_KEY is not configured");

  const type = mime.split(";")[0]?.trim() || "audio/wav";
  const form = new FormData();
  form.set("language", "en");
  form.set("format", "true");
  form.set("filler_words", "false");
  for (const term of KEYTERMS) form.append("keyterm", term);
  form.append(
    "file",
    new Blob([Uint8Array.from(bytes)], { type }),
    fileNameFor(type),
  );

  const res = await fetch(STT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail.slice(0, 240) || `Grok STT ${res.status}`);
  }
  const json = (await res.json()) as { text?: string };
  return (json.text ?? "").trim();
}

export function grokTranscribeWav(wav: Uint8Array): Promise<string> {
  return grokTranscribeAudio(wav, "audio/wav");
}
