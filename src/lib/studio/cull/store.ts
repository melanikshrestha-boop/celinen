/** Where a cull session lives on this device.
 *
 * A sports card is ten thousand frames, so this store is built around two
 * facts. Writing one transaction per frame would spend more time committing
 * than the engine spends reading, so frames are written in batches. And ten
 * thousand thumbnails do not belong in memory, so they sit in their own store
 * and are fetched only for the frames on screen.
 *
 * Every database is scoped to the signed-in account, like the rest of Studio.
 */
import type { CullFrame } from "./session";
import type { CullSourceRoot } from "./sources";

// 2: the card's file handles and the review-size previews' index.
// 3: caption code tables. Additive: frame rows gained only optional fields
// (stars, label, tag, caption, AF area), which need no migration.
const VERSION = 3;
const SESSIONS = "sessions";
const FRAMES = "frames";
const THUMBNAILS = "thumbnails";
const SOURCES = "sources";
const PREVIEWS = "previews";
const CODE_TABLES = "codeTables";

export type CullSessionSummary = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  frameCount: number;
  /** The "Keep ~N" line, when the photographer set one. */
  keepTarget?: number | undefined;
};

/** A caption code source as loaded: kept as its original text, so a parser fix
 * applies to tables loaded before it. One account's tables serve every session. */
export type CullCodeTableRow = {
  id: string;
  /** The file's name. */
  name: string;
  kind: "codes" | "roster";
  /** Roster code prefix, e.g. "u" for `\u23\`. Empty for code files. */
  prefix: string;
  text: string;
  createdAt: number;
};

type FrameRow = CullFrame & { sessionId: string };
type ThumbnailRow = { sessionId: string; frameId: string; blob: Blob };
type SourcesRow = { sessionId: string; roots: CullSourceRoot[] };

/** One review-size preview. The JPEG itself lives in the Origin Private File
 * System; this row is its index entry, so totals and eviction never have to
 * open ten thousand files to learn their sizes. */
export type CullPreviewRow = {
  sessionId: string;
  frameId: string;
  /** File name inside the session's preview folder. */
  file: string;
  bytes: number;
  width: number;
  height: number;
  createdAt: number;
  /** The engine's suggestion when the preview was made, for eviction order in
   * sessions that are not open (suggestions are not stored with frames). */
  suggestedReject: boolean;
  /** Set when the original could not be turned into a preview, so it is not retried every visit. */
  failed?: true | undefined;
};

