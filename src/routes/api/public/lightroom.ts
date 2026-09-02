import { createFileRoute } from "@tanstack/react-router";

/**
 * LensLabs ↔ Lightroom bridge (public endpoint — the LR plugin calls it directly).
 *
 * POST — the Lightroom plugin pushes XMP-derived state (rating, label, pick,
 *        IPTC, develop settings) for the selected photos.
 * GET  — the studio polls `?side=studio` for what Lightroom pushed; the plugin
 *        GETs the default side to pull LensLabs verdicts back into the catalog.
 *
 * State is persisted per workspace key so it survives restarts and works from
 * the published URL, not just localhost.
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
  workspace?: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
  });

const cleanWorkspace = (value: string | null | undefined) => {
  const raw = (value ?? "default").trim().toLowerCase();
  const safe = raw.replace(/[^a-z0-9-_]/g, "").slice(0, 48);
  return safe || "default";
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const Route = createFileRoute("/api/public/lightroom")({
  server: {
    handlers: {
      OPTIONS: async () => json({ ok: true }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const workspace = cleanWorkspace(url.searchParams.get("workspace"));
        const direction =
          url.searchParams.get("side") === "studio" ? "to-studio" : "to-lightroom";

        const db = await admin();
        const { data, error } = await db
          .from("lightroom_sync")
          .select("kind, frames: frames as unknown as never, updated_at")
          .eq("workspace", workspace)
          .eq("direction", direction)
          .maybeSingle();

        if (error) return json({ error: error.message }, 500);
        if (!data) return json({ kind: "empty", at: 0, frames: [], workspace, direction });

        return json({
          kind: data.kind,
          at: new Date(data.updated_at as string).getTime(),
          frames: data.frames ?? [],
          workspace,
          direction,
        });
      },

      POST: async ({ request }) => {
        let body: Payload;
        try {
          body = (await request.json()) as Payload;
        } catch {
          return json({ error: "invalid json" }, 400);
        }

        const frames = Array.isArray(body.frames)
          ? body.frames.filter((f) => f && typeof f.file === "string").slice(0, 5000)
          : [];
        const workspace = cleanWorkspace(body.workspace);
        const direction = body.direction === "to-lightroom" ? "to-lightroom" : "to-studio";
        const at = new Date().toISOString();

        const db = await admin();
        const { error } = await db.from("lightroom_sync").upsert(
          {
            workspace,
            direction,
            kind: body.kind ?? "push",
            frames: frames as unknown as never,
            updated_at: at,
          },
          { onConflict: "workspace,direction" },
        );

        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, received: frames.length, at: Date.parse(at), workspace });
      },
    },
  },
});
