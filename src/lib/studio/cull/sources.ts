/** Where a card's originals live on disk, and finding them again after a reload.
 *
 * A browser forgets every File a page held once the page reloads. Browsers with
 * the File System Access API (Chromium, Edge) can hand the page a *handle* to a
 * folder or file instead, which survives in IndexedDB; after a reload the handle
 * needs the photographer's permission again, and then every frame of the card
 * resolves through it without another import.
 *
 * A handle is a path, not a promise: the card can be ejected, a file renamed or
 * re-exported. Every resolved file is checked against the size and modification
 * time recorded at import, and a mismatch is treated as missing. Showing the
 * wrong photo under a frame's verdict is worse than showing a thumbnail.
 */
import type { CullFrame } from "./session";

export type CullPermission = "granted" | "prompt" | "denied";

type PermissionDescriptor = { mode: "read" };

/** The part of FileSystemHandle this module uses. TypeScript's DOM library
 * does not yet describe permissions or directory iteration. */
type HandleBase = {
  readonly name: string;
  queryPermission?: (descriptor: PermissionDescriptor) => Promise<CullPermission>;
  requestPermission?: (descriptor: PermissionDescriptor) => Promise<CullPermission>;
};

export type CullFileHandle = HandleBase & {
  readonly kind: "file";
  getFile(): Promise<File>;
};

export type CullDirectoryHandle = HandleBase & {
  readonly kind: "directory";
  getDirectoryHandle(name: string): Promise<CullDirectoryHandle>;
  getFileHandle(name: string): Promise<CullFileHandle>;
  values(): AsyncIterable<CullFileHandle | CullDirectoryHandle>;
};

/** What an import remembers: the folders and files the photographer handed over. */
export type CullSourceRoot = CullFileHandle | CullDirectoryHandle;

/** Size and modification time of the file a frame was read from. */
export type CullFileStamp = { size: number; lastModified: number | null };

const READ: PermissionDescriptor = { mode: "read" };
const MAX_FILES = 50_000;
const MAX_DEPTH = 32;
const FILE_CONCURRENCY = 16;

/**
 * The stamp a resolved file must match. Frames record `lastModified` since this
 * module landed; older sessions still carry it inside the id the ingest pool
 * built (`path:size:lastModified:index`), read from the right because a path
 * may itself contain colons.
 */
export function frameFileStamp(
  frame: Pick<CullFrame, "id" | "bytes" | "lastModified">,
): CullFileStamp {
  if (typeof frame.lastModified === "number")
    return { size: frame.bytes, lastModified: frame.lastModified };
  const parts = frame.id.split(":");
  if (parts.length >= 4) {
    const size = Number(parts[parts.length - 3]);
    const lastModified = Number(parts[parts.length - 2]);
    if (size === frame.bytes && Number.isFinite(lastModified))
      return { size: frame.bytes, lastModified };
  }
  return { size: frame.bytes, lastModified: null };
}

export function matchesStamp(file: Pick<File, "size" | "lastModified">, stamp: CullFileStamp) {
  return (
    file.size === stamp.size &&
    (stamp.lastModified === null || file.lastModified === stamp.lastModified)
  );
}

function errorName(error: unknown): string {
  return error && typeof error === "object" && "name" in error ? String(error.name) : "";
}

/** Thrown when the browser withdrew access mid-session (site settings, a revoked grant). */
export class SourcePermissionError extends Error {
  constructor() {
    super("Access to the original files was withdrawn.");
    this.name = "SourcePermissionError";
  }
}

function isPermissionError(error: unknown) {
  const name = errorName(error);
  return name === "NotAllowedError" || name === "SecurityError";
}

/** The combined state of every root: granted only when all of them are. */
export async function sourcePermission(roots: readonly CullSourceRoot[]): Promise<CullPermission> {
  if (!roots.length) return "denied";
  let prompt = false;
  let denied = false;
  for (const root of roots) {
    let state: CullPermission;
    try {
      // A browser that can store a handle but not describe its permission
      // is treated as asking; resolution then proves or disproves access.
      state = root.queryPermission ? await root.queryPermission(READ) : "prompt";
    } catch {
      state = "prompt";
    }
    if (state === "prompt") prompt = true;
    else if (state === "denied") denied = true;
  }
  return prompt ? "prompt" : denied ? "denied" : "granted";
}

/**
 * Asks for read access to every root. Must run inside the photographer's click:
 * browsers refuse a permission prompt without one. A root the browser refuses
 * to prompt for (the gesture expired) stays "prompt" so the action can be retried.
 */
