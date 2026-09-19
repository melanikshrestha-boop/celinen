/** Due posts fire here. Tokens stay on the server. One attempt per network, never two.
 *
 * A scheduled post is one `social_publications` row (kind "schedule") with one
 * `unit` per network. Every runner — the cron tick, "post now" from the page,
 * a second cron tick that overlaps the first — claims the row under its lease
 * (a conditional UPDATE), so a row is worked by exactly one runner at a time.
 *
 * Inside a unit the publisher keeps every provider id it obtains and writes
 * `progress.committedAt` right before the one request that makes the post
 * visible. A run that finds that mark and no result never repeats the request:
 * it asks the provider what happened (`reconcile`) and otherwise leaves the
 * unit `uncertain` for a human. Retries happen only for refusals the provider
 * stated plainly, with backoff and a cap.
 */
import { openToken, sealToken } from "./instagram.server";
import {
  connectionDeps,
  markReconnect,
  rememberConnectionMeta,
  socialSession,
  type ConnectionDeps,
  type SocialSession,
} from "./social-connections.server";
import {
  IMAGE_BUCKET,
  bucketsAreSafe,
  downloadImage,
  mediaDeps,
  proxyTicket,
  proxyUrl,
  removeStoredMedia,
  signedMediaUrl,
  storedMedia,
  uploadTickets,
  verifyStoredMedia,
  type MediaDeps,
  type UploadTicket,
} from "./social-media.server";
import {
  PUBLISHERS,
  type PublishContext,
  type PublishUnit,
  type Publisher,
} from "./social-publishers";
import { postPasteNetwork } from "../social-paste-post";
import type { PasteSecret } from "../social-paste";
import { isPasteSocial } from "../social-paste";
import { jpegDimensions, sha256Hex } from "../social/instagram-post";
import {
  MAX_ATTEMPTS,
  MAX_RECONCILES,
  PROVIDER_LABEL,
  RECONCILE_BACKOFF_MS,
  SocialApiError,
  backoffMs,
  unitOptions,
  validateUnit,
  type SocialProvider,
  type StoredMedia,
} from "../social/connectors";
import {
  SCHEDULE_KIND,
  deriveStatus,
  isScheduleRecord,
  nextAttemptOf,
  parseScheduleInput,
  providerForNetwork,
  summarizeUnits,
  unitSettled,
  type LivePostNetwork,
  type ScheduleRecord,
  type ScheduleUnit,
  type ScheduleUnitView,
  type ScheduleView,
} from "../social/schedule";

const TABLE = "social_publications";
const TICK_LIMIT = 20;
const LEASE_MS = 180_000;
/** Time one run may spend waiting on providers before handing back. */
export const RUN_BUDGET_MS = 25_000;
/** Rows whose media never finished uploading are cancelled after this long. */
const UNREADY_TTL_MS = 24 * 60 * 60_000;
/** Settled rows keep their media this long at most. */
const MEDIA_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_ROWS_PER_OWNER = 1000;

export type ScheduleDeps = ConnectionDeps & {
  media: MediaDeps;
  publishers: Record<SocialProvider, Publisher>;
  paste: typeof postPasteNetwork;
};
export function scheduleDeps(overrides: Partial<ScheduleDeps> = {}): ScheduleDeps {
  const base = connectionDeps(overrides);
  return {
    ...base,
    media: overrides.media ?? mediaDeps({ db: base.db, env: base.env, now: base.now }),
    publishers: overrides.publishers ?? PUBLISHERS,
    paste: overrides.paste ?? postPasteNetwork,
  };
}

function tokenKey(env: Record<string, string | undefined>): Buffer | null {
  const key = env["SOCIAL_TOKEN_KEY"];
  if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) return null;
  return Buffer.from(key, "hex");
}
const iso = (deps: Pick<ScheduleDeps, "now">, offset = 0) =>
  new Date(deps.now() + offset).toISOString();
const storageDown = () => new Error("Schedule storage is unavailable.");

/** What the page sees: never sealed secrets or provider progress. */
export function viewSchedule(record: ScheduleRecord, id: string): ScheduleView {
  const { sealedSecrets: _secrets, units: full, id: _id, ...rest } = record;
  void _secrets;
  void _id;
  const units: Partial<Record<LivePostNetwork, ScheduleUnitView>> = {};
  for (const [network, unit] of Object.entries(full ?? {}) as [
    LivePostNetwork,
    ScheduleUnit | undefined,
  ][]) {
    if (!unit) continue;
    const { progress: _progress, ...view } = unit;
    void _progress;
    units[network] = view;
  }
  return { ...rest, ...(full ? { units } : {}), id };
}

