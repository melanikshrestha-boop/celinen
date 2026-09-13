import { createServerFn } from "@tanstack/react-start";
import { grokTranscribeWav } from "@/lib/voice/grok-stt";

const MAX_B64 = 2_800_000;

export const transcribeUtterance = createServerFn({ method: "POST" })
  .inputValidator((data: { wav: string }) => {
    if (typeof data.wav !== "string" || data.wav.length < 16) throw new Error("Missing audio");
    if (data.wav.length > MAX_B64) throw new Error("Audio too long");
    return data;
  })
  .handler(async ({ data }): Promise<{ text: string } | { error: string }> => {
    try {
      const wav = Buffer.from(data.wav, "base64");
      if (wav.length < 44) return { error: "Audio too short" };
      const text = await grokTranscribeWav(new Uint8Array(wav));
      return { text };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transcription failed";
      return { error: message };
    }
  });
