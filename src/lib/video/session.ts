import { workspaceStorageKey } from "@/lib/workspace-storage";

export type VideoVerdict = "undecided" | "keep" | "reject";
export type VideoFilter = "all" | "todo" | "keepers" | "rejected";
export type VideoMetadataStatus = "ready" | "unavailable";

export type PersistedVideoClip = {
  id: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  duration: number;
  width: number;
  height: number;
  verdict: VideoVerdict;
  metadataStatus: VideoMetadataStatus;
};

export type PersistedVerdictChange = {
  id: string;
  previous: VideoVerdict;
  next: VideoVerdict;
};

export type PersistedJournalEntry = {
  id: string;
  label: string;
  changes: PersistedVerdictChange[];
};

export type PersistedVideoSession = {
  version: 1;
  revision: number;
  clips: PersistedVideoClip[];
  selectedId: string | null;
  filter: VideoFilter;
  journal: PersistedJournalEntry[];
  updatedAt: string;
};

export type VideoReviewDraft = Omit<PersistedVideoSession, "version" | "revision" | "updatedAt">;

export type VideoSessionLoadResult =
  | { status: "empty"; session: null; warning: null }
  | { status: "ready"; session: PersistedVideoSession; warning: null }
  | { status: "invalid"; session: null; warning: string };

export type VideoSessionWriteResult =
  | { ok: true; session: PersistedVideoSession }
  | {
      ok: false;
      reason: "unavailable" | "invalid" | "conflict" | "write";
      error: string;
      currentSession?: PersistedVideoSession;
    };

export interface VideoReviewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface VideoReviewLockManager {
  request<T>(name: string, callback: () => T | Promise<T>): Promise<T>;
}

export const VIDEO_REVIEW_STORAGE_KEY = "lenslabs.video-review.v1";

const VIDEO_REVIEW_WRITE_LOCK = `${VIDEO_REVIEW_STORAGE_KEY}.write`;
const MAX_CLIPS = 5_000;
const MAX_JOURNAL = 50;
const VERDICTS = new Set<VideoVerdict>(["undecided", "keep", "reject"]);
const FILTERS = new Set<VideoFilter>(["all", "todo", "keepers", "rejected"]);
const METADATA_STATUSES = new Set<VideoMetadataStatus>(["ready", "unavailable"]);

function browserStorage(): VideoReviewStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function browserLockManager(): VideoReviewLockManager | null {
  if (typeof navigator === "undefined" || !("locks" in navigator)) return null;
  return navigator.locks as VideoReviewLockManager;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseClip(value: unknown): PersistedVideoClip | null {
  if (!value || typeof value !== "object") return null;
  const clip = value as Partial<Record<keyof PersistedVideoClip, unknown>>;
  if (
    typeof clip.id !== "string" ||
    clip.id.length === 0 ||
    typeof clip.name !== "string" ||
    clip.name.length === 0 ||
    typeof clip.type !== "string" ||
    !finiteNumber(clip.size) ||
    !finiteNumber(clip.lastModified) ||
    !finiteNumber(clip.duration) ||
    !finiteNumber(clip.width) ||
    !finiteNumber(clip.height) ||
    !VERDICTS.has(clip.verdict as VideoVerdict)
  ) {
    return null;
  }

  // v1 snapshots written before metadataStatus existed can be migrated without
  // dropping any user review state.
  const metadataStatus = METADATA_STATUSES.has(clip.metadataStatus as VideoMetadataStatus)
    ? (clip.metadataStatus as VideoMetadataStatus)
    : clip.duration > 0 || clip.width > 0 || clip.height > 0
      ? "ready"
      : "unavailable";

  return {
    id: clip.id,
    name: clip.name,
    type: clip.type,
    size: clip.size,
    lastModified: clip.lastModified,
    duration: clip.duration,
    width: clip.width,
    height: clip.height,
    verdict: clip.verdict as VideoVerdict,
    metadataStatus,
  };
}

function parseJournalEntry(value: unknown): PersistedJournalEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as { id?: unknown; label?: unknown; changes?: unknown };
  if (
    typeof entry.id !== "string" ||
    entry.id.length === 0 ||
    typeof entry.label !== "string" ||
    entry.label.length === 0 ||
    !Array.isArray(entry.changes) ||
    entry.changes.length === 0
  ) {
    return null;
  }

  const changes: PersistedVerdictChange[] = [];
  for (const value of entry.changes) {
    if (!value || typeof value !== "object") return null;
    const change = value as { id?: unknown; previous?: unknown; next?: unknown };
    if (
      typeof change.id !== "string" ||
      change.id.length === 0 ||
      !VERDICTS.has(change.previous as VideoVerdict) ||
      !VERDICTS.has(change.next as VideoVerdict)
    ) {
      return null;
    }
    changes.push({
      id: change.id,
      previous: change.previous as VideoVerdict,
      next: change.next as VideoVerdict,
    });
  }

  return { id: entry.id, label: entry.label, changes };
}