export async function listSchedule(
  owner: string,
  deps: ScheduleDeps = scheduleDeps(),
): Promise<ScheduleView[]> {
  const { data, error } = await deps.db
    .from(TABLE)
    .select("id, record")
    .eq("owner_id", owner)
    .eq("record->>kind", SCHEDULE_KIND)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw storageDown();
  return (data ?? [])
    .map((row) => (isScheduleRecord(row.record) ? viewSchedule(row.record, String(row.id)) : null))
    .filter((row): row is ScheduleView => Boolean(row))
    .sort((a, b) => Date.parse(a.runAt) - Date.parse(b.runAt));
}

/** Records made before units existed get them the first time a runner touches them. */
function upgradeRecord(record: ScheduleRecord): ScheduleRecord {
  if (record.units) return record;
  const runnable = record.status === "scheduled";
  const units: Partial<Record<LivePostNetwork, ScheduleUnit>> = {};
  for (const network of record.networks)
    units[network] = {
      status: runnable ? "scheduled" : record.status === "posting" ? "publishing" : record.status,
      attempts: 0,
      nextAttemptAt: runnable ? record.runAt : null,
      lastError: null,
      progress: {},
    };
  return { ...record, version: 2, units, nextAttemptAt: runnable ? record.runAt : null };
}

/** Version 1 rows carry one server-uploaded JPEG with no declared facts; it is
 * still verified as a JPEG but not against a hash it never had. */
const legacyMedia = (record: ScheduleRecord): StoredMedia[] =>
  record.media?.length
    ? record.media
    : record.imagePath
      ? [
          {
            kind: "image",
            mime: "image/jpeg",
            bytes: 0,
            sha256: "",
            width: 0,
            height: 0,
            bucket: IMAGE_BUCKET,
            path: record.imagePath,
          },
        ]
      : [];

async function inlinePhoto(
  owner: string,
  id: string,
  raw: { mime?: unknown; data?: unknown } | undefined,
  deps: ScheduleDeps,
): Promise<StoredMedia | null> {
  if (!raw || typeof raw.data !== "string" || !raw.data.length) return null;
  const bytes = Uint8Array.from(atob(raw.data), (ch) => ch.charCodeAt(0));
  if (bytes.length < 32 || bytes.length > 1_500_000) throw new Error("That photo is too large.");
  // The photo bucket only takes JPEG; a PNG would be refused at upload with a vaguer error.
  const size = jpegDimensions(bytes);
  if (!size) throw new Error("Photos must be JPEG.");
  const path = `${owner}/${id}/schedule.jpg`;
  const stored = await deps.db.storage
    .from(IMAGE_BUCKET)
    .upload(path, bytes, { contentType: "image/jpeg", upsert: false });
  if (stored.error) throw new Error("Could not store this photo for the scheduled post.");
  return {
    kind: "image",
    mime: "image/jpeg",
    bytes: bytes.length,
    sha256: await sha256Hex(bytes),
    width: size.width,
    height: size.height,
    bucket: IMAGE_BUCKET,
    path,
  };
}

/** Saves the post and, for declared media, hands out owner-scoped upload
 * tickets. Sending the same `id` again returns the same post, so a double
 * click cannot schedule twice. Posts due within 15 seconds run right away. */
