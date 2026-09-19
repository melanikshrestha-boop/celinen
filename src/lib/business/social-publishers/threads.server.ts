/** Threads: text, one image, one video, or a carousel, through Meta's
 * container → publish flow.
 * https://developers.facebook.com/docs/threads/posts
 * https://developers.facebook.com/docs/threads/posts/carousel-posts
 * https://developers.facebook.com/docs/threads/troubleshooting  (status, error_message)
 * https://developers.facebook.com/docs/threads/overview/rate-limiting  (250 posts / 24 h)
 */
import { SocialApiError } from "../../social/connectors";
import {
  committed,
  createdSinceCommit,
  numericId,
  pollPause,
  readBody,
  type PublishContext,
  type PublishResult,
  type Publisher,
  type ReconcileResult,
} from "./types";

const API = "https://graph.threads.net/v1.0";
export const THREADS_CONTAINER_TIMEOUT_MS = 5 * 60_000;

/** Threads answers with Meta's Graph error shape; classify it in Celinen's words. */
export function classifyThreads(status: number, body: Record<string, unknown>): SocialApiError {
  const error = body["error"] as { code?: unknown; error_subcode?: unknown } | undefined;
  const code = typeof error?.code === "number" ? error.code : null;
  const subcode = typeof error?.error_subcode === "number" ? error.error_subcode : null;
  if (subcode === 2207042 || code === 9)
    return new SocialApiError(
      "Threads' daily posting limit for this account is reached. Try again later.",
      "quota",
      status,
      60 * 60_000,
    );
  if (status === 429 || (code !== null && [4, 17, 32, 613].includes(code)))
    return new SocialApiError(
      "Threads is busy. Try again later.",
      "rate-limit",
      status,
      15 * 60_000,
    );
  if (code === 190 || status === 401)
    return new SocialApiError("Threads access expired. Reconnect Threads.", "auth", status);
  if (code === 10 || (code !== null && code >= 200 && code < 300) || status === 403)
    return new SocialApiError(
      "Threads did not grant posting. Reconnect Threads and allow it.",
      "permission",
      status,
    );
  if (subcode === 2207027)
    return new SocialApiError("Threads is still preparing this post.", "not-ready", status);
  if (subcode === 2207052 || subcode === 2207003)
    return new SocialApiError("Threads could not download the media. Try again.", "media", status);
  if (subcode !== null && subcode >= 2207000 && subcode < 2208000)
    return new SocialApiError("Threads rejected the media file.", "media", status);
  if (status >= 500)
    return new SocialApiError(
      "Threads is unavailable right now. Try again.",
      "unavailable",
      status,
    );
  return new SocialApiError("Threads did not accept this request.", "rejected", status);
}

async function call(
  ctx: PublishContext,
  path: string,
  body?: URLSearchParams,
): Promise<Record<string, unknown>> {
  if (!/^[a-zA-Z0-9_/?=&,%.-]+$/.test(path) || path.includes(".."))
    throw new Error("Invalid Threads request.");
  let response: Response;
  try {
    response = await ctx.fetch(`${API}/${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${ctx.session.token}` },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
  } catch {
    throw new SocialApiError("Threads did not answer. Try again.", "unavailable", 0);
  }
  const parsed = await readBody(response);
  if (!response.ok) throw classifyThreads(response.status, parsed);
  return parsed;
}

const forget = (ctx: PublishContext) => {
  delete ctx.unit.progress["children"];
  delete ctx.unit.progress["containerId"];
  delete ctx.unit.progress["containerCreatedAt"];
};

async function waitFor(
  ctx: PublishContext,
  ids: string[],
): Promise<"finished" | "pending" | "failed" | "timeout"> {
  const open = new Set(ids);
  const since = Date.parse(String(ctx.unit.progress["containerCreatedAt"] ?? "")) || ctx.now();
  for (let attempt = 0; ; attempt++) {
    for (const id of [...open]) {
      const status = await call(ctx, `${id}?fields=status,error_message`);
      if (status["status"] === "FINISHED" || status["status"] === "PUBLISHED") open.delete(id);
      else if (status["status"] === "ERROR" || status["status"] === "EXPIRED") return "failed";
    }
    if (!open.size) return "finished";
    if (ctx.now() - since > THREADS_CONTAINER_TIMEOUT_MS) return "timeout";
    const pause = pollPause(attempt);
    if (ctx.now() + pause > ctx.deadline) return "pending";
    await ctx.sleep(pause);
  }
}