export function loadVideoReviewSession(
  storage: VideoReviewStorage | null = browserStorage(),
  scope = "device-local",
): VideoSessionLoadResult {
  if (!storage) {
    return {
      status: "invalid",
      session: null,
      warning: "Local review storage is unavailable. Existing review data was not changed.",
    };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(workspaceStorageKey(VIDEO_REVIEW_STORAGE_KEY, scope));
  } catch {
    return {
      status: "invalid",
      session: null,
      warning: "Local review storage could not be read. Existing review data was not changed.",
    };
  }
  if (raw === null) return { status: "empty", session: null, warning: null };

  try {
    const value = JSON.parse(raw) as {
      version?: unknown;
      revision?: unknown;
      clips?: unknown;
      selectedId?: unknown;
      filter?: unknown;
      journal?: unknown;
      updatedAt?: unknown;
    };
    if (
      value.version !== 1 ||
      (value.revision !== undefined && !validRevision(value.revision)) ||
      !Array.isArray(value.clips) ||
      value.clips.length > MAX_CLIPS ||
      !(value.selectedId === null || typeof value.selectedId === "string") ||
      !FILTERS.has(value.filter as VideoFilter) ||
      !Array.isArray(value.journal) ||
      value.journal.length > MAX_JOURNAL ||
      !validTimestamp(value.updatedAt)
    ) {
      throw new Error("unsupported snapshot");
    }

    const clips = value.clips.map(parseClip);
    const journal = value.journal.map(parseJournalEntry);
    if (clips.some((clip) => clip === null) || journal.some((entry) => entry === null)) {
      throw new Error("invalid snapshot rows");
    }
    const validClips = clips as PersistedVideoClip[];
    const validJournal = journal as PersistedJournalEntry[];
    if (new Set(validClips.map((clip) => clip.id)).size !== validClips.length) {
      throw new Error("duplicate clips");
    }
    if (
      typeof value.selectedId === "string" &&
      !validClips.some((clip) => clip.id === value.selectedId)
    ) {
      throw new Error("missing selection");
    }

    return {
      status: "ready",
      session: {
        version: 1,
        revision: value.revision ?? 0,
        clips: validClips,
        selectedId: value.selectedId,
        filter: value.filter as VideoFilter,
        journal: validJournal,
        updatedAt: value.updatedAt as string,
      },
      warning: null,
    };
  } catch {
    return {
      status: "invalid",
      session: null,
      warning:
        "The saved video review is unreadable or unsupported. It was preserved and automatic saving is paused.",
    };
  }
}

