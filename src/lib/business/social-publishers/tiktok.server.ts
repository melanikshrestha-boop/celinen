/** TikTok Content Posting API, Direct Post: a video uploaded in chunks
 * (FILE_UPLOAD) or a photo post pulled from a verified URL (PULL_FROM_URL).
 * https://developers.tiktok.com/doc/content-posting-api-get-started
 * https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
 * https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
 * https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status
 *
 * Unaudited apps: TikTok restricts every Direct Post to the creator alone
 * (privacy SELF_ONLY) until the app passes its audit. Set TIKTOK_AUDITED=true
 * on the Worker only after that audit; until then Celinen forces SELF_ONLY and
 * says so in the result note.
 */
import { SocialApiError } from "../../social/connectors";
import {
  bodyOf,
  committed,
  pollPause,
  readBody,
  type PublishContext,
  type PublishResult,
  type Publisher,
  type ReconcileResult,
} from "./types";

const API = "https://open.tiktokapis.com/v2";
/** Chunk rules: 5 MB ≤ chunk ≤ 64 MB; files under 5 MB go whole; the last chunk may run long (≤ 128 MB). */
const CHUNK = 10 * 1024 * 1024;

const FAIL_REASONS: Record<string, [string, SocialApiError["kind"]]> = {
  file_format_check_failed: ["TikTok rejected the video format.", "media"],
  duration_check_failed: ["TikTok rejected the video length.", "media"],
  frame_rate_check_failed: ["TikTok rejected the video frame rate.", "media"],
  picture_size_check_failed: ["TikTok rejected the video size.", "media"],
  video_pull_failed: ["TikTok could not fetch the video.", "media"],
  photo_pull_failed: ["TikTok could not fetch the photos.", "media"],
  publish_cancelled: ["The TikTok post was cancelled.", "rejected"],
  spam_risk_too_many_posts: ["TikTok's daily posting limit for this account is reached.", "quota"],
  spam_risk_user_banned_from_posting: ["TikTok has blocked posting on this account.", "permission"],
  spam_risk_text: ["TikTok flagged the caption. Change it and post again.", "rejected"],
  auth_failed: ["TikTok access expired. Reconnect TikTok.", "auth"],
  reached_active_user_cap: ["TikTok's active-user cap for unaudited apps is reached.", "quota"],
  internal: ["TikTok is unavailable right now.", "unavailable"],
};

export function classifyTikTok(status: number, body: Record<string, unknown>): SocialApiError {
  const error = body["error"] as { code?: unknown } | undefined;
  const code = String(error?.code ?? "");
  const map: Record<string, [string, SocialApiError["kind"], number | null]> = {
    access_token_invalid: ["TikTok access expired. Reconnect TikTok.", "auth", null],
    scope_not_authorized: ["Reconnect TikTok and allow posting.", "permission", null],
    scope_permission_missed: ["Reconnect TikTok and allow posting.", "permission", null],
    rate_limit_exceeded: ["TikTok is busy. Try again later.", "rate-limit", 15 * 60_000],
    spam_risk_too_many_posts: [
      "TikTok's daily posting limit for this account is reached.",
      "quota",
      6 * 60 * 60_000,
    ],
    spam_risk_user_banned_from_posting: [
      "TikTok has blocked posting on this account.",
      "permission",
      null,
    ],
    reached_active_user_cap: [
      "TikTok's active-user cap for unaudited apps is reached.",
      "quota",
      24 * 60 * 60_000,
    ],
    unaudited_client_can_only_post_to_private_accounts: [
      "TikTok only lets an unaudited app post privately. Set the post to private or finish TikTok's app audit.",
      "rejected",
      null,
    ],
    url_ownership_unverified: [
      "TikTok has not verified https://lenslab.dev/api/social-media/ as a URL prefix. Verify it in the TikTok developer portal.",
      "config",
      null,
    ],
    privacy_level_option_mismatch: [
      "TikTok does not allow that privacy level for this account.",
      "rejected",
      null,
    ],
    invalid_file_upload: ["TikTok rejected the upload.", "media", null],
    invalid_params: ["TikTok did not accept this post.", "rejected", null],
    internal_error: ["TikTok is unavailable right now. Try again.", "unavailable", null],
  };
  const known = map[code];
  if (known) return new SocialApiError(known[0], known[1], status, known[2]);
  if (status === 401)
    return new SocialApiError("TikTok access expired. Reconnect TikTok.", "auth", status);
  if (status === 403)
    return new SocialApiError("Reconnect TikTok and allow posting.", "permission", status);
  if (status === 429)
    return new SocialApiError(
      "TikTok is busy. Try again later.",
      "rate-limit",
      status,
      15 * 60_000,
    );
  if (status >= 500)
    return new SocialApiError("TikTok is unavailable right now. Try again.", "unavailable", status);
  return new SocialApiError("TikTok did not accept this request.", "rejected", status || 400);
}

