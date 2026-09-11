import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServerFn } from "@tanstack/react-start";
import {
  GENIE_POLLS,
  isBlogComment,
  normalizeBlogComment,
  validateBlogComment,
  type BlogComment,
  type BlogCommentDraft,
} from "./blog-comments";

type Store = {
  comments: BlogComment[];
  polls: Record<string, Record<string, number>>;
};

const FILE = join(process.cwd(), ".data", "blog-comments.json");
const POLL_IDS = new Set(GENIE_POLLS.map((row) => row.id));

async function readStore(): Promise<Store> {
  try {
    const raw = JSON.parse(await readFile(FILE, "utf8")) as Store;
    const comments = Array.isArray(raw.comments) ? raw.comments.filter(isBlogComment) : [];
    const polls = raw.polls && typeof raw.polls === "object" ? raw.polls : {};
    return { comments, polls };
  } catch {
    return { comments: [], polls: {} };
  }
}

async function writeStore(store: Store): Promise<void> {
  await mkdir(join(process.cwd(), ".data"), { recursive: true });
  await writeFile(FILE, JSON.stringify(store, null, 2), "utf8");
}

export const listBlogThread = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => {
    if (!d?.slug || typeof d.slug !== "string") throw new Error("Missing article.");
    return { slug: d.slug };
  })
  .handler(async ({ data }) => {
    const store = await readStore();
    return {
      comments: store.comments.filter((row) => row.slug === data.slug),
      poll: store.polls[data.slug] ?? {},
    };
  });

export const postBlogComment = createServerFn({ method: "POST" })
  .inputValidator((d: BlogCommentDraft) => {
    const error = validateBlogComment(d);
    if (error) throw new Error(error);
    return d;
  })
  .handler(async ({ data }) => {
    const store = await readStore();
    const comment = normalizeBlogComment(data, `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    store.comments.push(comment);
    await writeStore(store);
    return comment;
  });

export const voteBlogComment = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; delta: "like" | "dislike" }) => d)
  .handler(async ({ data }) => {
    const store = await readStore();
    const comment = store.comments.find((row) => row.id === data.id);
    if (!comment) throw new Error("That note is gone.");
    if (data.delta === "like") comment.likes += 1;
    else comment.dislikes += 1;
    await writeStore(store);
    return comment;
  });

export const voteGeniePoll = createServerFn({ method: "POST" })
  .inputValidator((d: { slug: string; option: string }) => {
    if (!d?.slug || !POLL_IDS.has(d.option)) throw new Error("Pick a real pain.");
    return d;
  })
  .handler(async ({ data }) => {
    const store = await readStore();
    const poll = store.polls[data.slug] ?? {};
    poll[data.option] = (poll[data.option] ?? 0) + 1;
    store.polls[data.slug] = poll;
    await writeStore(store);
    return poll;
  });
