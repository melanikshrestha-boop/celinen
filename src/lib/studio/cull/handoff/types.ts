/** Shared shapes for the hand-off layer: what a culled frame must carry to be
 * exported, the slice of the File System Access API the layer relies on, and
 * the progress and report every copy job produces.
 *
 * The frame and handle types are structural on purpose. A `CullFrame` from
 * session.ts satisfies `HandoffFrame` as it is, and a real
 * `FileSystemDirectoryHandle` satisfies `DirectoryHandleLike`, so the hand-off
 * modules neither depend on the review screen's internals nor need a browser
 * to be tested.
 */
import type { CullReason, CullVerdict } from "../engine";

export type HandoffSuggestion = {
  verdict: CullVerdict;
  reason: CullReason;
  /** 1..99, calibrated against the shoot. */
  score: number;
  group: number | null;
  bestOfGroup: boolean;
  duplicate: boolean;
};

export type HandoffFrame = {
  id: string;
  name: string;
  relativePath?: string | undefined;
  bytes?: number | undefined;
  captureTimeMs: number | null;
  captureTimeBasis?: "utc" | "camera_clock" | undefined;
  /** The engine's camera identity: `make|model|serial`, any part optional. */
  cameraKey?: string | undefined;
  suggestion?: HandoffSuggestion | undefined;
  verdict: CullVerdict;
  decided: boolean;
  /** A star rating the photographer set (0..5). Wins over score bands. */
  rating?: number | undefined;
};

/** The photographer's verdict when they decided, otherwise the engine's.
 * Mirrors `effectiveVerdict` in session.ts; kept here so the hand-off layer
 * does not move when the review screen's model does. */
export function handoffVerdict(frame: HandoffFrame): CullVerdict {
  if (frame.decided) return frame.verdict;
  return frame.suggestion?.verdict ?? "undecided";
}

// ---------------------------------------------------------------------------
// File System Access, structurally.

/** A file's writable. Only piped into, so the stream shape is all that is needed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- FileSystemWritableFileStream is WritableStream<any>
export type WritableFileLike = WritableStream<any>;

export type FileHandleLike = {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<WritableFileLike>;
};

export type DirectoryHandleLike = {
  readonly kind: "directory";
  readonly name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  keys?(): AsyncIterable<string>;
  queryPermission?(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
};

// ---------------------------------------------------------------------------
// Progress and reports.

export type HandoffProgress = {
  /** Files finished: copied, skipped or failed. */
  files: number;
  totalFiles: number;
  bytes: number;
  totalBytes: number;
  /** Recent throughput, or null before there is enough to measure. */
  bytesPerSecond: number | null;
};

export type CopiedEntry = {
  frameId?: string | undefined;
  source: string;
  destination: string;
  bytes: number;
};

export type SkippedEntry = {
  frameId?: string | undefined;
  source: string;
  destination?: string | undefined;
  reason: "exists" | "already-copied" | "cancelled" | "no-sidecar-target" | "sidecar-conflict";
};

export type FailedEntry = {
  frameId?: string | undefined;
  source: string;
  destination?: string | undefined;
  reason: string;
};

export type HandoffReport = {
  copied: CopiedEntry[];
  skipped: SkippedEntry[];
  failed: FailedEntry[];
  cancelled: boolean;
  bytes: number;
  elapsedMs: number;
};

export function emptyReport(): HandoffReport {
  return { copied: [], skipped: [], failed: [], cancelled: false, bytes: 0, elapsedMs: 0 };
}

/** Where a file sat on the card, for reports and pairing. */
export function sourcePath(file: File): string {
  const withPath = file as File & { webkitRelativePath?: string };
  return withPath.webkitRelativePath || file.name;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

export function isAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return error instanceof Error && error.name === "AbortError";
}
