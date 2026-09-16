import { createFileRoute } from "@tanstack/react-router";
import { PHOTOGRAPHY_ASSISTANT_POLICY } from "@/lib/photography-assistant";
import { requestCloudflareChat } from "@/lib/cloudflare-ai.server";
import { loadLiveSportsBrief, sportsEventSystemPrompt, wantsEventSearch } from "@/lib/photographer-events";
import { isPhotographerWorkRole } from "@/lib/photographer-work-roles";

type Body = {
  messages?: unknown;
  tools?: unknown;
  mode?: unknown;
  workRole?: unknown;
};

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Paid AI calls are for signed-in users only.
        const authHeader = request.headers.get("authorization") ?? "";
        const token = /^Bearer (.+)$/.exec(authHeader)?.[1]?.trim();
        const unauthorized = () =>
          new Response(JSON.stringify({ error: "Sign in to use the assistant." }), {
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

        const { messages, tools, mode, workRole } = (await request.json()) as Body;
        if (!Array.isArray(messages)) {
          return new Response(JSON.stringify({ error: "messages required" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        const lastUser = [...messages].reverse().find((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return false;
          return (item as { role?: unknown }).role === "user";
        }) as { content?: unknown } | undefined;
        const ask = typeof lastUser?.content === "string" ? lastUser.content : "";
        const role =
          typeof workRole === "string" && isPhotographerWorkRole(workRole) ? workRole : "sports";
        const live =
          mode === "conversation" && wantsEventSearch(ask) ? await loadLiveSportsBrief() : "";
        const context = live
          ? [
              {
                role: "system",
                content: sportsEventSystemPrompt(role, live, new Date().toISOString()),
              },
            ]
          : [];

        const upstream = await requestCloudflareChat({
          messages: [
            { role: "system", content: PHOTOGRAPHY_ASSISTANT_POLICY },
            ...context,
            ...messages,
          ],
          // Conversation mode cannot acquire tools through a client payload.
          ...(mode !== "conversation" && Array.isArray(tools) && tools.length
            ? { tools, tool_choice: "auto" }
            : {}),
        });
        const responseHeaders = {
          "content-type": "application/json",
          "cache-control": "no-store",
          ...(upstream.headers.get("x-chat-request-id")
            ? { "x-chat-request-id": upstream.headers.get("x-chat-request-id")! }
            : {}),
        };

        if (!upstream.ok) {
          const text = await upstream.text();
          let message = text;
          try {
            const error = JSON.parse(text)?.error;
            message = typeof error === "string" ? error : (error?.message ?? text);
          } catch {
            /* raw text */
          }
          if (upstream.status === 429) message = "Rate limited — wait a moment and try again.";
          if (upstream.status === 402) message = message || "AI credits exhausted.";
          return new Response(JSON.stringify({ error: message }), {
            status: upstream.status,
            headers: responseHeaders,
          });
        }

        const data = (await upstream.json()) as {
          choices?: Array<{ message?: unknown }>;
        };
        return new Response(JSON.stringify({ message: data.choices?.[0]?.message ?? null }), {
          headers: responseHeaders,
        });
      },
    },
  },
});
