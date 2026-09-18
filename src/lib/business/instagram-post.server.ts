/** Publishes Cull/Develop photos to an Instagram feed, one resumable step at a time.
 *
 * Flow (Meta content publishing): the page frames JPEGs with the C++ social
 * operator and uploads them to the private `publishing-media-v1` bucket through
 * owner-scoped signed upload URLs. This module verifies those exact bytes, gives
 * Instagram a short-lived signed URL per photo, creates containers (children,
 * then a CAROUSEL container), waits for FINISHED, and calls media_publish once.
 *
 * Duplicate-post safety, the lesson from delivery publishing:
 *  - the post id is chosen by the composer and is the row's primary key;
 *  - a row lease serializes every step, so a double click or a second tab waits;
 *  - status `publishing` is stored *before* media_publish. A run that finds it,
 *    or any media_publish answer that is not a definitive refusal, becomes
 *    `uncertain` and media_publish is never sent again for that post.
 */
import { businessDatabase } from "./database.server";
import {
  InstagramApiError,
  instagramCall,
  instagramSession,
  requireScope,
  type InstagramFetch,
  type InstagramSession,
} from "./instagram.server";
import {
  PUBLISHING_BUCKET,
  instagramPostDiscardable,
  instagramPostInput,
  isInstagramPostRecord,
  jpegDimensions,
  sameInstagramPost,
  sha256Hex,
  type InstagramPostInput,
  type InstagramPostRecord,
  type InstagramPostStatus,
} from "../social/instagram-post";

type Database = ReturnType<typeof businessDatabase>;
export type InstagramPostDeps = {
  db: Database;
  fetch: InstagramFetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  session: (owner: string) => Promise<InstagramSession>;
};
export function instagramPostDeps(overrides: Partial<InstagramPostDeps> = {}): InstagramPostDeps {
  const db = overrides.db ?? businessDatabase();
  const request = overrides.fetch ?? fetch;
  return {
    db,
    fetch: request,
    now: overrides.now ?? Date.now,
    sleep: overrides.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    session: overrides.session ?? ((owner) => instagramSession(owner, { db, fetch: request })),
  };
}

const TABLE = "social_publications";
const LEASE_MS = 180_000;
/** Time one request may spend waiting on Instagram before handing back to the page. */
export const POLL_BUDGET_MS = 25_000;
/** Meta: check status about once a minute for no more than five minutes. */
export const CONTAINER_TIMEOUT_MS = 5 * 60_000;
/** Instagram fetches the photo when the container is created; the URL need not outlive that. */
const SIGNED_URL_SECONDS = 15 * 60;
const STALE_MS = 24 * 60 * 60_000;
const POLL_STEPS_MS = [1500, 2500, 4000, 6000, 8000];

export type InstagramPostView = {
  id: string;
  status: InstagramPostStatus;
  note: string;
  caption: string;
  format: InstagramPostRecord["format"];
  source: InstagramPostRecord["source"];
  username: string;
  photos: number;
  createdAt: string;
  publishedAt?: string;
  permalink?: string;
};
export const viewInstagramPost = (post: InstagramPostRecord): InstagramPostView => ({
  id: post.id,
  status: post.status,
  note: post.note,
  caption: post.caption,
  format: post.format,
  source: post.source,
  username: post.username,
  photos: post.items.length,
  createdAt: post.createdAt,
  ...(post.publishedAt ? { publishedAt: post.publishedAt } : {}),
  ...(post.permalink ? { permalink: post.permalink } : {}),
});

const iso = (deps: InstagramPostDeps, offset = 0) => new Date(deps.now() + offset).toISOString();
const numericId = (value: unknown) =>
  typeof value === "string" && /^\d+$/.test(value) ? value : null;

async function uploadTickets(deps: InstagramPostDeps, post: InstagramPostRecord) {
  const tickets: { path: string; token: string }[] = [];
  for (const item of post.items) {
    // upsert: an interrupted upload can be sent again with a fresh ticket.
    const signed = await deps.db.storage
      .from(PUBLISHING_BUCKET)
      .createSignedUploadUrl(item.path, { upsert: true });
    if (signed.error || !signed.data?.token)
      throw new Error("Could not prepare the photo upload. Nothing was posted.");
    tickets.push({ path: item.path, token: signed.data.token });
  }
  return tickets;
}

