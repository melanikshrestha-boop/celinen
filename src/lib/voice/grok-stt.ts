/** Server-side Grok speech-to-text. Key stays on the machine — never in the browser bundle. */

const STT_URL = "https://api.x.ai/v1/stt";
const KEYTERMS = ["celinen", "Pick", "Lightroom", "gallery", "Develop"];

export async function grokTranscribeWav(wav: Uint8Array): Promise<string> {
  const key = process.env["XAI_API_KEY"];
  if (!key) throw new Error("XAI_API_KEY is not configured");

  const form = new FormData();
  form.set("language", "en");
  form.set("format", "true");
  form.set("filler_words", "false");
  for (const term of KEYTERMS) form.append("keyterm", term);
  // file must be last in the multipart body
  form.append("file", new Blob([wav], { type: "audio/wav" }), "speech.wav");

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
