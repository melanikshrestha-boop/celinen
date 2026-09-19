/** Scheduled social posts. Measurements of intent, never pixels.
 *
 * One record (`social_publications`, kind "schedule") is one caption sent to
 * several networks at one time. Version 2 records carry a per-network `unit`
 * with its own status machine, attempts and provider progress, so one slow or
 * uncertain network never blocks or repeats another.
 */
import { SOCIAL_NETWORKS, type SocialId } from "../social-accounts";
import { isPasteSocial, type PasteSecret, type PasteSocialId } from "../social-paste";
import {
  PROVIDER_FOR_NETWORK,
  mediaItem,
  unitOptions,
  type MediaItem,
  type ScheduleStatus as UnitStatus,
  type SocialProvider,
  type StoredMedia,
  type UnitKind,
  type UnitOptions,
} from "./connectors";

/** Networks Celinen can publish without opening someone else's compose sheet. */
export const LIVE_POST_NETWORKS = [
  "instagram",
  "facebook",
  "threads",
  "bluesky",
  "mastodon",
  "discord",
  "x",
  "linkedin",
  "tiktok",
  "youtube-shorts",
] as const satisfies readonly SocialId[];

export type LivePostNetwork = (typeof LIVE_POST_NETWORKS)[number];

export const SCHEDULE_KIND = "schedule";

export type ScheduleStatus =
  "scheduled" | "posting" | "posted" | "failed" | "uncertain" | "cancelled";

export type ScheduleResult = {
  id: LivePostNetwork;
  ok: boolean;
  error?: string;
  url?: string;
};

/** One network's slice of a scheduled post. */
export type ScheduleUnit = {
  status: UnitStatus;
  attempts: number;
  /** When a runner may next touch this unit; null = not runnable (settled, or media still uploading). */
  nextAttemptAt: string | null;
  lastError: string | null;
  /** Provider ids the publisher obtained, and `committedAt` before the visible call. */
  progress: Record<string, unknown>;
  result?: { remoteId: string; url?: string };
  postedAt?: string;
  /** The provider account the unit was confirmed for; never post elsewhere. */
  accountId?: string;
  connectionId?: string | null;
};

export type ScheduleRecord = {
  id?: string;
  kind: typeof SCHEDULE_KIND;
  caption: string;
  networks: LivePostNetwork[];
  runAt: string;
  status: ScheduleStatus;
  /** Per-network summary for the page; derived from `units` on version 2 records. */
  results: ScheduleResult[];
  /** Version 1: one inline photo uploaded by the server. */
  imagePath?: string;
  imageMime?: string;
  /** Version 1: sealed paste credentials for Bluesky/Mastodon/Discord (and X/LinkedIn without OAuth). */
  sealedSecrets?: string;
  createdAt: string;
  postedAt?: string;
  /** Version 2 fields. */
  version?: 2;
  unitKind?: UnitKind;
  title?: string;
  media?: StoredMedia[];
  options?: UnitOptions;
  units?: Partial<Record<LivePostNetwork, ScheduleUnit>>;
  /** Earliest runnable unit time; null while media uploads or once every unit settled. */
  nextAttemptAt?: string | null;
  mediaRemovedAt?: string;
};

/** What the page receives: no sealed secrets, no provider progress. */
export type ScheduleUnitView = Omit<ScheduleUnit, "progress">;
export type ScheduleView = Omit<ScheduleRecord, "sealedSecrets" | "units" | "id"> & {
  id: string;
  units?: Partial<Record<LivePostNetwork, ScheduleUnitView>>;
};

export function isLivePostNetwork(id: string): id is LivePostNetwork {
  return (LIVE_POST_NETWORKS as readonly string[]).includes(id);
}

export function canScheduleNetwork(id: SocialId): boolean {
  return isLivePostNetwork(id);
}

/** Networks served by a server-side OAuth connection (instagram.server, facebook.server, social-connections.server). */
export const providerForNetwork = (id: LivePostNetwork): SocialProvider | null =>
  PROVIDER_FOR_NETWORK[id] ?? null;

export function isScheduleRecord(value: unknown): value is ScheduleRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as ScheduleRecord;
  return (
    row.kind === SCHEDULE_KIND && typeof row.caption === "string" && Array.isArray(row.networks)
  );
}

export type ParsedScheduleInput = {
  caption: string;
  networks: LivePostNetwork[];
  runAt: string;
  id: string | null;
  unitKind: UnitKind;
  title: string | null;
  media: MediaItem[];
  options: UnitOptions;
};