export async function createSchedule(
  owner: string,
  raw: {
    caption: unknown;
    networks: unknown;
    runAt: unknown;
    secrets?: unknown;
    image?: { mime?: unknown; data?: unknown } | undefined;
    id?: unknown;
    unitKind?: unknown;
    title?: unknown;
    media?: unknown;
    options?: unknown;
  },
  deps: ScheduleDeps = scheduleDeps(),
): Promise<ScheduleView & { uploads: UploadTicket[] }> {
  const input = parseScheduleInput(raw);
  const db = deps.db;
  if (input.id) {
    const previous = await db
      .from(TABLE)
      .select("record")
      .eq("id", input.id)
      .eq("owner_id", owner)
      .maybeSingle();
    if (previous.error) throw storageDown();
    if (previous.data) {
      const old = previous.data.record;
      if (!isScheduleRecord(old) || old.caption !== input.caption)
        throw new Error("This post already exists with different content. Start a new post.");
      const unready = old.nextAttemptAt === null && old.status === "scheduled" && old.media?.length;
      return {
        ...viewSchedule(old, input.id),
        uploads: unready ? await uploadTickets(deps.media, old.media!) : [],
      };
    }
  }
  const { count, error: countError } = await db
    .from(TABLE)
    .select("id", { head: true, count: "exact" })
    .eq("owner_id", owner);
  if (countError || (count ?? 0) >= MAX_ROWS_PER_OWNER)
    throw new Error("Publishing storage is full or unavailable.");
  const id = input.id ?? crypto.randomUUID();

  // Which networks post through a server-side connection, and which through pasted credentials.
  const sessions = new Map<LivePostNetwork, SocialSession>();
  const pasted: LivePostNetwork[] = [];
  for (const network of input.networks) {
    const provider = providerForNetwork(network);
    if (provider) {
      try {
        sessions.set(network, await socialSession(owner, provider, deps));
        continue;
      } catch (error) {
        // X and LinkedIn may still post with a pasted token when no OAuth connection exists.
        if (!isPasteSocial(network))
          throw new Error(
            error instanceof Error ? error.message : `Connect ${PROVIDER_LABEL[provider]} first.`,
          );
      }
    }
    pasted.push(network);
  }
  const extras: Partial<ScheduleRecord> = {};
  if (pasted.length) {
    const key = tokenKey(deps.env);
    if (!key) throw new Error("Hosting is missing SOCIAL_TOKEN_KEY.");
    const secrets = Array.isArray(raw.secrets) ? (raw.secrets as { id?: unknown }[]) : [];
    const missing = pasted.find(
      (network) => !secrets.some((secret) => secret && secret.id === network),
    );
    if (missing) throw new Error("Connect those accounts first.");
    extras.sealedSecrets = sealToken(JSON.stringify(secrets), `schedule:${owner}`, key);
  }

  const inline = await inlinePhoto(owner, id, raw.image, deps);
  const ticketed = storedMedia(owner, id, input.media);
  const media = [...(inline ? [inline] : []), ...ticketed];
  if (media.length && !(await bucketsAreSafe(deps.media)))
    throw new Error("Publishing media storage is not safely configured.");
  for (const session of sessions.values()) {
    const problem = validateUnit(
      session.provider,
      input.unitKind,
      input.caption,
      input.title,
      media,
    );
    if (problem) throw new Error(problem);
  }
  if (Date.parse(input.runAt) > deps.now() + 366 * 24 * 60 * 60_000)
    throw new Error("Pick a time within the next year.");

  const runnableAt = ticketed.length ? null : input.runAt;
  const units: Partial<Record<LivePostNetwork, ScheduleUnit>> = {};
  for (const network of input.networks) {
    const session = sessions.get(network);
    units[network] = {
      status: "scheduled",
      attempts: 0,
      nextAttemptAt: runnableAt,
      lastError: null,
      progress: {},
      ...(session ? { accountId: session.accountId, connectionId: session.connectionId } : {}),
    };
  }
  const record: ScheduleRecord = {
    kind: SCHEDULE_KIND,
    version: 2,
    caption: input.caption,
    ...(input.title ? { title: input.title } : {}),
    networks: input.networks,
    runAt: input.runAt,
    status: "scheduled",
    results: [],
    createdAt: iso(deps),
    unitKind: input.unitKind,
    media,
    options: input.options,
    units,
    nextAttemptAt: runnableAt,
    ...(inline ? { imagePath: inline.path, imageMime: "image/jpeg" } : {}),
    ...extras,
  };
  const { error } = await db.from(TABLE).insert({ id, owner_id: owner, record });
  if (error) throw new Error("Could not save this scheduled post.");
  const uploads = ticketed.length ? await uploadTickets(deps.media, ticketed) : [];
  if (!ticketed.length && Date.parse(input.runAt) <= deps.now() + 15_000)
    return { ...(await runSchedule(owner, id, deps)), uploads };
  return { ...viewSchedule(record, id), uploads };
}

/** The page calls this once every upload ticket succeeded: the post becomes
 * runnable at its time, and runs now if that time has come. */
export async function readySchedule(
  owner: string,
  id: string,
  deps: ScheduleDeps = scheduleDeps(),
): Promise<ScheduleView> {
  const db = deps.db;
  const { data, error } = await db
    .from(TABLE)
    .select("record")
    .eq("id", id)
    .eq("owner_id", owner)
    .maybeSingle();
  if (error || !data || !isScheduleRecord(data.record))
    throw new Error("That post is not on the calendar.");
  const record = upgradeRecord(data.record);
  if (record.status !== "scheduled") return viewSchedule(record, id);
  if (record.nextAttemptAt === null) {
    for (const unit of Object.values(record.units!))
      if (unit && unit.status === "scheduled") unit.nextAttemptAt = record.runAt;
    record.nextAttemptAt = nextAttemptOf(record.units!);
    const saved = await db
      .from(TABLE)
      .update({ record })
      .eq("id", id)
      .eq("owner_id", owner)
      .is("lease", null);
    if (saved.error) throw storageDown();
  }
  if (Date.parse(record.runAt) <= deps.now()) return runSchedule(owner, id, deps);
  return viewSchedule(record, id);
}

