import type { Shot } from "@/lib/imaging";
import { studioDatabaseKey } from "./shoot-directory";

const VERSION = 2;
const SESSION_STORE = "sessions";
const SHOT_STORE = "shots";
const ACTIVE_SESSION = "active";
const WRITER_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const STUDIO_FILTERS = new Set<StudioFilter>(["all", "keepers", "flagged", "rejected", "todo"]);

export type StudioFilter = "all" | "keepers" | "flagged" | "rejected" | "todo";
export type StudioHydrationState = "loading" | "ready" | "failed" | "clearing" | "conflicted";

export class StudioSaveConflict extends Error {
  constructor() {
    super("This Studio session changed in another tab. Saving is paused to protect both versions.");
    this.name = "StudioSaveConflict";
  }
}

type StoredShot = Omit<Shot, "file" | "previewUrl" | "previewBlob"> & {
  previewBlob: Blob | null;
};

type StoredSession = {
  id: typeof ACTIVE_SESSION;
  shotIds: string[];
  selectedId: string | null;
  filter: StudioFilter;
  updatedAt: number;
  revision?: number;
  writerId?: string;
  recoverySource?: string;
};

type LegacyStoredSession = Omit<StoredSession, "shotIds"> & { shots: StoredShot[] };

export type HydratedStudioSession = {
  shots: Shot[];
  selectedId: string | null;
  filter: StudioFilter;
  updatedAt: number;
};

type SessionState = {
  lastSavedSignatures: Map<string, string>;
  lastSavedPreviews: Map<string, Blob | null>;
  saveQueue: Promise<void>;
  knownRevision: number;
};
// Fast Refresh preserves the live Studio component. Its writer must survive too:
// resetting the expected revision to zero creates a false cross-tab conflict.
const sessions: Map<string, SessionState> = import.meta.hot?.data["studioSessions"] ?? new Map();
if (import.meta.hot)
  import.meta.hot.dispose((data) => {
    data["studioSessions"] = sessions;
  });
function sessionState(scope: string, shootId?: string): SessionState {
  const key = studioDatabaseKey(scope, shootId);
  let state = sessions.get(key);
  if (!state) {
    state = {
      lastSavedSignatures: new Map(),
      lastSavedPreviews: new Map(),
      saveQueue: Promise.resolve(),
      knownRevision: 0,
    };
    sessions.set(key, state);
  }
  state.lastSavedPreviews ??= new Map();
  return state;
}

export function sameStudioView(
  current: { shotIds: string[]; selectedId: string | null; filter: StudioFilter } | undefined,
  ids: string[],
  selectedId: string | null,
  filter: StudioFilter,
): boolean {
  return Boolean(
    current &&
    current.selectedId === selectedId &&
    current.filter === filter &&
    current.shotIds?.length === ids.length &&
    current.shotIds.every((id, index) => id === ids[index]),
  );
}

export function canPersistStudioSession(state: StudioHydrationState): boolean {
  return state === "ready";
}

export function studioRevisionChanged(currentRevision: number, expectedRevision: number): boolean {
  return currentRevision !== expectedRevision;
}

export function nextStudioRevision(currentRevision: number, knownRevision: number): number {
  const revision = Math.max(currentRevision, knownRevision) + 1;
  if (!Number.isSafeInteger(revision)) {
    throw new Error("The Studio revision can no longer advance safely.");
  }
  return revision;
}

export function nextStudioClearRevision(
  currentRevision: number,
  expectedRevision: number,
  force = false,
): number {
  if (!force && studioRevisionChanged(currentRevision, expectedRevision)) {
    throw new Error("This Studio session changed in another tab. Reload before clearing it.");
  }
  return nextStudioRevision(currentRevision, expectedRevision);
}

export function shouldWriteStudioShot(
  cachedSignature: string | undefined,
  nextSignature: string,
  storedRecordExists: boolean,
): boolean {
  return !storedRecordExists || cachedSignature !== nextSignature;
}

