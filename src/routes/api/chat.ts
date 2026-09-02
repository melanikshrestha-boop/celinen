import { createFileRoute } from "@tanstack/react-router";

type Body = {
  messages?: unknown;
  tools?: unknown;
};

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { messages, tools } = (await request.json()) as Body;
        if (!Array.isArray(messages)) {
          return new Response(JSON.stringify({ error: "messages required" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const key = process.env["LOVABLE_API_KEY"];
        if (!key) {
          return new Response(JSON.stringify({ error: "AI is not configured." }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3.7-flash",
            messages,
            ...(Array.isArray(tools) && tools.length ? { tools, tool_choice: "auto" } : {}),
          }),
        });

        if (!upstream.ok) {
          const text = await upstream.text();
          let message = text;
          try {
            message = JSON.parse(text)?.error?.message ?? text;
          } catch {
            /* raw text */
          }
          if (upstream.status === 429) message = "Rate limited — wait a moment and try again.";
          if (upstream.status === 402) message = message || "AI credits exhausted.";
          return new Response(JSON.stringify({ error: message }), {
            status: upstream.status,
            headers: { "content-type": "application/json" },
          });
        }

        const data = (await upstream.json()) as {
          choices?: Array<{ message?: unknown }>;
        };
        return new Response(JSON.stringify({ message: data.choices?.[0]?.message ?? null }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
