/** YouTube Data API v3 `videos.insert` over the resumable upload protocol.
 * Shorts are just vertical videos of three minutes or less.
 * https://developers.google.com/youtube/v3/docs/videos/insert
 * https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
 * https://developers.google.com/youtube/v3/determine_quota_cost  (insert = 1,600 units; 10,000/day default)
 *
 * Quota: the day's spend is kept on the connection (Pacific-time day, which is
 * when Google resets it) and checked before each insert, so the sixth upload
 * of a default-quota day is refused here with tomorrow's time, not by Google
 * half-way through a 500 MB upload.
 */
import {
  SocialApiError,
  YOUTUBE_DEFAULT_QUOTA,
  YOUTUBE_INSERT_UNITS,
} from "../../social/connectors";
import {
  bodyOf,
  committed,
  readBody,
  type PublishContext,
  type PublishResult,
  type Publisher,
  type ReconcileResult,
} from "./types";

/** Resumable chunks must be multiples of 256 KiB. */
const CHUNK = 8 * 1024 * 1024;
const UPLOAD =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

export function classifyYouTube(status: number, body: Record<string, unknown>): SocialApiError {
  const error = body["error"] as
    { errors?: { reason?: unknown; domain?: unknown }[]; status?: unknown } | undefined;
  const reasons = (error?.errors ?? []).map((row) => String(row.reason ?? ""));
  const has = (reason: string) => reasons.includes(reason);
  if (status === 401 || has("authError"))
    return new SocialApiError("YouTube access expired. Reconnect YouTube.", "auth", status);
  if (
    has("quotaExceeded") ||
    has("dailyLimitExceeded") ||
    has("uploadLimitExceeded") ||
    has("rateLimitExceeded")
  )
    return new SocialApiError(
      "YouTube's daily upload quota is used up. It will be tried again tomorrow.",
      "quota",
      status,
      msUntilPacificMidnight(Date.now()),
    );
  if (has("youtubeSignupRequired"))
    return new SocialApiError("This Google account has no YouTube channel.", "rejected", status);
  if (has("insufficientPermissions") || has("forbidden") || status === 403)
    return new SocialApiError(
      "YouTube did not allow the upload. Reconnect YouTube and allow uploads.",
      "permission",
      status,
    );
  if (
    has("invalidTitle") ||
    has("invalidDescription") ||
    has("invalidTags") ||
    has("invalidCategoryId")
  )
    return new SocialApiError("YouTube rejected the title or description.", "rejected", status);
  if (has("mediaBodyRequired") || has("invalidVideoMetadata") || has("badRequest"))
    return new SocialApiError("YouTube did not accept the video.", "media", status);
  if (status === 429)
    return new SocialApiError(
      "YouTube is busy. Try again later.",
      "rate-limit",
      status,
      15 * 60_000,
    );
  if (status === 404 || status === 410)
    return new SocialApiError("The YouTube upload session expired.", "media", status);
  if (status >= 500)
    return new SocialApiError(
      "YouTube is unavailable right now. Try again.",
      "unavailable",
      status,
    );
  return new SocialApiError("YouTube did not accept this request.", "rejected", status);
}

/** Google resets API quota at midnight Pacific time. */
export function msUntilPacificMidnight(now: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const elapsed = ((get("hour") * 60 + get("minute")) * 60 + get("second")) * 1000;
  return Math.max(60_000, 24 * 60 * 60_000 - elapsed + 60_000);
}
export const pacificDay = (now: number) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));

const isShort = (video: { width: number; height: number; durationMs?: number | undefined }) =>
  video.height > video.width && (video.durationMs ?? 0) <= 180_000;