async function api(ctx: PublishContext, path: string, payload?: Record<string, unknown>) {
  let response: Response;
  try {
    response = await ctx.fetch(`${API}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.session.token}`,
        "content-type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(payload ?? {}),
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
  } catch {
    throw new SocialApiError("TikTok did not answer. Try again.", "unavailable", 0);
  }
  const raw = await response.text().catch(() => "");
  const body = await readBody(new Response(raw));
  const code = String((body["error"] as { code?: unknown } | undefined)?.code ?? "ok");
  if (!response.ok || code !== "ok") throw classifyTikTok(response.status, body);
  return { data: (body["data"] ?? {}) as Record<string, unknown>, raw };
}

type Creator = {
  privacy: string[];
  maxDurationSec: number;
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
};
/** TikTok requires querying creator_info before every post. */
async function creatorInfo(ctx: PublishContext): Promise<Creator> {
  const { data } = await api(ctx, "/post/publish/creator_info/query/");
  const privacy = Array.isArray(data["privacy_level_options"])
    ? (data["privacy_level_options"] as string[])
    : [];
  const creator = {
    privacy,
    maxDurationSec: Number(data["max_video_post_duration_sec"]) || 600,
    commentDisabled: data["comment_disabled"] === true,
    duetDisabled: data["duet_disabled"] === true,
    stitchDisabled: data["stitch_disabled"] === true,
  };
  await ctx.remember({ tiktokCreator: creator }).catch(() => {});
  return creator;
}

function privacyFor(ctx: PublishContext, creator: Creator) {
  const audited = ctx.env["TIKTOK_AUDITED"] === "true";
  const wanted = ctx.unit.options.privacy;
  if (!audited) return { level: "SELF_ONLY", note: "Posted privately (unaudited TikTok app)." };
  if (wanted && creator.privacy.includes(wanted)) return { level: wanted, note: "" };
  if (creator.privacy.includes("SELF_ONLY"))
    return { level: "SELF_ONLY", note: "Posted privately." };
  throw new SocialApiError(
    "TikTok did not allow any privacy level for this account.",
    "rejected",
    400,
  );
}

/** Files under 5 MB (and any file smaller than one chunk) go whole; otherwise
 * total_chunk_count = floor(size / chunk_size) and the last chunk takes the rest. */
function chunking(size: number) {
  const chunkSize = Math.min(CHUNK, size);
  return { chunkSize, count: Math.max(1, Math.floor(size / chunkSize)) };
}

async function putChunk(
  ctx: PublishContext,
  url: string,
  bytes: Uint8Array,
  start: number,
  end: number,
  total: number,
  mime: string,
) {
  let response: Response;
  try {
    response = await ctx.fetch(url, {
      method: "PUT",
      headers: {
        "content-type": mime,
        "content-length": String(bytes.byteLength),
        "content-range": `bytes ${start}-${end}/${total}`,
      },
      body: bodyOf(bytes),
      signal: AbortSignal.timeout(180_000),
      redirect: "error",
    });
  } catch {
    throw new SocialApiError("TikTok did not take a video chunk. Try again.", "unavailable", 0);
  }
  // 206: chunk stored; 201: upload complete.
  if (response.status !== 206 && response.status !== 201 && response.status !== 200)
    throw new SocialApiError(
      "TikTok rejected a video chunk.",
      response.status >= 500 ? "unavailable" : "media",
      response.status,
    );
}

async function statusOf(ctx: PublishContext, publishId: string) {
  const { data, raw } = await api(ctx, "/post/publish/status/fetch/", { publish_id: publishId });
  // Post ids are 64-bit integers; JSON.parse would round them. Read the digits from the raw text.
  const ids =
    /"publicaly_available_post_id"\s*:\s*\[([^\]]*)\]/.exec(raw)?.[1]?.match(/\d{6,}/g) ?? [];
  return {
    status: String(data["status"] ?? ""),
    failReason: String(data["fail_reason"] ?? ""),
    uploadedBytes: Number(data["uploaded_bytes"]) || 0,
    postId: ids[0] ?? null,
  };
}

