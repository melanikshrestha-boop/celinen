/** The Origin Private File System, as the preview library uses it: a folder per
 * account, a folder per session, one JPEG per frame.
 *
 * Kept free of IndexedDB and the DOM so the preview worker can import it, and
 * typed structurally so tests can hand in an in-memory directory.
 */

export type OpfsWritable = {
  write(data: Blob | BufferSource): Promise<void>;
  close(): Promise<void>;
  abort?: () => Promise<void>;
};

export type OpfsSyncAccess = {
  // Sync in current engines, a promise in Safari before 17; awaiting covers both.
  truncate(size: number): void | Promise<void>;
  write(data: BufferSource, options?: { at?: number }): number | Promise<number>;
  flush(): void | Promise<void>;
  close(): void | Promise<void>;
};

export type OpfsFileHandle = {
  readonly kind: "file";
  getFile(): Promise<File>;
  createWritable?: () => Promise<OpfsWritable>;
  /** Workers only. The one write path Safari has had since 15.2. */
  createSyncAccessHandle?: () => Promise<OpfsSyncAccess>;
};

export type OpfsDirectory = {
  readonly kind: "directory";
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OpfsDirectory>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
};

export const PREVIEW_FOLDER = "celinen-cull-previews";

/** Folder names for an account's previews and one session's. Scope and session
 * ids are made inert the same way the IndexedDB name is. */
export function previewFolder(scope: string, sessionId?: string): string[] {
  const inert = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");
  return sessionId
    ? [PREVIEW_FOLDER, inert(scope), inert(sessionId)]
    : [PREVIEW_FOLDER, inert(scope)];
}

export function opfsRoot(): Promise<OpfsDirectory> | null {
  const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
  if (!storage || typeof storage.getDirectory !== "function") return null;
  return storage.getDirectory() as unknown as Promise<OpfsDirectory>;
}

export async function openFolder(
  root: OpfsDirectory,
  path: readonly string[],
  create: boolean,
): Promise<OpfsDirectory | null> {
  let directory = root;
  for (const name of path) {
    try {
      directory = await directory.getDirectoryHandle(name, { create });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }
  return directory;
}

export function isNotFound(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name: unknown }).name === "NotFoundError"
  );
}

export function isQuotaError(error: unknown): boolean {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name: unknown }).name)
      : "";
  return name === "QuotaExceededError";
}

/** Writes a whole file, replacing whatever a crashed earlier attempt left. */
export async function writeFile(
  directory: OpfsDirectory,
  name: string,
  bytes: Uint8Array<ArrayBuffer>,
) {
  const handle = await directory.getFileHandle(name, { create: true });
  if (handle.createSyncAccessHandle) {
    const access = await handle.createSyncAccessHandle();
    try {
      await access.truncate(0);
      await access.write(bytes, { at: 0 });
      await access.flush();
    } finally {
      await access.close();
    }
    return;
  }
  if (!handle.createWritable) throw new Error("This browser cannot write previews.");
  const writable = await handle.createWritable();
  try {
    await writable.write(bytes);
    await writable.close();
  } catch (error) {
    await writable.abort?.().catch(() => {});
    throw error;
  }
}

/** Removes a file or folder; one that is already gone is not an error. */
export async function removeEntry(directory: OpfsDirectory, name: string, recursive = false) {
  try {
    await directory.removeEntry(name, { recursive });
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}