function revisionOf(session: Pick<StoredSession, "revision"> | undefined): number {
  const revision = session?.revision;
  if (revision === undefined) return 0;
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("The saved Studio revision is invalid.");
  }
  return revision;
}

function openDatabase(scope: string, shootId?: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(studioDatabaseKey(scope, shootId), VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SESSION_STORE)) {
        request.result.createObjectStore(SESSION_STORE, { keyPath: "id" });
      }
      if (!request.result.objectStoreNames.contains(SHOT_STORE)) {
        request.result.createObjectStore(SHOT_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local studio"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Local studio write aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("Local studio write failed"));
  });
}

function signatureOf(record: StoredShot): string {
  return JSON.stringify([
    record.name,
    record.relativePath,
    record.captureTimeMs,
    record.captureTimeBasis,
    record.cameraKey,
    record.analysisBackend,
    record.isRaw,
    record.width,
    record.height,
    record.sizeMb,
    record.sharpness,
    record.brightness,
    record.clippedHighlights,
    record.clippedShadows,
    record.hash,
    record.sourceDigest,
    record.tone,
    record.score,
    record.flags,
    record.verdict,
    record.edits,
    record.faces,
    record.develop,
    record.error,
    record.previewBlob?.size ?? 0,
  ]);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local studio request failed"));
  });
}

export function stableShotId(file: File): string {
  const withPath = file as File & { webkitRelativePath?: string };
  const path = withPath.webkitRelativePath || file.name;
  return `${path}:${file.size}:${file.lastModified}`;
}

export async function loadStudioSession(
  scope = "device-local",
  shootId?: string,
): Promise<HydratedStudioSession | null> {
  return hydrateStudioSession(scope, shootId, true);
}

/**
 * Read media for another tool without acknowledging a revision on behalf of the
 * still-mounted Studio writer. The caller owns and must revoke returned URLs.
 */
export async function readStudioSessionSnapshot(
  scope = "device-local",
  shootId?: string,
): Promise<HydratedStudioSession | null> {
  return hydrateStudioSession(scope, shootId, false);
}

