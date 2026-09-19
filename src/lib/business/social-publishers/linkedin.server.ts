/** LinkedIn: text, image, multi-image or video posts as the member, or as an
 * organization the member administers when w_organization_social was granted.
 * https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api
 * https://learn.microsoft.com/linkedin/marketing/community-management/shares/images-api
 * https://learn.microsoft.com/linkedin/marketing/community-management/shares/videos-api
 * Rate limit (Posts API): 150 requests per day per member, 100,000 per day per app.
 */
import { LINKEDIN_VERSION } from "../social-connections.server";
import { SocialApiError } from "../../social/connectors";
import {
  bodyOf,
  committed,
  createdSinceCommit,
  pollPause,
  readBody,
  type PublishContext,
  type PublishResult,
  type Publisher,
  type ReconcileResult,
} from "./types";

const API = "https://api.linkedin.com";
const headersFor = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "LinkedIn-Version": LINKEDIN_VERSION,
  "X-Restli-Protocol-Version": "2.0.0",
});

export function classifyLinkedIn(status: number, body: Record<string, unknown>): SocialApiError {
  const code = typeof body["serviceErrorCode"] === "number" ? body["serviceErrorCode"] : null;
  const message = String(body["message"] ?? "").toLowerCase();
  if (status === 401 || code === 65600 || code === 65601)
    return new SocialApiError("LinkedIn access expired. Reconnect LinkedIn.", "auth", status);
  if (status === 403)
    return new SocialApiError(
      "LinkedIn did not grant posting for this account. Reconnect LinkedIn and allow it.",
      "permission",
      status,
    );
  if (status === 429)
    return new SocialApiError(
      "LinkedIn's posting limit is reached. Try again later.",
      "rate-limit",
      status,
      15 * 60_000,
    );
  if (status === 422 && message.includes("duplicate"))
    return new SocialApiError("LinkedIn already has this post.", "duplicate", status);
  if (status === 422 || status === 400)
    return new SocialApiError(
      "LinkedIn did not accept this post. Check the caption and media.",
      "rejected",
      status,
    );
  if (status >= 500)
    return new SocialApiError(
      "LinkedIn is unavailable right now. Try again.",
      "unavailable",
      status,
    );
  return new SocialApiError("LinkedIn did not accept this request.", "rejected", status);
}

