import { createFileRoute } from "@tanstack/react-router";

/** Serves one private media object to a provider that only pulls from a
 * verified domain (TikTok photo posts). The ticket is an HMAC over bucket,
 * path and expiry, minted by the scheduler for a few minutes; nothing here is
 * listable or guessable, and the response is never cached.
 */
export const Route = createFileRoute("/api/social-media/$ticket")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { openProxyTicket, streamStoredObject } =
          await import("@/lib/business/social-media.server");
        const env = process.env as Record<string, string | undefined>;
        const target = openProxyTicket(env, params.ticket, Date.now());
        if (!target)
          return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
        return streamStoredObject(env, target.bucket, target.path, request.headers.get("range"));
      },
    },
  },
});