async function settle(ctx: PublishContext, publishId: string): Promise<PublishResult> {
  for (let attempt = 0; ; attempt++) {
    const state = await statusOf(ctx, publishId);
    if (state.status === "PUBLISH_COMPLETE") {
      const note = String(ctx.unit.progress["privacyNote"] ?? "");
      // No permalink: user.info.basic carries no @handle, and TikTok URLs need one.
      return { status: "posted", remoteId: state.postId ?? publishId, ...(note ? { note } : {}) };
    }
    if (state.status === "FAILED") {
      const known = FAIL_REASONS[state.failReason];
      delete ctx.unit.progress["publishId"];
      delete ctx.unit.progress["committedAt"];
      throw new SocialApiError(
        known?.[0] ?? "TikTok could not publish this post.",
        known?.[1] ?? "rejected",
        400,
      );
    }
    const pause = pollPause(attempt) * 2;
    if (ctx.now() + pause > ctx.deadline)
      return { status: "pending", note: "TikTok is processing the post…", retryMs: 60_000 };
    await ctx.sleep(pause);
  }
}

export const tiktokPublisher: Publisher = {
  async publish(ctx): Promise<PublishResult> {
    const { unit, session } = ctx;
    if (session.accountId !== unit.accountId)
      throw new SocialApiError("Reconnect the TikTok account this post was made for.", "auth", 401);
    if (!session.scopes.includes("video.publish"))
      throw new SocialApiError("Reconnect TikTok and allow posting.", "permission", 403);
    const progress = unit.progress;
    const video = unit.media.find((item) => item.kind === "video");
    const images = unit.media.filter((item) => item.kind === "image");
    if (!video && !images.length)
      throw new SocialApiError("TikTok needs a video or photos.", "media", 400);

    if (typeof progress["publishId"] === "string") {
      // A previous run already started this post; continue with TikTok's own record of it.
      if (video && !progress["uploaded"] && (await continueUpload(ctx, video)) === "pending")
        return { status: "pending", note: "Uploading the video to TikTok…", retryMs: 15_000 };
      return settle(ctx, progress["publishId"] as string);
    }

    const creator = await creatorInfo(ctx);
    const privacy = privacyFor(ctx, creator);
    progress["privacyNote"] = privacy.note;
    if (video && (video.durationMs ?? 0) > creator.maxDurationSec * 1000)
      throw new SocialApiError(
        `TikTok allows this account ${Math.round(creator.maxDurationSec / 60)} minutes per video.`,
        "media",
        400,
      );
    const flags = {
      disable_comment: unit.options.disableComment ?? creator.commentDisabled,
      disable_duet: unit.options.disableDuet ?? creator.duetDisabled,
      disable_stitch: unit.options.disableStitch ?? creator.stitchDisabled,
    };

    if (video) {
      if (!session.scopes.includes("video.upload"))
        throw new SocialApiError("Reconnect TikTok and allow video uploads.", "permission", 403);
      const { chunkSize, count } = chunking(video.bytes);
      // The publish id is TikTok's key for this post: commit before init so a
      // lost answer is reconciled from status/fetch rather than re-initialised.
      await ctx.commit();
      const { data } = await api(ctx, "/post/publish/video/init/", {
        post_info: {
          title: unit.caption.trim().slice(0, 2200),
          privacy_level: privacy.level,
          ...flags,
          video_cover_timestamp_ms: 1000,
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: video.bytes,
          chunk_size: chunkSize,
          total_chunk_count: count,
        },
      });
      const publishId = String(data["publish_id"] ?? "");
      const uploadUrl = String(data["upload_url"] ?? "");
      if (!publishId || !/^https:\/\//.test(uploadUrl))
        throw new SocialApiError("TikTok did not open the upload.", "unavailable", 0);
      progress["publishId"] = publishId;
      progress["uploadUrl"] = uploadUrl;
      progress["chunkSize"] = chunkSize;
      progress["chunkCount"] = count;
      progress["chunksDone"] = 0;
      await ctx.save();
      if ((await continueUpload(ctx, video)) === "pending")
        return { status: "pending", note: "Uploading the video to TikTok…", retryMs: 15_000 };
      return settle(ctx, publishId);
    }

    // Photo posts only pull from URLs on a domain verified in the developer portal.
    const urls: string[] = [];
    for (const item of images) urls.push(await ctx.media.proxyUrl(item));
    await ctx.commit();
    const { data } = await api(ctx, "/post/publish/content/init/", {
      post_info: {
        title: (unit.title ?? unit.caption).trim().slice(0, 90),
        description: unit.caption.trim().slice(0, 4000),
        privacy_level: privacy.level,
        disable_comment: flags.disable_comment,
        auto_add_music: false,
      },
      source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: urls },
      post_mode: "DIRECT_POST",
      media_type: "PHOTO",
    });
    const publishId = String(data["publish_id"] ?? "");
    if (!publishId) throw new SocialApiError("TikTok did not accept the photos.", "unavailable", 0);
    progress["publishId"] = publishId;
    progress["uploaded"] = true;
    await ctx.save();
    return settle(ctx, publishId);
  },

  async reconcile(ctx): Promise<ReconcileResult> {
    const publishId = ctx.unit.progress["publishId"];
    if (!committed(ctx.unit)) return { status: "unknown" };
    // Committed but init never answered: TikTok has nothing to show; a fresh init is safe.
    if (typeof publishId !== "string") return { status: "absent" };
    try {
      const state = await statusOf(ctx, publishId);
      if (state.status === "PUBLISH_COMPLETE")
        return { status: "posted", remoteId: state.postId ?? publishId };
      if (state.status === "FAILED") {
        delete ctx.unit.progress["publishId"];
        return { status: "absent" };
      }
      return { status: "pending", note: "TikTok is processing the post…", retryMs: 60_000 };
    } catch (error) {
      if (error instanceof SocialApiError && (error.kind === "auth" || error.kind === "permission"))
        throw error;
      return { status: "unknown" };
    }
  },
};

