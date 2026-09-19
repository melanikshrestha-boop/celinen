/** Instagram feed, carousel, story and Reel through the same container flow the
 * Cull/Develop publisher uses (instagram-post.server.ts): create container(s),
 * wait for FINISHED, commit, media_publish once, reconcile from the container.
 * https://developers.facebook.com/docs/instagram-platform/content-publishing
 * https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
 */
import { InstagramApiError, instagramCall } from "../instagram.server";
import { SocialApiError } from "../../social/connectors";
import {
  committed,
  numericId,
  pollPause,
  type PublishContext,
  type PublishResult,
  type Publisher,
  type ReconcileResult,
} from "./types";

/** Meta: check status about once a minute for no more than five minutes. */
export const INSTAGRAM_CONTAINER_TIMEOUT_MS = 5 * 60_000;

const KINDS: Record<InstagramApiError["kind"], SocialApiError["kind"]> = {
  "rate-limit": "rate-limit",
  "publish-limit": "quota",
  auth: "auth",
  permission: "permission",
  "not-ready": "not-ready",
  expired: "media",
  media: "media",
  rejected: "rejected",
  unavailable: "unavailable",
};
export const fromInstagramError = (error: unknown): SocialApiError =>
  error instanceof InstagramApiError
    ? new SocialApiError(
        error.message,
        KINDS[error.kind],
        error.status,
        error.kind === "publish-limit" ? 60 * 60_000 : null,
      )
    : error instanceof SocialApiError
      ? error
      : new SocialApiError(
          error instanceof Error ? error.message : "Instagram could not post this.",
          "unavailable",
        );

async function call(ctx: PublishContext, path: string, body?: URLSearchParams) {
  try {
    return await instagramCall(path, ctx.session.token, {
      fetch: ctx.fetch,
      ...(body ? { body } : {}),
    });
  } catch (error) {
    throw fromInstagramError(error);
  }
}

type ContainerState = "finished" | "pending" | "timeout" | "failed";
async function waitForContainers(ctx: PublishContext, ids: string[]): Promise<ContainerState> {
  const open = new Set(ids);
  const since = Date.parse(String(ctx.unit.progress["containerCreatedAt"] ?? "")) || ctx.now();
  for (let attempt = 0; ; attempt++) {
    for (const id of [...open]) {
      const status = await call(ctx, `${id}?fields=status_code`);
      if (status.status_code === "FINISHED" || status.status_code === "PUBLISHED") open.delete(id);
      else if (status.status_code === "ERROR" || status.status_code === "EXPIRED") return "failed";
    }
    if (!open.size) return "finished";
    if (ctx.now() - since > INSTAGRAM_CONTAINER_TIMEOUT_MS) return "timeout";
    const pause = pollPause(attempt);
    if (ctx.now() + pause > ctx.deadline) return "pending";
    await ctx.sleep(pause);
  }
}

const forget = (ctx: PublishContext) => {
  delete ctx.unit.progress["children"];
  delete ctx.unit.progress["containerId"];
  delete ctx.unit.progress["containerCreatedAt"];
};

