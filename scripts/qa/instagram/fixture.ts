/** Synthetic server functions for the isolated Instagram QA page. No network,
 * no accounts: every "Instagram" answer here is invented and labelled as such.
 */
if (location.origin !== "http://127.0.0.1:8094") throw new Error("Isolated QA only");

type Post = {
  id: string;
  status: string;
  note: string;
  caption: string;
  format: "portrait" | "square";
  source: "cull" | "develop";
  username: string;
  photos: number;
  createdAt: string;
  permalink?: string;
};

export const qa = {
  connected: true,
  scopes: [
    "instagram_business_basic",
    "instagram_business_content_publish",
    "instagram_business_manage_comments",
    "instagram_business_manage_insights",
  ],
  /** How many advance steps report "processing" before publishing. */
  processingSteps: 1,
  failPublish: false,
  created: [] as unknown[],
  uploads: [] as { path: string; bytes: number; type: string; head: number[] }[],
  advances: 0,
  actions: [] as unknown[],
  errors: [] as string[],
  posts: new Map<string, Post>(),
  comments: [
    {
      id: "17800000000000001",
      text: "That dive is unreal",
      username: "coach.ramos",
      timestamp: "2026-09-16T01:00:00+0000",
      hidden: false,
      likes: 3,
      replies: [
        {
          id: "17800000000000002",
          text: "Thank you!",
          username: "sideline.studio",
          timestamp: "2026-09-16T01:05:00+0000",
          hidden: false,
        },
      ],
    },
    {
      id: "17800000000000003",
      text: "buy followers cheap",
      username: "spam.account",
      timestamp: "2026-09-16T02:00:00+0000",
      hidden: false,
      likes: 0,
      replies: [],
    },
  ],
};
Object.assign(window, { __instagramQA: qa });
window.addEventListener("error", (e) => qa.errors.push(e.message));
window.addEventListener("unhandledrejection", (e) => qa.errors.push(String(e.reason)));

const pause = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

export const instagramAccount = async () => {
  await pause(120);
  return {
    configured: true,
    connection: qa.connected
      ? {
          username: "sideline.studio",
          accountType: "MEDIA_CREATOR",
          expiresAt: new Date(Date.now() + 50 * 864e5).toISOString(),
          active: true,
          scopes: qa.scopes,
        }
      : null,
    posts: [...qa.posts.values()].reverse(),
  };
};
export const startInstagramConnection = async () => "about:blank#instagram-authorize-fixture";
export const finishInstagramConnection = async () => ({ username: "sideline.studio" });
export const disconnectInstagram = async () => {
  qa.connected = false;
  return { disconnected: true };
};

export const createInstagramPost = async ({
  data,
}: {
  data: {
    id: string;
    caption: string;
    format: "portrait" | "square";
    source: "cull" | "develop";
    items: unknown[];
  };
}) => {
  qa.created.push(data);
  await pause();
  const existing = qa.posts.get(data.id);
  const post: Post = existing ?? {
    id: data.id,
    status: "awaiting-upload",
    note: "",
    caption: data.caption,
    format: data.format,
    source: data.source,
    username: "sideline.studio",
    photos: data.items.length,
    createdAt: new Date().toISOString(),
  };
  qa.posts.set(data.id, post);
  return {
    post,
    uploads:
      post.status === "awaiting-upload"
        ? data.items.map((_, i) => ({ path: `owner/${data.id}/${i}.jpg`, token: `fixture-${i}` }))
        : [],
  };
};
export const advanceInstagramPost = async ({ data }: { data: { id: string } }) => {
  qa.advances++;
  await pause(400);
  const post = qa.posts.get(data.id)!;
  if (post.status === "published") return post;
  if (qa.processingSteps > 0) {
    qa.processingSteps--;
    Object.assign(post, { status: "processing", note: "Instagram is processing the photos…" });
  } else if (qa.failPublish)
    Object.assign(post, {
      status: "failed",
      note: "Instagram's daily publishing limit for this account is reached. Try again later.",
    });
  else
    Object.assign(post, {
      status: "published",
      note: "Posted to Instagram.",
      permalink: "https://www.instagram.com/p/QA-FIXTURE/",
    });
  return post;
};
export const discardInstagramPost = async ({ data }: { data: { id: string } }) => {
  const post = qa.posts.get(data.id)!;
  post.status = "discarded";
  return post;
};

const square = (hue: number) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="hsl(${hue} 45% 40%)"/></svg>`)}`;
export const instagramMedia = async ({ data }: { data: { after: string | null } }) => {
  await pause(150);
  const page = data.after ? 1 : 0;
  return {
    account: { username: "sideline.studio", scopes: qa.scopes },
    media: Array.from({ length: 8 }, (_, i) => ({
      id: `179000000000${page}${String(i).padStart(4, "0")}`, // Graph ids exceed 2^53; keep them strings
      caption: `Fixture post ${page * 8 + i + 1}\nsecond line`,
      mediaType: "IMAGE",
      productType: "FEED",
      image: square(page * 40 + i * 25),
      permalink: "https://www.instagram.com/p/QA/",
      timestamp: "2026-09-16T01:00:00+0000",
      likes: 100 + i,
      comments: 2,
    })),
    next: page ? null : "QVFIUmFfZml4dHVyZQ",
  };
};
export const instagramComments = async () => {
  await pause(150);
  return { comments: structuredClone(qa.comments), next: null };
};
export const instagramCommentAction = async ({
  data,
}: {
  data: { action: string; commentId: string; hidden?: boolean; message?: string };
}) => {
  qa.actions.push(data);
  await pause(150);
  const comment = qa.comments.find((c) => c.id === data.commentId);
  if (data.action === "hide" && comment) comment.hidden = !!data.hidden;
  if (data.action === "delete") qa.comments = qa.comments.filter((c) => c.id !== data.commentId);
  if (data.action === "reply" && comment)
    comment.replies.push({
      id: String(Date.now()),
      text: data.message!,
      username: "sideline.studio",
      timestamp: new Date().toISOString(),
      hidden: false,
    });
  return { ok: true };
};
export const instagramInsights = async () => {
  await pause(150);
  return { reach: 2480, likes: 131, comments: 2, saved: 17, shares: 6 };
};

/** Records what the composer uploads instead of sending it anywhere. */
export const supabase = {
  storage: {
    from: (bucket: string) => ({
      uploadToSignedUrl: async (
        path: string,
        _token: string,
        blob: Blob,
        options: { contentType: string },
      ) => {
        if (bucket !== "publishing-media-v1") throw new Error("wrong bucket");
        const head = Array.from(new Uint8Array(await blob.slice(0, 3).arrayBuffer()));
        qa.uploads.push({ path, bytes: blob.size, type: options.contentType, head });
        return { data: { path }, error: null };
      },
    }),
  },
};
