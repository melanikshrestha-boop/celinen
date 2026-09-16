import { createFileRoute } from "@tanstack/react-router";
import { localCultureBrief } from "@/lib/assistant/culture";

function queryFrom(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  const q = (raw as { q?: unknown }).q;
  return typeof q === "string" ? q : "";
}

export const Route = createFileRoute("/api/culture")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const q = new URL(request.url).searchParams.get("q") ?? "";
        return Response.json(localCultureBrief(q), {
          headers: { "cache-control": "no-store" },
        });
      },
      POST: async ({ request }) => {
        const q = queryFrom(await request.json().catch(() => ({})));
        return Response.json(localCultureBrief(q), {
          headers: { "cache-control": "no-store" },
        });
      },
    },
  },
});
