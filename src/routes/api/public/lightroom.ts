import { createFileRoute } from "@tanstack/react-router";
import { LightroomRequestError, readLightroomPayload } from "@/lib/lightroom-request";
import {
  checkedLightroomFrames,
  checkedLightroomVerdicts,
  LIGHTROOM_MATCHING,
} from "@/lib/lightroom-matching";

/**
 * Celinen ↔ Lightroom bridge (public endpoint — the LR plugin calls it directly).
 *
 * POST — the Lightroom plugin pushes XMP-derived state (rating, label, pick,
 *        IPTC, develop settings) for the selected photos.
 * GET  — the studio polls `?side=studio` for what Lightroom pushed; the plugin
 *        GETs the default side to pull Celinen verdicts back into the catalog.
 *
 * State is persisted per workspace key so it survives restarts and works from
 * the published URL, not just localhost.
 */

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
  });

const cleanWorkspace = (value: string | null | undefined) => {
  const raw = (value ?? "").trim().toLowerCase();
  return raw.replace(/[^a-z0-9-_]/g, "").slice(0, 48);
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * The bridge is unauthenticated by URL, so every call must present the studio's
 * bridge token. The workspace is resolved *from the token*, never from the
 * client-supplied name alone.
 */
async function authorize(request: Request, claimedWorkspace: string) {
  const token = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "")?.[1]?.trim();
  if (!token || token.length < 20) return null;

  const db = await admin();
  const { data } = await db
    .from("lightroom_workspaces")
    .select("workspace")
    .eq("token", token)
    .maybeSingle();
  if (!data?.workspace) return null;
  if (claimedWorkspace && claimedWorkspace !== data.workspace) return null;
  return data.workspace;
}

export const Route = createFileRoute("/api/public/lightroom")({
  server: {
    handlers: {
      OPTIONS: async () => json({ ok: true }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const workspace = await authorize(
          request,
          cleanWorkspace(url.searchParams.get("workspace")),
        );
        if (!workspace) return json({ error: "unauthorized" }, 401);
        const direction = url.searchParams.get("side") === "studio" ? "to-studio" : "to-lightroom";
        if (direction === "to-lightroom" && url.searchParams.get("matching") !== LIGHTROOM_MATCHING)
          return json(
            {
              error: "Update the Celinen Lightroom plug-in for folder-matched sync.",
              kind: "upgrade-required",
              at: 0,
              frames: [],
            },
            409,
          );

        const db = await admin();
        const { data, error } = await db
          .from("lightroom_sync")
          .select("kind, frames, updated_at")
          .eq("workspace", workspace)
          .eq("direction", direction)
          .maybeSingle();

        if (error) return json({ error: error.message }, 500);
        if (!data) return json({ kind: "empty", at: 0, frames: [], workspace, direction });
        if (direction === "to-lightroom" && data.kind !== `verdicts-${LIGHTROOM_MATCHING}`)
          return json(
            {
              error: "Publish this batch again from the updated Celinen Studio.",
              kind: "upgrade-required",
              at: 0,
              frames: [],
            },
            409,
          );

        return json({
          kind: data.kind,
          at: new Date(data.updated_at as string).getTime(),
          frames: data.frames ?? [],
          workspace,
          direction,
        });
      },

      POST: async ({ request }) => {
        let body;
        try {
          body = await readLightroomPayload(request);
        } catch (error) {
          return json(
            { error: error instanceof LightroomRequestError ? error.message : "invalid json" },
            error instanceof LightroomRequestError ? error.status : 400,
          );
        }

        const workspace = await authorize(request, cleanWorkspace(body.workspace));
        if (!workspace) return json({ error: "unauthorized" }, 401);

        const direction = body.direction === "to-lightroom" ? "to-lightroom" : "to-studio";
        if (direction === "to-lightroom" && body.kind !== `verdicts-${LIGHTROOM_MATCHING}`)
          return json({ error: "Update Studio before publishing folder-matched verdicts." }, 409);
        let frames;
        try {
          frames =
            direction === "to-lightroom"
              ? checkedLightroomVerdicts(body.frames)
              : checkedLightroomFrames(body.frames);
        } catch (error) {
          return json(
            { error: error instanceof Error ? error.message : "Invalid Lightroom batch" },
            400,
          );
        }
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