export async function requestSourcePermission(
  roots: readonly CullSourceRoot[],
): Promise<CullPermission> {
  for (const root of roots) {
    if (!root.requestPermission) continue;
    try {
      const current = root.queryPermission ? await root.queryPermission(READ) : "prompt";
      if (current === "granted") continue;
      await root.requestPermission(READ);
    } catch {
      // Left as it was; sourcePermission below reports the real state.
    }
  }
  return sourcePermission(roots);
}

/**
 * Finds a frame's original among the roots. Directory lookups are cached, so a
 * ten-thousand frame card walks each folder of the card once, not once per frame.
 */
export class OriginalResolver {
  private directories = new Map<string, Promise<CullDirectoryHandle | null>>();
  // Dropping loose files stores one root per file; indexing them by name keeps
  // a ten-thousand file drop from scanning every root for every frame.
  private files = new Map<string, CullFileHandle[]>();
  private folders: { index: number; root: CullDirectoryHandle }[] = [];

  constructor(readonly roots: readonly CullSourceRoot[]) {
    roots.forEach((root, index) => {
      if (root.kind === "directory") this.folders.push({ index, root });
      else {
        const named = this.files.get(root.name);
        if (named) named.push(root);
        else this.files.set(root.name, [root]);
      }
    });
  }

  /** The verified original, or null when it is missing or has changed.
   * Throws SourcePermissionError when access has been withdrawn. */
  async resolve(
    frame: Pick<CullFrame, "id" | "name" | "bytes" | "relativePath" | "lastModified">,
  ): Promise<File | null> {
    const stamp = frameFileStamp(frame);
    const path = (frame.relativePath || frame.name).split("/").filter(Boolean);
    if (!path.length) return null;
    // A loose file root only ever stands for a frame imported without a folder.
    if (path.length === 1)
      for (const handle of this.files.get(path[0]!) ?? []) {
        const file = await this.guard(() => handle.getFile());
        if (file && matchesStamp(file, stamp)) return file;
      }
    for (const { index, root } of this.folders) {
      for (const candidate of candidatePaths(path)) {
        const file = await this.guard(async () => {
          const directory = await this.directory(index, root, candidate.slice(0, -1));
          if (!directory) return null;
          const handle = await directory.getFileHandle(candidate[candidate.length - 1]!);
          return handle.getFile();
        });
        if (file && matchesStamp(file, stamp)) return file;
      }
    }
    return null;
  }

  private async guard(open: () => Promise<File | null>): Promise<File | null> {
    try {
      return await open();
    } catch (error) {
      if (isPermissionError(error)) {
        this.directories.clear();
        throw new SourcePermissionError();
      }
      // NotFoundError, TypeMismatchError, NotReadableError (changed mid-read):
      // this candidate is not the frame's original.
      return null;
    }
  }

  private directory(
    index: number,
    root: CullDirectoryHandle,
    path: readonly string[],
  ): Promise<CullDirectoryHandle | null> {
    if (!path.length) return Promise.resolve(root);
    const key = JSON.stringify([index, ...path]);
    let pending = this.directories.get(key);
    if (!pending) {
      pending = this.directory(index, root, path.slice(0, -1)).then(
        async (parent: CullDirectoryHandle | null) => {
          if (!parent) return null;
          try {
            return await parent.getDirectoryHandle(path[path.length - 1]!);
          } catch (error) {
            if (isPermissionError(error)) throw error;
            return null;
          }
        },
      );
      // A failed lookup (permission) must be retried after a new grant.
      pending.catch(() => this.directories.delete(key));
      this.directories.set(key, pending);
    }
    return pending;
  }
}

/**
 * Where a frame's recorded path may sit under a root. The recorded path starts
 * with the folder the photographer imported ("Card/DCIM/100/IMG_1.JPG"). The
 * same folder may since have been renamed, or the photographer may have picked
 * its parent when reconnecting; the stamp check makes trying each safe.
 */
export function candidatePaths(path: readonly string[]): string[][] {
  const candidates: string[][] = [];
  if (path.length > 1) candidates.push(path.slice(1));
  candidates.push([...path]);
  return candidates;
}

// ---------------------------------------------------------------------------
// Capturing handles at import.

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: "read" }) => Promise<CullDirectoryHandle>;
  showOpenFilePicker?: (options?: {
    id?: string;
    multiple?: boolean;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<CullFileHandle[]>;
};

export function folderPickerSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function"
  );
}