export function parseScheduleInput(input: {
  caption: unknown;
  networks: unknown;
  runAt: unknown;
  id?: unknown;
  unitKind?: unknown;
  title?: unknown;
  media?: unknown;
  options?: unknown;
}): ParsedScheduleInput {
  const caption = String(input.caption ?? "").trim();
  if (caption.length > 20000) throw new Error("Caption is too long.");
  if (!Array.isArray(input.networks) || !input.networks.length)
    throw new Error("Choose at least one account.");
  const networks = [
    ...new Set(
      input.networks.filter(
        (id): id is LivePostNetwork => typeof id === "string" && isLivePostNetwork(id),
      ),
    ),
  ];
  if (!networks.length) throw new Error("Those accounts cannot be posted from Celinen yet.");
  const runAt = String(input.runAt ?? "");
  const at = Date.parse(runAt);
  if (!Number.isFinite(at)) throw new Error("Pick a time.");
  const id =
    typeof input.id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id)
      ? input.id.toLowerCase()
      : null;
  const unitKind =
    (["post", "story", "reel", "video"] as const).find((kind) => kind === input.unitKind) ?? "post";
  const title =
    typeof input.title === "string" && input.title.trim() ? input.title.trim().slice(0, 400) : null;
  const media = Array.isArray(input.media) ? input.media.map((item) => mediaItem.parse(item)) : [];
  if (media.length > 20) throw new Error("At most 20 photos per post.");
  if (new Set(media.map((item) => item.sha256)).size !== media.length)
    throw new Error("Remove duplicate media.");
  const videos = media.filter((item) => item.kind === "video").length;
  if (videos > 1) throw new Error("One video per post.");
  if (videos && media.length > 1) throw new Error("A video posts on its own, without photos.");
  const options = unitOptions.parse(input.options ?? {});
  if (!caption && !media.length) throw new Error("Write a caption first.");
  return {
    caption,
    networks,
    runAt: new Date(at).toISOString(),
    id,
    unitKind,
    title,
    media,
    options,
  };
}

export function secretsForNetworks(
  networks: readonly LivePostNetwork[],
  secrets: Partial<Record<PasteSocialId, PasteSecret>>,
): PasteSecret[] {
  const needed = networks.filter((id): id is PasteSocialId => isPasteSocial(id));
  const missing = needed.filter((id) => !secrets[id]);
  if (missing.length) {
    const title = SOCIAL_NETWORKS.find((row) => row.id === missing[0])?.title ?? missing[0];
    throw new Error(`Connect ${title} first.`);
  }
  return needed.map((id) => secrets[id]!);
}

export const unitSettled = (status: UnitStatus) =>
  status === "posted" || status === "failed" || status === "cancelled";

/** The record's status is the worst of its units: any unit still running keeps
 * the record open; an uncertain unit outranks a failure; posted only when every
 * unit settled and at least one posted. */
export function deriveStatus(units: Partial<Record<string, ScheduleUnit>>): ScheduleStatus {
  const list = Object.values(units).filter((unit): unit is ScheduleUnit => Boolean(unit));
  if (!list.length) return "scheduled";
  if (list.every((unit) => unit.status === "cancelled")) return "cancelled";
  if (list.some((unit) => unit.status === "publishing")) return "posting";
  if (list.every((unit) => unit.status === "scheduled")) return "scheduled";
  // Some units are waiting for a retry while others already settled: still in flight.
  if (list.some((unit) => unit.status === "scheduled")) return "posting";
  if (list.some((unit) => unit.status === "uncertain")) return "uncertain";
  if (list.some((unit) => unit.status === "posted")) return "posted";
  return "failed";
}

export function summarizeUnits(
  units: Partial<Record<LivePostNetwork, ScheduleUnit>>,
): ScheduleResult[] {
  return (Object.entries(units) as [LivePostNetwork, ScheduleUnit | undefined][])
    .filter(([, unit]) => unit && (unitSettled(unit.status) || unit.status === "uncertain"))
    .map(([id, unit]) => ({
      id,
      ok: unit!.status === "posted",
      ...(unit!.result?.url ? { url: unit!.result.url } : {}),
      ...(unit!.status !== "posted" && unit!.lastError ? { error: unit!.lastError } : {}),
    }));
}

/** The earliest time any unit wants a runner; null when nothing is runnable. */
export function nextAttemptOf(units: Partial<Record<string, ScheduleUnit>>): string | null {
  let next: string | null = null;
  for (const unit of Object.values(units)) {
    if (!unit?.nextAttemptAt) continue;
    if (!next || unit.nextAttemptAt < next) next = unit.nextAttemptAt;
  }
  return next;
}
