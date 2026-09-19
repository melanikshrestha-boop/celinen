/** X: one post with up to four images or one video, media uploaded in chunks
 * through the v2 media endpoints (initialize → append → finalize → status).
 * https://docs.x.com/x-api/posts/creation-of-a-post
 * https://docs.x.com/x-api/media/quickstart/media-upload-chunked
 * https://docs.x.com/x-api/fundamentals/rate-limits  (Free: 17 posts / 24 h per user; Basic: 100)
 * Tier limits are not hard-coded: the 24-hour headers X returns are stored on
 * the connection and reported back with each result.
 */
import { SocialApiError } from "../../social/connectors";
import {
  blobPartOf,
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

const API = "https://api.x.com/2";
/** X accepts at most 5 MB per append; 4 MiB keeps a comfortable margin. */
const APPEND_BYTES = 4 * 1024 * 1024;

type Quota = { limit: number | null; remaining: number | null; resetAt: string | null };
function readQuota(headers: Headers): { user: Quota; app: Quota } {
  const read = (prefix: string): Quota => {
    const limit = Number(headers.get(`${prefix}-limit`));
    const remaining = Number(headers.get(`${prefix}-remaining`));
    const reset = Number(headers.get(`${prefix}-reset`));
    return {
      limit: Number.isFinite(limit) && headers.has(`${prefix}-limit`) ? limit : null,
      remaining:
        Number.isFinite(remaining) && headers.has(`${prefix}-remaining`) ? remaining : null,
      resetAt: Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : null,
    };
  };
  return { user: read("x-user-limit-24hour"), app: read("x-app-limit-24hour") };
}

export function classifyX(
  status: number,
  body: Record<string, unknown>,
  headers: Headers,
  now = Date.now(),
): SocialApiError {
  const detail = String(body["detail"] ?? body["title"] ?? "").toLowerCase();
  const errors = Array.isArray(body["errors"]) ? (body["errors"] as Record<string, unknown>[]) : [];
  const text = [detail, ...errors.map((row) => String(row["message"] ?? row["detail"] ?? ""))]
    .join(" ")
    .toLowerCase();
  const quota = readQuota(headers);
  const resetIn = (at: string | null) => (at ? Math.max(60_000, Date.parse(at) - now) : null);
  if (status === 401) return new SocialApiError("X access expired. Reconnect X.", "auth", status);
  if (status === 403 && text.includes("duplicate"))
    return new SocialApiError("X already has this post.", "duplicate", status);
  if (status === 403)
    return new SocialApiError(
      "X did not allow this post. Reconnect X and allow posting.",
      "permission",
      status,
    );
  if (status === 429) {
    if (quota.user.remaining === 0 || quota.app.remaining === 0)
      return new SocialApiError(
        `X's daily posting limit for this tier is reached${quota.user.limit ? ` (${quota.user.limit} per 24 hours)` : ""}. Try again later.`,
        "quota",
        status,
        resetIn(quota.user.remaining === 0 ? quota.user.resetAt : quota.app.resetAt) ?? 60 * 60_000,
      );
    const reset = Number(headers.get("x-rate-limit-reset"));
    return new SocialApiError(
      "X is busy. Try again later.",
      "rate-limit",
      status,
      Number.isFinite(reset) && reset > 0 ? Math.max(60_000, reset * 1000 - now) : 15 * 60_000,
    );
  }
  if (status === 400 && text.includes("media"))
    return new SocialApiError("X rejected the media file.", "media", status);
  if (status === 400 || status === 422)
    return new SocialApiError(
      "X did not accept this post. Check the caption length and media.",
      "rejected",
      status,
    );
  if (status >= 500)
    return new SocialApiError("X is unavailable right now. Try again.", "unavailable", status);
  return new SocialApiError("X did not accept this request.", "rejected", status);
}

async function api(ctx: PublishContext, path: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await ctx.fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${ctx.session.token}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(60_000),
      redirect: "error",
    });
  } catch {
    throw new SocialApiError("X did not answer. Try again.", "unavailable", 0);
  }
  const body = await readBody(response);
  if (!response.ok) throw classifyX(response.status, body, response.headers, ctx.now());
  return { response, body };
}

