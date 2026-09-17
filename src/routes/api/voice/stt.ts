import { createFileRoute } from "@tanstack/react-router";
import { verifySupabaseBearer } from "@/lib/supabase-bearer.server";
import { grokTranscribeAudio } from "@/lib/voice/grok-stt";

const MAX_BYTES = 2_000_000;

export const Route = createFileRoute("/api/voice/stt")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await verifySupabaseBearer(request, "Sign in to dictate.");
        if (user instanceof Response) return user;

        const mime = request.headers.get("content-type") || "application/octet-stream";
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.byteLength < 64) {
          return new Response(JSON.stringify({ error: "Audio too short" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        if (bytes.byteLength > MAX_BYTES) {
          return new Response(JSON.stringify({ error: "Audio too long" }), {
            status: 413,
            headers: { "content-type": "application/json" },
          });
        }
        try {
          const text = await grokTranscribeAudio(bytes, mime);
          return new Response(JSON.stringify({ text }), {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Transcription failed";
          return new Response(JSON.stringify({ error: message }), {
            status: message.includes("not configured") ? 503 : 502,
            headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});
