/** Photo Mechanic-style ingest: while the cull engine reads the card, copy
 * every original to a primary and an optional secondary drive, into dated
 * shoot folders.
 *
 * - Never overwrites. A different file with the same name gets `-1`, `-2`.
 * - Resumable. Each destination keeps a small manifest of what it holds
 *   (source path, size, modified time), so re-running after a crash, a closed
 *   tab or a pulled cable skips everything already copied — including files
 *   that were renamed on the first run.
 * - Out of the way. One copy lane per destination, a yield between files and
 *   `pause()`, so the cull read path keeps the card and the cores it needs.
 */
import { ProgressMeter } from "./progress";
import { joinPath, type HandoffTarget } from "./target";
import { parseTemplate, renderTemplate } from "./template";
import {
  emptyReport,
  errorMessage,
  isAbort,
  sourcePath,
  type HandoffProgress,
  type HandoffReport,
} from "./types";
import { splitExtension } from "./xmp";

export const MANIFEST_NAME = ".celinen-ingest.json";
const MANIFEST_VERSION = 1;

export type BackupOptions = {
  primary: HandoffTarget;
  secondary?: HandoffTarget | undefined;
  /** Folder template. Default `{yyyy}-{mm}-{dd} {shootName}`, or `{yyyy}-{mm}-{dd}` without a shoot name. */
  folderTemplate?: string | undefined;
  /** File name template without extension. Default `{filename}`. */
  renameTemplate?: string | undefined;
  shootName?: string | undefined;
  /** Capture time for folder dates. Default: the file's modified time, which
   * cameras set to the moment of capture. */
  captureTime?:
    ((file: File) => { ms: number; basis?: "utc" | "camera_clock" | undefined } | null) | undefined;
  /** Copies at once per destination. Default 1: the card is shared with the cull. */
  lanes?: number | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: ((progress: BackupProgress) => void) | undefined;
  /** Yield to the page between files. Default: a macrotask. Tests may pass a no-op. */
  yieldBetweenFiles?: (() => Promise<void>) | undefined;
};

export type BackupProgress = HandoffProgress & {
  primary: HandoffProgress;
  secondary: HandoffProgress | null;
};

export type BackupReport = {
  primary: HandoffReport;
  secondary: HandoffReport | null;
  cancelled: boolean;
  elapsedMs: number;
};

export type BackupIngest = {
  /** Queues files. May be called any number of times before `close()`. */
  add(files: Iterable<File>): void;
  /** No more files are coming; `done` resolves once the queue drains. */
  close(): void;
  pause(): void;
  resume(): void;
  readonly paused: boolean;
  cancel(reason?: unknown): void;
  done: Promise<BackupReport>;
};

type ManifestEntry = { source: string; size: number; mtime: number };
type Manifest = { version: number; entries: Record<string, ManifestEntry> };

function identity(entry: ManifestEntry): string {
  return `${entry.source.toLowerCase()}|${entry.size}|${entry.mtime}`;
}

