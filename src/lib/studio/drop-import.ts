export type DropWarning = {
  code:
    "unreadable" | "empty-folder" | "invalid-path" | "limit" | "repeated-directory" | "empty-drop";
  path: string;
  message: string;
};

export type DropProgress = {
  files: number;
  directories: number;
  entries: number;
  currentPath: string;
};

export type DroppedFilesResult = {
  files: File[];
  warnings: DropWarning[];
  directories: number;
  duplicates: number;
};

export type DropImportOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: DropProgress) => void;
  /** Newly registered handles in deterministic traversal order, not saved/decoded photos. */
  onFiles?: (files: readonly File[]) => void;
};

const MAX_ENTRIES = 100000;
const MAX_FILES = 50000;
const MAX_DEPTH = 64;
const MAX_WARNINGS = 1000;
const READ_TIMEOUT_MS = 10000;
const FILE_READ_CONCURRENCY = 8;

type Root = { entry: FileSystemEntry | null; file: File | null };
type Work =
  | { kind: "entry"; entry: FileSystemEntry; path: string; depth: number; fallback?: File }
  | { kind: "file"; file: File; path: string }
  | {
      kind: "directory";
      reader: FileSystemDirectoryReader;
      path: string;
      depth: number;
      seen: Set<string>;
      batches: number;
    };

function abortError() {
  return new DOMException(
    "Folder import was cancelled. No source files were changed.",
    "AbortError",
  );
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

/** File/entry handles must be obtained before the browser protects the drag store. */
function captureDrop(transfer: DataTransfer): Root[] {
  const flat = Array.from(transfer.files);
  const items = Array.from(transfer.items ?? []).filter((item) => item.kind === "file");
  if (!items.length) return flat.map((file) => ({ file, entry: null }));
  // The FileList mirrors the file-kind items. Do not append it after walking
  // directories: it can contain the same files or opaque directory placeholders.
  return items.map((item, index) => {
    let entry: FileSystemEntry | null = null;
    let file: File | null = null;
    try {
      const modern = item as DataTransferItem & { getAsEntry?: () => FileSystemEntry | null };
      entry = modern.getAsEntry ? modern.getAsEntry() : (item.webkitGetAsEntry?.() ?? null);
    } catch {
      /* Some browsers expose the method but deny entry access. */
    }
    try {
      file = item.getAsFile();
    } catch {
      /* Use the synchronously captured FileList below. */
    }
    return { entry, file: file ?? flat[index] ?? null };
  });
}

function relativePath(path: string): string | null {
  const value = path.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = value.split("/");
  return value.length <= 8192 &&
    parts.every((part) => part.length > 0 && part !== "." && part !== ".." && !part.includes("\0"))
    ? value
    : null;
}

function childPath(parent: string, name: string): string | null {
  // Entry names are individual path components, not user-supplied filesystem paths.
  if (name.includes("/") || name.includes("\\")) return null;
  return relativePath(`${parent}/${name}`);
}

function withRelativePath(file: File, path: string): File {
  if ((file.webkitRelativePath || file.name) === path) return file;
  const wrapped = new File([file], file.name, { type: file.type, lastModified: file.lastModified });
  Object.defineProperty(wrapped, "webkitRelativePath", { value: path, enumerable: true });
  return wrapped;
}

function readEntry<T>(
  start: (success: (value: T) => void, fail: (error: unknown) => void) => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: unknown, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      if (error) reject(error);
      else resolve(value as T);
    };
    const aborted = () => finish(abortError());
    const timer = setTimeout(
      () => finish(new Error("Reading this dropped item timed out.")),
      READ_TIMEOUT_MS,
    );
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) {
      aborted();
      return;
    }
    try {
      start(
        (value) => finish(null, value),
        (error) => finish(error || new Error("Could not read this dropped item.")),
      );
    } catch (error) {
      finish(error);
    }
  });
}

/**
 * Call directly during the drop event, before awaiting anything. This never
 * uploads, edits, or opens paths from disk; it reads only user-dropped handles.
 * All files (including XMP sidecars) are retained for the existing ingest filter.
 * Cancellation rejects with AbortError instead of silently returning a partial set.
 */