export async function cancelSchedule(
  owner: string,
  id: string,
  deps: ScheduleDeps = scheduleDeps(),
): Promise<ScheduleView> {
  const db = deps.db;
  const { data, error } = await db
    .from(TABLE)
    .select("record")
    .eq("id", id)
    .eq("owner_id", owner)
    .maybeSingle();
  if (error || !data || !isScheduleRecord(data.record))
    throw new Error("That post is not on the calendar.");
  const record = upgradeRecord(data.record);
  if (record.status !== "scheduled") throw new Error("That post already ran.");
  for (const unit of Object.values(record.units!))
    if (unit) Object.assign(unit, { status: "cancelled", nextAttemptAt: null });
  const cancelled: ScheduleRecord = { ...record, status: "cancelled", nextAttemptAt: null };
  // A runner holding the lease may be mid-request; it re-reads status before posting.
  const saved = await db
    .from(TABLE)
    .update({ record: cancelled })
    .eq("id", id)
    .eq("owner_id", owner)
    .or(`lease.is.null,lease_until.lt.${iso(deps)}`)
    .select("id")
    .maybeSingle();
  if (saved.error || !saved.data)
    throw new Error("That post is running right now. Try again shortly.");
  await cleanupMedia(owner, id, cancelled, deps).catch(() => {});
  return viewSchedule(cancelled, id);
}

export async function rescheduleSchedule(
  owner: string,
  id: string,
  runAt: string,
  deps: ScheduleDeps = scheduleDeps(),
): Promise<ScheduleView> {
  const at = Date.parse(runAt);
  if (!Number.isFinite(at)) throw new Error("Pick a time.");
  if (at > deps.now() + 366 * 24 * 60 * 60_000)
    throw new Error("Pick a time within the next year.");
  const db = deps.db;
  const { data, error } = await db
    .from(TABLE)
    .select("record")
    .eq("id", id)
    .eq("owner_id", owner)
    .maybeSingle();
  if (error || !data || !isScheduleRecord(data.record))
    throw new Error("That post is not on the calendar.");
  const record = upgradeRecord(data.record);
  if (record.status !== "scheduled")
    throw new Error("Only a post still on the calendar can be moved.");
  const when = new Date(at).toISOString();
  for (const unit of Object.values(record.units!))
    if (unit && unit.status === "scheduled")
      Object.assign(unit, {
        nextAttemptAt: unit.nextAttemptAt === null ? null : when,
        attempts: 0,
        lastError: null,
      });
  const moved: ScheduleRecord = {
    ...record,
    runAt: when,
    nextAttemptAt: nextAttemptOf(record.units!),
  };
  const saved = await db
    .from(TABLE)
    .update({ record: moved })
    .eq("id", id)
    .eq("owner_id", owner)
    .or(`lease.is.null,lease_until.lt.${iso(deps)}`)
    .select("id")
    .maybeSingle();
  if (saved.error || !saved.data)
    throw new Error("That post is running right now. Try again shortly.");
  return viewSchedule(moved, id);
}

type Lease = { record: ScheduleRecord; save: () => Promise<void>; release: () => Promise<void> };
/** The lease: one runner per row. `save` only lands while the lease is still ours. */
async function claim(owner: string | null, id: string, deps: ScheduleDeps): Promise<Lease | null> {
  const db = deps.db,
    lease = crypto.randomUUID();
  let query = db
    .from(TABLE)
    .update({ lease, lease_until: iso(deps, LEASE_MS) })
    .eq("id", id);
  if (owner) query = query.eq("owner_id", owner);
  const { data, error } = await query
    .or(`lease.is.null,lease_until.lt.${iso(deps)}`)
    .select("record")
    .maybeSingle();
  if (error) throw storageDown();
  if (!data || !isScheduleRecord(data.record)) return null;
  const record = upgradeRecord(data.record);
  return {
    record,
    save: async () => {
      record.results = summarizeUnits(record.units!);
      record.status = deriveStatus(record.units!);
      record.nextAttemptAt = nextAttemptOf(record.units!);
      if (record.status === "posted" && !record.postedAt) record.postedAt = iso(deps);
      const saved = await db
        .from(TABLE)
        .update({ record, lease_until: iso(deps, LEASE_MS) })
        .eq("id", id)
        .eq("lease", lease)
        .select("id")
        .maybeSingle();
      if (saved.error || !saved.data)
        throw new Error(
          "Could not save posting progress. Check this post again before anything else.",
        );
    },
    release: async () => {
      await db
        .from(TABLE)
        .update({ lease: null, lease_until: null })
        .eq("id", id)
        .eq("lease", lease);
    },
  };
}