async function hydrateStudioSession(
  scope: string,
  shootId: string | undefined,
  acknowledgeWriter: boolean,
): Promise<HydratedStudioSession | null> {
  const state = acknowledgeWriter ? sessionState(scope, shootId) : null;
  if (typeof indexedDB === "undefined") {
    throw new Error("Local Studio storage is unavailable.");
  }
  const database = await openDatabase(scope, shootId);
  try {
    const transaction = database.transaction([SESSION_STORE, SHOT_STORE], "readonly");
    const stored = await requestResult(
      transaction.objectStore(SESSION_STORE).get(ACTIVE_SESSION) as IDBRequest<
        StoredSession | LegacyStoredSession | undefined
      >,
    );
    if (!stored) {
      if (state) {
        state.knownRevision = 0;
        state.lastSavedSignatures.clear();
        state.lastSavedPreviews.clear();
      }
      return null;
    }
    const loadedRevision = revisionOf(stored);

    const isLegacy = "shots" in stored;
    if (
      !isLegacy &&
      (new Set(stored.shotIds).size !== stored.shotIds.length ||
        stored.shotIds.some((id) => typeof id !== "string" || !id))
    ) {
      throw new Error("The saved Studio frame index is invalid.");
    }
    const records = isLegacy
      ? stored.shots
      : await Promise.all(
          stored.shotIds.map((id) =>
            requestResult(
              transaction.objectStore(SHOT_STORE).get(id) as IDBRequest<StoredShot | undefined>,
            ),
          ),
        ).then((items) => items.filter((item): item is StoredShot => Boolean(item)));
    if (!isLegacy && records.length !== stored.shotIds.length) {
      throw new Error("The saved Studio session is missing frame records.");
    }
    if (!records.length) {
      if (state) {
        state.knownRevision = loadedRevision;
        state.lastSavedSignatures.clear();
        state.lastSavedPreviews.clear();
      }
      return null;
    }

    const createdUrls: string[] = [];
    let shots: Shot[];
    try {
      shots = records.map((record): Shot => {
        const { previewBlob: storedPreviewBlob, ...rest } = record;
        const previewBlob = storedPreviewBlob ?? undefined;
        const previewUrl = previewBlob ? URL.createObjectURL(previewBlob) : null;
        if (previewUrl) createdUrls.push(previewUrl);
        const previewName = `${record.name.replace(/\.[^.]+$/, "") || "frame"}.preview.jpg`;
        return {
          ...rest,
          ...(previewBlob ? { previewBlob } : {}),
          previewUrl,
          sourceAvailable: false,
          file: new File(previewBlob ? [previewBlob] : [], previewName, {
            type: previewBlob?.type || "image/jpeg",
            lastModified: 0,
          }),
        };
      });
    } catch (cause) {
      for (const url of createdUrls) URL.revokeObjectURL(url);
      throw cause;
    }

    // Only the Studio owner may acknowledge the loaded writer revision. A
    // read-only consumer must not make stale in-memory Studio edits writable.
    if (state) {
      state.knownRevision = loadedRevision;
      state.lastSavedSignatures.clear();
      state.lastSavedPreviews.clear();
      if (!isLegacy) {
        for (const record of records) {
          state.lastSavedSignatures.set(record.id, signatureOf(record));
          state.lastSavedPreviews.set(record.id, record.previewBlob);
        }
      }
    }

    const selectedId = records.some((record) => record.id === stored.selectedId)
      ? stored.selectedId
      : (records[0]?.id ?? null);
    const filter = STUDIO_FILTERS.has(stored.filter) ? stored.filter : "all";

    return {
      shots,
      selectedId,
      filter,
      updatedAt: stored.updatedAt,
    };
  } finally {
    database.close();
  }
}

async function persistStudioSession(
  shots: Shot[],
  selectedId: string | null,
  filter: StudioFilter,
  scope: string,
  shootId?: string,
): Promise<void> {
  const state = sessionState(scope, shootId);
  if (typeof indexedDB === "undefined") {
    throw new Error("Local Studio storage is unavailable.");
  }
  const database = await openDatabase(scope, shootId);
  try {
    const records: StoredShot[] = shots.map(
      ({ file: _file, previewUrl: _previewUrl, ...shot }) => ({
        ...shot,
        sourceAvailable: false,
        previewBlob: shot.previewBlob ?? null,
      }),
    );
    const transaction = database.transaction([SESSION_STORE, SHOT_STORE], "readwrite");
    const sessionStore = transaction.objectStore(SESSION_STORE);
    const current = await requestResult(
      sessionStore.get(ACTIVE_SESSION) as IDBRequest<StoredSession | undefined>,
    );
    const currentRevision = revisionOf(current);
    if (studioRevisionChanged(currentRevision, state.knownRevision)) {
      transaction.abort();
      throw new StudioSaveConflict();
    }
    const shotStore = transaction.objectStore(SHOT_STORE);
    const storedKeys = await requestResult(shotStore.getAllKeys());
    const storedIds = new Set(storedKeys.filter((key): key is string => typeof key === "string"));
    const nextSignatures = new Map(records.map((record) => [record.id, signatureOf(record)]));
    // Check CAS first. An unchanged tab should not invalidate another editor.
    // Compare Blob identity too: equal sizes do not mean equal preview bytes.
    if (
      sameStudioView(
        current,
        records.map((record) => record.id),
        selectedId,
        filter,
      ) &&
      storedIds.size === records.length &&
      records.every(
        (record) =>
          storedIds.has(record.id) &&
          state.lastSavedSignatures.get(record.id) === nextSignatures.get(record.id) &&
          state.lastSavedPreviews.get(record.id) === record.previewBlob,
      )
    ) {
      await transactionDone(transaction);
      return;
    }
    const revision = nextStudioRevision(currentRevision, state.knownRevision);
    const session: StoredSession = {
      ...(current?.recoverySource ? { recoverySource: current.recoverySource } : {}),
      id: ACTIVE_SESSION,
      shotIds: records.map((record) => record.id),
      selectedId,
      filter,
      updatedAt: Date.now(),
      revision,
      writerId: WRITER_ID,
    };
    sessionStore.put(session);

    const nextIds = new Set<string>();
    for (const record of records) {
      nextIds.add(record.id);
      const signature = signatureOf(record);
      if (
        shouldWriteStudioShot(
          state.lastSavedPreviews.get(record.id) === record.previewBlob
            ? state.lastSavedSignatures.get(record.id)
            : undefined,
          signature,
          storedIds.has(record.id),
        )
      ) {
        shotStore.put(record);
      }
      nextSignatures.set(record.id, signature);
    }
    for (const id of storedIds) {
      if (!nextIds.has(id)) {
        shotStore.delete(id);
      }
    }
    await transactionDone(transaction);
    state.knownRevision = revision;
    state.lastSavedSignatures.clear();
    state.lastSavedPreviews.clear();
    for (const record of records) state.lastSavedPreviews.set(record.id, record.previewBlob);
    for (const [id, signature] of nextSignatures) state.lastSavedSignatures.set(id, signature);
  } finally {
    database.close();
  }
}

