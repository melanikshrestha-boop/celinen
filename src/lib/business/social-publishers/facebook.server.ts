/** Facebook Page posts: text, one photo, several photos, a video, or a story.
 * https://developers.facebook.com/docs/pages-api/posts
 * https://developers.facebook.com/docs/graph-api/reference/page/photos
 * https://developers.facebook.com/docs/video-api/guides/publishing   (file_url, graph-video host)
 * https://developers.facebook.com/docs/page-stories-api                (photos published=false → photo_stories)
 */
import { FacebookApiError, facebookCall } from "../facebook.server";
import { SocialApiError } from "../../social/connectors";
import {
  committed,
  createdSinceCommit,
  numericId,
  type PublishContext,
  type PublishResult,
  type Publisher,
  type ReconcileResult,
} from "./types";

const KINDS: Record<FacebookApiError["kind"], SocialApiError["kind"]> = {
  "rate-limit": "rate-limit",
  auth: "auth",
  permission: "permission",
  duplicate: "duplicate",
  media: "media",
  rejected: "rejected",
  unavailable: "unavailable",
};
export const fromFacebookError = (error: unknown): SocialApiError =>
  error instanceof FacebookApiError
    ? new SocialApiError(error.message, KINDS[error.kind], error.status)
    : error instanceof SocialApiError
      ? error
      : new SocialApiError(
          error instanceof Error ? error.message : "Facebook could not post this.",
          "unavailable",
        );

async function call(
  ctx: PublishContext,
  path: string,
  body?: URLSearchParams,
  host?: "graph.facebook.com" | "graph-video.facebook.com",
) {
  try {
    return await facebookCall(path, ctx.session.token, {
      fetch: ctx.fetch,
      ...(body ? { body } : {}),
      ...(host ? { host } : {}),
      // A video URL upload can take a while to be accepted.
      timeoutMs: host === "graph-video.facebook.com" ? 120_000 : 20_000,
    });
  } catch (error) {
    throw fromFacebookError(error);
  }
}

const postUrl = (id: string) => `https://www.facebook.com/${id}`;

