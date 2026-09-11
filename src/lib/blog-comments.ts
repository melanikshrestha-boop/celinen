export const COMMENT_STANCES = ["like", "dislike", "improve"] as const;
export type CommentStance = (typeof COMMENT_STANCES)[number];

export const GENIE_POLLS = [
  { id: "turnaround", label: "Get it out immediately" },
  { id: "peak-action", label: "Find the peak-action frame" },
  { id: "who", label: "Know who is in every photo" },
  { id: "one-workflow", label: "One workflow, no transferring" },
  { id: "edit-like-me", label: "Edit like me, per frame" },
  { id: "collections", label: "Athlete and team galleries" },
  { id: "sell", label: "Sell while I shoot" },
  { id: "backup", label: "Never lose a file" },
  { id: "captions", label: "Captions without typing" },
  { id: "archive", label: "Search my whole career" },
] as const;

export type BlogComment = {
  id: string;
  slug: string;
  name: string;
  stance: CommentStance;
  body: string;
  createdAt: string;
  likes: number;
  dislikes: number;
};

export type BlogCommentDraft = {
  slug: string;
  name: string;
  stance: CommentStance;
  body: string;
};

const NAME_MAX = 80;
const BODY_MAX = 2000;

export function validateBlogComment(draft: BlogCommentDraft): string | null {
  const name = draft.name.trim();
  const body = draft.body.trim();
  if (!COMMENT_STANCES.includes(draft.stance)) return "Pick like, dislike, or improve.";
  if (!draft.slug.trim()) return "Missing article.";
  if (name.length > NAME_MAX) return "Keep the name under 80 characters.";
  if (body.length < 8) return "Write a little more so we can use it.";
  if (body.length > BODY_MAX) return "Keep the note under 2,000 characters.";
  if (/[<>]/.test(body) || /[<>]/.test(name)) return "Plain text only.";
  return null;
}

export function normalizeBlogComment(draft: BlogCommentDraft, id: string, now = Date.now()): BlogComment {
  const error = validateBlogComment(draft);
  if (error) throw new Error(error);
  return {
    id,
    slug: draft.slug.trim(),
    name: draft.name.trim() || "Photographer",
    stance: draft.stance,
    body: draft.body.trim(),
    createdAt: new Date(now).toISOString(),
    likes: 0,
    dislikes: 0,
  };
}

export function isBlogComment(value: unknown): value is BlogComment {
  if (!value || typeof value !== "object") return false;
  const row = value as BlogComment;
  return (
    typeof row.id === "string" &&
    row.id &&
    typeof row.slug === "string" &&
    typeof row.name === "string" &&
    COMMENT_STANCES.includes(row.stance) &&
    typeof row.body === "string" &&
    typeof row.createdAt === "string" &&
    Number.isFinite(row.likes) &&
    Number.isFinite(row.dislikes)
  );
}

export const STANCE_LABEL: Record<CommentStance, string> = {
  like: "I want this",
  dislike: "This misses",
  improve: "Improve this",
};
