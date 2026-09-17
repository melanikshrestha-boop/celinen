/** Makes the review previews for a session, after the card has been read.
 *
 * Nothing here runs while the ingest pool is busy: previews are a second pass
 * over the originals, one worker, one photo at a time, so a ten-thousand frame
 * card reads exactly as fast as it did without them. Progress is the index
 * itself — a tab closed halfway resumes from the first frame without a preview
 * the next time the originals are at hand, whether that is the same tab, a
 * reconnected folder, or a fresh import.
 */
import { effectiveVerdict, type CullFrame } from "./session";
import {
  previewBytesEstimate,
  previewEdge,
  PREVIEW_QUALITY,
  previewFileName,
  type PreviewLibrary,
} from "./preview-library";
import { previewFolder } from "./opfs";
import type { PreviewReply, PreviewRequest } from "./preview-messages";
import { SourcePermissionError } from "./sources";

export type PreviewEncoder = {
  encode(request: Omit<PreviewRequest, "id">): Promise<PreviewReply>;
  dispose(): void;
};

export type PreviewRunResult = {
  written: number;
  failed: number;
  /** Frames whose original could not be found or no longer matched. */
  missing: number;
  /** Why the run ended. */
  end: "done" | "aborted" | "full" | "permission" | "unavailable" | "busy";
};

export type PreviewRunOptions = {
  sessionId: string;
  /** The session as it stands now; read again for every photo so decisions count. */
  frames: () => readonly CullFrame[];
  /** One frame as it stands now, or undefined when it has left the session. */
  frame: (frameId: string) => CullFrame | undefined;
  /** The verified original of a frame, or null. May throw SourcePermissionError. */
  original: (frame: CullFrame) => Promise<File | null>;
  signal: AbortSignal;
  onProgress?: ((done: number, total: number) => void) | undefined;
};

/** Keepers first, rejects last: if space or time runs out, the photos the
 * photographer will look at longest are the ones that already have previews. */
export function previewOrder(
  frames: readonly CullFrame[],
  covered: ReadonlySet<string>,
): CullFrame[] {
  const rank = (frame: CullFrame) => {
    const verdict = effectiveVerdict(frame);
    return verdict === "keep" ? 0 : verdict === "undecided" ? 1 : 2;
  };
  return frames
    .filter((frame) => !frame.error && !covered.has(frame.id))
    .map((frame, index) => ({ frame, index, rank: rank(frame) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ frame }) => frame);
}

type LockManagerLike = {
  request<T>(
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: unknown) => Promise<T>,
  ): Promise<T>;
};

/** Runs `task` holding a named lock, so two tabs of the same session do not
 * both encode it; null when another tab holds it. Without Web Locks, just runs. */
export function withTabLock<T>(name: string, task: () => Promise<T>): Promise<T | null> {
  const locks =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as unknown as { locks?: LockManagerLike }).locks;
  if (!locks) return task();
  return locks.request<T | null>(name, { ifAvailable: true }, async (lock) =>
    lock ? task() : null,
  );
}

export class PreviewQueue {
  constructor(
    private readonly deps: {
      scope: string;
      library: PreviewLibrary;
      encoder: () => PreviewEncoder;
      lock?: (<T>(name: string, task: () => Promise<T>) => Promise<T | null>) | undefined;
    },
  ) {}

  async run(options: PreviewRunOptions): Promise<PreviewRunResult> {
    const lock = this.deps.lock ?? withTabLock;
    const result = await lock(`celinen-cull-previews:${this.deps.scope}:${options.sessionId}`, () =>
      this.runLocked(options),
    );
    return result ?? { written: 0, failed: 0, missing: 0, end: "busy" };
  }

  private async runLocked(options: PreviewRunOptions): Promise<PreviewRunResult> {
    const { library } = this.deps;
    const result: PreviewRunResult = { written: 0, failed: 0, missing: 0, end: "done" };
    // One size for the whole run: this screen's own pixels.
    const maxEdge = previewEdge();
    const estimate = previewBytesEstimate(maxEdge);
    library.refresh(); // another tab may have written or evicted since
    const covered = await library.covered(options.sessionId);
    const pending = previewOrder(options.frames(), covered);
    if (!pending.length) return result;
    void library.persist();

    let encoder: PreviewEncoder | null = null;
    const folder = previewFolder(this.deps.scope, options.sessionId);
    try {
      for (let index = 0; index < pending.length; index++) {
        if (options.signal.aborted) return { ...result, end: "aborted" };
        // The frame as it stands now: it may have been decided since the run began.
        const frame = options.frame(pending[index]!.id);
        if (!frame || frame.error) continue;
        const open = { sessionId: options.sessionId, frames: options.frames() };
        if (!(await library.reserve(estimate, open))) return { ...result, end: "full" };

        let file: File | null;
        try {
          file = await options.original(frame);
        } catch (error) {
          if (error instanceof SourcePermissionError) return { ...result, end: "permission" };
          file = null;
        }
        if (options.signal.aborted) return { ...result, end: "aborted" };
        if (!file) {
          result.missing += 1;
          continue;
        }

        const name = await previewFileName(frame.id);
        encoder ??= this.deps.encoder();
        const request = {
          file,
          folder,
          name,
          maxEdge,
          quality: PREVIEW_QUALITY,
        };
        let reply = await encoder.encode(request);
        if (reply.kind === "quota") {
          // The estimate was optimistic; take a fresh one, make real room, retry once.
          if (!(await library.reserve(estimate * 4, open, true))) return { ...result, end: "full" };
          reply = await encoder.encode(request);
          if (reply.kind === "quota") return { ...result, end: "full" };
        }
        if (reply.kind === "unavailable") return { ...result, end: "unavailable" };
        const suggestedReject = frame.suggestion?.verdict === "reject";
        if (reply.kind === "written") {
          await library.record({
            sessionId: options.sessionId,
            frameId: frame.id,
            file: name,
            bytes: reply.bytes,
            width: reply.width,
            height: reply.height,
            createdAt: Date.now(),
            suggestedReject,
          });
          result.written += 1;
        } else {
          await library.record({
            sessionId: options.sessionId,
            frameId: frame.id,
            file: name,
            bytes: 0,
            width: 0,
            height: 0,
            createdAt: Date.now(),
            suggestedReject,
            failed: true,
          });
          result.failed += 1;
        }
        options.onProgress?.(index + 1, pending.length);
      }
      return result;
    } finally {
      encoder?.dispose();
    }
  }
}

/** The real encoder: one dedicated worker, one request at a time. */
export function workerPreviewEncoder(): PreviewEncoder {
  const worker = new Worker(new URL("./preview.worker.ts", import.meta.url), { type: "module" });
  let sequence = 0;
  const waiting = new Map<number, (reply: PreviewReply) => void>();
  const failAll = (error: string) => {
    for (const [id, resolve] of waiting) resolve({ id, kind: "unavailable", error });
    waiting.clear();
  };
  worker.onmessage = ({ data }: MessageEvent<PreviewReply>) => {
    const resolve = waiting.get(data.id);
    waiting.delete(data.id);
    resolve?.(data);
  };
  worker.onerror = () => failAll("The preview worker stopped.");
  worker.onmessageerror = () => failAll("The preview worker stopped.");
  return {
    encode(request) {
      const id = ++sequence;
      return new Promise((resolve) => {
        waiting.set(id, resolve);
        worker.postMessage({ ...request, id } satisfies PreviewRequest);
      });
    },
    dispose() {
      worker.terminate();
      failAll("The preview worker was stopped.");
    },
  };
}
