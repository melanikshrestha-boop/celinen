/** Posts one set of hearted photos to every connected story destination, one
 * resumable step at a time.
 *
 * Flow. The page frames each photo to 1080x1920 with the C++ social operator
 * and uploads it to the private `publishing-media-v1` bucket through
 * owner-scoped signed upload URLs. This module verifies those exact bytes once,
 * then walks the destination x photo matrix, giving each platform a short-lived
 * signed URL and publishing one story at a time.
 *
 * Duplicate-post safety, the same discipline as the feed publisher:
 *  - the broadcast id is chosen by the composer and is the row's primary key;
 *  - a row lease serializes every step, so a double click or a second tab waits;
 *  - a unit's status becomes `publishing` in the database *before* the only
 *    externally visible write. A run that finds `publishing`, or any answer that
 *    is not a definitive refusal, becomes `uncertain`, and that unit is never
 *    sent again. Reconciliation can promote it to `posted`, never back to a
 *    state that would re-send it.
 *
 * A destination is independent: Instagram failing does not stop Facebook, and a
 * retry re-sends only the photos that provably never left.
 */
import { businessDatabase } from "./database.server";
import {
  InstagramApiError,
  instagramCall,
  instagramSession,
  type InstagramFetch,
  type InstagramSession,
} from "./instagram.server";
import {
  FacebookApiError,
  facebookCall,
  facebookPageSession,
  type FacebookPageSession,
} from "./facebook.server";
import {
  PUBLISHING_BUCKET,
  STORY_FORMAT,
  SERVER_DESTINATIONS,
  broadcastDiscardable,
  isStoryBroadcastRecord,
  jpegDimensions,
  rollUpDestination,
  sameStoryBroadcast,
  sha256Hex,
  storyBroadcastInput,
  unitSendable,
  viewStoryBroadcast,
  type DestinationState,
  type StoryBroadcastInput,
  type StoryBroadcastRecord,
  type StoryBroadcastView,
  type StoryUnit,
} from "../social/story-broadcast";

type Database = ReturnType<typeof businessDatabase>;
type ServerDestination = (typeof SERVER_DESTINATIONS)[number];

export type StoryBroadcastDeps = {
  db: Database;
  fetch: InstagramFetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  instagram: (owner: string) => Promise<InstagramSession>;
  facebook: (owner: string) => Promise<FacebookPageSession>;
};
export function storyBroadcastDeps(
  overrides: Partial<StoryBroadcastDeps> = {},
): StoryBroadcastDeps {
  const db = overrides.db ?? businessDatabase();
  const request = overrides.fetch ?? fetch;
  return {
    db,
    fetch: request,
    now: overrides.now ?? Date.now,
    sleep: overrides.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    instagram: overrides.instagram ?? ((owner) => instagramSession(owner, { db, fetch: request })),
    facebook: overrides.facebook ?? facebookPageSession,
  };
}

const TABLE = "social_publications";
const LEASE_MS = 180_000;
/** Time one request may spend on the platforms before handing back to the page. */
export const STORY_BUDGET_MS = 25_000;
/** Meta: check a container's status about once a minute for no more than five. */
export const CONTAINER_TIMEOUT_MS = 5 * 60_000;
/** The platform fetches the photo when the container is created. */
const SIGNED_URL_SECONDS = 15 * 60;
const STALE_MS = 24 * 60 * 60_000;
const POLL_STEPS_MS = [1200, 2000, 3500, 5000, 8000];
const UNCERTAIN_NOTE =
  "Not confirmed. Check the app; Celinen will not send this photo there again.";

const iso = (deps: StoryBroadcastDeps, offset = 0) => new Date(deps.now() + offset).toISOString();
const numericId = (value: unknown) =>
  typeof value === "string" && /^\d+$/.test(value) ? value : null;
/** Facebook returns story ids as `pageid_storyid`, and `post_id` may be a number. */
const storyPostId = (value: unknown) => {
  const text = typeof value === "number" ? String(value) : value;
  return typeof text === "string" && /^[\d_]+$/.test(text) && text.length <= 64 ? text : null;
};