export const facebookPublisher: Publisher = {
  async publish(ctx): Promise<PublishResult> {
    const { unit, session } = ctx;
    if (session.accountId !== unit.accountId)
      throw new SocialApiError(
        "Reconnect Facebook and choose the Page this post was made for.",
        "auth",
        401,
      );
    const page = session.accountId;
    const progress = unit.progress;
    const images = unit.media.filter((item) => item.kind === "image");
    const video = unit.media.find((item) => item.kind === "video");
    const caption = unit.caption.trim();

    if (unit.kind === "story") {
      const photo = images[0];
      if (!photo || images.length !== 1)
        throw new SocialApiError("A story is one photo.", "media", 400);
      if (!progress["photoId"]) {
        const staged = await call(
          ctx,
          `${page}/photos`,
          new URLSearchParams({ url: await ctx.media.signedUrl(photo), published: "false" }),
        );
        const id = numericId(staged["id"]);
        if (!id) throw new SocialApiError("Facebook did not accept the photo.", "media", 400);
        progress["photoId"] = id;
        await ctx.save();
      }
      await ctx.commit();
      const story = await call(
        ctx,
        `${page}/photo_stories`,
        new URLSearchParams({ photo_id: String(progress["photoId"]) }),
      );
      const postId =
        typeof story["post_id"] === "string" && /^[\d_]+$/.test(story["post_id"])
          ? story["post_id"]
          : null;
      if (story["success"] !== true || !postId)
        throw new SocialApiError("Facebook did not confirm the story.", "unavailable", 0);
      return { status: "posted", remoteId: postId, url: postUrl(postId) };
    }

    if (unit.kind === "video" || video) {
      if (!video) throw new SocialApiError("Facebook video posts need a video.", "media", 400);
      await ctx.commit();
      const posted = await call(
        ctx,
        `${page}/videos`,
        new URLSearchParams({
          file_url: await ctx.media.signedUrl(video, 60 * 60),
          description: caption,
          ...(unit.title ? { title: unit.title } : {}),
        }),
        "graph-video.facebook.com",
      );
      const id = numericId(posted["id"]);
      if (!id) throw new SocialApiError("Facebook did not confirm the video.", "unavailable", 0);
      return { status: "posted", remoteId: id, url: postUrl(id) };
    }

    if (images.length === 1) {
      await ctx.commit();
      const posted = await call(
        ctx,
        `${page}/photos`,
        new URLSearchParams({
          url: await ctx.media.signedUrl(images[0]!),
          caption,
          published: "true",
        }),
      );
      const postId =
        typeof posted["post_id"] === "string" && /^[\d_]+$/.test(posted["post_id"])
          ? posted["post_id"]
          : null;
      const id = postId ?? numericId(posted["id"]);
      if (!id) throw new SocialApiError("Facebook did not confirm the post.", "unavailable", 0);
      return { status: "posted", remoteId: id, url: postUrl(id) };
    }

    if (images.length > 1) {
      // Unpublished photos first (safe to repeat: nothing is visible until the feed post).
      const staged = Array.isArray(progress["photoIds"]) ? (progress["photoIds"] as string[]) : [];
      for (const item of images.slice(staged.length)) {
        const photo = await call(
          ctx,
          `${page}/photos`,
          new URLSearchParams({ url: await ctx.media.signedUrl(item), published: "false" }),
        );
        const id = numericId(photo["id"]);
        if (!id) throw new SocialApiError("Facebook did not accept a photo.", "media", 400);
        staged.push(id);
        progress["photoIds"] = staged;
        await ctx.save();
      }
      const body = new URLSearchParams({ message: caption });
      staged.forEach((id, index) =>
        body.set(`attached_media[${index}]`, JSON.stringify({ media_fbid: id })),
      );
      await ctx.commit();
      const posted = await call(ctx, `${page}/feed`, body);
      const id =
        typeof posted["id"] === "string" && /^[\d_]+$/.test(posted["id"]) ? posted["id"] : null;
      if (!id) throw new SocialApiError("Facebook did not confirm the post.", "unavailable", 0);
      return { status: "posted", remoteId: id, url: postUrl(id) };
    }

    if (!caption) throw new SocialApiError("Write a caption first.", "rejected", 400);
    await ctx.commit();
    const posted = await call(ctx, `${page}/feed`, new URLSearchParams({ message: caption }));
    const id =
      typeof posted["id"] === "string" && /^[\d_]+$/.test(posted["id"]) ? posted["id"] : null;
    if (!id) throw new SocialApiError("Facebook did not confirm the post.", "unavailable", 0);
    return { status: "posted", remoteId: id, url: postUrl(id) };
  },

  /** Facebook has no client idempotency key. The Page's own recent items are
   * read back and matched by content and time; anything else stays unknown. */
  async reconcile(ctx): Promise<ReconcileResult> {
    const { unit, session } = ctx;
    if (!committed(unit)) return { status: "unknown" };
    const page = session.accountId;
    const now = ctx.now();
    const read = async (path: string) => {
      try {
        const result = await call(ctx, path);
        return Array.isArray(result["data"]) ? (result["data"] as Record<string, unknown>[]) : [];
      } catch (error) {
        const failure = fromFacebookError(error);
        if (failure.kind === "auth" || failure.kind === "permission") throw failure;
        return null;
      }
    };
    if (unit.kind === "story") {
      const photoId = numericId(unit.progress["photoId"]);
      const stories = await read(`${page}/stories?fields=post_id,media_id,creation_time&limit=25`);
      if (!stories) return { status: "unknown" };
      const match = stories.find((row) => photoId && String(row["media_id"]) === photoId);
      if (match && typeof match["post_id"] === "string")
        return { status: "posted", remoteId: match["post_id"] };
      return { status: "unknown" };
    }
    const video = unit.media.find((item) => item.kind === "video");
    if (video) {
      const videos = await read(`${page}/videos?fields=id,description,created_time&limit=10`);
      if (!videos) return { status: "unknown" };
      const match = videos.find(
        (row) =>
          String(row["description"] ?? "") === unit.caption.trim() &&
          createdSinceCommit(unit, row["created_time"], now),
      );
      if (match && numericId(match["id"]))
        return {
          status: "posted",
          remoteId: numericId(match["id"])!,
          url: postUrl(numericId(match["id"])!),
        };
      return { status: "unknown" };
    }
    const feed = await read(`${page}/feed?fields=id,message,created_time&limit=10`);
    if (!feed) return { status: "unknown" };
    const match = feed.find(
      (row) =>
        String(row["message"] ?? "") === unit.caption.trim() &&
        createdSinceCommit(unit, row["created_time"], now),
    );
    if (match && typeof match["id"] === "string")
      return { status: "posted", remoteId: match["id"], url: postUrl(match["id"]) };
    return { status: "unknown" };
  },
};
