import { createFileRoute } from "@tanstack/react-router";
import { recordMarketingVisit } from "@/lib/marketing-traffic";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export async function handleTrafficPost(request: Request): Promise<Response> {
  let body: { path?: string; referrer?: string } = {};
  try {
    body = (await request.json()) as { path?: string; referrer?: string };
  } catch {
    return json({ recorded: false }, 400);
  }
  const result = await recordMarketingVisit({
    cookie: request.headers.get("cookie"),
    path: typeof body.path === "string" ? body.path : "",
    referrer: typeof body.referrer === "string" ? body.referrer : "",
  });
  return json(result);
}

export const Route = createFileRoute("/api/public/traffic")({
  server: {
    handlers: {
      POST: async ({ request }) => handleTrafficPost(request),
    },
  },
});