async function uploadTickets(deps: StoryBroadcastDeps, record: StoryBroadcastRecord) {
  const tickets: { path: string; token: string }[] = [];
  for (const item of record.items) {
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

const freshUnits = (count: number): StoryUnit[] =>
  Array.from({ length: count }, () => ({ status: "pending" as const, note: "" }));

/** Saves the set (or returns the same set for a retry) and hands out upload tickets. */
export async function createStoryBroadcast(
  owner: string,
  raw: StoryBroadcastInput,
  deps: StoryBroadcastDeps = storyBroadcastDeps(),
) {
  const input = storyBroadcastInput.parse(raw);
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
    if (!isStoryBroadcastRecord(old) || !sameStoryBroadcast(old, input))
      throw new Error("This set already exists with different photos. Start a new one.");
    return {
      broadcast: viewStoryBroadcast(old),
      uploads: old.status === "awaiting-upload" ? await uploadTickets(deps, old) : [],
    };
  }

  const record: StoryBroadcastRecord = {
    kind: "story-broadcast",
    version: 1,
    id: input.id,
    source: input.source,
    // Paths are derived from the verified owner and server-checked id only.
    items: input.items.map((item, index) => ({
      ...item,
      path: `${owner}/${input.id}/story-${index}.jpg`,
    })),
    destinations: {},
    createdAt: iso(deps),
    updatedAt: iso(deps),
    status: "awaiting-upload",
    note: "",
  };

  // Every chosen destination must be connected now, so the photographer learns
  // about a missing Page before she confirms rather than after.
  for (const destination of input.destinations) {
    if (destination === "instagram-story") {
      const session = await deps.instagram(owner).catch(() => null);
      if (!session) throw new Error("Connect Instagram first.");
      if (!session.scopes.includes("instagram_business_content_publish"))
        throw new Error("Reconnect Instagram and allow posting.");
      record.instagramAccountId = session.accountId;
      record.instagramUsername = session.username;
    } else {
      const page = await deps.facebook(owner).catch((error: unknown) => {
        throw error instanceof Error ? error : new Error("Connect Facebook first.");
      });
      record.facebookPageId = page.pageId;
      record.facebookPageName = page.pageName;
    }
    record.destinations[destination] = {
      status: "pending",
      note: "",
      units: freshUnits(input.items.length),
    };
  }

  if (!(await bucketIsSafe(db)))
    throw new Error("Publishing media storage is not safely configured.");
  await sweepStoryMedia(owner, deps).catch(() => {});
  const { count, error: countError } = await db
    .from(TABLE)
    .select("id", { head: true, count: "exact" })
    .eq("owner_id", owner);
  if (countError || (count ?? 0) >= 1000)
    throw new Error("Publishing storage is full or unavailable.");

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
      isStoryBroadcastRecord(raced.data.record) &&
      sameStoryBroadcast(raced.data.record, input)
    )
      return {
        broadcast: viewStoryBroadcast(raced.data.record),
        uploads: await uploadTickets(deps, raced.data.record),
      };
    throw new Error("Could not save this set. Nothing was posted; try again.");
  }
  return { broadcast: viewStoryBroadcast(record), uploads: await uploadTickets(deps, record) };
}