async function bucketIsSafe(db: Database) {
  const { data, error } = await db.storage.getBucket(PUBLISHING_BUCKET);
  return (
    !error &&
    !!data &&
    !data.public &&
    data.file_size_limit === 8388608 &&
    data.allowed_mime_types?.length === 1 &&
    data.allowed_mime_types[0] === "image/jpeg"
  );
}

/** Saves the draft (or returns the same draft for a retry) and hands out upload tickets. */
export async function createInstagramPost(
  owner: string,
  raw: InstagramPostInput,
  deps: InstagramPostDeps = instagramPostDeps(),
) {
  const input = instagramPostInput.parse(raw);
  const db = deps.db;
  const previous = await db
    .from(TABLE)
    .select("record")
    .eq("id", input.id)
    .eq("owner_id", owner)
    .maybeSingle();
  if (previous.error) throw new Error("Publishing storage is unavailable.");
  if (previous.data) {
    const old = previous.data.record;
    if (!isInstagramPostRecord(old) || !sameInstagramPost(old, input))
      throw new Error(
        "This post already exists with different photos or caption. Start a new post.",
      );
    return {
      post: viewInstagramPost(old),
      uploads: old.status === "awaiting-upload" ? await uploadTickets(deps, old) : [],
    };
  }
  const session = await deps.session(owner);
  requireScope(session, "instagram_business_content_publish", "posting");
  if (!(await bucketIsSafe(db)))
    throw new Error("Publishing media storage is not safely configured.");
  await sweepInstagramMedia(owner, deps).catch(() => {});
  const { count, error: countError } = await db
    .from(TABLE)
    .select("id", { head: true, count: "exact" })
    .eq("owner_id", owner);
  if (countError || (count ?? 0) >= 1000)
    throw new Error("Publishing storage is full or unavailable.");
  const now = iso(deps);
  const record: InstagramPostRecord = {
    kind: "instagram-post",
    version: 1,
    id: input.id,
    source: input.source,
    format: input.format,
    caption: input.caption,
    accountId: session.accountId,
    username: session.username,
    // Paths are derived from the verified owner and server-checked id only.
    items: input.items.map((item, index) => ({
      ...item,
      path: `${owner}/${input.id}/${index}.jpg`,
    })),
    createdAt: now,
    updatedAt: now,
    status: "awaiting-upload",
    note: "",
  };
  const { error } = await db.from(TABLE).insert({ id: input.id, owner_id: owner, record });
  if (error) {
    // A concurrent first attempt with the same id won the insert; answer as a retry would.
    const raced = await db
      .from(TABLE)
      .select("record")
      .eq("id", input.id)
      .eq("owner_id", owner)
      .maybeSingle();
    if (
      raced.data &&
      isInstagramPostRecord(raced.data.record) &&
      sameInstagramPost(raced.data.record, input)
    )
      return {
        post: viewInstagramPost(raced.data.record),
        uploads: await uploadTickets(deps, raced.data.record),
      };
    throw new Error("Could not save this post. Nothing was posted; try again.");
  }
  return { post: viewInstagramPost(record), uploads: await uploadTickets(deps, record) };
}

type Lease = { post: InstagramPostRecord; save: () => Promise<void>; release: () => Promise<void> };
async function claim(owner: string, id: string, deps: InstagramPostDeps): Promise<Lease> {
  const db = deps.db,
    lease = crypto.randomUUID();
  const { data, error } = await db
    .from(TABLE)
    .update({ lease, lease_until: iso(deps, LEASE_MS) })
    .eq("id", id)
    .eq("owner_id", owner)
    .or(`lease.is.null,lease_until.lt.${iso(deps)}`)
    .select("record,revision")
    .maybeSingle();
  if (error || !data || !isInstagramPostRecord(data.record))
    throw new Error("This post is already being handled or is unavailable. Check again shortly.");
  const post = data.record;
  let revision = Number(data.revision);
  return {
    post,
    save: async () => {
      post.updatedAt = iso(deps);
      const saved = await db
        .from(TABLE)
        .update({ record: post, revision: revision + 1, lease_until: iso(deps, LEASE_MS) })
        .eq("id", id)
        .eq("owner_id", owner)
        .eq("lease", lease)
        .select("id")
        .maybeSingle();
      if (saved.error || !saved.data)
        throw new Error(
          "Could not save posting progress. Check this post again before anything else.",
        );
      revision++;
    },
    release: async () => {
      await db
        .from(TABLE)
        .update({ lease: null, lease_until: null })
        .eq("id", id)
        .eq("owner_id", owner)
        .eq("lease", lease);
    },
  };
}

