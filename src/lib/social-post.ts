/** Caption drafts and compose URLs. Encrypted login first; we never claim a live post landed. */

import { SOCIAL_NETWORKS, type SocialId } from "./social-accounts";

export const POST_TONES = ["Professional", "Casual", "Warm"] as const;
export const POST_LENGTHS = ["Short", "Medium", "Long"] as const;
export type PostTone = (typeof POST_TONES)[number];
export type PostLength = (typeof POST_LENGTHS)[number];

export type SocialPost = {
  idea: string;
  tone: PostTone;
  length: PostLength;
  caption: string;
  hashtags: string[];
  createdAt: number;
};

export type ComposeAction = {
  id: SocialId;
  title: string;
  href: string | null;
  copy: boolean;
  hint: string;
};

const LIMIT: Partial<Record<SocialId, number>> = {
  x: 280,
  threads: 500,
  bluesky: 300,
  linkedin: 3000,
  instagram: 2200,
  facebook: 2200,
  pinterest: 500,
  mastodon: 500,
};

const DRAFT_KEY = "celinen.social.draft.v1";

function tagsFor(idea: string) {
  const value = idea.toLowerCase();
  if (/\b(game|sideline|football|keeper|sports)\b/.test(value))
    return ["#gameday", "#sportsphotography", "#sideline"];
  if (/\b(wedding|bride|ceremony)\b/.test(value)) return ["#wedding", "#weddingphotography"];
  if (/\b(gallery|tonight|deliver)\b/.test(value)) return ["#gallery", "#photography"];
  if (/\b(portrait|session)\b/.test(value)) return ["#portrait", "#photography"];
  return ["#photography", "#onassignment"];
}

function bodyFor(idea: string, tone: PostTone, length: PostLength) {
  const clean = idea.replace(/\s+/g, " ").trim();
  const professional = [
    `${clean}.`,
    "The keepers are in. Originals stay with me; the gallery is the copy you can send.",
    "Pick, then send — same night.",
  ];
  const casual = [
    `${clean}.`,
    "These are the frames I kept.",
    "Gallery’s up when you’re ready.",
  ];
  const warm = [
    `${clean}.`,
    "I kept the ones that still feel like being there.",
    "The set is ready whenever you want it.",
  ];
  const lines = tone === "Casual" ? casual : tone === "Warm" ? warm : professional;
  if (length === "Short") return lines.slice(0, 1).join(" ");
  if (length === "Long") return lines.join(" ");
  return lines.slice(0, 2).join(" ");
}

export function clipCaption(text: string, id: SocialId) {
  const limit = LIMIT[id];
  if (!limit || text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export function buildSocialPost(input: {
  idea: string;
  tone?: PostTone;
  length?: PostLength;
  hashtags?: boolean;
}): SocialPost {
  const idea = input.idea.replace(/\s+/g, " ").trim();
  const tone = input.tone ?? "Professional";
  const length = input.length ?? "Medium";
  const hashtags = input.hashtags === false ? [] : tagsFor(idea);
  const caption = [bodyFor(idea, tone, length), hashtags.join(" ")].filter(Boolean).join("\n\n");
  return { idea, tone, length, caption, hashtags, createdAt: Date.now() };
}

export function composeAction(id: SocialId, caption: string): ComposeAction {
  const network = SOCIAL_NETWORKS.find((item) => item.id === id)!;
  const text = clipCaption(caption, id);
  const encoded = encodeURIComponent(text);
  if (id === "x")
    return {
      id,
      title: network.title,
      href: `https://twitter.com/intent/tweet?text=${encoded}`,
      copy: true,
      hint: "Opens X compose. Review, then post.",
    };
  if (id === "bluesky")
    return {
      id,
      title: network.title,
      href: `https://bsky.app/intent/compose?text=${encoded}`,
      copy: true,
      hint: "Opens Bluesky compose. Review, then post.",
    };
  if (id === "threads")
    return {
      id,
      title: network.title,
      href: `https://www.threads.net/intent/post?text=${encoded}`,
      copy: true,
      hint: "Opens Threads compose. Review, then post.",
    };
  if (id === "linkedin")
    return {
      id,
      title: network.title,
      href: "https://www.linkedin.com/feed/",
      copy: true,
      hint: "Caption copied. Paste into LinkedIn, then post.",
    };
  if (id === "pinterest")
    return {
      id,
      title: network.title,
      href: `https://www.pinterest.com/pin/create/button/?description=${encoded}`,
      copy: true,
      hint: "Opens Pinterest with the caption. Add the frame, then pin.",
    };
  if (id === "facebook")
    return {
      id,
      title: network.title,
      href: "https://www.facebook.com/",
      copy: true,
      hint: "Caption copied. Paste into Facebook, then post.",
    };
  return {
    id,
    title: network.title,
    href: null,
    copy: true,
    hint: `No public compose URL for ${network.title}. Caption copied — paste in the app, then post.`,
  };
}

export function isPostIntent(text: string) {
  const value = text.toLowerCase();
  if (/\b(gallery|send|deliver|invoice|earnings|pick|lightroom)\b/.test(value) && !/\bpost\b/.test(value))
    return false;
  return /\b(post|caption|hashtag|instagram|tiktok|threads|linkedin|what should we post)\b/.test(
    value,
  );
}

export function writeSocialDraft(post: SocialPost) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(post));
  } catch {
    /* ignore */
  }
}

export function readSocialDraft(): SocialPost | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(DRAFT_KEY);
    const parsed = JSON.parse(raw) as SocialPost;
    if (!parsed || typeof parsed.caption !== "string" || !parsed.caption.trim()) return null;
    return parsed;
  } catch {
    return null;
  }
}
