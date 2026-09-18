/** Shapes shared by the Instagram management views and their server functions. */
import { z } from "zod";

export const graphId = z.string().regex(/^\d{1,30}$/);
/** Graph cursors are opaque base64url-like tokens. */
export const graphCursor = z.string().regex(/^[A-Za-z0-9_=-]{1,512}$/);

export const commentAction = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("reply"),
      mediaId: graphId,
      commentId: graphId,
      message: z.string().trim().min(1).max(2200),
    })
    .strict(),
  z
    .object({
      action: z.literal("hide"),
      mediaId: graphId,
      commentId: graphId,
      hidden: z.boolean(),
    })
    .strict(),
  z.object({ action: z.literal("delete"), mediaId: graphId, commentId: graphId }).strict(),
]);
export type CommentAction = z.infer<typeof commentAction>;

export type InstagramMediaView = {
  id: string;
  caption: string;
  mediaType: string;
  productType: string | null;
  image: string | null;
  permalink: string | null;
  timestamp: string;
  likes: number | null;
  comments: number | null;
};
export type InstagramReplyView = {
  id: string;
  text: string;
  username: string;
  timestamp: string;
  hidden: boolean;
};
export type InstagramCommentView = InstagramReplyView & {
  likes: number;
  replies: InstagramReplyView[];
};

/** Feed insights for one post (Meta: `impressions` is deprecated; carousel children have none). */
export const INSIGHT_METRICS = ["reach", "likes", "comments", "saved", "shares"] as const;
export type InstagramInsights = Partial<Record<(typeof INSIGHT_METRICS)[number], number>>;
