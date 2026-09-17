/** The ingest pool: every core reading photos at once, results streaming back
 * as they land.
 *
 * A sports card is ten thousand frames. Read one at a time through the browser's
 * own decoder that is an hour; through the C++ engine on every core it is about
 * a minute, and the photographer can start reviewing after the first few
 * frames rather than after the last one.
 */
import type { CullFrame } from "./session";
import type { IngestOptions } from "./ingest-engine";
import type { IngestReply, IngestRequest } from "./ingest-messages";

export type IngestedFrame = {
  frame: CullFrame;
  /** The filmstrip picture the engine made from the same decode. */
  thumbnail: Blob;
  /** The file it was read from, for a full-quality look later. */
  file: File;
  /** Set when the photo decoded but is not whole (a cut-off or corrupt file):
   * why, in plain words. Its readings are partly over gray. */
  damaged?: string | undefined;
};

export type IngestHandlers = {
  /** Called once per photo, in whatever order the lanes finish. */
  onFrame: (frame: IngestedFrame) => void;
  /** Called after every completion, with counts for the progress strip. */
  onProgress?: ((read: number, failed: number, total: number) => void) | undefined;
  signal?: AbortSignal | undefined;
  options?: IngestOptions | undefined;
  /** Lanes to run. Defaults to the machine's cores, less one for the page. */
  lanes?: number | undefined;
};

function laneCount(requested?: number) {
  if (requested && requested > 0) return Math.min(16, Math.floor(requested));
  const cores = typeof navigator === "undefined" ? 4 : navigator.hardwareConcurrency || 4;
  // One core stays with the page so the grid keeps painting while a card reads.
  return Math.min(12, Math.max(2, cores - 1));
}

export function ingestSupported(): boolean {
  return typeof Worker !== "undefined" && typeof WebAssembly !== "undefined";
}

/**
 * Reads every file through the pool and resolves when the card is done.
 * Frames arrive through `onFrame` as they are read. A file that cannot be read
 * becomes a frame carrying its error, never a missing row and never a guess.
 */
export async function ingestFiles(
  files: readonly File[],
  handlers: IngestHandlers,
): Promise<{ read: number; failed: number }> {
  if (!files.length) return { read: 0, failed: 0 };
  if (!ingestSupported()) throw new Error("This browser cannot run the cull engine.");

  const lanes = Math.min(laneCount(handlers.lanes), files.length);
  const workers: Worker[] = [];
  let next = 0;
  let read = 0;
  let failed = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        handlers.signal?.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve();
      };
      const abort = () =>
        finish(
          handlers.signal?.reason instanceof Error
            ? handlers.signal.reason
            : new DOMException("Import cancelled.", "AbortError"),
        );
      handlers.signal?.addEventListener("abort", abort, { once: true });

      const send = (worker: Worker) => {
        if (handlers.signal?.aborted) return abort();
        if (next >= files.length) {
          if (read + failed >= files.length) finish();
          return;
        }
        const index = next++;
        const file = files[index]!;
        worker.postMessage({
          id: String(index),
          file,
          ...(handlers.options ? { options: handlers.options } : {}),
        } satisfies IngestRequest);
      };

      for (let lane = 0; lane < lanes; lane++) {
        let worker: Worker;
        try {
          worker = new Worker(new URL("./ingest.worker.ts", import.meta.url), { type: "module" });
        } catch {
          finish(new Error("This browser cannot run the cull engine."));
          return;
        }
        workers.push(worker);
        worker.onmessage = ({ data }: MessageEvent<IngestReply>) => {
          const index = Number(data.id);
          const file = files[index];
          if (file) {
            if (data.kind === "read") {
              read += 1;
              handlers.onFrame({
                frame: {
                  id: frameId(file, index),
                  name: file.name,
                  ...(relativePath(file) ? { relativePath: relativePath(file) } : {}),
                  width: data.width,
                  height: data.height,
                  bytes: file.size,
                  lastModified: file.lastModified,
                  captureTimeMs: data.captureTimeMs,
                  captureTimeBasis: data.captureTimeBasis,
                  cameraKey: data.cameraKey,
                  reading: data.reading,
                  verdict: "undecided",
                  decided: false,
                  // Only files that name an AF area carry these, so older
                  // engines and AF-less JPEGs store exactly the row they did.
                  ...(data.afPoint
                    ? {
                        afPoint: data.afPoint,
                        ...(data.afConfirmed === undefined
                          ? {}
                          : { afConfirmed: data.afConfirmed }),
                        ...(data.focusHit ? { focusHit: data.focusHit } : {}),
                      }
                    : {}),
                },
                thumbnail: data.thumbnail,
                file,
                ...(data.damaged ? { damaged: data.damaged } : {}),
              });
            } else {
              failed += 1;
              handlers.onFrame({
                frame: {
                  id: frameId(file, index),
                  name: file.name,
                  ...(relativePath(file) ? { relativePath: relativePath(file) } : {}),
                  width: 0,
                  height: 0,
                  bytes: file.size,
                  lastModified: file.lastModified,
                  captureTimeMs: null,
                  verdict: "undecided",
                  decided: false,
                  error: data.error,
                },
                thumbnail: new Blob(),
                file,
              });
            }
            handlers.onProgress?.(read, failed, files.length);
          }
          if (read + failed >= files.length) finish();
          else send(worker);
        };
        worker.onerror = () => finish(new Error("The cull engine stopped."));
        worker.onmessageerror = () => finish(new Error("The cull engine stopped."));
        send(worker);
      }
    });
  } finally {
    for (const worker of workers) worker.terminate();
  }
  return { read, failed };
}

function relativePath(file: File): string | undefined {
  const withPath = file as File & { webkitRelativePath?: string };
  return withPath.webkitRelativePath || undefined;
}

/** Unique within a card even when two folders hold files of the same name. */
function frameId(file: File, index: number): string {
  const path = relativePath(file) ?? file.name;
  return `${path}:${file.size}:${file.lastModified}:${index}`;
}