async function uploadMedia(
  ctx: PublishContext,
  item: PublishContext["unit"]["media"][number],
): Promise<string> {
  const video = item.kind === "video";
  const { body: init } = await api(ctx, "/media/upload/initialize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      media_type: item.mime,
      total_bytes: item.bytes,
      media_category: video ? "tweet_video" : "tweet_image",
    }),
  });
  const data = init["data"] as { id?: unknown } | undefined;
  const mediaId = numericId(data?.id);
  if (!mediaId) throw new SocialApiError("X did not open a media upload.", "unavailable", 0);
  for (let offset = 0, segment = 0; offset < item.bytes; offset += APPEND_BYTES, segment++) {
    const end = Math.min(offset + APPEND_BYTES, item.bytes) - 1;
    const bytes = video
      ? await ctx.media.readRange(item, offset, end)
      : (await ctx.media.download(item)).subarray(offset, end + 1);
    const form = new FormData();
    form.set("segment_index", String(segment));
    form.set(
      "media",
      new Blob([blobPartOf(bytes)], { type: item.mime }),
      video ? "clip.mp4" : "photo.jpg",
    );
    await api(ctx, `/media/upload/${mediaId}/append`, { method: "POST", body: form });
  }
  const { body: done } = await api(ctx, `/media/upload/${mediaId}/finalize`, { method: "POST" });
  let info = (
    done["data"] as
      { processing_info?: { state?: unknown; check_after_secs?: unknown } } | undefined
  )?.processing_info;
  for (let attempt = 0; info && info.state !== "succeeded"; attempt++) {
    if (info.state === "failed")
      throw new SocialApiError("X could not process the media.", "media", 400);
    const wait = Math.min(
      Math.max(Number(info.check_after_secs) || 0, 1) * 1000,
      pollPause(attempt) * 2,
    );
    if (ctx.now() + wait > ctx.deadline)
      throw new SocialApiError("X is still processing the media.", "not-ready", 0, 60_000);
    await ctx.sleep(wait);
    const { body: status } = await api(ctx, `/media/upload?media_id=${mediaId}`);
    info = (
      status["data"] as
        { processing_info?: { state?: unknown; check_after_secs?: unknown } } | undefined
    )?.processing_info;
  }
  return mediaId;
}

export const xPublisher: Publisher = {
  async publish(ctx): Promise<PublishResult> {
    const { unit, session } = ctx;
    if (session.accountId !== unit.accountId)
      throw new SocialApiError("Reconnect the X account this post was made for.", "auth", 401);
    if (!session.scopes.includes("tweet.write"))
      throw new SocialApiError("Reconnect X and allow posting.", "permission", 403);
    if (unit.media.length && !session.scopes.includes("media.write"))
      throw new SocialApiError("Reconnect X and allow media uploads.", "permission", 403);
    const progress = unit.progress;
    const mediaIds = Array.isArray(progress["mediaIds"]) ? (progress["mediaIds"] as string[]) : [];
    for (const item of unit.media.slice(mediaIds.length)) {
      if (ctx.now() > ctx.deadline)
        return { status: "pending", note: "Uploading media to X…", retryMs: 15_000 };
      mediaIds.push(await uploadMedia(ctx, item));
      progress["mediaIds"] = mediaIds;
      await ctx.save();
    }
    const text = unit.caption.trim();
    if (!text && !mediaIds.length)
      throw new SocialApiError("Write a caption first.", "rejected", 400);
    await ctx.commit();
    const { response, body } = await api(ctx, "/tweets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}),
      }),
    });
    const quota = readQuota(response.headers);
    if (quota.user.limit !== null || quota.app.limit !== null)
      await ctx.remember({ xDailyPosts: quota.user, xDailyApp: quota.app }).catch(() => {});
    const id = numericId((body["data"] as { id?: unknown } | undefined)?.id);
    if (!id) throw new SocialApiError("X did not confirm this post.", "unavailable", 0);
    return {
      status: "posted",
      remoteId: id,
      url: `https://x.com/${session.accountName}/status/${id}`,
    };
  },

  async reconcile(ctx): Promise<ReconcileResult> {
    if (!committed(ctx.unit)) return { status: "unknown" };
    try {
      const { body } = await api(
        ctx,
        `/users/${ctx.session.accountId}/tweets?max_results=5&tweet.fields=created_at`,
      );
      const rows = Array.isArray(body["data"]) ? (body["data"] as Record<string, unknown>[]) : [];
      const wanted = ctx.unit.caption.trim();
      // X rewrites links to t.co; compare the leading text when the caption holds a URL.
      const head = wanted.split(/https?:\/\//)[0]!.trim();
      const match = rows.find((row) => {
        const text = String(row["text"] ?? "");
        return (
          (text === wanted || (head.length >= 12 && text.startsWith(head))) &&
          createdSinceCommit(ctx.unit, row["created_at"], ctx.now())
        );
      });
      const id = match ? numericId(match["id"]) : null;
      if (id)
        return {
          status: "posted",
          remoteId: id,
          url: `https://x.com/${ctx.session.accountName}/status/${id}`,
        };
      return { status: "unknown" };
    } catch (error) {
      if (error instanceof SocialApiError && error.kind === "auth") throw error;
      return { status: "unknown" };
    }
  },
};