/** One bounded step for one post: every unit that is due gets a turn. Safe to
 * call any number of times, from any runner. */
export async function runSchedule(
  owner: string | null,
  id: string,
  deps: ScheduleDeps = scheduleDeps(),
  options: { deadline?: number } = {},
): Promise<ScheduleView> {
  const leased = await claim(owner, id, deps);
  if (!leased) {
    const peek = await deps.db.from(TABLE).select("record,owner_id").eq("id", id).maybeSingle();
    if (peek.data && isScheduleRecord(peek.data.record) && (!owner || peek.data.owner_id === owner))
      return viewSchedule(peek.data.record, id);
    throw new Error("This post is already running or unavailable.");
  }
  const { record, save, release } = leased;
  const rowOwner = owner ?? (await ownerOf(id, deps));
  const deadline = Math.min(options.deadline ?? Infinity, deps.now() + RUN_BUDGET_MS);
  try {
    if (record.status === "posted" || record.status === "cancelled" || record.status === "failed")
      return viewSchedule(record, id);
    for (const network of record.networks) {
      const unit = record.units![network];
      if (!unit || unitSettled(unit.status)) continue;
      if (!unit.nextAttemptAt || Date.parse(unit.nextAttemptAt) > deps.now()) continue;
      if (deps.now() >= deadline) break;
      await runUnit(rowOwner, id, record, network, unit, deps, save, deadline);
    }
    await save();
    // `save` re-derived the status from the units; read it fresh past TypeScript's narrowing.
    const settled: ScheduleRecord["status"] = deriveStatus(record.units!);
    if (settled === "posted" || settled === "failed")
      await cleanupMedia(rowOwner, id, record, deps).catch(() => {});
    return viewSchedule(record, id);
  } finally {
    await release();
  }
}

async function ownerOf(id: string, deps: ScheduleDeps) {
  const { data } = await deps.db.from(TABLE).select("owner_id").eq("id", id).maybeSingle();
  return String(data?.owner_id ?? "");
}

const UNCONFIRMED = (label: string) =>
  `${label} has not confirmed this post. Check your account; Celinen will not send it again.`;

async function runUnit(
  owner: string,
  id: string,
  record: ScheduleRecord,
  network: LivePostNetwork,
  unit: ScheduleUnit,
  deps: ScheduleDeps,
  save: () => Promise<void>,
  deadline: number,
) {
  const provider = providerForNetwork(network);
  // Pasted credentials: Bluesky, Mastodon, Discord always; X and LinkedIn only when the post was made without OAuth.
  if (!provider || (isPasteSocial(network) && !unit.connectionId && !unit.accountId)) {
    await runPasteUnit(owner, record, network, unit, deps, save);
    return;
  }
  const label = PROVIDER_LABEL[provider];
  let session: SocialSession;
  try {
    session = await socialSession(owner, provider, deps);
  } catch (error) {
    await settleFailure(owner, provider, unit, toSocialError(error, provider), deps, save);
    return;
  }
  if (
    (unit.accountId && session.accountId !== unit.accountId) ||
    (unit.connectionId && session.connectionId && unit.connectionId !== session.connectionId)
  ) {
    // Never post to an account other than the one shown when the post was confirmed.
    await settleFailure(
      owner,
      provider,
      unit,
      new SocialApiError(`Reconnect the ${label} account this post was made for.`, "auth", 401),
      deps,
      save,
    );
    return;
  }
  unit.accountId ??= session.accountId;
  const media = legacyMedia(record);
  const publishUnit: PublishUnit = {
    id,
    owner,
    provider,
    kind: record.unitKind ?? "post",
    caption: record.caption,
    title: record.title ?? null,
    media,
    options: unitOptions.parse(record.options ?? {}),
    accountId: unit.accountId,
    progress: unit.progress,
  };
  const ctx: PublishContext = {
    unit: publishUnit,
    session,
    fetch: deps.fetch,
    now: deps.now,
    sleep: deps.sleep,
    deadline,
    media: mediaAccess(deps),
    env: deps.env,
    save,
    commit: async () => {
      unit.progress["committedAt"] = iso(deps);
      await save();
    },
    remember: (patch) => rememberConnectionMeta(session, patch, deps),
  };
  const publisher = deps.publishers[provider];
  const committed = typeof unit.progress["committedAt"] === "string";
  if (
    unit.status === "uncertain" ||
    (unit.status === "publishing" && committed && !unit.progress["resumable"])
  ) {
    await reconcileUnit(owner, provider, unit, ctx, publisher, deps, save);
    return;
  }
  if (unit.status === "scheduled") {
    unit.status = "publishing";
    unit.attempts += 1;
    unit.lastError = null;
    await save();
  }
  try {
    if (!unit.progress["verifiedAt"]) {
      for (const item of media) {
        if (item.bytes) await verifyStoredMedia(deps.media, item);
        else if (!jpegDimensions(await downloadImage(deps.media, item)))
          throw new SocialApiError("The photo is not a JPEG.", "media", 400);
      }
      unit.progress["verifiedAt"] = iso(deps);
      await save();
    }
    const result = await publisher.publish(ctx);
    if (result.status === "posted") {
      delete unit.progress["resumable"];
      unit.status = "posted";
      unit.result = { remoteId: result.remoteId, ...(result.url ? { url: result.url } : {}) };
      unit.postedAt = iso(deps);
      unit.nextAttemptAt = null;
      unit.lastError = result.note ?? null;
    } else {
      // The publisher resumes from its saved ids; a committed-but-pending unit is not uncertain.
      unit.progress["resumable"] = true;
      unit.status = "publishing";
      unit.nextAttemptAt = iso(deps, Math.max(5_000, result.retryMs));
      unit.lastError = result.note;
    }
    await save();
  } catch (error) {
    const failure = toSocialError(error, provider);
    const nowCommitted = typeof unit.progress["committedAt"] === "string";
    if (nowCommitted && !failure.definitive && failure.kind !== "not-ready") {
      // The visible request may have gone through. Never send it again.
      delete unit.progress["resumable"];
      unit.progress["reconciles"] = 0;
      unit.status = "uncertain";
      unit.lastError = UNCONFIRMED(label);
      unit.nextAttemptAt = iso(deps, RECONCILE_BACKOFF_MS[0]);
      await save();
      return;
    }
    if (nowCommitted && failure.definitive) delete unit.progress["committedAt"];
    await settleFailure(owner, provider, unit, failure, deps, save);
  }
}

