import { createFileRoute } from "@tanstack/react-router";

function authorized(request: Request) {
  const expected = process.env["SCHEDULE_TICK_KEY"] || process.env["SOCIAL_TOKEN_KEY"] || "";
  if (!expected) return false;
  const got = request.headers.get("x-schedule-key") ?? "";
  if (got.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < got.length; i++) mismatch |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

export const Route = createFileRoute("/api/schedule/tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorized(request))
          return new Response(JSON.stringify({ ok: false }), {
            status: 401,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        const { tickDuePosts } = await import("@/lib/business/schedule.server");
        const result = await tickDuePosts();
        return new Response(JSON.stringify({ ok: true, ...result }), {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      },
    },
  },
});
