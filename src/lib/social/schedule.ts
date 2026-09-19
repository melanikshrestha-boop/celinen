/** Scheduled social posts. Measurements of intent, never pixels. */
import { SOCIAL_NETWORKS, type SocialId } from "../social-accounts";
import { isPasteSocial, type PasteSecret, type PasteSocialId } from "../social-paste";

/** Networks Celinen can publish without opening someone else's compose sheet. */
export const LIVE_POST_NETWORKS = [
  "instagram",
  "facebook",
  "bluesky",
  "mastodon",
  "discord",
  "x",
  "linkedin",
] as const satisfies readonly SocialId[];

export type LivePostNetwork = (typeof LIVE_POST_NETWORKS)[number];

export const SCHEDULE_KIND = "schedule";

export type ScheduleStatus = "scheduled" | "posting" | "posted" | "failed" | "cancelled";

export type ScheduleResult = {
  id: LivePostNetwork;
  ok: boolean;
  error?: string;
  url?: string;
};

export type ScheduleRecord = {
  id?: string;
  kind: typeof SCHEDULE_KIND;
  caption: string;
  networks: LivePostNetwork[];
  runAt: string;
  status: ScheduleStatus;
  results: ScheduleResult[];
  imagePath?: string;
  imageMime?: string;
  sealedSecrets?: string;
  createdAt: string;
  postedAt?: string;
};

export function isLivePostNetwork(id: string): id is LivePostNetwork {
  return (LIVE_POST_NETWORKS as readonly string[]).includes(id);
}

export function canScheduleNetwork(id: SocialId): boolean {
  return isLivePostNetwork(id);
}

export function isScheduleRecord(value: unknown): value is ScheduleRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as ScheduleRecord;
  return row.kind === SCHEDULE_KIND && typeof row.caption === "string" && Array.isArray(row.networks);
}

export function parseScheduleInput(input: {
  caption: unknown;
  networks: unknown;
  runAt: unknown;
}): { caption: string; networks: LivePostNetwork[]; runAt: string } {
  const caption = String(input.caption ?? "").trim();
  if (!caption) throw new Error("Write a caption first.");
  if (caption.length > 2200) throw new Error("Caption is too long.");
  if (!Array.isArray(input.networks) || !input.networks.length)
    throw new Error("Choose at least one account.");
  const networks = [
    ...new Set(
      input.networks.filter((id): id is LivePostNetwork => typeof id === "string" && isLivePostNetwork(id)),
    ),
  ];
  if (!networks.length) throw new Error("Those accounts cannot be posted from Celinen yet.");
  const runAt = String(input.runAt ?? "");
  const at = Date.parse(runAt);
  if (!Number.isFinite(at)) throw new Error("Pick a time.");
  return { caption, networks, runAt: new Date(at).toISOString() };
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