/** Pasted-credential networks have no read-back: a committed call whose
 * answer was lost stays uncertain and is never repeated. */
async function runPasteUnit(
  owner: string,
  record: ScheduleRecord,
  network: LivePostNetwork,
  unit: ScheduleUnit,
  deps: ScheduleDeps,
  save: () => Promise<void>,
) {
  if (typeof unit.progress["committedAt"] === "string") {
    unit.status = "uncertain";
    unit.lastError = UNCONFIRMED(network);
    unit.nextAttemptAt = null;
    await save();
    return;
  }
  const key = tokenKey(deps.env);
  const secrets: PasteSecret[] =
    record.sealedSecrets && key
      ? (JSON.parse(openToken(record.sealedSecrets, `schedule:${owner}`, key)) as PasteSecret[])
      : [];
  const secret = secrets.find((row) => row.id === network);
  if (!secret) {
    unit.status = "failed";
    unit.lastError = "Connect this account first.";
    unit.nextAttemptAt = null;
    await save();
    return;
  }
  unit.status = "publishing";
  unit.attempts += 1;
  unit.progress["committedAt"] = iso(deps);
  await save();
  const photo = legacyMedia(record).find((item) => item.kind === "image");
  const image = photo ? await downloadImage(deps.media, photo).catch(() => null) : null;
  const posted = await deps.paste({
    secret,
    caption: record.caption,
    ...(image?.length ? { image: { mime: "image/jpeg", bytes: image } } : {}),
  });
  if (posted.ok) {
    unit.status = "posted";
    unit.result = { remoteId: network };
    unit.postedAt = iso(deps);
    unit.nextAttemptAt = null;
    unit.lastError = null;
  } else if (/timed out/i.test(posted.error)) {
    unit.status = "uncertain";
    unit.lastError = UNCONFIRMED(network);
    unit.nextAttemptAt = null;
  } else {
    delete unit.progress["committedAt"];
    unit.status = "failed";
    unit.lastError = posted.error;
    unit.nextAttemptAt = null;
  }
  await save();
}

const toSocialError = (error: unknown, provider: SocialProvider) =>
  error instanceof SocialApiError
    ? error
    : new SocialApiError(
        error instanceof Error && error.message
          ? error.message
          : `${PROVIDER_LABEL[provider]} could not post this.`,
        "unavailable",
      );

/** Retry accounting for a stated refusal or a no-answer before any commit. */
async function settleFailure(
  owner: string,
  provider: SocialProvider,
  unit: ScheduleUnit,
  failure: SocialApiError,
  deps: ScheduleDeps,
  save: () => Promise<void>,
) {
  // "Not ready" means "nothing happened yet, ask again": resume from saved ids.
  if (failure.kind === "not-ready") unit.progress["resumable"] = true;
  else delete unit.progress["resumable"];
  unit.lastError = failure.message;
  if (failure.kind === "auth") {
    await markReconnect(owner, provider, failure.message, deps).catch(() => {});
    unit.status = "failed";
    unit.nextAttemptAt = null;
  } else if (failure.kind === "not-ready") {
    unit.status = "publishing";
    unit.nextAttemptAt = iso(deps, failure.retryAfterMs ?? 60_000);
  } else if ((failure.retryable || failure.kind === "quota") && unit.attempts < MAX_ATTEMPTS) {
    unit.status = "scheduled";
    unit.nextAttemptAt = iso(deps, backoffMs(unit.attempts, failure));
  } else {
    unit.status = "failed";
    unit.nextAttemptAt = null;
  }
  await save();
}

