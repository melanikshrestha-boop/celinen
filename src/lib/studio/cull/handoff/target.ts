/** Where hand-off files land: a real folder (File System Access) or a zip.
 * Export and backup write through this one interface, so the copy logic —
 * naming, collisions, verification, cancel — is the same for both.
 */
import { ZipStreamWriter } from "./zip-stream";
import type { DirectoryHandleLike, FileHandleLike } from "./types";

export type WriteBody = Blob | Uint8Array | string;

export type WriteOptions = {
  signal?: AbortSignal | undefined;
  onBytes?: ((bytes: number) => void) | undefined;
  lastModified?: number | undefined;
};

export type HandoffTarget = {
  readonly kind: "directory" | "zip";
  /** How many writes may run at once. */
  readonly maxConcurrency: number;
  /** The entry at `path`: its size, or `directory` when a folder has that name. */
  stat(
    path: readonly string[],
  ): Promise<{ kind: "file"; size: number } | { kind: "directory" } | null>;
  readText(path: readonly string[]): Promise<string | null>;
  /**
   * Writes `body` at `path`, replacing any file there, and resolves with the
   * size the destination reports afterwards. On failure or cancel nothing is
   * left behind that did not exist before the call.
   */
  write(path: readonly string[], body: WriteBody, options?: WriteOptions): Promise<number>;
  /** Removes a file this run wrote. Unsupported (no-op) for zips. */
  remove(path: readonly string[]): Promise<void>;
};

export function joinPath(path: readonly string[]): string {
  return path.join("/");
}

export function bodySize(body: WriteBody): number {
  if (typeof body === "string") return new TextEncoder().encode(body).length;
  if (body instanceof Uint8Array) return body.length;
  return body.size;
}

function bodyBlob(body: WriteBody): Blob {
  return body instanceof Blob ? body : new Blob([body as BlobPart]);
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === "NotFoundError" || error.name === "TypeMismatchError")
  );
}

/** A counting pass-through: reports bytes as the destination accepts them. */
function counting(onBytes: (bytes: number) => void): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      onBytes(chunk.length);
    },
  });
}

export function directoryTarget(
  root: DirectoryHandleLike,
  options: { concurrency?: number } = {},
): HandoffTarget {
  // Creating lookups are cached as promises, so two writers making the same
  // folder at once share one creation instead of racing. Read-only lookups
  // reuse a created folder but are never cached themselves: a folder missing
  // now may be created a moment later by a concurrent write.
  const created = new Map<string, Promise<DirectoryHandleLike>>();

  const folder = (segments: readonly string[], create: boolean): Promise<DirectoryHandleLike> => {
    if (!segments.length) return Promise.resolve(root);
    const key = segments.join("/").toLowerCase();
    const cached = created.get(key);
    if (cached) return cached;
    const lookup = folder(segments.slice(0, -1), create).then((parent) =>
      parent.getDirectoryHandle(segments[segments.length - 1]!, { create }),
    );
    if (!create) return lookup;
    created.set(key, lookup);
    lookup.catch(() => {
      if (created.get(key) === lookup) created.delete(key);
    });
    return lookup;
  };

  const split = (path: readonly string[]) => {
    if (!path.length) throw new Error("Empty destination path.");
    return { dirs: path.slice(0, -1), name: path[path.length - 1]! };
  };

  return {
    kind: "directory",
    maxConcurrency: Math.max(1, options.concurrency ?? 8),

    async stat(path) {
      const { dirs, name } = split(path);
      let parent: DirectoryHandleLike;
      try {
        parent = await folder(dirs, false);
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
      try {
        const handle = await parent.getFileHandle(name);
        return { kind: "file", size: (await handle.getFile()).size };
      } catch (error) {
        if (error instanceof Error && error.name === "TypeMismatchError")
          return { kind: "directory" };
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async readText(path) {
      const { dirs, name } = split(path);
      try {
        const parent = await folder(dirs, false);
        const handle = await parent.getFileHandle(name);
        return await (await handle.getFile()).text();
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async write(path, body, writeOptions = {}) {
      const { dirs, name } = split(path);
      writeOptions.signal?.throwIfAborted();
      const parent = await folder(dirs, true);
      let existed = true;
      try {
        await parent.getFileHandle(name);
      } catch (error) {
        if (!isNotFound(error)) throw error;
        existed = false;
      }
      const handle: FileHandleLike = await parent.getFileHandle(name, { create: true });
      try {
        // createWritable writes to a swap file; the original is only replaced on close.
        const writable = await handle.createWritable();
        let source: ReadableStream<Uint8Array> = bodyBlob(body).stream();
        if (writeOptions.onBytes) source = source.pipeThrough(counting(writeOptions.onBytes));
        // pipeTo closes the writable on success and aborts it (discarding the
        // swap file) on error or when the signal fires.
        await source.pipeTo(writable, writeOptions.signal ? { signal: writeOptions.signal } : {});
        return (await handle.getFile()).size;
      } catch (error) {
        // getFileHandle({create}) made an empty file; do not leave it behind.
        if (!existed) await parent.removeEntry(name).catch(() => {});
        throw error;
      }
    },

    async remove(path) {
      const { dirs, name } = split(path);
      const parent = await folder(dirs, false);
      await parent.removeEntry(name);
    },
  };
}

/** A zip archive as a target. Writes are serialised; ZIP is sequential. */
export function zipTarget(writer: ZipStreamWriter): HandoffTarget {
  const sizes = new Map<string, number>();
  let queue: Promise<unknown> = Promise.resolve();
  const key = (path: readonly string[]) => joinPath(path).toLowerCase();

  return {
    kind: "zip",
    maxConcurrency: 1,
    async stat(path) {
      const size = sizes.get(key(path));
      if (size !== undefined) return { kind: "file", size };
      // A file path that is a prefix of an existing entry is a folder in the archive.
      const prefix = `${key(path)}/`;
      for (const existing of sizes.keys())
        if (existing.startsWith(prefix)) return { kind: "directory" };
      return null;
    },
    async readText() {
      return null;
    },
    write(path, body, options = {}) {
      const run = queue.then(async () => {
        const { size } = await writer.add(
          joinPath(path),
          body instanceof Blob || body instanceof Uint8Array
            ? body
            : new TextEncoder().encode(body),
          {
            lastModified: options.lastModified,
            signal: options.signal,
            onBytes: options.onBytes,
          },
        );
        sizes.set(key(path), size);
        return size;
      });
      queue = run.catch(() => {});
      return run;
    },
    async remove() {
      // Bytes already streamed into an archive cannot be taken back.
    },
  };
}
