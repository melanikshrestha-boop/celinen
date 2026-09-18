/** Choosing where keepers and backups go, once.
 *
 * Chromium browsers (Chrome, Edge, Arc, Brave, Opera) can write straight into
 * a folder the photographer picks, and can remember that folder across
 * visits: the handle is stored in IndexedDB and only needs its permission
 * re-granted with one click. Safari and Firefox have no folder picker, so
 * they get a single zip download instead — `destinationSupport()` says which
 * path this browser takes before any button is shown.
 */
import { ZipStreamWriter, writableZipSink, type ZipSink } from "./zip-stream";
import type { DirectoryHandleLike, FileHandleLike } from "./types";

export type DestinationSupport =
  | { kind: "directory" }
  | {
      kind: "zip";
      /** Why folders are unavailable, in words a photographer can read. */
      reason: string;
      /** Whether the zip can be spooled to disk (OPFS) instead of held in memory. */
      spoolsToDisk: boolean;
    };

type PickerWindow = {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?: string | DirectoryHandleLike;
  }) => Promise<DirectoryHandleLike>;
  isSecureContext?: boolean;
};

function pickerWindow(): PickerWindow | null {
  return typeof window === "undefined" ? null : (window as unknown as PickerWindow);
}

export function destinationSupport(win: PickerWindow | null = pickerWindow()): DestinationSupport {
  if (win && typeof win.showDirectoryPicker === "function") return { kind: "directory" };
  const spoolsToDisk = opfsWritableSupported();
  if (win && win.isSecureContext === false) {
    return { kind: "zip", reason: "Folder access needs a secure (https) page.", spoolsToDisk };
  }
  return {
    kind: "zip",
    reason: "This browser cannot save into a folder, so your photos download as one zip.",
    spoolsToDisk,
  };
}

export type PickResult =
  | { kind: "picked"; handle: DirectoryHandleLike }
  | { kind: "cancelled" }
  | { kind: "unsupported"; support: Extract<DestinationSupport, { kind: "zip" }> }
  | { kind: "error"; message: string };

/**
 * Opens the folder picker. Must be called from a click or key handler: the
 * browser refuses pickers without a user gesture. `id` lets Chromium reopen
 * the picker where this purpose last left off (e.g. "celinen-export").
 */
export async function pickDestination(
  options: { id?: string; remember?: string; idb?: IDBFactory } = {},
  win: PickerWindow | null = pickerWindow(),
): Promise<PickResult> {
  const support = destinationSupport(win);
  if (support.kind === "zip") return { kind: "unsupported", support };
  try {
    const handle = await win!.showDirectoryPicker!({
      ...(options.id ? { id: options.id } : {}),
      mode: "readwrite",
    });
    if (options.remember) {
      // A failure to remember must not lose the folder just picked.
      await rememberDirectory(options.remember, handle, options.idb).catch(() => {});
    }
    return { kind: "picked", handle };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { kind: "cancelled" };
    return {
      kind: "error",
      message:
        error instanceof Error && error.name === "SecurityError"
          ? "The browser blocked the folder picker. Try again from a button click."
          : "That folder could not be opened.",
    };
  }
}

/**
 * The permission this page holds on a folder. With `request`, asks the
 * photographer when it is not already granted — which needs a user gesture,
 * so only pass `request: true` from a click handler.
 */
export async function ensurePermission(
  handle: DirectoryHandleLike,
  options: { mode?: "read" | "readwrite"; request?: boolean } = {},
): Promise<PermissionState> {
  const descriptor = { mode: options.mode ?? "readwrite" };
  // Browsers without the permission methods grant access for the handle's lifetime.
  if (typeof handle.queryPermission !== "function") return "granted";
  try {
    const state = await handle.queryPermission(descriptor);
    if (state === "granted" || !options.request || typeof handle.requestPermission !== "function")
      return state;
    return await handle.requestPermission(descriptor);
  } catch {
    return "denied";
  }
}

// ---------------------------------------------------------------------------
// Remembered folders

const DB_NAME = "celinen-handoff";
const STORE = "directories";

function openDb(idb?: IDBFactory): Promise<IDBDatabase> {
  const factory = idb ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  if (!factory) return Promise.reject(new Error("IndexedDB is unavailable."));
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
    request.onblocked = () => reject(new Error("IndexedDB is blocked by another tab."));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  idb: IDBFactory | undefined,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb(idb);
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      let result: T;
      request.onsuccess = () => {
        result = request.result;
      };
      // Resolve on commit, not on request success: a write is not durable until then.
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? request.error ?? new Error("IndexedDB failed."));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted."));
    });
  } finally {
    db.close();
  }
}

type StoredDirectory = { handle: DirectoryHandleLike; name: string; savedAt: number };

/** Stores a folder handle under `key` (e.g. "export", "backup-primary"). */
export async function rememberDirectory(
  key: string,
  handle: DirectoryHandleLike,
  idb?: IDBFactory,
): Promise<void> {
  const value: StoredDirectory = { handle, name: handle.name, savedAt: Date.now() };
  await withStore("readwrite", idb, (store) => store.put(value, key));
}