export function saveStudioSession(
  shots: Shot[],
  selectedId: string | null,
  filter: StudioFilter,
  scope = "device-local",
  shootId?: string,
): Promise<void> {
  const state = sessionState(scope, shootId);
  const snapshot = shots.map((shot) => ({
    ...shot,
    edits: { ...shot.edits },
    flags: [...shot.flags],
    ...(shot.develop ? { develop: { ...shot.develop } } : {}),
  }));
  const nextSave = state.saveQueue
    .catch(() => {
      // A later complete snapshot can safely retry after an earlier write fails.
    })
    .then(() => persistStudioSession(snapshot, selectedId, filter, scope, shootId));
  state.saveQueue = nextSave;
  return nextSave;
}

async function writeStudioClearTombstone(
  force: boolean,
  scope: string,
  shootId?: string,
): Promise<void> {
  const state = sessionState(scope, shootId);
  if (typeof indexedDB === "undefined") {
    throw new Error("Local Studio storage is unavailable.");
  }
  const database = await openDatabase(scope, shootId);
  try {
    const transaction = database.transaction([SESSION_STORE, SHOT_STORE], "readwrite");
    const sessionStore = transaction.objectStore(SESSION_STORE);
    const current = await requestResult(
      sessionStore.get(ACTIVE_SESSION) as IDBRequest<StoredSession | undefined>,
    );
    let currentRevision: number;
    try {
      currentRevision = revisionOf(current);
    } catch (cause) {
      if (!force) {
        transaction.abort();
        throw cause;
      }
      // A confirmed New Shoot after failed hydration may recover an unreadable
      // revision while still advancing beyond the last revision this tab saw.
      currentRevision = state.knownRevision;
    }
    let revision: number;
    try {
      revision = nextStudioClearRevision(currentRevision, state.knownRevision, force);
    } catch (cause) {
      transaction.abort();
      throw cause;
    }
    sessionStore.put({
      id: ACTIVE_SESSION,
      shotIds: [],
      selectedId: null,
      filter: "all",
      updatedAt: Date.now(),
      revision,
      writerId: WRITER_ID,
    } satisfies StoredSession);
    transaction.objectStore(SHOT_STORE).clear();
    await transactionDone(transaction);
    state.knownRevision = revision;
    state.lastSavedSignatures.clear();
    state.lastSavedPreviews.clear();
  } finally {
    database.close();
  }
}

