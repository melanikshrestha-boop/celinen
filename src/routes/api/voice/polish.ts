import { createFileRoute } from "@tanstack/react-router";
import { requestCloudflareChat } from "@/lib/cloudflare-ai.server";
import { verifySupabaseBearer } from "@/lib/supabase-bearer.server";
import {
  acceptPolishedDictation,
  polishMessages,
  POLISH_MAX_CHARS,
  shouldPolishDictation,
} from "@/lib/voice/polish";

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export const Route = createFileRoute("/api/voice/polish")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await verifySupabaseBearer(request, "Sign in to dictate.");
        if (user instanceof Response) return user;

        const body: unknown = await request.json().catch(() => null);
        const text =
          body && typeof body === "object" && "text" in body && typeof body.text === "string"
            ? body.text
            : "";
        if (!text.trim()) return reply(400, { error: "text required" });
        if (text.length > POLISH_MAX_CHARS) return reply(413, { error: "Dictation too long" });
        // Nothing to organize: answer with the speaker's words, not an error.
        if (!shouldPolishDictation(text)) return reply(200, { text, polished: false });

        const upstream = await requestCloudflareChat({
          messages: polishMessages(text),
          voice: "human",
          max_tokens: 2048,
        });
        if (!upstream.ok)
          return reply(upstream.status === 429 ? 429 : 502, { error: "Polish unavailable" });
        const data = (await upstream.json()) as { choices?: { message?: { content?: unknown } }[] };
        const content = data.choices?.[0]?.message?.content;
        const polished =
          typeof content === "string" ? acceptPolishedDictation(text, content) : null;
        return reply(
          200,
          polished ? { text: polished, polished: true } : { text, polished: false },
        );
      },
    },
  },
});