async function reconcileUnit(
  owner: string,
  provider: SocialProvider,
  unit: ScheduleUnit,
  ctx: PublishContext,
  publisher: Publisher,
  deps: ScheduleDeps,
  save: () => Promise<void>,
) {
  const label = PROVIDER_LABEL[provider];
  let outcome: Awaited<ReturnType<Publisher["reconcile"]>>;
  try {
    outcome = await publisher.reconcile(ctx);
  } catch (error) {
    const failure = toSocialError(error, provider);
    if (failure.kind === "auth") {
      await markReconnect(owner, provider, failure.message, deps).catch(() => {});
      unit.status = "uncertain";
      unit.lastError = failure.message;
      unit.nextAttemptAt = null;
      await save();
      return;
    }
    outcome = { status: "unknown" };
  }
  if (outcome.status === "posted") {
    unit.status = "posted";
    unit.result = { remoteId: outcome.remoteId, ...(outcome.url ? { url: outcome.url } : {}) };
    unit.postedAt = iso(deps);
    unit.nextAttemptAt = null;
    unit.lastError = null;
    await save();
    return;
  }
  if (outcome.status === "absent") {
    // The provider states nothing was posted: the unit may be tried again.
    delete unit.progress["committedAt"];
    delete unit.progress["resumable"];
    await settleFailure(
      owner,
      provider,
      unit,
      new SocialApiError(`${label} did not post this. It will be tried again.`, "unavailable"),
      deps,
      save,
    );
    return;
  }
  if (outcome.status === "pending") {
    unit.progress["resumable"] = true;
    unit.status = "publishing";
    unit.nextAttemptAt = iso(deps, Math.max(5_000, outcome.retryMs));
    unit.lastError = outcome.note;
    await save();
    return;
  }
  const reconciles = (Number(unit.progress["reconciles"]) || 0) + 1;
  unit.progress["reconciles"] = reconciles;
  unit.status = "uncertain";
  unit.lastError = UNCONFIRMED(label);
  unit.nextAttemptAt =
    reconciles < MAX_RECONCILES
      ? iso(deps, RECONCILE_BACKOFF_MS[Math.min(reconciles, RECONCILE_BACKOFF_MS.length - 1)]!)
      : null;
  await save();
}

function mediaAccess(deps: ScheduleDeps): PublishContext["media"] {
  const origin = (() => {
    try {
      return new URL(deps.env["PUBLISH_ORIGIN"] ?? "").origin;
    } catch {
      return "";
    }
  })();
  return {
    signedUrl: (item, seconds) => signedMediaUrl(deps.media, item, seconds),
    proxyUrl: async (item) => {
      if (!origin) throw new SocialApiError("PUBLISH_ORIGIN is not configured.", "config");
      return proxyUrl(origin, proxyTicket(deps.env, item, deps.now()));
    },
    readRange: (item, start, end) => deps.media.readRange(item.bucket, item.path, start, end),
    download: (item) => downloadImage(deps.media, item),
  };
}

/** Media goes once no unit can still need it. */
async function cleanupMedia(owner: string, id: string, record: ScheduleRecord, deps: ScheduleDeps) {
  if (record.mediaRemovedAt) return true;
  const units = Object.values(record.units ?? {});
  const done = units.every(
    (unit) =>
      !unit ||
      unitSettled(unit.status) ||
      (unit.status === "uncertain" && unit.nextAttemptAt === null),
  );
  if (!done) return false;
  const media = legacyMedia(record);
  if (media.length && !(await removeStoredMedia(deps.media, media))) return false;
  record.mediaRemovedAt = iso(deps);
  await deps.db.from(TABLE).update({ record }).eq("id", id).eq("owner_id", owner);
  return true;
}

export type TickSummary = {
  ran: number;
  posted: number;
  pending: number;
  failed: number;
  uncertain: number;
  swept: number;
};

/** Every due post (all owners for the cron; one owner from the page). Each row is
 * claimed under its own lease, so overlapping ticks share the work. */