export function clearStudioSession(
  options: { force?: boolean; scope?: string; shootId?: string } = {},
): Promise<void> {
  const scope = options.scope ?? "device-local";
  const shootId = options.shootId;
  const state = sessionState(scope, shootId);
  const nextClear = state.saveQueue
    .catch(() => {
      // Clearing is a complete replacement and can proceed after a failed save.
    })
    .then(() => writeStudioClearTombstone(options.force === true, scope, shootId));
  state.saveQueue = nextClear;
  return nextClear;
}

/** Read-only inspection: never changes the live writer's CAS baseline or makes preview URLs. */
export async function inspectPreviousShoot(scope: string) {
  const db = await openDatabase(scope);
  try {
    const raw = (await requestResult(
      db.transaction(SESSION_STORE).objectStore(SESSION_STORE).get(ACTIVE_SESSION),
    )) as StoredSession | LegacyStoredSession | undefined;
    return raw ? ("shotIds" in raw ? raw.shotIds.length : raw.shots.length) : 0;
  } finally {
    db.close();
  }
}

/** Explicit, coherent copy into an empty shoot. The previous database is never written. */
export async function copyPreviousShoot(sourceScope: string, owner: string, shootId: string) {
  if (owner === "device-local" || shootId === "legacy")
    throw new Error("Choose a signed-in account and a new shoot.");
  const source = await openDatabase(sourceScope);
  let snapshot: StoredSession | LegacyStoredSession | undefined;
  let records: StoredShot[];
  try {
    const tx = source.transaction([SESSION_STORE, SHOT_STORE], "readonly");
    snapshot = await requestResult(tx.objectStore(SESSION_STORE).get(ACTIVE_SESSION));
    if (!snapshot) throw new Error("No previous shoot was found.");
    const raw: StoredShot[] =
      "shots" in snapshot
        ? snapshot.shots
        : await requestResult(tx.objectStore(SHOT_STORE).getAll());
    const byId = new Map(raw.map((row) => [row.id, row]));
    const ids = "shotIds" in snapshot ? snapshot.shotIds : snapshot.shots.map((row) => row.id);
    records = ids.map((id) => {
      const row = byId.get(id);
      if (!row) throw new Error("A saved frame is missing. Previous data was preserved.");
      return row;
    });
    if (!records.length) throw new Error("There are no photos in the previous shoot.");
  } finally {
    source.close();
  }
  if (
    records.some((row) => typeof row.id !== "string" || !row.id.trim()) ||
    new Set(records.map((row) => row.id)).size !== records.length
  )
    throw new Error("The previous shoot has invalid frame IDs. Nothing was copied.");
  const db = await openDatabase(owner, shootId);
  try {
    const tx = db.transaction([SESSION_STORE, SHOT_STORE], "readwrite");
    const done = transactionDone(tx);
    void done.catch(() => {});
    try {
      const sessions = tx.objectStore(SESSION_STORE),
        shots = tx.objectStore(SHOT_STORE);
      const [existing, count] = await Promise.all([
        requestResult(sessions.get(ACTIVE_SESSION)),
        requestResult(shots.count()),
      ]);
      if (existing || count) {
        if (
          existing?.recoverySource === sourceScope &&
          count > 0 &&
          count === existing.shotIds?.length
        ) {
          await done;
          return count;
        }
        tx.abort();
        await done.catch(() => {});
        throw new Error("Destination already contains a shoot. Nothing was overwritten.");
      }
      sessions.add({
        recoverySource: sourceScope,
        id: ACTIVE_SESSION,
        shotIds: records.map((row) => row.id),
        selectedId: snapshot.selectedId,
        filter: snapshot.filter,
        updatedAt: Date.now(),
        revision: 1,
        writerId: WRITER_ID,
      } satisfies StoredSession);
      for (const row of records) shots.add(row);
      await done;
      return records.length;
    } catch (cause) {
      try {
        tx.abort();
      } catch {
        /* already aborted or completed */
      }
      await done.catch(() => {});
      throw cause;
    }
  } finally {
    db.close();
  }
}