export function cullDatabaseName(scope: string): string {
  // The scope is an account id or "device-local"; keep it readable but inert.
  return `celinen-cull:${scope.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Cull save was interrupted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Cull save failed."));
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Cull storage request failed."));
  });
}

export type CullStore = {
  create(name: string): Promise<CullSessionSummary>;
  list(): Promise<CullSessionSummary[]>;
  /** Every frame of a session, without thumbnails. */
  frames(sessionId: string): Promise<CullFrame[]>;
  thumbnail(sessionId: string, frameId: string): Promise<Blob | null>;
  /** Frames and thumbnails from the ingest pool. Writes are batched by the caller. */
  append(sessionId: string, batch: readonly { frame: CullFrame; thumbnail: Blob }[]): Promise<void>;
  /** Decisions and suggestions: frame rows only, thumbnails untouched. */
  update(sessionId: string, frames: readonly CullFrame[]): Promise<void>;
  /** The folders and files a session was imported from, where the browser offers handles. */
  saveSources(sessionId: string, roots: readonly CullSourceRoot[]): Promise<void>;
  sources(sessionId: string): Promise<CullSourceRoot[]>;
  /** Every preview index row of this account. */
  previews(): Promise<CullPreviewRow[]>;
  preview(sessionId: string, frameId: string): Promise<CullPreviewRow | null>;
  putPreview(row: CullPreviewRow): Promise<void>;
  deletePreviews(keys: readonly { sessionId: string; frameId: string }[]): Promise<void>;
  /** Removes a session and everything stored for it here. The preview files
   * themselves are removed by the preview library. */
  deleteSession(sessionId: string): Promise<void>;
  /** Saves the session's keeper target; null removes it. */
  setKeepTarget(sessionId: string, target: number | null): Promise<void>;
  /** This account's caption code tables, oldest first. */
  codeTables(): Promise<CullCodeTableRow[]>;
  putCodeTable(row: CullCodeTableRow): Promise<void>;
  deleteCodeTable(id: string): Promise<void>;
  close(): void;
};

export async function openCullStore(
  scope: string,
  factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB,
): Promise<CullStore> {
  if (!factory) throw new Error("This browser cannot store a cull session on this device.");
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(cullDatabaseName(scope), VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSIONS))
        db.createObjectStore(SESSIONS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(FRAMES)) {
        const frames = db.createObjectStore(FRAMES, { keyPath: ["sessionId", "id"] });
        frames.createIndex("session", "sessionId");
      }
      if (!db.objectStoreNames.contains(THUMBNAILS))
        db.createObjectStore(THUMBNAILS, { keyPath: ["sessionId", "frameId"] });
      if (!db.objectStoreNames.contains(SOURCES))
        db.createObjectStore(SOURCES, { keyPath: "sessionId" });
      if (!db.objectStoreNames.contains(PREVIEWS)) {
        const previews = db.createObjectStore(PREVIEWS, { keyPath: ["sessionId", "frameId"] });
        previews.createIndex("session", "sessionId");
      }
      if (!db.objectStoreNames.contains(CODE_TABLES))
        db.createObjectStore(CODE_TABLES, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open cull storage."));
    request.onblocked = () =>
      reject(new Error("Close other Celinen tabs to finish updating storage."));
  });

  const touch = async (
    transaction: IDBTransaction,
    sessionId: string,
    added: number,
  ): Promise<void> => {
    const sessions = transaction.objectStore(SESSIONS);
    const summary = await result(
      sessions.get(sessionId) as IDBRequest<CullSessionSummary | undefined>,
    );
    if (!summary) throw new Error("This cull session no longer exists.");
    sessions.put({ ...summary, updatedAt: Date.now(), frameCount: summary.frameCount + added });
  };

  return {
    async create(name) {
      const now = Date.now();
      const summary: CullSessionSummary = {
        id: crypto.randomUUID(),
        name: name.trim().slice(0, 120) || "Untitled shoot",
        createdAt: now,
        updatedAt: now,
        frameCount: 0,
      };
      const transaction = database.transaction(SESSIONS, "readwrite");
      transaction.objectStore(SESSIONS).add(summary);
      await done(transaction);
      return summary;
    },
    async list() {
      const all = await result(
        database.transaction(SESSIONS, "readonly").objectStore(SESSIONS).getAll() as IDBRequest<
          CullSessionSummary[]
        >,
      );
      return all.sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async frames(sessionId) {
      const rows = await result(
        database
          .transaction(FRAMES, "readonly")
          .objectStore(FRAMES)
          .index("session")
          .getAll(sessionId) as IDBRequest<FrameRow[]>,
      );
      // Capture order is review order; files without a time keep import order.
      return rows
        .map(({ sessionId: _session, ...frame }) => frame)
        .sort((a, b) => {
          if (
            a.captureTimeMs !== null &&
            b.captureTimeMs !== null &&
            a.captureTimeMs !== b.captureTimeMs
          )
            return a.captureTimeMs - b.captureTimeMs;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
    },
    async thumbnail(sessionId, frameId) {
      const row = await result(
        database
          .transaction(THUMBNAILS, "readonly")
          .objectStore(THUMBNAILS)
          .get([sessionId, frameId]) as IDBRequest<ThumbnailRow | undefined>,
      );
      return row?.blob.size ? row.blob : null;
    },
    async append(sessionId, batch) {
      if (!batch.length) return;
      const transaction = database.transaction([SESSIONS, FRAMES, THUMBNAILS], "readwrite");
      const committed = done(transaction);
      const frames = transaction.objectStore(FRAMES);
      const thumbnails = transaction.objectStore(THUMBNAILS);
      for (const { frame, thumbnail } of batch) {
        frames.put({ ...frame, sessionId } satisfies FrameRow);
        if (thumbnail.size)
          thumbnails.put({ sessionId, frameId: frame.id, blob: thumbnail } satisfies ThumbnailRow);
      }
      await touch(transaction, sessionId, batch.length);
      await committed;
    },
    async update(sessionId, frames) {
      if (!frames.length) return;
      const transaction = database.transaction([SESSIONS, FRAMES], "readwrite");
      const committed = done(transaction);
      const store = transaction.objectStore(FRAMES);
      for (const frame of frames) store.put({ ...frame, sessionId } satisfies FrameRow);
      await touch(transaction, sessionId, 0);
      await committed;
    },
    async saveSources(sessionId, roots) {
      if (!roots.length) return;
      const transaction = database.transaction(SOURCES, "readwrite");
      const committed = done(transaction);
      transaction.objectStore(SOURCES).put({ sessionId, roots: [...roots] } satisfies SourcesRow);
      await committed;
    },
    async sources(sessionId) {
      const row = await result(
        database.transaction(SOURCES, "readonly").objectStore(SOURCES).get(sessionId) as IDBRequest<
          SourcesRow | undefined
        >,
      );
      return row?.roots ?? [];
    },
    previews() {
      return result(
        database.transaction(PREVIEWS, "readonly").objectStore(PREVIEWS).getAll() as IDBRequest<
          CullPreviewRow[]
        >,
      );
    },
    async preview(sessionId, frameId) {
      const row = await result(
        database
          .transaction(PREVIEWS, "readonly")
          .objectStore(PREVIEWS)
          .get([sessionId, frameId]) as IDBRequest<CullPreviewRow | undefined>,
      );
      return row ?? null;
    },
    async putPreview(row) {
      const transaction = database.transaction(PREVIEWS, "readwrite");
      const committed = done(transaction);
      transaction.objectStore(PREVIEWS).put(row);
      await committed;
    },
    async deletePreviews(keys) {
      if (!keys.length) return;
      const transaction = database.transaction(PREVIEWS, "readwrite");
      const committed = done(transaction);
      const store = transaction.objectStore(PREVIEWS);
      for (const { sessionId, frameId } of keys) store.delete([sessionId, frameId]);
      await committed;
    },
    async deleteSession(sessionId) {
      const transaction = database.transaction(
        [SESSIONS, FRAMES, THUMBNAILS, SOURCES, PREVIEWS],
        "readwrite",
      );
      const committed = done(transaction);
      transaction.objectStore(SESSIONS).delete(sessionId);
      transaction.objectStore(SOURCES).delete(sessionId);
      // Frame and thumbnail rows share the key [sessionId, frameId].
      const frames = transaction.objectStore(FRAMES);
      const thumbnails = transaction.objectStore(THUMBNAILS);
      for (const key of await result(frames.index("session").getAllKeys(sessionId))) {
        frames.delete(key);
        thumbnails.delete(key);
      }
      const previews = transaction.objectStore(PREVIEWS);
      for (const key of await result(previews.index("session").getAllKeys(sessionId)))
        previews.delete(key);
      await committed;
    },
    async setKeepTarget(sessionId, target) {
      const transaction = database.transaction(SESSIONS, "readwrite");
      const committed = done(transaction);
      const sessions = transaction.objectStore(SESSIONS);
      const summary = await result(
        sessions.get(sessionId) as IDBRequest<CullSessionSummary | undefined>,
      );
      if (summary) {
        const { keepTarget: _previous, ...rest } = summary;
        // Not a content change, so updatedAt stays: the session list keeps its order.
        sessions.put(target === null ? rest : { ...rest, keepTarget: target });
      }
      await committed;
    },
    async codeTables() {
      const rows = await result(
        database
          .transaction(CODE_TABLES, "readonly")
          .objectStore(CODE_TABLES)
          .getAll() as IDBRequest<CullCodeTableRow[]>,
      );
      // Later tables win where codes collide, so load order is merge order.
      return rows.sort((a, b) => a.createdAt - b.createdAt);
    },
    async putCodeTable(row) {
      const transaction = database.transaction(CODE_TABLES, "readwrite");
      const committed = done(transaction);
      transaction.objectStore(CODE_TABLES).put(row);
      await committed;
    },
    async deleteCodeTable(id) {
      const transaction = database.transaction(CODE_TABLES, "readwrite");
      const committed = done(transaction);
      transaction.objectStore(CODE_TABLES).delete(id);
      await committed;
    },
    close: () => database.close(),
  };
}

/** Collects frames as the pool reads them and writes them in batches, so a
 * ten-thousand frame card is a few dozen transactions instead of ten thousand.
 * A failed write is reported, never silently dropped.
 */
export function createCullWriter(
  store: Pick<CullStore, "append">,
  sessionId: string,
  options: {
    batch?: number;
    delayMs?: number;
    onError?: (error: unknown) => void;
    /** The frame as it stands at write time. A decision made while the frame
     * waited in the batch must be what reaches storage, not the copy that queued. */
    latest?: (frame: CullFrame) => CullFrame;
  } = {},
) {
  const size = options.batch ?? 250;
  const delay = options.delayMs ?? 400;
  let pending: { frame: CullFrame; thumbnail: Blob }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain = Promise.resolve();

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending.length) return chain;
    const queued = pending;
    pending = [];
    chain = chain
      .then(() => {
        const batch = options.latest
          ? queued.map(({ frame, thumbnail }) => ({ frame: options.latest!(frame), thumbnail }))
          : queued;
        return store.append(sessionId, batch);
      })
      .catch((error: unknown) => {
        options.onError?.(error);
      });
    return chain;
  };

  return {
    add(frame: CullFrame, thumbnail: Blob) {
      pending.push({ frame, thumbnail });
      if (pending.length >= size) void flush();
      else timer ??= setTimeout(() => void flush(), delay);
    },
    /** Writes whatever is still waiting. Await it before telling the photographer a card is saved. */
    flush,
  };
}