function defaultYield(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === "function") return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function startBackupIngest(options: BackupOptions): BackupIngest {
  const started = Date.now();
  const controller = new AbortController();
  const signal = controller.signal;
  const forward = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) forward();
  else options.signal?.addEventListener("abort", forward, { once: true });

  const folderTemplate =
    options.folderTemplate ??
    (options.shootName ? "{yyyy}-{mm}-{dd} {shootName}" : "{yyyy}-{mm}-{dd}");
  const renameTemplate = options.renameTemplate ?? "{filename}";
  // A bad template is a programming or settings error: fail fast, before any copy.
  parseTemplate(folderTemplate);
  parseTemplate(renameTemplate);

  const yieldBetweenFiles = options.yieldBetweenFiles ?? defaultYield;
  const queue: { file: File; seq: number }[] = [];
  let closed = false;
  let paused = false;
  const wakers = new Set<() => void>();
  const wake = () => {
    for (const waker of [...wakers]) waker();
  };
  const waitForChange = () =>
    new Promise<void>((resolve) => {
      const done = () => {
        wakers.delete(done);
        resolve();
      };
      wakers.add(done);
    });
  signal.addEventListener("abort", wake, { once: true });

  const destinations = [
    { name: "primary" as const, target: options.primary },
    ...(options.secondary ? [{ name: "secondary" as const, target: options.secondary }] : []),
  ].map((destination) => ({
    ...destination,
    report: emptyReport(),
    meter: new ProgressMeter(0, 0, undefined),
    next: 0,
  }));

  let lastEmit = -Infinity;
  const emit = (force = false) => {
    if (!options.onProgress) return;
    const at = Date.now();
    if (!force && at - lastEmit < 150) return;
    lastEmit = at;
    const [primary, secondary] = destinations.map((d) => d.meter.snapshot());
    const parts = secondary ? [primary!, secondary] : [primary!];
    const rates = parts.map((p) => p.bytesPerSecond);
    options.onProgress({
      files: parts.reduce((s, p) => s + p.files, 0),
      totalFiles: parts.reduce((s, p) => s + p.totalFiles, 0),
      bytes: parts.reduce((s, p) => s + p.bytes, 0),
      totalBytes: parts.reduce((s, p) => s + p.totalBytes, 0),
      bytesPerSecond: rates.some((r) => r === null) ? null : rates.reduce((s, r) => s! + r!, 0),
      primary: primary!,
      secondary: secondary ?? null,
    });
  };

  const run = async (destination: (typeof destinations)[number]) => {
    const { target, report, meter } = destination;
    const manifestPath = [MANIFEST_NAME];
    let manifest: Manifest = { version: MANIFEST_VERSION, entries: {} };
    try {
      const text = await target.readText(manifestPath);
      if (text) {
        const parsed = JSON.parse(text) as Partial<Manifest>;
        if (
          parsed.version === MANIFEST_VERSION &&
          parsed.entries &&
          typeof parsed.entries === "object"
        )
          manifest = { version: MANIFEST_VERSION, entries: parsed.entries };
      }
    } catch {
      // An unreadable manifest only costs re-checking; files are still never overwritten.
    }
    const bySource = new Map<string, string>();
    for (const [path, entry] of Object.entries(manifest.entries))
      bySource.set(identity(entry), path);

    const reserved = new Set<string>();
    let dirty = 0;
    let lastSave = Date.now();
    let saving: Promise<void> = Promise.resolve();
    const save = (force: boolean) => {
      if (!dirty || (!force && dirty < 25 && Date.now() - lastSave < 2000)) return saving;
      dirty = 0;
      lastSave = Date.now();
      const body = JSON.stringify(manifest);
      // Saves are chained so an older snapshot never lands after a newer one.
      saving = saving
        .then(() => target.write(manifestPath, body).then(() => {}))
        .catch(() => {
          dirty += 1; // try again with the next save
        });
      return saving;
    };

    /** Copies one file. Progress bytes it streams are tallied so the lane can
     * settle the file at exactly its size, whatever the outcome. */
    const copyOne = async (file: File, seq: number, tally: { bytes: number }) => {
      const source = sourcePath(file);
      const entry: ManifestEntry = { source, size: file.size, mtime: file.lastModified };
      const capture = options.captureTime?.(file) ?? null;
      let segments: string[];
      try {
        const context = {
          fileName: file.name,
          relativePath: source,
          captureTimeMs: capture?.ms ?? null,
          captureTimeBasis: capture?.basis,
          fallbackTimeMs: file.lastModified,
          seq,
          shootName: options.shootName,
        };
        const rendered = renderTemplate(renameTemplate, context);
        segments = [...renderTemplate(folderTemplate, context), ...rendered];
      } catch (error) {
        report.failed.push({ source, reason: errorMessage(error) });
        return;
      }
      const { ext } = splitExtension(file.name);
      const folders = segments.slice(0, -1);
      const base = segments[segments.length - 1]!;

      // Already here from an earlier run, under whatever name it got then?
      const previous = bySource.get(identity(entry));
      if (previous !== undefined) {
        const stat = await target.stat(previous.split("/"));
        if (stat?.kind === "file" && stat.size === file.size) {
          report.skipped.push({ source, destination: previous, reason: "already-copied" });
          return;
        }
      }

      let path: string[] | null = null;
      for (let attempt = 0; attempt < 10_000; attempt++) {
        const name = attempt === 0 ? base : `${base}-${attempt}`;
        const candidate = [...folders, ext ? `${name}.${ext}` : name];
        const key = joinPath(candidate).toLowerCase();
        if (reserved.has(key)) continue;
        if (await target.stat(candidate)) continue;
        reserved.add(key);
        path = candidate;
        break;
      }
      if (!path) {
        report.failed.push({ source, reason: "No free file name at the destination." });
        return;
      }

      const destination = joinPath(path);
      try {
        const written = await target.write(path, file, {
          signal,
          lastModified: file.lastModified,
          onBytes: (bytes) => {
            tally.bytes += bytes;
            meter.addBytes(bytes);
            emit();
          },
        });
        if (written !== file.size) {
          await target.remove(path).catch(() => {});
          report.failed.push({
            source,
            destination,
            reason: `Size check failed: the destination has ${written} bytes, expected ${file.size}.`,
          });
          return;
        }
        report.copied.push({ source, destination, bytes: written });
        report.bytes += written;
        manifest.entries[destination] = entry;
        bySource.set(identity(entry), destination);
        dirty += 1;
      } catch (error) {
        reserved.delete(joinPath(path).toLowerCase());
        if (isAbort(error, signal))
          report.skipped.push({ source, destination, reason: "cancelled" });
        else report.failed.push({ source, destination, reason: errorMessage(error) });
      }
    };

    const lane = async () => {
      for (;;) {
        if (signal.aborted) return;
        if (paused) {
          await waitForChange();
          continue;
        }
        if (destination.next >= queue.length) {
          if (closed) return;
          await waitForChange();
          continue;
        }
        const { file, seq } = queue[destination.next++]!;
        const tally = { bytes: 0 };
        try {
          await copyOne(file, seq, tally);
        } catch (error) {
          // A destination that cannot even be asked (drive unplugged) fails this file only.
          report.failed.push({ source: sourcePath(file), reason: errorMessage(error) });
        }
        meter.rewindBytes(tally.bytes);
        meter.addBytes(file.size);
        meter.fileDone();
        emit();
        void save(false);
        await yieldBetweenFiles();
      }
    };

    const lanes = Math.max(1, Math.floor(options.lanes ?? 1));
    await Promise.all(Array.from({ length: lanes }, lane));
    // Anything never started is accounted for, not silently dropped.
    while (destination.next < queue.length) {
      const { file } = queue[destination.next++]!;
      report.skipped.push({ source: sourcePath(file), reason: "cancelled" });
      meter.addBytes(file.size);
      meter.fileDone();
    }
    await save(true);
    await saving;
  };

  const done = Promise.all(destinations.map(run)).then(() => {
    options.signal?.removeEventListener("abort", forward);
    emit(true);
    const elapsedMs = Date.now() - started;
    const cancelled = signal.aborted;
    for (const d of destinations) {
      d.report.cancelled = cancelled;
      d.report.elapsedMs = elapsedMs;
    }
    return {
      primary: destinations[0]!.report,
      secondary: destinations[1]?.report ?? null,
      cancelled,
      elapsedMs,
    };
  });

  return {
    add(files) {
      if (closed) throw new Error("This backup has been closed; start a new one for more files.");
      let bytes = 0;
      let count = 0;
      for (const file of files) {
        // Sequence numbers follow arrival order, so {seq} is stable across a resume.
        queue.push({ file, seq: queue.length + 1 });
        bytes += file.size;
        count += 1;
      }
      for (const d of destinations) d.meter.grow(count, bytes);
      emit();
      wake();
    },
    close() {
      closed = true;
      wake();
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      wake();
    },
    get paused() {
      return paused;
    },
    cancel(reason) {
      controller.abort(reason ?? new DOMException("Backup cancelled.", "AbortError"));
      wake();
    },
    done,
  };
}