export function filePickerSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as DirectoryPickerWindow).showOpenFilePicker === "function"
  );
}

export type PickedCard = { name: string; files: File[]; roots: CullSourceRoot[] };

function withRelativePath(file: File, path: string): File {
  // The ingest pool reads webkitRelativePath, as a folder <input> would set it.
  Object.defineProperty(file, "webkitRelativePath", { value: path, configurable: true });
  return file;
}

/** Every file under a directory handle, each carrying its path from the folder itself. */
export async function walkDirectory(
  root: CullDirectoryHandle,
  signal?: AbortSignal,
): Promise<File[]> {
  const files: File[] = [];
  const pending = new Set<Promise<void>>();
  const stack: { directory: CullDirectoryHandle; path: string; depth: number }[] = [
    { directory: root, path: root.name, depth: 0 },
  ];
  const abort = () => {
    if (signal?.aborted) throw new DOMException("Import cancelled.", "AbortError");
  };
  while (stack.length) {
    abort();
    const { directory, path, depth } = stack.pop()!;
    for await (const entry of directory.values()) {
      abort();
      const entryPath = `${path}/${entry.name}`;
      if (entry.kind === "directory") {
        if (depth + 1 < MAX_DEPTH)
          stack.push({ directory: entry, path: entryPath, depth: depth + 1 });
        continue;
      }
      if (files.length + pending.size >= MAX_FILES) break;
      while (pending.size >= FILE_CONCURRENCY) await Promise.race(pending);
      const task = entry.getFile().then(
        (file) => {
          files.push(withRelativePath(file, entryPath));
        },
        () => {
          // An unreadable entry is skipped, like a folder <input> would.
        },
      );
      pending.add(task);
      void task.finally(() => pending.delete(task));
    }
  }
  await Promise.all(pending);
  return files;
}

function isAbort(error: unknown) {
  return errorName(error) === "AbortError";
}

/** A folder handle from the picker. Null when the photographer cancels. */
export async function pickDirectoryHandle(): Promise<CullDirectoryHandle | null> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) return null;
  try {
    return await picker.call(window, { id: "celinen-cull", mode: "read" });
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }
}

/** The folder picker, with the handle kept. Null when the photographer cancels. */
export async function pickFolder(): Promise<PickedCard | null> {
  const directory = await pickDirectoryHandle();
  if (!directory) return null;
  return { name: directory.name, files: await walkDirectory(directory), roots: [directory] };
}

/** The file picker, with handles kept. Null when the photographer cancels. */
export async function pickFiles(): Promise<PickedCard | null> {
  const picker = (window as DirectoryPickerWindow).showOpenFilePicker;
  if (!picker) return null;
  let handles: CullFileHandle[];
  try {
    handles = await picker.call(window, {
      id: "celinen-cull",
      multiple: true,
      types: [
        {
          description: "Photos",
          accept: {
            "image/*": [
              ".jpg",
              ".jpeg",
              ".png",
              ".webp",
              ".heic",
              ".nef",
              ".cr2",
              ".cr3",
              ".arw",
              ".dng",
              ".raf",
              ".orf",
              ".rw2",
              ".pef",
              ".srw",
            ],
          },
        },
      ],
    });
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }
  const files = await Promise.all(handles.map((handle) => handle.getFile()));
  return { name: "", files, roots: handles };
}

type HandleItem = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<unknown>;
};

/**
 * Handles for a drop. Call it synchronously inside the drop event, like
 * `collectDroppedFiles`: the browser closes the drag data once the event returns.
 * Resolves to an empty list where the browser offers no handles.
 */
export function captureDropHandles(transfer: DataTransfer): Promise<CullSourceRoot[]> {
  const requests: Promise<unknown>[] = [];
  for (const item of Array.from(transfer.items ?? [])) {
    const handleItem = item as HandleItem;
    if (item.kind !== "file" || typeof handleItem.getAsFileSystemHandle !== "function") continue;
    try {
      requests.push(handleItem.getAsFileSystemHandle().catch(() => null));
    } catch {
      // A browser that exposes the method but refuses it: no handle for this item.
    }
  }
  // A drag built by script (or some browsers' plain-text drags) resolves to
  // nothing at all rather than null; only real handles are kept.
  return Promise.all(requests).then((handles) => handles.filter(isSourceRoot));
}

function isSourceRoot(handle: unknown): handle is CullSourceRoot {
  return (
    !!handle &&
    typeof handle === "object" &&
    "kind" in handle &&
    (handle.kind === "file" || handle.kind === "directory")
  );
}