export async function tickDuePosts(
  now = Date.now(),
  deps: ScheduleDeps = scheduleDeps({ now: () => now }),
  options: { owner?: string; limit?: number; budgetMs?: number } = {},
): Promise<TickSummary> {
  const summary: TickSummary = { ran: 0, posted: 0, pending: 0, failed: 0, uncertain: 0, swept: 0 };
  const stamp = new Date(now).toISOString();
  const limit = options.limit ?? TICK_LIMIT;
  const due = deps.db
    .from(TABLE)
    .select("id, owner_id")
    .eq("record->>kind", SCHEDULE_KIND)
    .in("record->>status", ["scheduled", "posting", "uncertain"])
    .not("record->>nextAttemptAt", "is", null)
    .lte("record->>nextAttemptAt", stamp)
    .or(`lease.is.null,lease_until.lt.${stamp}`);
  // Rows from before units existed have no nextAttemptAt; they are due by runAt.
  const legacy = deps.db
    .from(TABLE)
    .select("id, owner_id")
    .eq("record->>kind", SCHEDULE_KIND)
    .eq("record->>status", "scheduled")
    .is("record->>version", null)
    .lte("record->>runAt", stamp)
    .or(`lease.is.null,lease_until.lt.${stamp}`);
  const [v2, v1] = await Promise.all([
    (options.owner ? due.eq("owner_id", options.owner) : due)
      .order("created_at", { ascending: true })
      .limit(limit),
    (options.owner ? legacy.eq("owner_id", options.owner) : legacy)
      .order("created_at", { ascending: true })
      .limit(limit),
  ]);
  const rows = [...(v2.data ?? []), ...(v1.data ?? [])].slice(0, limit) as {
    id: string;
    owner_id: string;
  }[];
  const deadline = options.budgetMs ? deps.now() + options.budgetMs : undefined;
  for (const row of rows) {
    if (deadline && deps.now() >= deadline) break;
    try {
      const view = await runSchedule(
        options.owner ?? null,
        String(row.id),
        deps,
        deadline ? { deadline } : {},
      );
      summary.ran++;
      if (view.status === "posted") summary.posted++;
      else if (view.status === "failed") summary.failed++;
      else if (view.status === "uncertain") summary.uncertain++;
      else summary.pending++;
    } catch {
      /* next due post still runs */
    }
  }
  if (!options.owner) summary.swept = await sweepSchedule(deps).catch(() => 0);
  return summary;
}

/** Housekeeping after the due rows: posts whose media never arrived are
 * cancelled after a day; settled posts lose their media after a week. */
export async function sweepSchedule(deps: ScheduleDeps = scheduleDeps()): Promise<number> {
  let swept = 0;
  const stale = await deps.db
    .from(TABLE)
    .select("id, owner_id, record")
    .eq("record->>kind", SCHEDULE_KIND)
    .eq("record->>status", "scheduled")
    .eq("record->>version", "2")
    .is("record->>nextAttemptAt", null)
    .lt("created_at", iso(deps, -UNREADY_TTL_MS))
    .limit(50);
  for (const row of stale.data ?? []) {
    if (
      !isScheduleRecord(row.record) ||
      row.record.nextAttemptAt !== null ||
      row.record.status !== "scheduled"
    )
      continue;
    const record = { ...row.record, status: "cancelled" as const };
    for (const unit of Object.values(record.units ?? {}))
      if (unit)
        Object.assign(unit, {
          status: "cancelled",
          nextAttemptAt: null,
          lastError: "The media never finished uploading.",
        });
    const saved = await deps.db
      .from(TABLE)
      .update({ record })
      .eq("id", row.id)
      .eq("owner_id", row.owner_id)
      .is("lease", null)
      .select("id")
      .maybeSingle();
    if (!saved.error && saved.data) {
      swept++;
      await cleanupMedia(String(row.owner_id), String(row.id), record, deps).catch(() => {});
    }
  }
  const old = await deps.db
    .from(TABLE)
    .select("id, owner_id, record")
    .eq("record->>kind", SCHEDULE_KIND)
    .in("record->>status", ["posted", "failed", "cancelled", "uncertain"])
    .is("record->>mediaRemovedAt", null)
    .lt("created_at", iso(deps, -MEDIA_TTL_MS))
    .limit(50);
  for (const row of old.data ?? []) {
    if (!isScheduleRecord(row.record) || row.record.mediaRemovedAt) continue;
    const record = upgradeRecord(row.record);
    // A week on, an uncertain unit is a human's job; its media is no longer useful to a runner.
    for (const unit of Object.values(record.units ?? {}))
      if (unit?.status === "uncertain") unit.nextAttemptAt = null;
    if (await cleanupMedia(String(row.owner_id), String(row.id), record, deps).catch(() => false))
      swept++;
  }
  return swept;
}
