import { createFileRoute } from "@tanstack/react-router";
import { grokTranscribeAudio } from "@/lib/voice/grok-stt";

const MAX_BYTES = 2_000_000;

export const Route = createFileRoute("/api/voice/stt")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = /^Bearer (.+)$/.exec(authHeader)?.[1]?.trim();
        const unauthorized = () =>
          new Response(JSON.stringify({ error: "Sign in to dictate." }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        if (!token || token.split(".").length !== 3) return unauthorized();

        const { createClient } = await import("@supabase/supabase-js");
        const supabaseUrl = process.env["SUPABASE_URL"];
        const supabaseKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
        if (!supabaseUrl || !supabaseKey) {
          return new Response(JSON.stringify({ error: "Auth is not configured." }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
        const authClient = createClient(supabaseUrl, supabaseKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: claims, error: claimsError } = await authClient.auth
          .getClaims(token)
          .catch(() => ({ data: null, error: true }));
        if (claimsError || !claims?.claims?.sub) return unauthorized();

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