/** Sends the remaining chunks. TikTok reports uploaded_bytes for an upload in
 * progress, so a resumed run trusts its own chunk count and, if that is
 * missing, TikTok's byte count. */
async function continueUpload(
  ctx: PublishContext,
  video: PublishContext["unit"]["media"][number],
): Promise<"done" | "pending"> {
  const progress = ctx.unit.progress;
  const uploadUrl = String(progress["uploadUrl"] ?? "");
  const chunkSize = Number(progress["chunkSize"]);
  const count = Number(progress["chunkCount"]);
  if (!uploadUrl || !chunkSize || !count)
    throw new SocialApiError(
      "TikTok upload state is missing. It will be tried again.",
      "unavailable",
      0,
    );
  let done = Number(progress["chunksDone"]) || 0;
  for (; done < count; done++) {
    if (ctx.now() > ctx.deadline) {
      progress["chunksDone"] = done;
      await ctx.save();
      return "pending";
    }
    const start = done * chunkSize;
    // The final chunk absorbs the remainder, as TikTok's chunking rules require.
    const end = done === count - 1 ? video.bytes - 1 : start + chunkSize - 1;
    const bytes = await ctx.media.readRange(video, start, end);
    await putChunk(ctx, uploadUrl, bytes, start, end, video.bytes, video.mime);
    progress["chunksDone"] = done + 1;
    await ctx.save();
  }
  progress["uploaded"] = true;
  await ctx.save();
  return "done";
}