export async function collectDroppedFiles(
  transfer: DataTransfer,
  options: DropImportOptions = {},
): Promise<DroppedFilesResult> {
  checkAbort(options.signal);
  const roots = captureDrop(transfer); // No await before this synchronous capture.
  const result: DroppedFilesResult = { files: [], warnings: [], directories: 0, duplicates: 0 };
  let eventOrder = 0;
  let warningOverflow = false;
  const warningOrder = new Map<DropWarning, number>();
  const warn = (code: DropWarning["code"], path: string, message: string, order = eventOrder) => {
    if (
      result.warnings.length === MAX_WARNINGS &&
      order >= warningOrder.get(result.warnings[MAX_WARNINGS - 1]!)!
    ) {
      warningOverflow = true;
      return;
    }
    const warning = { code, path, message };
    warningOrder.set(warning, order);
    result.warnings.push(warning);
    result.warnings.sort((a, b) => warningOrder.get(a)! - warningOrder.get(b)!);
    if (result.warnings.length > MAX_WARNINGS) {
      warningOverflow = true;
      warningOrder.delete(result.warnings.pop()!);
    }
  };
  const work: Work[] = [];
  const filePaths = new WeakMap<File, Set<string>>();
  const visited = new WeakSet<FileSystemEntry>();
  let entries = 0;
  let operations = 0;
  let fileSequence = 0;
  let nextPublished = 0;
  const active = new Set<Promise<void>>();
  const completed = new Map<
    number,
    { file?: File; path: string; failed: boolean; order: number }
  >();

  const progress = (path: string) => {
    if (options.signal?.aborted) return;
    try {
      options.onProgress?.({
        files: result.files.length,
        directories: result.directories,
        entries,
        currentPath: path,
      });
    } catch {
      /* A display observer cannot discard a discovered file. */
    }
  };

  const addFile = (file: File, path: string) => {
    const paths = filePaths.get(file) ?? new Set<string>();
    if (paths.has(path)) {
      result.duplicates++;
      return;
    }
    // Never mutate the caller's File to attach its read-only relative path.
    const registered = withRelativePath(file, path);
    result.files.push(registered);
    paths.add(path);
    filePaths.set(file, paths);
    try {
      options.onFiles?.([registered]);
    } catch {
      /* Registration is an observer, not permission to drop a readable source. */
    }
  };

  const publish = () => {
    // Entry callbacks may finish in any order. Keep metadata collisions, XMP paths,
    // and the compatible final result independent from callback timing.
    while (!options.signal?.aborted && completed.has(nextPublished)) {
      const item = completed.get(nextPublished)!;
      completed.delete(nextPublished++);
      if (item.file) {
        try {
          if (!(item.file instanceof File)) throw new Error("Invalid file handle");
          addFile(item.file, item.path);
        } catch {
          warn(
            "unreadable",
            item.path,
            "This file handle could not be registered. Other files remain available.",
            item.order,
          );
        }
      } else if (item.failed)
        warn(
          "unreadable",
          item.path,
          "This item could not be read. Other dropped files remain available; try importing it again.",
          item.order,
        );
      progress(item.path);
    }
  };

  const scheduleFile = (item: Extract<Work, { kind: "entry" | "file" }>) => {
    const sequence = fileSequence++,
      order = eventOrder;
    const task = (async () => {
      let file: File | undefined;
      try {
        file =
          item.kind === "file"
            ? item.file
            : await readEntry<File>(
                (success, fail) => (item.entry as FileSystemFileEntry).file(success, fail),
                options.signal,
              );
      } catch {
        if (item.kind === "entry" && !options.signal?.aborted) file = item.fallback;
      }
      if (!options.signal?.aborted) {
        completed.set(sequence, {
          ...(file ? { file } : {}),
          path: item.path,
          failed: !file,
          order,
        });
        publish();
      }
    })();
    active.add(task);
    // Every task settles normally, including canceled read callbacks. The outer
    // operation rejects cancellation and drains all wrappers before it returns.
    void task.finally(() => active.delete(task));
  };

  for (const { entry, file } of roots) {
    const path = relativePath(
      entry?.fullPath || entry?.name || file?.webkitRelativePath || file?.name || "",
    );
    if (!path) {
      warn(
        "invalid-path",
        entry?.name || file?.name || "",
        "A dropped item has no safe relative path and was not imported.",
      );
    } else if (entry)
      work.push({ kind: "entry", entry, path, depth: 0, ...(file ? { fallback: file } : {}) });
    else if (file) work.push({ kind: "file", file, path });
    else
      warn("unreadable", path, "The browser did not expose this dropped item. Try Choose folder.");
  }
  work.reverse();

  try {
    while (work.length) {
      checkAbort(options.signal);
      // Include outstanding handles in the safety budget. Drain at the boundary so
      // failed/repeated handles do not incorrectly consume the successful-file cap.
      if (result.files.length + active.size + completed.size >= MAX_FILES) {
        await Promise.all(active);
        checkAbort(options.signal);
        publish();
      }
      if (entries >= MAX_ENTRIES || result.files.length >= MAX_FILES) {
        warn(
          "limit",
          "",
          `Import stopped at the safety limit (${MAX_ENTRIES} entries / ${MAX_FILES} files). Remaining items were not imported; use smaller folders.`,
        );
        break;
      }
      const item = work.pop()!;
      eventOrder++;
      if (item.kind !== "directory") entries++;
      try {
        if (item.kind === "file") {
          while (active.size >= FILE_READ_CONCURRENCY) await Promise.race(active);
          checkAbort(options.signal);
          scheduleFile(item);
        } else if (item.kind === "entry") {
          if (visited.has(item.entry)) {
            if (item.entry.isDirectory)
              warn(
                "repeated-directory",
                item.path,
                "This folder was encountered again and was not traversed twice.",
              );
            else result.duplicates++;
          } else {
            visited.add(item.entry);
            if (item.entry.isFile) {
              while (active.size >= FILE_READ_CONCURRENCY) await Promise.race(active);
              checkAbort(options.signal);
              scheduleFile(item);
            } else if (item.entry.isDirectory) {
              result.directories++;
              if (item.depth >= MAX_DEPTH)
                warn(
                  "limit",
                  item.path,
                  `This folder exceeds ${MAX_DEPTH} nested levels and was not read.`,
                );
              else
                work.push({
                  kind: "directory",
                  path: item.path,
                  depth: item.depth,
                  reader: (item.entry as FileSystemDirectoryEntry).createReader(),
                  seen: new Set(),
                  batches: 0,
                });
            } else
              warn(
                "unreadable",
                item.path,
                "This dropped item is neither a readable file nor a folder.",
              );
          }
        } else {
          if (++item.batches > 10000) {
            warn(
              "limit",
              item.path,
              "The folder reader exceeded 10,000 batches. Remaining items were not imported.",
            );
            continue;
          }
          const batch = await readEntry<FileSystemEntry[]>(
            (success, fail) => item.reader.readEntries(success, fail),
            options.signal,
          );
          if (!batch.length) {
            if (!item.seen.size)
              warn(
                "empty-folder",
                item.path,
                "This folder is empty; no files were imported from it.",
              );
          } else {
            const children: Work[] = [];
            let newNames = 0;
            for (const entry of batch) {
              if (entries + work.length + children.length >= MAX_ENTRIES) {
                warn(
                  "limit",
                  item.path,
                  `The folder exceeds the ${MAX_ENTRIES}-entry safety limit; remaining items were not imported.`,
                );
                break;
              }
              const name = `${entry.isDirectory ? "directory" : "file"}:${entry.name}`;
              if (item.seen.has(name)) continue;
              item.seen.add(name);
              newNames++;
              const path = childPath(item.path, entry.name);
              if (!path)
                warn(
                  "invalid-path",
                  item.path,
                  "A child item has an unsafe path and was not imported.",
                );
              else children.push({ kind: "entry", entry, path, depth: item.depth + 1 });
            }
            if (!newNames)
              warn(
                "repeated-directory",
                item.path,
                "The folder reader returned no new entries; traversal stopped to avoid looping.",
              );
            else {
              work.push(item); // Read the next batch only after this one has been visited.
              for (let index = children.length - 1; index >= 0; index--)
                work.push(children[index]!);
            }
          }
        }
      } catch (error) {
        checkAbort(options.signal);
        warn(
          "unreadable",
          item.path,
          "This item could not be read. Other dropped files remain available; try importing it again.",
        );
      }
      progress(item.path);
      if (++operations % 50 === 0) {
        // Browser callbacks may complete synchronously. A real task yield lets
        // review, paint and cancellation events run during 3,000+ file drops.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        checkAbort(options.signal);
      }
    }
    await Promise.all(active);
    checkAbort(options.signal);
    publish();
  } finally {
    // readEntry aborts its promise/listeners immediately; the browser's uncancelable
    // late entry callback is ignored and cannot publish after this invocation.
    await Promise.all(active);
    completed.clear();
  }
  if (warningOverflow)
    result.warnings[MAX_WARNINGS - 1] = {
      code: "limit",
      path: "",
      message:
        "At least 1,000 import problems were found. Some additional warning details were omitted; no source files were changed.",
    };
  if (!result.files.length && !result.warnings.length)
    warn(
      "empty-drop",
      "",
      "No readable files were dropped. Drop a photo folder or use Choose folder.",
    );
  return result;
}
