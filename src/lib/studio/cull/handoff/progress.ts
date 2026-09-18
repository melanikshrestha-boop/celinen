/** Progress for long copies: counts, bytes and a throughput that settles
 * instead of jittering, delivered at most a few times a second. */
import type { HandoffProgress } from "./types";

const WINDOW_MS = 3000;

export class ProgressMeter {
  private files = 0;
  private bytes = 0;
  private samples: { at: number; bytes: number }[] = [];
  private lastEmit = -Infinity;

  constructor(
    private totalFiles: number,
    private totalBytes: number,
    private readonly onProgress?: ((progress: HandoffProgress) => void) | undefined,
    private readonly intervalMs = 150,
    private readonly now: () => number = () =>
      typeof performance !== "undefined" ? performance.now() : Date.now(),
  ) {
    this.samples.push({ at: this.now(), bytes: 0 });
  }

  grow(files: number, bytes: number) {
    this.totalFiles += files;
    this.totalBytes += bytes;
    this.emit(false);
  }

  addBytes(bytes: number) {
    this.bytes += bytes;
    this.emit(false);
  }

  /** Undo bytes counted for a write that did not complete, so totals stay honest. */
  rewindBytes(bytes: number) {
    this.bytes = Math.max(0, this.bytes - bytes);
  }

  fileDone() {
    this.files += 1;
    this.emit(false);
  }

  snapshot(): HandoffProgress {
    const at = this.now();
    this.samples.push({ at, bytes: this.bytes });
    while (this.samples.length > 2 && at - this.samples[1]!.at > WINDOW_MS) this.samples.shift();
    const first = this.samples[0]!;
    const elapsed = at - first.at;
    return {
      files: this.files,
      totalFiles: this.totalFiles,
      bytes: this.bytes,
      totalBytes: this.totalBytes,
      // Under half a second of data reads as a wild number that then jumps.
      bytesPerSecond: elapsed >= 500 ? ((this.bytes - first.bytes) / elapsed) * 1000 : null,
    };
  }

  emit(force: boolean) {
    if (!this.onProgress) return;
    const at = this.now();
    if (!force && at - this.lastEmit < this.intervalMs) return;
    this.lastEmit = at;
    this.onProgress(this.snapshot());
  }
}

/**
 * Runs `task` over `items` with at most `concurrency` at once. Stops starting
 * new items once `signal` aborts; items never started are passed to
 * `onSkipped`. Task errors are the task's to handle — a throw here is a bug.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
  options: { signal?: AbortSignal | undefined; onSkipped?: ((item: T) => void) | undefined } = {},
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      if (options.signal?.aborted) {
        options.onSkipped?.(item);
        continue;
      }
      await task(item);
    }
  };
  const lanes = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: lanes }, lane));
}