/**
 * The folder remembered under `key`, with the permission it holds right now.
 * "prompt" means one `ensurePermission(handle, { request: true })` from a
 * click restores access; the photographer does not pick the folder again.
 */
export async function recallDirectory(
  key: string,
  idb?: IDBFactory,
): Promise<{ handle: DirectoryHandleLike; name: string; permission: PermissionState } | null> {
  let stored: StoredDirectory | undefined;
  try {
    stored = await withStore<StoredDirectory | undefined>("readonly", idb, (store) =>
      store.get(key),
    );
  } catch {
    return null;
  }
  if (!stored?.handle) return null;
  const permission = await ensurePermission(stored.handle, { request: false });
  return { handle: stored.handle, name: stored.name, permission };
}

export async function forgetDirectory(key: string, idb?: IDBFactory): Promise<void> {
  await withStore("readwrite", idb, (store) => store.delete(key));
}

// ---------------------------------------------------------------------------
// Zip download fallback

type OpfsStorage = { getDirectory?: () => Promise<DirectoryHandleLike> };

function opfsWritableSupported(): boolean {
  const storage =
    typeof navigator === "undefined" ? undefined : (navigator.storage as unknown as OpfsStorage);
  return (
    typeof storage?.getDirectory === "function" &&
    typeof FileSystemFileHandle !== "undefined" &&
    "createWritable" in FileSystemFileHandle.prototype
  );
}

const SPOOL_DIR = "celinen-zip-spool";

export type ZipDownload = {
  writer: ZipStreamWriter;
  /** Finishes the archive and hands it to the browser's downloads. */
  save(): Promise<{ bytes: number; entries: number }>;
  /** Abandons the archive and releases its storage. */
  cancel(reason?: unknown): Promise<void>;
  /** Where the archive is being assembled. "memory" can exhaust RAM on a large export. */
  storage: "disk" | "memory";
};

/**
 * Starts a zip that downloads as `fileName` when saved.
 *
 * Browsers cannot stream a download from a page without a service worker, so
 * the archive is assembled first: in the origin-private file system when the
 * browser supports `createWritable` there (feature-detected), which keeps a
 * multi-GB export on disk within the origin's storage quota, and in memory
 * otherwise. A download cannot be observed finishing, so spools older than a
 * day are cleared when a later export starts.
 */
export async function startZipDownload(
  fileName: string,
  options: { forceMemory?: boolean; download?: (blob: Blob, name: string) => void } = {},
): Promise<ZipDownload> {
  const download = options.download ?? triggerDownload;
  if (!options.forceMemory && opfsWritableSupported()) {
    try {
      const root = await (navigator.storage as unknown as OpfsStorage).getDirectory!();
      const dir = await root.getDirectoryHandle(SPOOL_DIR, { create: true });
      await clearOldSpools(dir);
      const handle: FileHandleLike = await dir.getFileHandle(`${Date.now()}.zip`, { create: true });
      const writable = await handle.createWritable();
      const writer = new ZipStreamWriter(writableZipSink(writable));
      return {
        writer,
        storage: "disk",
        async save() {
          const result = await writer.finish();
          download(await handle.getFile(), fileName);
          return result;
        },
        async cancel(reason) {
          await writer.abort(reason).catch(() => {});
          await dir.removeEntry(handle.name).catch(() => {});
        },
      };
    } catch {
      // Fall through to memory: an OPFS quirk must not block the export.
    }
  }

  // Chunks are folded into Blobs every so often: a Blob is the one container
  // a browser may page out to disk, where an array of buffers never is.
  const parts: Blob[] = [];
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  const fold = () => {
    if (!pending.length) return;
    parts.push(new Blob(pending as BlobPart[]));
    pending = [];
    pendingBytes = 0;
  };
  const sink: ZipSink = {
    write: async (chunk) => {
      pending.push(chunk);
      pendingBytes += chunk.length;
      if (pendingBytes >= 32 * 1024 * 1024) fold();
    },
    close: async () => fold(),
    abort: async () => {
      parts.length = 0;
      pending = [];
      pendingBytes = 0;
    },
  };
  const writer = new ZipStreamWriter(sink);
  return {
    writer,
    storage: "memory",
    async save() {
      const result = await writer.finish();
      download(new Blob(parts, { type: "application/zip" }), fileName);
      parts.length = 0;
      return result;
    },
    async cancel(reason) {
      await writer.abort(reason).catch(() => {});
    },
  };
}

/** A spool is this module's own temporary archive, named by its start time.
 * One younger than a day may still be downloading, or belong to an export
 * running in another tab, so it is left alone. */
async function clearOldSpools(dir: DirectoryHandleLike, now = Date.now()) {
  if (typeof dir.keys !== "function") return;
  const stale: string[] = [];
  for await (const name of dir.keys()) {
    const started = Number(name.replace(/\.zip$/, ""));
    if (Number.isFinite(started) && now - started > 24 * 60 * 60 * 1000) stale.push(name);
  }
  for (const name of stale) await dir.removeEntry(name).catch(() => {});
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // The download has taken its own reference by now; a minute is generous.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