export const youtubePublisher: Publisher = {
  async publish(ctx): Promise<PublishResult> {
    const { unit, session } = ctx;
    if (session.accountId !== unit.accountId)
      throw new SocialApiError(
        "Reconnect the YouTube channel this video was made for.",
        "auth",
        401,
      );
    if (!session.scopes.includes("https://www.googleapis.com/auth/youtube.upload"))
      throw new SocialApiError("Reconnect YouTube and allow uploads.", "permission", 403);
    const video = unit.media.find((item) => item.kind === "video");
    if (!video) throw new SocialApiError("YouTube needs a video.", "media", 400);
    const progress = unit.progress;

    if (typeof progress["sessionUri"] !== "string") {
      // Quota check before anything is sent.
      const dailyQuota = Number(ctx.env["YOUTUBE_DAILY_QUOTA"]) || YOUTUBE_DEFAULT_QUOTA;
      const spent = session.meta["youtubeQuota"] as { day?: unknown; used?: unknown } | undefined;
      const today = pacificDay(ctx.now());
      const used = spent && spent.day === today ? Number(spent.used) || 0 : 0;
      if (used + YOUTUBE_INSERT_UNITS > dailyQuota)
        throw new SocialApiError(
          `YouTube's daily quota (${dailyQuota} units, ${YOUTUBE_INSERT_UNITS} per upload) is used up. It will be tried again tomorrow.`,
          "quota",
          403,
          msUntilPacificMidnight(ctx.now()),
        );
      const privacy = ["public", "unlisted", "private"].includes(unit.options.privacy ?? "")
        ? unit.options.privacy!
        : "public";
      // Opening the session is the commit: once it exists, the video appears when
      // the last byte lands, so a lost answer is settled by querying the session.
      await ctx.commit();
      let opened: Response;
      try {
        opened = await ctx.fetch(UPLOAD, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.token}`,
            "content-type": "application/json; charset=UTF-8",
            "X-Upload-Content-Length": String(video.bytes),
            "X-Upload-Content-Type": video.mime,
          },
          body: JSON.stringify({
            snippet: {
              title: (unit.title ?? "").trim().slice(0, 100),
              description: unit.caption.slice(0, 5000),
            },
            status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
          }),
          signal: AbortSignal.timeout(30_000),
          redirect: "error",
        });
      } catch {
        throw new SocialApiError("YouTube did not answer. Try again.", "unavailable", 0);
      }
      if (!opened.ok) throw classifyYouTube(opened.status, await readBody(opened));
      const sessionUri = opened.headers.get("location");
      if (!sessionUri || !/^https:\/\/[a-z0-9.-]*googleapis\.com\//.test(sessionUri))
        throw new SocialApiError("YouTube did not open an upload session.", "unavailable", 0);
      progress["sessionUri"] = sessionUri;
      progress["sent"] = 0;
      progress["quotaCharged"] = { day: today, units: used + YOUTUBE_INSERT_UNITS };
      await ctx.save();
      // The insert is charged whether or not the upload completes.
      await ctx
        .remember({ youtubeQuota: { day: today, used: used + YOUTUBE_INSERT_UNITS } })
        .catch(() => {});
    }

    const sessionUri = progress["sessionUri"] as string;
    let sent = Number(progress["sent"]) || 0;
    if (progress["resumeCheck"] !== false) {
      // Ask the session where it stands; the row's own count can lag a chunk behind.
      const where = await queryUpload(ctx, sessionUri, video.bytes);
      if (where.status === "done") return finished(ctx, where.body, video);
      if (where.status === "gone") {
        delete progress["sessionUri"];
        delete progress["committedAt"];
        await ctx.save();
        throw new SocialApiError(
          "The YouTube upload session expired. It will be started again.",
          "unavailable",
          0,
        );
      }
      sent = where.next;
      progress["sent"] = sent;
      progress["resumeCheck"] = false;
      await ctx.save();
    }
    while (sent < video.bytes) {
      if (ctx.now() > ctx.deadline) {
        progress["resumeCheck"] = true;
        await ctx.save();
        return { status: "pending", note: "Uploading to YouTube…", retryMs: 15_000 };
      }
      const end = Math.min(sent + CHUNK, video.bytes) - 1;
      const bytes = await ctx.media.readRange(video, sent, end);
      let response: Response;
      try {
        response = await ctx.fetch(sessionUri, {
          method: "PUT",
          headers: {
            "content-length": String(bytes.byteLength),
            "content-type": video.mime,
            "content-range": `bytes ${sent}-${end}/${video.bytes}`,
          },
          body: bodyOf(bytes),
          signal: AbortSignal.timeout(180_000),
          redirect: "error",
        });
      } catch {
        progress["resumeCheck"] = true;
        await ctx.save();
        throw new SocialApiError(
          "The YouTube upload was interrupted. It will resume.",
          "unavailable",
          0,
        );
      }
      if (response.status === 308) {
        const range = response.headers.get("range");
        const last = range ? Number(/bytes=0-(\d+)/.exec(range)?.[1]) : NaN;
        sent = Number.isFinite(last) ? last + 1 : end + 1;
        progress["sent"] = sent;
        await ctx.save();
        continue;
      }
      if (response.ok) return finished(ctx, await readBody(response), video);
      if (response.status >= 500 || response.status === 404 || response.status === 410) {
        progress["resumeCheck"] = true;
        await ctx.save();
      }
      throw classifyYouTube(response.status, await readBody(response));
    }
    // All bytes were sent but no final answer was recorded: ask the session.
    const where = await queryUpload(ctx, sessionUri, video.bytes);
    if (where.status === "done") return finished(ctx, where.body, video);
    return { status: "pending", note: "YouTube is finishing the upload…", retryMs: 30_000 };
  },

  async reconcile(ctx): Promise<ReconcileResult> {
    const sessionUri = ctx.unit.progress["sessionUri"];
    if (!committed(ctx.unit)) return { status: "unknown" };
    // Committed, but the session was never opened: nothing exists on YouTube.
    if (typeof sessionUri !== "string") return { status: "absent" };
    const video = ctx.unit.media.find((item) => item.kind === "video");
    if (!video) return { status: "unknown" };
    try {
      const where = await queryUpload(ctx, sessionUri, video.bytes);
      if (where.status === "done") {
        const done = finished(ctx, where.body, video);
        return done.status === "posted"
          ? { status: "posted", remoteId: done.remoteId, ...(done.url ? { url: done.url } : {}) }
          : { status: "unknown" };
      }
      if (where.status === "gone") {
        delete ctx.unit.progress["sessionUri"];
        return { status: "absent" };
      }
      // Bytes still owed: the upload resumes on the next run.
      ctx.unit.progress["sent"] = where.next;
      ctx.unit.progress["resumeCheck"] = false;
      return { status: "pending", note: "Uploading to YouTube…", retryMs: 15_000 };
    } catch (error) {
      if (error instanceof SocialApiError && (error.kind === "auth" || error.kind === "permission"))
        throw error;
      return { status: "unknown" };
    }
  },
};

async function queryUpload(
  ctx: PublishContext,
  sessionUri: string,
  total: number,
): Promise<
  | { status: "done"; body: Record<string, unknown> }
  | { status: "resume"; next: number }
  | { status: "gone" }
> {
  let response: Response;
  try {
    response = await ctx.fetch(sessionUri, {
      method: "PUT",
      headers: { "content-length": "0", "content-range": `bytes */${total}` },
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
  } catch {
    throw new SocialApiError("YouTube did not answer. Try again.", "unavailable", 0);
  }
  if (response.ok) return { status: "done", body: await readBody(response) };
  if (response.status === 308) {
    const range = response.headers.get("range");
    const last = range ? Number(/bytes=0-(\d+)/.exec(range)?.[1]) : NaN;
    return { status: "resume", next: Number.isFinite(last) ? last + 1 : 0 };
  }
  if (response.status === 404 || response.status === 410) return { status: "gone" };
  throw classifyYouTube(response.status, await readBody(response));
}

function finished(
  ctx: PublishContext,
  body: Record<string, unknown>,
  video: { width: number; height: number; durationMs?: number | undefined },
): PublishResult {
  const id =
    typeof body["id"] === "string" && /^[A-Za-z0-9_-]{6,20}$/.test(body["id"]) ? body["id"] : null;
  if (!id) throw new SocialApiError("YouTube did not confirm the upload.", "unavailable", 0);
  ctx.unit.progress["videoId"] = id;
  return {
    status: "posted",
    remoteId: id,
    url: isShort(video) ? `https://www.youtube.com/shorts/${id}` : `https://youtu.be/${id}`,
  };
}