export function saveVideoReviewSession(
  draft: VideoReviewDraft,
  expectedRevision: number,
  storage: VideoReviewStorage | null = browserStorage(),
  now = new Date().toISOString(),
  scope = "device-local",
): VideoSessionWriteResult {
  if (!storage) {
    return { ok: false, reason: "unavailable", error: "Local review storage is unavailable." };
  }

  const current = loadVideoReviewSession(storage, scope);
  if (current.status === "invalid") {
    return {
      ok: false,
      reason: "invalid",
      error: "The saved video review became unreadable. It was preserved and saving is paused.",
    };
  }
  const currentRevision = current.status === "ready" ? current.session.revision : 0;
  if (currentRevision !== expectedRevision) {
    return {
      ok: false,
      reason: "conflict",
      error:
        "This video review changed in another tab. The latest saved review was loaded; retry your change.",
      ...(current.status === "ready" ? { currentSession: current.session } : {}),
    };
  }

  const payload: PersistedVideoSession = {
    version: 1,
    revision: expectedRevision + 1,
    clips: draft.clips,
    selectedId: draft.selectedId,
    filter: draft.filter,
    journal: draft.journal.slice(-MAX_JOURNAL),
    updatedAt: now,
  };

  // Validate the exact payload before touching the existing snapshot.
  const validationStorage: VideoReviewStorage = {
    getItem: () => JSON.stringify(payload),
    setItem: () => undefined,
  };
  if (loadVideoReviewSession(validationStorage).status !== "ready") {
    return {
      ok: false,
      reason: "invalid",
      error: "The video review update was invalid and was not saved.",
    };
  }

  try {
    storage.setItem(workspaceStorageKey(VIDEO_REVIEW_STORAGE_KEY, scope), JSON.stringify(payload));
    return { ok: true, session: payload };
  } catch {
    return {
      ok: false,
      reason: "write",
      error: "The video review could not be saved. Nothing in storage was changed.",
    };
  }
}

export async function commitVideoReviewSession(
  draft: VideoReviewDraft,
  expectedRevision: number,
  options: {
    storage?: VideoReviewStorage | null;
    lockManager?: VideoReviewLockManager | null;
    now?: string;
    scope?: string;
  } = {},
): Promise<VideoSessionWriteResult> {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const lockManager =
    options.lockManager === undefined ? browserLockManager() : options.lockManager;
  if (!storage || !lockManager) {
    return {
      ok: false,
      reason: "unavailable",
      error: "Safe cross-tab review storage is unavailable. Nothing was changed.",
    };
  }

  try {
    return await lockManager.request(workspaceStorageKey(VIDEO_REVIEW_WRITE_LOCK, options.scope), () =>
      saveVideoReviewSession(draft, expectedRevision, storage, options.now, options.scope),
    );
  } catch {
    return {
      ok: false,
      reason: "write",
      error: "The video review could not acquire its safe write lock.",
    };
  }
}

export async function clearVideoReviewSession(
  options: {
    storage?: VideoReviewStorage | null;
    lockManager?: VideoReviewLockManager | null;
    now?: string;
    scope?: string;
  } = {},
): Promise<VideoSessionWriteResult> {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const lockManager =
    options.lockManager === undefined ? browserLockManager() : options.lockManager;
  if (!storage || !lockManager) {
    return {
      ok: false,
      reason: "unavailable",
      error: "Safe cross-tab review storage is unavailable. Nothing was cleared.",
    };
  }

  try {
    return await lockManager.request(workspaceStorageKey(VIDEO_REVIEW_WRITE_LOCK, options.scope), () => {
      const current = loadVideoReviewSession(storage, options.scope);
      const currentRevision = current.status === "ready" ? current.session.revision : 0;
      const tombstone: PersistedVideoSession = {
        version: 1,
        revision: Math.max(Date.now(), currentRevision + 1),
        clips: [],
        selectedId: null,
        filter: "all",
        journal: [],
        updatedAt: options.now ?? new Date().toISOString(),
      };
      try {
        storage.setItem(workspaceStorageKey(VIDEO_REVIEW_STORAGE_KEY, options.scope), JSON.stringify(tombstone));
        return { ok: true, session: tombstone };
      } catch {
        return {
          ok: false,
          reason: "write" as const,
          error: "The saved video review could not be cleared.",
        };
      }
    });
  } catch {
    return {
      ok: false,
      reason: "write",
      error: "The video review could not acquire its safe clear lock.",
    };
  }
}
