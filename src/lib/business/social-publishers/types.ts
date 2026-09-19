/** What every publisher gets and must return. Publishers are resumable: they
 * keep every provider id they obtain in `unit.progress` (persisted by `save`)
 * and call `commit` once, right before the one request that makes a post
 * visible. A run that finds `progress.committedAt` set but no result never
 * repeats that request; it asks the provider what happened (`reconcile`).
 */
import type { SocialSession } from "../social-connections.server";
import type { SocialProvider, StoredMedia, UnitKind, UnitOptions } from "../../social/connectors";

export type PublishUnit = {
  id: string;
  owner: string;
  provider: SocialProvider;
  kind: UnitKind;
  caption: string;
  title: string | null;
  media: StoredMedia[];
  options: UnitOptions;
  /** The provider account the post was confirmed for. */
  accountId: string;
  progress: Record<string, unknown>;
};

export type MediaAccess = {
  /** A short-lived URL the provider can fetch (Supabase signed URL). */
  signedUrl: (item: StoredMedia, seconds?: number) => Promise<string>;
  /** A URL on PUBLISH_ORIGIN for providers that only pull from a verified domain. */
  proxyUrl: (item: StoredMedia) => Promise<string>;
  /** Bytes [start, end] inclusive. */
  readRange: (item: StoredMedia, start: number, end: number) => Promise<Uint8Array>;
  /** A whole image. Videos are read by range. */
  download: (item: StoredMedia) => Promise<Uint8Array>;
};

export type PublishContext = {
  unit: PublishUnit;
  session: SocialSession;
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** When this run must hand back; publishers return `pending` past it. */
  deadline: number;
  media: MediaAccess;
  env: Record<string, string | undefined>;
  /** Persists `unit.progress`. */
  save: () => Promise<void>;
  /** Persists `unit.progress` with `committedAt`. Call once, before the visible request. */
  commit: () => Promise<void>;
  /** Remembers provider facts on the connection (rate-limit headers, creator options). */
  remember: (patch: Record<string, unknown>) => Promise<void>;
};

export type PublishResult =
  | { status: "posted"; remoteId: string; url?: string; note?: string }
  /** Not done yet (processing, upload budget spent); run again after `retryMs`. */
  | { status: "pending"; note: string; retryMs: number };

export type ReconcileResult =
  | { status: "posted"; remoteId: string; url?: string }
  /** The provider states nothing was posted; a retry is safe. */
  | { status: "absent" }
  /** Still processing; check again later. */
  | { status: "pending"; note: string; retryMs: number }
  /** No way to know; leave for a human, never re-send. */
  | { status: "unknown" };

export type Publisher = {
  publish(context: PublishContext): Promise<PublishResult>;
  reconcile(context: PublishContext): Promise<ReconcileResult>;
};

export const committed = (unit: PublishUnit) => typeof unit.progress["committedAt"] === "string";

/** Poll pauses for container/processing checks. */
export const POLL_STEPS_MS = [2000, 3000, 5000, 8000, 10000] as const;
export const pollPause = (attempt: number) =>
  POLL_STEPS_MS[Math.min(attempt, POLL_STEPS_MS.length - 1)]!;

/** Bounded JSON body read: providers can answer with large HTML error pages. */
export async function readBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text().catch(() => "");
  if (!text || text.length > 400_000) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const numericId = (value: unknown) =>
  typeof value === "string" && /^\d+$/.test(value)
    ? value
    : typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : null;

/** Creation time window for reconciling by content: a post made for this unit
 * cannot predate its commit by more than clock skew. */
export const createdSinceCommit = (unit: PublishUnit, createdAt: unknown, now: number) => {
  const committedAt = Date.parse(String(unit.progress["committedAt"] ?? ""));
  const created = Date.parse(String(createdAt ?? ""));
  return (
    Number.isFinite(committedAt) &&
    Number.isFinite(created) &&
    created >= committedAt - 120_000 &&
    created <= now + 120_000
  );
};

/** TS 5.7 types `Uint8Array` over `ArrayBufferLike`, which `fetch`/`Blob` typings
 * refuse; the runtime accepts it. These casts are the only place that gap is bridged. */
export const bodyOf = (bytes: Uint8Array): BodyInit => bytes as unknown as BodyInit;
export const blobPartOf = (bytes: Uint8Array): BlobPart => bytes as unknown as BlobPart;