async function removeMedia(deps: InstagramPostDeps, post: InstagramPostRecord) {
  if (post.mediaRemovedAt) return;
  const removed = await deps.db.storage
    .from(PUBLISHING_BUCKET)
    .remove(post.items.map((item) => item.path));
  if (!removed.error) post.mediaRemovedAt = iso(deps);
}

/** Every byte Instagram will fetch is the byte the photographer confirmed. */
async function verifyUploads(deps: InstagramPostDeps, post: InstagramPostRecord) {
  for (const item of post.items) {
    const file = await deps.db.storage.from(PUBLISHING_BUCKET).download(item.path);
    if (file.error || !file.data)
      throw new Error("The photos have not finished uploading. Try again.");
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    const size = jpegDimensions(bytes);
    if (
      bytes.byteLength !== item.bytes ||
      !size ||
      size.width !== item.width ||
      size.height !== item.height ||
      (await sha256Hex(bytes)) !== item.sha256
    )
      throw new Error("An uploaded photo does not match what you confirmed. Post again.");
  }
}

type ContainerState = "finished" | "pending" | "timeout" | "failed";
async function waitForContainers(
  ids: string[],
  session: InstagramSession,
  post: InstagramPostRecord,
  deps: InstagramPostDeps,
  deadline: number,
): Promise<ContainerState> {
  const open = new Set(ids);
  for (let attempt = 0; ; attempt++) {
    for (const id of [...open]) {
      const status = await instagramCall(`${id}?fields=status_code`, session.token, {
        fetch: deps.fetch,
      });
      if (status.status_code === "FINISHED") open.delete(id);
      else if (status.status_code === "ERROR" || status.status_code === "EXPIRED") return "failed";
      else if (status.status_code === "PUBLISHED") open.delete(id); // only reachable for a published parent
    }
    if (!open.size) return "finished";
    if (deps.now() - Date.parse(post.containerCreatedAt ?? iso(deps)) > CONTAINER_TIMEOUT_MS)
      return "timeout";
    const pause = POLL_STEPS_MS[Math.min(attempt, POLL_STEPS_MS.length - 1)]!;
    if (deps.now() + pause > deadline) return "pending";
    await deps.sleep(pause);
  }
}

async function signedUrl(deps: InstagramPostDeps, path: string) {
  const signed = await deps.db.storage
    .from(PUBLISHING_BUCKET)
    .createSignedUrl(path, SIGNED_URL_SECONDS);
  if (signed.error || !signed.data?.signedUrl)
    throw new Error("Could not give Instagram access to the photos.");
  return signed.data.signedUrl;
}

const forgetContainers = (post: InstagramPostRecord) => {
  delete post.children;
  delete post.containerId;
  delete post.containerCreatedAt;
};

/** One bounded step toward published. Safe to call any number of times. */
export async function advanceInstagramPost(
  owner: string,
  id: string,
  deps: InstagramPostDeps = instagramPostDeps(),
): Promise<InstagramPostView> {
  const { post, save, release } = await claim(owner, id, deps);
  const set = async (status: InstagramPostStatus, note: string) => {
    post.status = status;
    post.note = note;
    await save();
  };
  try {
    if (["published", "discarded", "expired"].includes(post.status)) {
      if (post.status === "published" && !post.mediaRemovedAt) {
        await removeMedia(deps, post);
        if (post.mediaRemovedAt) await save();
      }
      return viewInstagramPost(post);
    }
    const session = await deps.session(owner);
    if (session.accountId !== post.accountId) {
      // Never publish to an account other than the one shown when the post was confirmed.
      if (post.status === "publishing" || post.status === "uncertain")
        return viewInstagramPost(post);
      await set("failed", `Reconnect @${post.username} to post this.`);
      return viewInstagramPost(post);
    }
    if (post.status === "publishing" || post.status === "uncertain") {
      await reconcile(post, session, deps, set);
      return viewInstagramPost(post);
    }
    requireScope(session, "instagram_business_content_publish", "posting");
    await pipeline(post, session, deps, save, set);
    return viewInstagramPost(post);
  } catch (error) {
    if (
      post.status !== "published" &&
      post.status !== "publishing" &&
      post.status !== "uncertain"
    ) {
      const message = error instanceof Error ? error.message : "Instagram could not post this.";
      if (!post.verifiedAt && post.status === "awaiting-upload") post.note = message;
      else {
        post.status = "failed";
        post.note = message;
      }
      await save().catch(() => {});
    }
    return viewInstagramPost(post);
  } finally {
    await release();
  }
}

