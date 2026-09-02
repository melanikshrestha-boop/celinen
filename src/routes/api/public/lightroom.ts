import { createFileRoute } from "@tanstack/react-router";

/**
 * Lens OS ↔ Lightroom bridge.
 *
 * POST — the Lightroom plugin pushes XMP-derived state (rating, label, pick,
 *        IPTC, develop settings) for the selected photos.
 * GET  — the studio polls the last push; the plugin also GETs to pull Lens OS
 *        verdicts back into the catalog.
 *
 * State lives in memory for the running server instance. This is a local
 * desk-side bridge, not a datastore — nothing here is durable and nothing is
 * shared between users.
 */

interface Frame {
  file: string;
  [key: string]: unknown;
}

interface Payload {
  kind?: string;
  at?: number;
  frames?: Frame[];
  direction?: "to-studio" | "to-lightroom";
}

const bucket = globalThis as unknown as {
  __lensosBridge?: { toStudio: Payload; toLightroom: Payload };
};

bucket.__lensosBridge ??= {
  toStudio: { kind: "empty", at: 0, frames: [] },
  toLightroom: { kind: "empty", at: 0, frames: [] },
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export const Route = createFileRoute("/api/public/lightroom")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const store = bucket.__lensosBridge!;
        const which = new URL(request.url).searchParams.get("side");
        // Default GET serves the Lightroom plugin: Lens OS verdicts to pull in.
        return json(which === "studio" ? store.toStudio : store.toLightroom);
      },
      POST: async ({ request }) => {
        let body: Payload;
        try {
          body = (await request.json()) as Payload;
        } catch {
          return json({ error: "invalid json" }, 400);
        }
        const frames = Array.isArray(body.frames) ? body.frames.filter((f) => f && f.file) : [];
        const payload: Payload = { kind: body.kind ?? "push", at: Date.now(), frames };
        const store = bucket.__lensosBridge!;
        if (body.direction === "to-lightroom") store.toLightroom = payload;
        else store.toStudio = payload;
        return json({ ok: true, received: frames.length, at: payload.at });
      },
    },
  },
});