export const threadsPublisher: Publisher = {
  async publish(ctx): Promise<PublishResult> {
    const { unit, session } = ctx;
    if (!session.scopes.includes("threads_content_publish"))
      throw new SocialApiError("Reconnect Threads and allow posting.", "permission", 403);
    if (session.accountId !== unit.accountId)
      throw new SocialApiError(
        "Reconnect the Threads account this post was made for.",
        "auth",
        401,
      );
    const user = session.accountId;
    const progress = unit.progress;
    const text = unit.caption.trim();

    if (!progress["containerId"] && !Array.isArray(progress["children"])) {
      try {
        const limit = await call(ctx, `${user}/threads_publishing_limit?fields=quota_usage,config`);
        const row = Array.isArray(limit["data"])
          ? (limit["data"][0] as Record<string, unknown>)
          : limit;
        const used = Number(row?.["quota_usage"]);
        const total = Number(
          (row?.["config"] as { quota_total?: unknown } | undefined)?.quota_total,
        );
        if (Number.isFinite(used) && Number.isFinite(total) && total > 0 && used >= total)
          throw new SocialApiError(
            `Threads allows ${total} posts per 24 hours and this account has used them. Try again later.`,
            "quota",
            400,
            60 * 60_000,
          );
      } catch (error) {
        if (error instanceof SocialApiError && ["quota", "auth", "permission"].includes(error.kind))
          throw error;
      }
    }

    const mediaParams = async (item: (typeof unit.media)[number]) =>
      item.kind === "video"
        ? { media_type: "VIDEO", video_url: await ctx.media.signedUrl(item, 60 * 60) }
        : { media_type: "IMAGE", image_url: await ctx.media.signedUrl(item) };

    if (unit.media.length > 1) {
      const children = Array.isArray(progress["children"])
        ? (progress["children"] as string[])
        : [];
      for (const item of unit.media.slice(children.length)) {
        const created = await call(
          ctx,
          `${user}/threads`,
          new URLSearchParams({ ...(await mediaParams(item)), is_carousel_item: "true" }),
        );
        const id = numericId(created["id"]);
        if (!id) throw new SocialApiError("Threads did not accept a media item.", "media", 400);
        children.push(id);
        progress["children"] = children;
        progress["containerCreatedAt"] ??= new Date(ctx.now()).toISOString();
        await ctx.save();
      }
      if (!progress["containerId"]) {
        const state = await waitFor(ctx, children);
        if (state === "pending")
          return { status: "pending", note: "Threads is processing the media…", retryMs: 60_000 };
        if (state !== "finished") {
          forget(ctx);
          throw new SocialApiError(
            state === "timeout"
              ? "Threads took too long to process the media. It will be tried again."
              : "Threads could not process the media.",
            state === "timeout" ? "unavailable" : "media",
            state === "timeout" ? 0 : 400,
          );
        }
        const created = await call(
          ctx,
          `${user}/threads`,
          new URLSearchParams({
            media_type: "CAROUSEL",
            children: children.join(","),
            ...(text ? { text } : {}),
          }),
        );
        const id = numericId(created["id"]);
        if (!id) throw new SocialApiError("Threads did not accept the carousel.", "media", 400);
        progress["containerId"] = id;
        await ctx.save();
      }
    } else if (!progress["containerId"]) {
      const item = unit.media[0];
      if (!item && !text) throw new SocialApiError("Write a caption first.", "rejected", 400);
      const created = await call(
        ctx,
        `${user}/threads`,
        new URLSearchParams(
          item
            ? { ...(await mediaParams(item)), ...(text ? { text } : {}) }
            : { media_type: "TEXT", text },
        ),
      );
      const id = numericId(created["id"]);
      if (!id) throw new SocialApiError("Threads did not accept this post.", "rejected", 400);
      progress["containerId"] = id;
      progress["containerCreatedAt"] = new Date(ctx.now()).toISOString();
      await ctx.save();
    }

    const containerId = String(progress["containerId"]);
    if (unit.media.length) {
      const state = await waitFor(ctx, [containerId]);
      if (state === "pending")
        return { status: "pending", note: "Threads is processing the media…", retryMs: 60_000 };
      if (state !== "finished") {
        forget(ctx);
        throw new SocialApiError(
          state === "timeout"
            ? "Threads took too long to process this. It will be tried again."
            : "Threads could not process this media.",
          state === "timeout" ? "unavailable" : "media",
          state === "timeout" ? 0 : 400,
        );
      }
    }
    await ctx.commit();
    let published: Record<string, unknown>;
    try {
      published = await call(
        ctx,
        `${user}/threads_publish`,
        new URLSearchParams({ creation_id: containerId }),
      );
    } catch (error) {
      if (error instanceof SocialApiError && error.kind === "not-ready")
        return { status: "pending", note: "Threads is still processing this…", retryMs: 60_000 };
      throw error;
    }
    const mediaId = numericId(published["id"]);
    if (!mediaId) throw new SocialApiError("Threads did not confirm this post.", "unavailable", 0);
    progress["mediaId"] = mediaId;
    let url: string | undefined;
    try {
      const media = await call(ctx, `${mediaId}?fields=permalink`);
      if (
        typeof media["permalink"] === "string" &&
        /^https:\/\/(www\.)?threads\.(net|com)\//.test(media["permalink"])
      )
        url = media["permalink"];
    } catch {
      // Confirmed; the link is a convenience.
    }
    return { status: "posted", remoteId: mediaId, ...(url ? { url } : {}) };
  },

  async reconcile(ctx): Promise<ReconcileResult> {
    const containerId = numericId(ctx.unit.progress["containerId"]);
    if (!committed(ctx.unit) || !containerId) return { status: "unknown" };
    let status: Record<string, unknown>;
    try {
      status = await call(ctx, `${containerId}?fields=status,error_message`);
    } catch (error) {
      if (error instanceof SocialApiError && (error.kind === "auth" || error.kind === "permission"))
        throw error;
      return { status: "unknown" };
    }
    if (status["status"] === "PUBLISHED") {
      // Find the published thread to hand back its permalink; the container id is the fallback.
      try {
        const recent = await call(
          ctx,
          `${ctx.session.accountId}/threads?fields=id,permalink,text,timestamp&limit=10`,
        );
        const rows = Array.isArray(recent["data"])
          ? (recent["data"] as Record<string, unknown>[])
          : [];
        const match = rows.find(
          (row) =>
            String(row["text"] ?? "") === ctx.unit.caption.trim() &&
            createdSinceCommit(ctx.unit, row["timestamp"], ctx.now()),
        );
        if (match && numericId(match["id"]))
          return {
            status: "posted",
            remoteId: numericId(match["id"])!,
            ...(typeof match["permalink"] === "string" ? { url: match["permalink"] } : {}),
          };
      } catch {
        // fall through
      }
      return { status: "posted", remoteId: containerId };
    }
    if (status["status"] === "EXPIRED" || status["status"] === "ERROR") {
      forget(ctx);
      return { status: "absent" };
    }
    return { status: "unknown" };
  },
};