async function reconcile(
  post: InstagramPostRecord,
  session: InstagramSession,
  deps: InstagramPostDeps,
  set: (status: InstagramPostStatus, note: string) => Promise<void>,
) {
  const unconfirmed =
    "Instagram has not confirmed this post. Check your profile; Celinen will not send it again.";
  if (!post.containerId) return set("uncertain", unconfirmed);
  const status = await instagramCall(`${post.containerId}?fields=status_code`, session.token, {
    fetch: deps.fetch,
  }).catch(() => null);
  if (status?.status_code === "PUBLISHED") {
    post.publishedAt ??= iso(deps);
    await removeMedia(deps, post);
    return set("published", "Posted to Instagram.");
  }
  // An expired or failed container can never have been published.
  if (status?.status_code === "EXPIRED" || status?.status_code === "ERROR") {
    forgetContainers(post);
    return set("failed", "Instagram did not post this. You can post it again.");
  }
  return set("uncertain", unconfirmed);
}

async function pipeline(
  post: InstagramPostRecord,
  session: InstagramSession,
  deps: InstagramPostDeps,
  save: () => Promise<void>,
  set: (status: InstagramPostStatus, note: string) => Promise<void>,
) {
  const deadline = deps.now() + POLL_BUDGET_MS;
  const call = (path: string, body?: URLSearchParams) =>
    instagramCall(path, session.token, { fetch: deps.fetch, ...(body ? { body } : {}) });

  if (!post.verifiedAt) {
    await verifyUploads(deps, post);
    post.verifiedAt = iso(deps);
    await set("preparing", "Sending photos to Instagram…");
  } else if (post.status !== "processing") await set("preparing", "Sending photos to Instagram…");

  const carousel = post.items.length > 1;
  if (!post.containerId && !post.children?.length) {
    // Clear refusal before any container exists, rather than a failure at the last step.
    try {
      const limit = await call(
        `${post.accountId}/content_publishing_limit?fields=quota_usage,config`,
      );
      const row = Array.isArray(limit.data) ? (limit.data[0] as Record<string, unknown>) : limit;
      const used = Number(row?.["quota_usage"]);
      const total = Number((row?.["config"] as { quota_total?: unknown } | undefined)?.quota_total);
      if (Number.isFinite(used) && Number.isFinite(total) && total > 0 && used >= total)
        throw new InstagramApiError(
          `Instagram allows ${total} app posts per 24 hours and this account has used them. Try again later.`,
          400,
          null,
          2207042,
          "publish-limit",
        );
    } catch (error) {
      if (
        error instanceof InstagramApiError &&
        ["publish-limit", "auth", "permission"].includes(error.kind)
      )
        throw error;
      // The quota check is advisory; media_publish still enforces the real limit.
    }
  }

  // Containers: one per photo, persisted as each is created so a retry resumes.
  if (carousel) {
    const children = post.children ?? [];
    for (const item of post.items.slice(children.length)) {
      const created = await call(
        `${post.accountId}/media`,
        new URLSearchParams({
          image_url: await signedUrl(deps, item.path),
          is_carousel_item: "true",
        }),
      );
      const childId = numericId(created.id);
      if (!childId) throw new Error("Instagram did not accept a photo.");
      children.push(childId);
      post.children = children;
      post.containerCreatedAt ??= iso(deps);
      await save();
    }
  } else if (!post.containerId) {
    const created = await call(
      `${post.accountId}/media`,
      new URLSearchParams({
        image_url: await signedUrl(deps, post.items[0]!.path),
        caption: post.caption,
      }),
    );
    const containerId = numericId(created.id);
    if (!containerId) throw new Error("Instagram did not accept the photo.");
    post.containerId = containerId;
    post.containerCreatedAt = iso(deps);
    await save();
  }

  const settle = async (ids: string[]) => {
    const state = await waitForContainers(ids, session, post, deps, deadline);
    if (state === "finished") return true;
    if (state === "pending") {
      await set("processing", "Instagram is processing the photos…");
      return false;
    }
    forgetContainers(post);
    throw new Error(
      state === "timeout"
        ? "Instagram took too long to process these photos. Post again."
        : "Instagram could not process these photos. Post again.",
    );
  };

  if (carousel && !post.containerId) {
    if (!(await settle(post.children!))) return;
    const created = await call(
      `${post.accountId}/media`,
      new URLSearchParams({
        media_type: "CAROUSEL",
        children: post.children!.join(","),
        caption: post.caption,
      }),
    );
    const containerId = numericId(created.id);
    if (!containerId) throw new Error("Instagram did not accept the carousel.");
    post.containerId = containerId;
    await save();
  }
  if (!(await settle([post.containerId!]))) return;

  // Durable intent before the only externally visible write.
  await set("publishing", "Waiting for Instagram to confirm…");
  let published: Awaited<ReturnType<typeof call>>;
  try {
    published = await call(
      `${post.accountId}/media_publish`,
      new URLSearchParams({ creation_id: post.containerId! }),
    );
  } catch (error) {
    if (error instanceof InstagramApiError && error.definitive) {
      // Refusals Instagram states plainly: nothing was posted.
      if (error.kind === "not-ready")
        return set("processing", "Instagram is processing the photos…");
      if (error.kind === "publish-limit" || error.kind === "rate-limit" || error.kind === "auth")
        return set("failed", error.message);
      if (error.kind === "expired") {
        forgetContainers(post);
        return set("failed", error.message);
      }
    }
    return set(
      "uncertain",
      "Instagram did not confirm this post. Check your profile; Celinen will not send it again.",
    );
  }
  const mediaId = numericId(published.id);
  if (!mediaId)
    return set(
      "uncertain",
      "Instagram did not confirm this post. Check your profile; Celinen will not send it again.",
    );
  post.mediaId = mediaId;
  post.publishedAt = iso(deps);
  await set("published", "Posted to Instagram.");
  try {
    const media = await call(`${mediaId}?fields=permalink`);
    if (
      typeof media.permalink === "string" &&
      /^https:\/\/(www\.)?instagram\.com\//.test(media.permalink)
    )
      post.permalink = media.permalink;
  } catch {
    // The post is confirmed; the link is a convenience.
  }
  await removeMedia(deps, post);
  await save();
}

