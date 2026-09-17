/** The photographer's own Instagram posts, comments and insights.
 *
 * Every call runs with the token of the account connected to the signed-in
 * Celinen owner, so Instagram itself refuses objects of other accounts. Celinen
 * also checks that a media id belongs to that account and that a comment
 * belongs to that media before changing anything, so a forged id fails here
 * with a clear message instead of reaching Instagram.
 */
import {
  instagramCall,
  requireScope,
  type InstagramFetch,
  type InstagramSession,
} from "./instagram.server";
import {
  INSIGHT_METRICS,
  commentAction,
  graphCursor,
  graphId,
  type CommentAction,
  type InstagramCommentView,
  type InstagramInsights,
  type InstagramMediaView,
} from "../social/instagram-manage";

export type InstagramManageDeps = {
  fetch: InstagramFetch;
  session: (owner: string) => Promise<InstagramSession>;
};

const text = (value: unknown, max = 2200) => (typeof value === "string" ? value.slice(0, max) : "");
const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const httpsUrl = (value: unknown) =>
  typeof value === "string" && value.startsWith("https://") ? value : null;
const after = (paging: unknown) => {
  const cursor = (paging as { cursors?: { after?: unknown }; next?: unknown } | undefined) ?? {};
  // A missing `next` is the last page even when a cursor is present.
  return cursor.next && graphCursor.safeParse(cursor.cursors?.after).success
    ? (cursor.cursors!.after as string)
    : null;
};
const fields = (list: string) => encodeURIComponent(list);

export async function listInstagramMedia(
  owner: string,
  cursor: string | null,
  deps: InstagramManageDeps,
) {
  const session = await deps.session(owner);
  requireScope(session, "instagram_business_basic", "reading your posts");
  const query = `fields=${fields("id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count")}&limit=24${cursor ? `&after=${graphCursor.parse(cursor)}` : ""}`;
  const result = await instagramCall(`${session.accountId}/media?${query}`, session.token, {
    fetch: deps.fetch,
  });
  const rows = Array.isArray(result.data) ? (result.data as Record<string, unknown>[]) : [];
  const media: InstagramMediaView[] = rows.flatMap((row) => {
    if (!graphId.safeParse(row["id"]).success) return [];
    const mediaType = text(row["media_type"], 40);
    return [
      {
        id: row["id"] as string,
        caption: text(row["caption"]),
        mediaType,
        productType: text(row["media_product_type"], 40) || null,
        // Videos have a poster frame; copyrighted media may have neither.
        image: httpsUrl(mediaType === "VIDEO" ? row["thumbnail_url"] : row["media_url"]),
        permalink: httpsUrl(row["permalink"]),
        timestamp: text(row["timestamp"], 40),
        likes: count(row["like_count"]),
        comments: count(row["comments_count"]),
      },
    ];
  });
  return {
    account: { username: session.username, scopes: session.scopes },
    media,
    next: after(result.paging),
  };
}

async function ownedMedia(session: InstagramSession, mediaId: string, deps: InstagramManageDeps) {
  graphId.parse(mediaId);
  const media = await instagramCall(`${mediaId}?fields=id,username`, session.token, {
    fetch: deps.fetch,
  });
  if (media.id !== mediaId || media.username !== session.username)
    throw new Error("This post is not on your connected Instagram account.");
}

async function commentOnMedia(
  session: InstagramSession,
  mediaId: string,
  commentId: string,
  deps: InstagramManageDeps,
) {
  graphId.parse(commentId);
  const comment = await instagramCall(
    `${commentId}?fields=id,media,parent_id,hidden`,
    session.token,
    {
      fetch: deps.fetch,
    },
  );
  const media = (comment["media"] as { id?: unknown } | undefined)?.id;
  if (comment.id !== commentId || media !== mediaId)
    throw new Error("This comment is not on that post.");
  return { hidden: comment["hidden"] === true, parent: typeof comment["parent_id"] === "string" };
}