export const instagramPublisher: Publisher = {
  async publish(ctx): Promise<PublishResult> {
    const { unit, session } = ctx;
    if (!session.scopes.includes("instagram_business_content_publish"))
      throw new SocialApiError("Reconnect Instagram and allow posting.", "permission", 403);
    if (session.accountId !== unit.accountId)
      throw new SocialApiError(
        "Reconnect the Instagram account this post was made for.",
        "auth",
        401,
      );
    const progress = unit.progress;
    const account = session.accountId;
    const images = unit.media.filter((item) => item.kind === "image");
    const video = unit.media.find((item) => item.kind === "video");

    if (!progress["containerId"] && !Array.isArray(progress["children"])) {
      // Clear refusal before any container exists, rather than at the last step.
      try {
        const limit = await call(
          ctx,
          `${account}/content_publishing_limit?fields=quota_usage,config`,
        );
        const row = Array.isArray(limit.data) ? (limit.data[0] as Record<string, unknown>) : limit;
        const used = Number(row?.["quota_usage"]);
        const total = Number(
          (row?.["config"] as { quota_total?: unknown } | undefined)?.quota_total,
        );
        if (Number.isFinite(used) && Number.isFinite(total) && total > 0 && used >= total)
          throw new SocialApiError(
            `Instagram allows ${total} API posts per 24 hours and this account has used them. Try again later.`,
            "quota",
            400,
            60 * 60_000,
          );
      } catch (error) {
        if (error instanceof SocialApiError && ["quota", "auth", "permission"].includes(error.kind))
          throw error;
        // Advisory only; media_publish enforces the real limit.
      }
    }

    if (unit.kind === "reel") {
      if (!video) throw new SocialApiError("Instagram Reels need a video.", "media", 400);
      if (!progress["containerId"]) {
        const created = await call(
          ctx,
          `${account}/media`,
          new URLSearchParams({
            media_type: "REELS",
            video_url: await ctx.media.signedUrl(video),
            caption: unit.caption,
            share_to_feed: unit.options.shareToFeed === false ? "false" : "true",
          }),
        );
        const id = numericId(created.id);
        if (!id) throw new SocialApiError("Instagram did not accept the video.", "media", 400);
        progress["containerId"] = id;
        progress["containerCreatedAt"] = new Date(ctx.now()).toISOString();
        await ctx.save();
      }
    } else if (unit.kind === "story") {
      const photo = images[0];
      if (!photo || images.length !== 1)
        throw new SocialApiError("A story is one photo.", "media", 400);
      // Meta: story publishing is for Business accounts. Unknown types are left to Meta to refuse.
      if (session.accountKind !== "user" && session.accountKind !== "business")
        throw new SocialApiError(
          "Instagram story publishing requires a Business account.",
          "permission",
          403,
        );
      if (!progress["containerId"]) {
        const created = await call(
          ctx,
          `${account}/media`,
          new URLSearchParams({
            image_url: await ctx.media.signedUrl(photo),
            media_type: "STORIES",
          }),
        );
        const id = numericId(created.id);
        if (!id) throw new SocialApiError("Instagram did not accept the photo.", "media", 400);
        progress["containerId"] = id;
        progress["containerCreatedAt"] = new Date(ctx.now()).toISOString();
        await ctx.save();
      }
    } else if (images.length > 1) {
      const children = Array.isArray(progress["children"])
        ? (progress["children"] as string[])
        : [];
      for (const item of images.slice(children.length)) {
        const created = await call(
          ctx,
          `${account}/media`,
          new URLSearchParams({
            image_url: await ctx.media.signedUrl(item),
            is_carousel_item: "true",
          }),
        );
        const id = numericId(created.id);
        if (!id) throw new SocialApiError("Instagram did not accept a photo.", "media", 400);
        children.push(id);
        progress["children"] = children;
        progress["containerCreatedAt"] ??= new Date(ctx.now()).toISOString();
        await ctx.save();
      }
      if (!progress["containerId"]) {
        const state = await waitForContainers(ctx, children);
        if (state === "pending")
          return {
            status: "pending",
            note: "Instagram is processing the photos…",
            retryMs: 60_000,
          };
        if (state !== "finished") {
          forget(ctx);
          throw new SocialApiError(
            state === "timeout"
              ? "Instagram took too long to process these photos. It will be tried again."
              : "Instagram could not process these photos.",
            state === "timeout" ? "unavailable" : "media",
            state === "timeout" ? 0 : 400,
          );
        }
        const created = await call(
          ctx,
          `${account}/media`,
          new URLSearchParams({
            media_type: "CAROUSEL",
            children: children.join(","),
            caption: unit.caption,
          }),
        );
        const id = numericId(created.id);
        if (!id) throw new SocialApiError("Instagram did not accept the carousel.", "media", 400);
        progress["containerId"] = id;
        await ctx.save();
      }
    } else {
      const photo = images[0];
      if (!photo) throw new SocialApiError("Instagram needs a photo.", "media", 400);
      if (!progress["containerId"]) {
        const created = await call(
          ctx,
          `${account}/media`,
          new URLSearchParams({
            image_url: await ctx.media.signedUrl(photo),
            caption: unit.caption,
          }),
        );
        const id = numericId(created.id);
        if (!id) throw new SocialApiError("Instagram did not accept the photo.", "media", 400);
        progress["containerId"] = id;
        progress["containerCreatedAt"] = new Date(ctx.now()).toISOString();
        await ctx.save();
      }
    }

    const containerId = String(progress["containerId"]);
    const state = await waitForContainers(ctx, [containerId]);
    if (state === "pending")
      return { status: "pending", note: "Instagram is processing the media…", retryMs: 60_000 };
    if (state !== "finished") {
      forget(ctx);
      throw new SocialApiError(
        state === "timeout"
          ? "Instagram took too long to process this. It will be tried again."
          : "Instagram could not process this media.",
        state === "timeout" ? "unavailable" : "media",
        state === "timeout" ? 0 : 400,
      );
    }

    // Durable intent before the only externally visible write.
    await ctx.commit();
    let published: Awaited<ReturnType<typeof call>>;
    try {
      published = await call(
        ctx,
        `${account}/media_publish`,
        new URLSearchParams({ creation_id: containerId }),
      );
    } catch (error) {
      const failure = fromInstagramError(error);
      if (failure.definitive && failure.kind === "not-ready")
        return {
          status: "pending",
          note: "Instagram is still processing the media…",
          retryMs: 60_000,
        };
      throw failure;
    }
    const mediaId = numericId(published.id);
    if (!mediaId)
      throw new SocialApiError("Instagram did not confirm this post.", "unavailable", 0);
    progress["mediaId"] = mediaId;
    let url: string | undefined;
    try {
      const media = await call(ctx, `${mediaId}?fields=permalink`);
      if (
        typeof media.permalink === "string" &&
        /^https:\/\/(www\.)?instagram\.com\//.test(media.permalink)
      )
        url = media.permalink;
    } catch {
      // The post is confirmed; the link is a convenience.
    }
    return { status: "posted", remoteId: mediaId, ...(url ? { url } : {}) };
  },

  async reconcile(ctx): Promise<ReconcileResult> {
    const containerId = numericId(ctx.unit.progress["containerId"]);
    if (!committed(ctx.unit) || !containerId) return { status: "unknown" };
    let status: Awaited<ReturnType<typeof call>>;
    try {
      status = await call(ctx, `${containerId}?fields=status_code`);
    } catch (error) {
      const failure = fromInstagramError(error);
      if (failure.kind === "auth" || failure.kind === "permission") throw failure;
      return { status: "unknown" };
    }
    if (status.status_code === "PUBLISHED") {
      // Instagram does not return the media id here; the container id identifies the post.
      return { status: "posted", remoteId: numericId(ctx.unit.progress["mediaId"]) ?? containerId };
    }
    if (status.status_code === "EXPIRED" || status.status_code === "ERROR") {
      forget(ctx);
      return { status: "absent" };
    }
    return { status: "unknown" };
  },
};