/** Removes a draft nobody can have seen on Instagram, with its uploaded photos. */
export async function discardInstagramPost(
  owner: string,
  id: string,
  deps: InstagramPostDeps = instagramPostDeps(),
) {
  const { post, save, release } = await claim(owner, id, deps);
  try {
    if (!instagramPostDiscardable(post.status))
      throw new Error(
        post.status === "uncertain" || post.status === "publishing"
          ? "This post may be on Instagram. Check your profile first."
          : "This post cannot be discarded.",
      );
    await removeMedia(deps, post);
    post.status = "discarded";
    post.note = "";
    await save();
    return viewInstagramPost(post);
  } finally {
    await release();
  }
}

export async function listInstagramPosts(
  owner: string,
  deps: Pick<InstagramPostDeps, "db"> = { db: businessDatabase() },
) {
  const { data, error } = await deps.db
    .from(TABLE)
    .select("record")
    .eq("owner_id", owner)
    .eq("record->>kind", "instagram-post")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error("Posts are unavailable right now.");
  return (data ?? [])
    .map((row) => row.record)
    .filter(isInstagramPostRecord)
    .filter((post) => post.status !== "discarded")
    .map(viewInstagramPost);
}

/** Deletes uploaded photos Instagram can no longer need: containers expire after 24 hours. */
export async function sweepInstagramMedia(owner: string, deps: InstagramPostDeps) {
  const { data, error } = await deps.db
    .from(TABLE)
    .select("id,record,revision")
    .eq("owner_id", owner)
    .eq("record->>kind", "instagram-post")
    .is("record->>mediaRemovedAt", null)
    .is("lease", null)
    .lt("created_at", iso(deps, -STALE_MS))
    .limit(20);
  if (error) return 0;
  let swept = 0;
  for (const row of data ?? []) {
    const post = row.record;
    if (!isInstagramPostRecord(post) || post.mediaRemovedAt) continue;
    await removeMedia(deps, post);
    if (!post.mediaRemovedAt) continue;
    if (["awaiting-upload", "preparing", "processing", "failed"].includes(post.status)) {
      post.status = "expired";
      post.note = "";
      forgetContainers(post);
    }
    post.updatedAt = iso(deps);
    const saved = await deps.db
      .from(TABLE)
      .update({ record: post, revision: Number(row.revision) + 1 })
      .eq("id", row.id)
      .eq("owner_id", owner)
      .eq("revision", row.revision)
      .is("lease", null)
      .select("id")
      .maybeSingle();
    if (!saved.error && saved.data) swept++;
  }
  return swept;
}