async function api(ctx: PublishContext, path: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await ctx.fetch(`${API}${path}`, {
      ...init,
      headers: {
        ...headersFor(ctx.session.token),
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
  } catch {
    throw new SocialApiError("LinkedIn did not answer. Try again.", "unavailable", 0);
  }
  const body = await readBody(response);
  if (!response.ok) throw classifyLinkedIn(response.status, body);
  return { response, body };
}

async function put(ctx: PublishContext, url: string, bytes: Uint8Array) {
  let response: Response;
  try {
    response = await ctx.fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${ctx.session.token}`,
        "content-type": "application/octet-stream",
      },
      body: bodyOf(bytes),
      signal: AbortSignal.timeout(120_000),
      redirect: "error",
    });
  } catch {
    throw new SocialApiError("LinkedIn did not take the upload. Try again.", "unavailable", 0);
  }
  if (!response.ok) throw classifyLinkedIn(response.status, await readBody(response));
  return response;
}

const author = (ctx: PublishContext) => {
  const org = ctx.unit.options.organization;
  if (org) {
    const known = Array.isArray(ctx.session.meta["organizations"])
      ? (ctx.session.meta["organizations"] as { urn: string }[]).map((row) => row.urn)
      : [];
    if (!ctx.session.scopes.includes("w_organization_social") || !known.includes(org))
      throw new SocialApiError(
        "Reconnect LinkedIn and allow posting for that organization.",
        "permission",
        403,
      );
    return org;
  }
  if (!ctx.session.scopes.includes("w_member_social"))
    throw new SocialApiError("Reconnect LinkedIn and allow posting.", "permission", 403);
  return `urn:li:person:${ctx.session.accountId}`;
};

export const linkedinPublisher: Publisher = {
  async publish(ctx): Promise<PublishResult> {
    const { unit } = ctx;
    if (ctx.session.accountId !== unit.accountId)
      throw new SocialApiError(
        "Reconnect the LinkedIn account this post was made for.",
        "auth",
        401,
      );
    const owner = author(ctx);
    const progress = unit.progress;
    const images = unit.media.filter((item) => item.kind === "image");
    const video = unit.media.find((item) => item.kind === "video");

    // Images API: initializeUpload → PUT bytes. Repeating an upload is harmless.
    const imageUrns = Array.isArray(progress["images"]) ? (progress["images"] as string[]) : [];
    for (const item of images.slice(imageUrns.length)) {
      const { body } = await api(ctx, "/rest/images?action=initializeUpload", {
        method: "POST",
        body: JSON.stringify({ initializeUploadRequest: { owner } }),
      });
      const value = body["value"] as { uploadUrl?: unknown; image?: unknown } | undefined;
      if (
        !value ||
        typeof value.uploadUrl !== "string" ||
        typeof value.image !== "string" ||
        !/^urn:li:image:/.test(value.image)
      )
        throw new SocialApiError("LinkedIn did not open an image upload.", "unavailable", 0);
      await put(ctx, value.uploadUrl, await ctx.media.download(item));
      imageUrns.push(value.image);
      progress["images"] = imageUrns;
      await ctx.save();
    }

    // Videos API: initializeUpload → PUT each part (ETag) → finalizeUpload → wait for AVAILABLE.
    let videoUrn = typeof progress["video"] === "string" ? (progress["video"] as string) : null;
    if (video && !progress["videoFinalized"]) {
      if (!videoUrn) {
        const { body } = await api(ctx, "/rest/videos?action=initializeUpload", {
          method: "POST",
          body: JSON.stringify({
            initializeUploadRequest: {
              owner,
              fileSizeBytes: video.bytes,
              uploadCaptions: false,
              uploadThumbnail: false,
            },
          }),
        });
        const value = body["value"] as
          | {
              video?: unknown;
              uploadToken?: unknown;
              uploadInstructions?: {
                uploadUrl?: unknown;
                firstByte?: unknown;
                lastByte?: unknown;
              }[];
            }
          | undefined;
        if (
          !value ||
          typeof value.video !== "string" ||
          !Array.isArray(value.uploadInstructions) ||
          !value.uploadInstructions.length
        )
          throw new SocialApiError("LinkedIn did not open a video upload.", "unavailable", 0);
        videoUrn = value.video;
        progress["video"] = videoUrn;
        progress["videoToken"] = typeof value.uploadToken === "string" ? value.uploadToken : "";
        progress["videoParts"] = value.uploadInstructions.map((part) => ({
          url: String(part.uploadUrl),
          first: Number(part.firstByte),
          last: Number(part.lastByte),
        }));
        progress["videoEtags"] = [];
        await ctx.save();
      }
      const parts = progress["videoParts"] as { url: string; first: number; last: number }[];
      const etags = progress["videoEtags"] as string[];
      for (const part of parts.slice(etags.length)) {
        if (ctx.now() > ctx.deadline)
          return { status: "pending", note: "Uploading the video to LinkedIn…", retryMs: 15_000 };
        // Parts are what LinkedIn asked for; they are read straight from storage in pieces.
        const bytes = await ctx.media.readRange(video, part.first, part.last);
        const response = await put(ctx, part.url, bytes);
        const etag = response.headers.get("etag");
        if (!etag)
          throw new SocialApiError("LinkedIn did not acknowledge a video part.", "unavailable", 0);
        etags.push(etag);
        progress["videoEtags"] = etags;
        await ctx.save();
      }
      await api(ctx, "/rest/videos?action=finalizeUpload", {
        method: "POST",
        body: JSON.stringify({
          finalizeUploadRequest: {
            video: videoUrn,
            uploadToken: progress["videoToken"] ?? "",
            uploadedPartIds: etags,
          },
        }),
      });
      progress["videoFinalized"] = new Date(ctx.now()).toISOString();
      await ctx.save();
    }
    if (video && videoUrn) {
      // Wait for processing; a post referencing an unprocessed video is refused.
      for (let attempt = 0; ; attempt++) {
        const { body } = await api(ctx, `/rest/videos/${encodeURIComponent(videoUrn)}`);
        const status = String(body["status"] ?? "");
        if (status === "AVAILABLE") break;
        if (status === "PROCESSING_FAILED") {
          delete progress["video"];
          delete progress["videoFinalized"];
          throw new SocialApiError("LinkedIn could not process the video.", "media", 400);
        }
        const pause = pollPause(attempt);
        if (ctx.now() + pause > ctx.deadline)
          return { status: "pending", note: "LinkedIn is processing the video…", retryMs: 60_000 };
        await ctx.sleep(pause);
      }
    }

    const content =
      video && videoUrn
        ? { media: { id: videoUrn, ...(unit.title ? { title: unit.title } : {}) } }
        : imageUrns.length > 1
          ? { multiImage: { images: imageUrns.map((id) => ({ id })) } }
          : imageUrns.length === 1
            ? { media: { id: imageUrns[0]! } }
            : null;
    const commentary = unit.caption.trim();
    if (!content && !commentary)
      throw new SocialApiError("Write a caption first.", "rejected", 400);
    await ctx.commit();
    const { response } = await api(ctx, "/rest/posts", {
      method: "POST",
      body: JSON.stringify({
        author: owner,
        commentary,
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
        ...(content ? { content } : {}),
      }),
    });
    const urn = response.headers.get("x-restli-id");
    if (!urn || !/^urn:li:(share|ugcPost):\d+$/.test(urn))
      throw new SocialApiError("LinkedIn did not confirm this post.", "unavailable", 0);
    return { status: "posted", remoteId: urn, url: `https://www.linkedin.com/feed/update/${urn}` };
  },

  /** No client key on LinkedIn either: read the author's latest posts back and
   * match on commentary and time. Needs r_member_social for members, which
   * LinkedIn grants sparingly; without it the answer is unknown. */
  async reconcile(ctx): Promise<ReconcileResult> {
    if (!committed(ctx.unit)) return { status: "unknown" };
    let owner: string;
    try {
      owner = author(ctx);
    } catch {
      return { status: "unknown" };
    }
    try {
      const { body } = await api(
        ctx,
        `/rest/posts?author=${encodeURIComponent(owner)}&q=author&count=10&sortBy=LAST_MODIFIED`,
      );
      const rows = Array.isArray(body["elements"])
        ? (body["elements"] as Record<string, unknown>[])
        : [];
      const match = rows.find(
        (row) =>
          String(row["commentary"] ?? "") === ctx.unit.caption.trim() &&
          createdSinceCommit(ctx.unit, Number(row["createdAt"]), ctx.now()),
      );
      if (match && typeof match["id"] === "string")
        return {
          status: "posted",
          remoteId: match["id"],
          url: `https://www.linkedin.com/feed/update/${match["id"]}`,
        };
      return { status: "unknown" };
    } catch (error) {
      if (error instanceof SocialApiError && error.kind === "auth") throw error;
      return { status: "unknown" };
    }
  },
};