export async function listInstagramComments(
  owner: string,
  mediaId: string,
  cursor: string | null,
  deps: InstagramManageDeps,
) {
  const session = await deps.session(owner);
  requireScope(session, "instagram_business_manage_comments", "comment management");
  await ownedMedia(session, mediaId, deps);
  const query = `fields=${fields("id,text,username,timestamp,hidden,like_count,replies{id,text,username,timestamp,hidden}")}&limit=50${cursor ? `&after=${graphCursor.parse(cursor)}` : ""}`;
  const result = await instagramCall(`${mediaId}/comments?${query}`, session.token, {
    fetch: deps.fetch,
  });
  const rows = Array.isArray(result.data) ? (result.data as Record<string, unknown>[]) : [];
  const reply = (row: Record<string, unknown>) => ({
    id: row["id"] as string,
    text: text(row["text"]),
    username: text(row["username"], 60),
    timestamp: text(row["timestamp"], 40),
    hidden: row["hidden"] === true,
  });
  const comments: InstagramCommentView[] = rows
    .filter((row) => graphId.safeParse(row["id"]).success)
    .map((row) => {
      const replies = (row["replies"] as { data?: unknown } | undefined)?.data;
      return {
        ...reply(row),
        likes: count(row["like_count"]) ?? 0,
        replies: Array.isArray(replies)
          ? (replies as Record<string, unknown>[])
              .filter((r) => graphId.safeParse(r["id"]).success)
              .map(reply)
          : [],
      };
    });
  return { comments, next: after(result.paging) };
}

export async function actOnInstagramComment(
  owner: string,
  raw: CommentAction,
  deps: InstagramManageDeps,
) {
  const input = commentAction.parse(raw);
  const session = await deps.session(owner);
  requireScope(session, "instagram_business_manage_comments", "comment management");
  await ownedMedia(session, input.mediaId, deps);
  const comment = await commentOnMedia(session, input.mediaId, input.commentId, deps);
  const call = (path: string, options: Parameters<typeof instagramCall>[2]) =>
    instagramCall(path, session.token, { ...options, fetch: deps.fetch });
  if (input.action === "reply") {
    if (comment.hidden) throw new Error("Unhide this comment before replying.");
    if (comment.parent) throw new Error("Reply to the original comment.");
    const result = await call(`${input.commentId}/replies`, {
      body: new URLSearchParams({ message: input.message }),
    });
    if (!graphId.safeParse(result.id).success)
      throw new Error("Instagram did not confirm the reply.");
    return { ok: true as const, id: result.id as string };
  }
  if (input.action === "hide") {
    const result = await call(`${input.commentId}?hide=${input.hidden ? "true" : "false"}`, {
      method: "POST",
    });
    if (result.success !== true) throw new Error("Instagram did not confirm the change.");
    return { ok: true as const };
  }
  const result = await call(input.commentId, { method: "DELETE" });
  if (result.success !== true) throw new Error("Instagram did not confirm the deletion.");
  return { ok: true as const };
}

export async function instagramMediaInsights(
  owner: string,
  mediaId: string,
  deps: InstagramManageDeps,
) {
  const session = await deps.session(owner);
  requireScope(session, "instagram_business_manage_insights", "insights");
  await ownedMedia(session, mediaId, deps);
  const result = await instagramCall(
    `${mediaId}/insights?metric=${INSIGHT_METRICS.join(",")}`,
    session.token,
    {
      fetch: deps.fetch,
    },
  );
  const insights: InstagramInsights = {};
  for (const row of Array.isArray(result.data) ? (result.data as Record<string, unknown>[]) : []) {
    const name = row["name"];
    const values = row["values"];
    const value =
      Array.isArray(values) && values.length
        ? (values[0] as { value?: unknown }).value
        : (row["total_value"] as { value?: unknown } | undefined)?.value;
    if ((INSIGHT_METRICS as readonly unknown[]).includes(name) && typeof value === "number")
      insights[name as (typeof INSIGHT_METRICS)[number]] = value;
  }
  return insights;
}