type Lease = {
  record: StoryBroadcastRecord;
  save: () => Promise<void>;
  release: () => Promise<void>;
};
async function claim(owner: string, id: string, deps: StoryBroadcastDeps): Promise<Lease> {
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
  if (error || !data || !isStoryBroadcastRecord(data.record))
    throw new Error("This set is already being handled or is unavailable. Check again shortly.");
  const record = data.record;
  let revision = Number(data.revision);
  return {
    record,
    save: async () => {
      record.updatedAt = iso(deps);
      const saved = await db
        .from(TABLE)
        .update({ record, revision: revision + 1, lease_until: iso(deps, LEASE_MS) })
        .eq("id", id)
        .eq("owner_id", owner)
        .eq("lease", lease)
        .select("id")
        .maybeSingle();
      if (saved.error || !saved.data)
        throw new Error(
          "Could not save posting progress. Check this set again before anything else.",
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

async function removeMedia(deps: StoryBroadcastDeps, record: StoryBroadcastRecord) {
  if (record.mediaRemovedAt) return;
  const removed = await deps.db.storage
    .from(PUBLISHING_BUCKET)
    .remove(record.items.map((item) => item.path));
  if (!removed.error) record.mediaRemovedAt = iso(deps);
}

/** Every byte a platform will fetch is the byte the photographer confirmed. */
async function verifyUploads(deps: StoryBroadcastDeps, record: StoryBroadcastRecord) {
  for (const item of record.items) {
    const file = await deps.db.storage.from(PUBLISHING_BUCKET).download(item.path);
    if (file.error || !file.data)
      throw new Error("The photos have not finished uploading. Try again.");
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    const size = jpegDimensions(bytes);
    if (
      bytes.byteLength !== item.bytes ||
      !size ||
      size.width !== STORY_FORMAT.width ||
      size.height !== STORY_FORMAT.height ||
      (await sha256Hex(bytes)) !== item.sha256
    )
      throw new Error("An uploaded photo does not match what you confirmed. Post again.");
  }
}

async function signedUrl(deps: StoryBroadcastDeps, path: string) {
  const signed = await deps.db.storage
    .from(PUBLISHING_BUCKET)
    .createSignedUrl(path, SIGNED_URL_SECONDS);
  if (signed.error || !signed.data?.signedUrl)
    throw new Error("Could not give the platform access to the photos.");
  return signed.data.signedUrl;
}

/** One bounded step toward done. Safe to call any number of times. */
export async function advanceStoryBroadcast(
  owner: string,
  id: string,
  deps: StoryBroadcastDeps = storyBroadcastDeps(),
): Promise<StoryBroadcastView> {
  const { record, save, release } = await claim(owner, id, deps);
  try {
    if (record.status === "discarded" || record.status === "expired")
      return viewStoryBroadcast(record);

    if (!record.verifiedAt) {
      await verifyUploads(deps, record);
      record.verifiedAt = iso(deps);
      record.status = "broadcasting";
      record.note = "";
      await save();
    }

    const deadline = deps.now() + STORY_BUDGET_MS;
    for (const destination of SERVER_DESTINATIONS) {
      const state = record.destinations[destination];
      if (!state) continue;
      if (!state.units.some(unitSendable)) continue;
      await runDestination(owner, destination, record, state, deps, save, deadline);
      if (deps.now() >= deadline) break;
    }

    const states = Object.values(record.destinations).filter(Boolean) as DestinationState[];
    const finished = states.every(
      (state) => state.status !== "pending" && state.status !== "working",
    );
    if (finished) {
      record.status = "done";
      await removeMedia(deps, record);
    }
    await save();
    return viewStoryBroadcast(record);
  } catch (error) {
    // A failure here is about the set, not about any one platform: uploads that
    // never verified, or storage that is unavailable. No unit has been sent.
    if (record.status === "awaiting-upload")
      record.note = error instanceof Error ? error.message : "The photos could not be sent.";
    await save().catch(() => {});
    return viewStoryBroadcast(record);
  } finally {
    await release();
  }
}

/** Marks the whole destination without touching units that may have been sent. */
function setDestination(state: DestinationState, status: DestinationState["status"], note: string) {
  state.status = status;
  state.note = note;
}

async function runDestination(
  owner: string,
  destination: ServerDestination,
  record: StoryBroadcastRecord,
  state: DestinationState,
  deps: StoryBroadcastDeps,
  save: () => Promise<void>,
  deadline: number,
) {
  // The connection as it is now. A missing or expired one is a reconnect, and
  // the photos it never received stay pending so a later retry can send them.
  let session: InstagramSession | FacebookPageSession;
  try {
    session =
      destination === "instagram-story" ? await deps.instagram(owner) : await deps.facebook(owner);
  } catch (error) {
    setDestination(
      state,
      "needs-reconnect",
      error instanceof Error ? error.message : "Reconnect this account.",
    );
    await save();
    return;
  }

  if (destination === "instagram-story") {
    const instagram = session as InstagramSession;
    if (instagram.accountId !== record.instagramAccountId) {
      // Never post to an account other than the one shown when this was confirmed.
      setDestination(
        state,
        "needs-reconnect",
        `Reconnect @${record.instagramUsername ?? "the account"} to post this set.`,
      );
      await save();
      return;
    }
    if (!instagram.scopes.includes("instagram_business_content_publish")) {
      setDestination(state, "needs-reconnect", "Reconnect Instagram and allow posting.");
      await save();
      return;
    }
  } else {
    const page = session as FacebookPageSession;
    if (page.pageId !== record.facebookPageId) {
      setDestination(
        state,
        "needs-reconnect",
        `Select ${record.facebookPageName ?? "the original Page"} to post this set.`,
      );
      await save();
      return;
    }
  }

  setDestination(state, "working", "");
  await save();

  for (const [index, unit] of state.units.entries()) {
    if (!unitSendable(unit)) continue;
    if (deps.now() >= deadline) break;
    const item = record.items[index];
    if (!item) continue;
    try {
      if (destination === "instagram-story")
        await postInstagramStory(
          unit,
          item.path,
          session as InstagramSession,
          deps,
          save,
          deadline,
        );
      else await postFacebookStory(unit, item.path, session as FacebookPageSession, deps, save);
    } catch (error) {
      // Reaching here means nothing was published for this photo: every path
      // that could have published sets the unit itself before it returns.
      if (unit.status === "publishing" || unit.status === "uncertain") {
        unit.status = "uncertain";
        unit.note = UNCERTAIN_NOTE;
      } else {
        unit.status = "failed";
        unit.note = error instanceof Error ? error.message : "This photo could not be posted.";
      }
      await save().catch(() => {});
      // An expired connection or a rate limit will fail every remaining photo
      // the same way; stop rather than burning the set against it. The rest are
      // marked failed with the same reason so the destination settles and the
      // photographer gets "try again" instead of a spinner that never stops.
      // `failed` is still sendable, so a later retry sends exactly these.
      if (stopsTheDestination(error)) {
        const reason = error instanceof Error ? error.message : "This photo could not be posted.";
        for (const remaining of state.units)
          if (unitSendable(remaining) && remaining !== unit) {
            remaining.status = "failed";
            remaining.note = reason;
          }
        await save().catch(() => {});
        break;
      }
    }
  }

  setDestination(state, rollUpDestination(state.units), destinationNote(state.units));
  await save();
}

function stopsTheDestination(error: unknown) {
  if (error instanceof InstagramApiError)
    return ["auth", "permission", "rate-limit", "publish-limit", "unavailable"].includes(
      error.kind,
    );
  if (error instanceof FacebookApiError)
    return ["auth", "permission", "rate-limit", "unavailable"].includes(error.kind);
  return false;
}

/** The first thing that went wrong, or nothing when every photo is up. */
function destinationNote(units: readonly StoryUnit[]) {
  const posted = units.filter((unit) => unit.status === "posted").length;
  if (posted === units.length) return "";
  return units.find((unit) => unit.status !== "posted" && unit.note)?.note ?? "";
}

async function postInstagramStory(
  unit: StoryUnit,
  path: string,
  session: InstagramSession,
  deps: StoryBroadcastDeps,
  save: () => Promise<void>,
  deadline: number,
) {
  const call = (path: string, body?: URLSearchParams) =>
    instagramCall(path, session.token, { fetch: deps.fetch, ...(body ? { body } : {}) });

  if (!unit.containerId) {
    unit.status = "preparing";
    unit.note = "";
    await save();
    // A story is one image in one container: no caption, no carousel, no
    // children. Meta does not document caption behaviour for stories, so
    // Celinen does not send one rather than relying on it being ignored.
    const created = await call(
      `${session.accountId}/media`,
      new URLSearchParams({ media_type: "STORIES", image_url: await signedUrl(deps, path) }),
    );
    const containerId = numericId(created.id);
    if (!containerId) throw new Error("Instagram did not accept the photo.");
    unit.containerId = containerId;
    unit.containerCreatedAt = iso(deps);
    await save();
  }

  // Wait for the container. A story image is usually ready at once, but
  // media_publish on a container that is not FINISHED is an error.
  for (let attempt = 0; ; attempt++) {
    const status = await call(`${unit.containerId}?fields=status_code`);
    if (status.status_code === "FINISHED" || status.status_code === "PUBLISHED") break;
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
      // An errored or expired container was never published and never will be.
      delete unit.containerId;
      delete unit.containerCreatedAt;
      throw new Error("Instagram could not process this photo. Post it again.");
    }
    if (deps.now() - Date.parse(unit.containerCreatedAt ?? iso(deps)) > CONTAINER_TIMEOUT_MS) {
      delete unit.containerId;
      delete unit.containerCreatedAt;
      throw new Error("Instagram took too long with this photo. Post it again.");
    }
    const pause = POLL_STEPS_MS[Math.min(attempt, POLL_STEPS_MS.length - 1)]!;
    if (deps.now() + pause > deadline) {
      unit.status = "processing";
      unit.note = "Instagram is processing this photo.";
      await save();
      return;
    }
    await deps.sleep(pause);
  }

  // Durable intent before the only externally visible write.
  unit.status = "publishing";
  unit.note = "";
  await save();
  let published;
  try {
    published = await call(
      `${session.accountId}/media_publish`,
      new URLSearchParams({ creation_id: unit.containerId! }),
    );
  } catch (error) {
    if (error instanceof InstagramApiError && error.definitive) {
      // Refusals Instagram states plainly: nothing was posted.
      if (error.kind === "not-ready") {
        unit.status = "processing";
        unit.note = "Instagram is processing this photo.";
        await save();
        return;
      }
      unit.status = "failed";
      unit.note = error.message;
      if (error.kind === "expired") {
        delete unit.containerId;
        delete unit.containerCreatedAt;
      }
      await save();
      throw error;
    }
    unit.status = "uncertain";
    unit.note = UNCERTAIN_NOTE;
    await save();
    throw error;
  }
  const storyId = numericId(published.id);
  if (!storyId) {
    unit.status = "uncertain";
    unit.note = UNCERTAIN_NOTE;
    await save();
    return;
  }
  unit.storyId = storyId;
  unit.postedAt = iso(deps);
  unit.status = "posted";
  unit.note = "";
  await save();
}

async function postFacebookStory(
  unit: StoryUnit,
  path: string,
  page: FacebookPageSession,
  deps: StoryBroadcastDeps,
  save: () => Promise<void>,
) {
  const call = (endpoint: string, body?: URLSearchParams) =>
    facebookCall(endpoint, page.token, { fetch: deps.fetch, ...(body ? { body } : {}) });

  if (!unit.photoId) {
    unit.status = "preparing";
    unit.note = "";
    await save();
    // An unpublished photo, so nothing appears on the Page timeline. Facebook
    // refuses a photo that has already been used in a published post, which is
    // why every story gets its own upload rather than reusing one.
    const created = await call(
      `${page.pageId}/photos`,
      new URLSearchParams({ url: await signedUrl(deps, path), published: "false" }),
    );
    const photoId = numericId(created["id"]);
    if (!photoId) throw new Error("Facebook did not accept the photo.");
    unit.photoId = photoId;
    await save();
  }

  // Durable intent before the only externally visible write.
  unit.status = "publishing";
  unit.note = "";
  await save();
  let published;
  try {
    published = await call(
      `${page.pageId}/photo_stories`,
      new URLSearchParams({ photo_id: unit.photoId! }),
    );
  } catch (error) {
    if (error instanceof FacebookApiError && error.definitive) {
      unit.status = "failed";
      unit.note = error.message;
      // A refused photo is spent; a retry needs a fresh upload.
      if (error.kind === "duplicate" || error.kind === "media") delete unit.photoId;
      await save();
      throw error;
    }
    unit.status = "uncertain";
    unit.note = UNCERTAIN_NOTE;
    await save();
    throw error;
  }
  const postId = storyPostId(published["post_id"]);
  if (published["success"] !== true || !postId) {
    unit.status = "uncertain";
    unit.note = UNCERTAIN_NOTE;
    await save();
    return;
  }
  unit.storyId = postId;
  unit.postedAt = iso(deps);
  unit.status = "posted";
  unit.note = "";
  await save();
}

/** Settles photos whose publish answer was lost, without ever re-sending one.
 * Only ever moves a unit from `uncertain` to `posted` or to `failed`, and
 * `failed` only on proof that nothing was published. */
export async function reconcileStoryBroadcast(
  owner: string,
  id: string,
  deps: StoryBroadcastDeps = storyBroadcastDeps(),
): Promise<StoryBroadcastView> {
  const { record, save, release } = await claim(owner, id, deps);
  try {
    for (const destination of SERVER_DESTINATIONS) {
      const state = record.destinations[destination];
      if (!state?.units.some((unit) => unit.status === "uncertain")) continue;
      if (destination === "instagram-story") {
        const session = await deps.instagram(owner).catch(() => null);
        if (!session || session.accountId !== record.instagramAccountId) continue;
        for (const unit of state.units) {
          if (unit.status !== "uncertain" || !unit.containerId) continue;
          const status = await instagramCall(
            `${unit.containerId}?fields=status_code`,
            session.token,
            { fetch: deps.fetch },
          ).catch(() => null);
          if (status?.status_code === "PUBLISHED") {
            unit.status = "posted";
            unit.note = "";
            unit.postedAt ??= iso(deps);
          } else if (status?.status_code === "EXPIRED" || status?.status_code === "ERROR") {
            // A container in either state was never published.
            unit.status = "failed";
            unit.note = "Instagram did not post this photo. You can post it again.";
            delete unit.containerId;
            delete unit.containerCreatedAt;
          }
        }
      } else {
        const page = await deps.facebook(owner).catch(() => null);
        if (!page || page.pageId !== record.facebookPageId) continue;
        // The Page's live stories, which is the only read-back Facebook offers.
        // Anything not found stays uncertain: the list is paged and archiving is
        // a Page setting, so absence is not proof that nothing was posted.
        const listed = await facebookCall(
          `${page.pageId}/stories?fields=post_id,media_id,status&limit=50`,
          page.token,
          { fetch: deps.fetch },
        ).catch(() => null);
        const rows = Array.isArray(listed?.["data"]) ? (listed["data"] as unknown[]) : [];
        for (const unit of state.units) {
          if (unit.status !== "uncertain" || !unit.photoId) continue;
          const found = rows.find(
            (row) =>
              !!row &&
              typeof row === "object" &&
              String((row as { media_id?: unknown }).media_id ?? "") === unit.photoId,
          );
          const postId = found ? storyPostId((found as { post_id?: unknown }).post_id) : null;
          if (postId) {
            unit.status = "posted";
            unit.note = "";
            unit.storyId = postId;
            unit.postedAt ??= iso(deps);
          }
        }
      }
      setDestination(state, rollUpDestination(state.units), destinationNote(state.units));
    }
    const states = Object.values(record.destinations).filter(Boolean) as DestinationState[];
    if (states.every((state) => state.status !== "pending" && state.status !== "working")) {
      record.status = "done";
      await removeMedia(deps, record);
    }
    await save();
    return viewStoryBroadcast(record);
  } finally {
    await release();
  }
}

/** Removes a set nobody can have seen, with its uploaded photos. */
export async function discardStoryBroadcast(
  owner: string,
  id: string,
  deps: StoryBroadcastDeps = storyBroadcastDeps(),
) {
  const { record, save, release } = await claim(owner, id, deps);
  try {
    if (!broadcastDiscardable(record))
      throw new Error("Some of this set may already be posted. Check the apps first.");
    await removeMedia(deps, record);
    record.status = "discarded";
    record.note = "";
    await save();
    return viewStoryBroadcast(record);
  } finally {
    await release();
  }
}

export async function listStoryBroadcasts(
  owner: string,
  deps: Pick<StoryBroadcastDeps, "db"> = { db: businessDatabase() },
) {
  const { data, error } = await deps.db
    .from(TABLE)
    .select("record")
    .eq("owner_id", owner)
    .eq("record->>kind", "story-broadcast")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error("Story sets are unavailable right now.");
  return (data ?? [])
    .map((row) => row.record)
    .filter(isStoryBroadcastRecord)
    .filter((record) => record.status !== "discarded")
    .map(viewStoryBroadcast);
}

/** Deletes uploaded photos no platform can still need: containers expire at 24 hours. */
export async function sweepStoryMedia(owner: string, deps: StoryBroadcastDeps) {
  const { data, error } = await deps.db
    .from(TABLE)
    .select("id,record,revision")
    .eq("owner_id", owner)
    .eq("record->>kind", "story-broadcast")
    .is("record->>mediaRemovedAt", null)
    .is("lease", null)
    .lt("created_at", iso(deps, -STALE_MS))
    .limit(20);
  if (error) return 0;
  let swept = 0;
  for (const row of data ?? []) {
    const record = row.record;
    if (!isStoryBroadcastRecord(record) || record.mediaRemovedAt) continue;
    await removeMedia(deps, record);
    if (!record.mediaRemovedAt) continue;
    if (record.status === "awaiting-upload" || record.status === "broadcasting") {
      record.status = "expired";
      record.note = "";
      for (const state of Object.values(record.destinations)) {
        if (!state) continue;
        for (const unit of state.units)
          if (unitSendable(unit) && unit.status !== "failed") {
            unit.status = "failed";
            unit.note = "This set expired before it was posted.";
            delete unit.containerId;
            delete unit.containerCreatedAt;
            delete unit.photoId;
          }
        setDestination(state, rollUpDestination(state.units), destinationNote(state.units));
      }
    }
    record.updatedAt = iso(deps);
    const saved = await deps.db
      .from(TABLE)
      .update({ record, revision: Number(row.revision) + 1 })
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
