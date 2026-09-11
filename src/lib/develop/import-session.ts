import { collectDroppedFiles, type DroppedFilesResult } from "../studio/drop-import";
import { readImportSidecars, sidecarKey, supportedPhoto } from "../studio/ingest";
import { prepareDevelopPreview } from "./preview";
import { completeDevelopImportIds, runDevelopImport, type DevelopImportProgress } from "./import";
import {
  createDevelopStore,
  type DevelopImportJob,
  type DevelopPhotoInput,
  type DevelopStore,
  type DevelopStoreOptions,
} from "./store";

export type DevelopImportRow = DevelopImportJob["rows"][number];
export type DevelopImportSnapshot = Omit<DevelopImportJob, "id" | "version" | "revision"> & {
  jobId: string | null;
  failures: { fileName: string; message: string }[];
  selectedId: string | null;
  /** Measured from the original event; these are not decoder-throughput claims. */
  timing: {
    registeredMs: number | null;
    firstPreviewMs: number | null;
    previewsMs: number | null;
    savedMs: number | null;
  };
};

type SessionStore = Pick<
  DevelopStore,
  "loadLibrary" | "addPhotosWithDocuments" | "readImportJob" | "saveImportJob"
>;
type ImportSessionDependencies = {
  store: SessionStore;
  preparePreview?: (
    file: File,
    input: DevelopPhotoInput,
    signal: AbortSignal,
  ) => Promise<DevelopPhotoInput>;
  collect?: typeof collectDroppedFiles;
  now?: () => number;
  /** Injectable lock for regression tests; browsers use an origin-wide Web Lock. */
  withLock?: (name: string, work: () => Promise<void>) => Promise<void>;
  /** Session-owned navigation protection; null disables it in non-browser hosts. */
  unloadTarget?: Pick<EventTarget, "addEventListener" | "removeEventListener"> | null;
};
const emptySnapshot = (): DevelopImportSnapshot => ({
  jobId: null,
  phase: "complete",
  startedAt: 0,
  finishedAt: null,
  rows: [],
  found: 0,
  previewReady: 0,
  analyzed: 0,
  saved: 0,
  failed: 0,
  duplicates: 0,
  error: null,
  failures: [],
  selectedId: null,
  timing: { registeredMs: null, firstPreviewMs: null, previewsMs: null, savedMs: null },
});
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Import could not continue.";
const terminal = (phase: DevelopImportJob["phase"]) =>
  ["complete", "cancelled", "paused", "interrupted"].includes(phase);

/** Native admission remains bounded by the engine; RAW fallback never changes original bytes. */
export async function prepareDevelopImportPreview(
  file: File,
  input: DevelopPhotoInput,
  signal: AbortSignal,
): Promise<DevelopPhotoInput> {
  const preview = await prepareDevelopPreview(file, input, signal, { priority: "background" });
  return { ...input, ...preview };
}

async function browserImportLock(name: string, work: (exclusive: boolean) => Promise<void>) {
  if (typeof navigator !== "undefined" && navigator.locks) {
    await navigator.locks.request(name, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock)
        throw new Error(
          "This shoot is importing in another tab. Let it finish or cancel it there.",
        );
      await work(true);
    });
  } else {
    // CAS can admit a new job, but cannot prove an existing owner's work has stopped.
    await work(false);
  }
}

/**
 * Owns File handles and cancellation independently of React. Unsubscribing a view does
 * not stop work. No customer originals enter localStorage, and pending rows never become
 * catalog photo IDs: only verified, transaction-acknowledged receipts establish identity.
 */
export function createDevelopImportSession(
  options: Pick<DevelopStoreOptions, "scope" | "libraryId">,
  dependencies: ImportSessionDependencies,
) {
  const { store } = dependencies;
  const now = dependencies.now ?? (() => performance.now());
  const listeners = new Set<() => void>();
  let state = emptySnapshot();
  let published = state;
  let controller: AbortController | null = null;
  let running: Promise<void> | null = null;
  let publishTimer: ReturnType<typeof setTimeout> | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let revision = 0;
  let admitted = false;
  let persistenceDirty = false;
  let persistence: Promise<void> | null = null;
  let eventStart = 0;
  let admittedJobId: string | null = null;
  let lastSettledOwnedJobId: string | null = null;
  const filesByHandle = new Map<File, number>();

  function publish(immediate = false) {
    if (!immediate) {
      publishTimer ??= setTimeout(() => {
        publishTimer = null;
        publish(true);
      }, 75);
      return;
    }
    if (publishTimer) clearTimeout(publishTimer);
    publishTimer = null;
    // Consumers receive a stable immutable snapshot, never the mutable work queue.
    published = {
      ...state,
      rows: state.rows.map((row) => ({ ...row })),
      failures: [...state.failures],
      timing: { ...state.timing },
    };
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* Display failures cannot invalidate a save. */
      }
    }
  }
  function pause(error: unknown) {
    state.phase = "paused";
    state.error = message(error);
    controller?.abort();
    publish(true);
  }
  function durableJob(): DevelopImportJob {
    return {
      version: 1,
      revision,
      id: state.jobId!,
      phase: state.phase,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      rows: state.rows.map((row) => ({ ...row })),
      found: state.found,
      previewReady: state.previewReady,
      analyzed: state.analyzed,
      saved: state.saved,
      failed: state.failed,
      duplicates: state.duplicates,
      error: state.error,
    };
  }
  async function persistNow() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (!admitted || !state.jobId) return;
    persistenceDirty = true;
    if (!persistence) {
      persistence = (async () => {
        while (persistenceDirty) {
          persistenceDirty = false;
          const saved = await store.saveImportJob(durableJob(), revision);
          revision = saved.revision;
        }
      })();
    }
    const active = persistence;
    try {
      await active;
    } finally {
      if (persistence === active) persistence = null;
    }
  }
  function changed() {
    publish();
    if (admitted && !saveTimer)
      saveTimer = setTimeout(() => {
        saveTimer = null;
        void persistNow().catch(pause);
      }, 500);
  }
  function register(files: readonly File[]) {
    if (controller?.signal.aborted) return;
    for (const file of files) {
      if (!supportedPhoto(file) || filesByHandle.has(file)) continue;
      const index = state.rows.length;
      filesByHandle.set(file, index);
      state.rows.push({
        id: `${state.jobId}:${index}`,
        name: file.name,
        path: file.webkitRelativePath || file.name,
        status: "found",
      });
    }
    state.found = state.rows.length;
    changed();
  }
  function begin() {
    if (running) throw new Error("An import is already running for this shoot.");
    controller = new AbortController();
    admitted = false;
    admittedJobId = null;
    filesByHandle.clear();
    eventStart = now();
    state = {
      ...emptySnapshot(),
      jobId: crypto.randomUUID(),
      phase: "discovering",
      startedAt: Date.now(),
    };
    publish(true);
    return controller;
  }
  async function execute(discovery: Promise<DroppedFilesResult>, owner: AbortController) {
    async function fail(error: unknown) {
      if (state.phase !== "paused") {
        state.phase = owner.signal.aborted ? "cancelled" : "paused";
        state.error = owner.signal.aborted ? null : message(error);
      }
      owner.abort();
      await discovery.catch(() => undefined);
    }
    async function finish() {
      if (state.phase === "cancelled")
        for (const row of state.rows)
          if (row.status === "found" || row.status === "preview-ready") row.status = "cancelled";
      state.finishedAt = Date.now();
      try {
        await persistNow();
        // The final journal is part of durable completion, not merely the last photo write.
        if (state.phase === "complete" && !owner.signal.aborted)
          state.timing.savedMs = now() - eventStart;
      } catch (error) {
        pause(error);
      }
      admitted = false;
      filesByHandle.clear();
      publish(true);
    }
    try {
      const withLock = dependencies.withLock
        ? (name: string, work: (exclusive: boolean) => Promise<void>) =>
            dependencies.withLock!(name, () => work(true))
        : browserImportLock;
      await withLock(
        `foto-import:${JSON.stringify([options.scope, options.libraryId])}`,
        async (exclusive) => {
          try {
            const prior = await store.readImportJob();
            revision = prior?.revision ?? 0;
            if (prior && !["complete", "cancelled", "interrupted"].includes(prior.phase)) {
              if (!exclusive && prior.id !== lastSettledOwnedJobId)
                throw new Error(
                  "An earlier import may still be running. Without Web Locks this tab cannot safely recover it. Cancel it in its original tab, or reopen FOTO in a browser with Web Locks support; saved photos remain intact.",
                );
              // Only an exclusive lock or this exact, fully drained owner proves it stopped.
              // Interrupted handle-only work is recorded honestly, never marked Saved on reload.
              const interrupted = await store.saveImportJob(
                { ...prior, phase: "interrupted", finishedAt: Date.now() },
                revision,
              );
              revision = interrupted.revision;
            }
            admitted = true;
            await persistNow();
            admittedJobId = state.jobId;
            const discovered = await discovery;
            owner.signal.throwIfAborted();
            register(discovered.files);
            state.failures.push(
              ...discovered.warnings.map((warning) => ({
                fileName: warning.path || "Folder",
                message: warning.message,
              })),
            );
            const files = discovered.files.filter((file) => supportedPhoto(file));
            // No filename guesses while enumeration is incomplete. A later collision cannot
            // retroactively steal a sidecar from a source already admitted into the library.
            const sidecars = await readImportSidecars(discovered.files, owner.signal);
            const targets = new Map<string, number>();
            for (const file of new Set(files))
              targets.set(sidecarKey(file), (targets.get(sidecarKey(file)) ?? 0) + 1);
            for (const [key] of sidecars.values)
              if (targets.get(key) !== 1)
                state.failures.push({
                  fileName: key,
                  message:
                    "Sidecar was not applied: an exact, unambiguous photo match is required.",
                });
            if (
              sidecars.ambiguous ||
              sidecars.unreadable ||
              sidecars.oversized ||
              sidecars.budgetSkipped
            )
              state.failures.push({
                fileName: "Sidecars",
                message: `${sidecars.ambiguous} ambiguous · ${sidecars.unreadable} unreadable · ${sidecars.oversized} too large · ${sidecars.budgetSkipped} beyond read limit`,
              });
            const library = await store.loadLibrary();
            owner.signal.throwIfAborted();
            state.phase = "processing";
            changed();
            const rowAt = (progress: DevelopImportProgress) =>
              state.rows[filesByHandle.get(files[progress.index - 1]!) ?? -1];
            const result = await runDevelopImport(files, {
              existingIds: completeDevelopImportIds(library.photos),
              signal: owner.signal,
              preparationConcurrency: 4,
              rawPreparationConcurrency: 1,
              preparePreview: async (file, input, signal) => {
                const prepared = await (dependencies.preparePreview ?? prepareDevelopImportPreview)(
                  file,
                  input,
                  signal,
                );
                const key = sidecarKey(file),
                  text = sidecars.values.get(key);
                if (text !== undefined && targets.get(key) === 1) {
                  const source = discovered.files.find(
                    (candidate) => /\.xmp$/i.test(candidate.name) && sidecarKey(candidate) === key,
                  )!;
                  return {
                    ...prepared,
                    sidecar: {
                      name: source.name,
                      path: source.webkitRelativePath || source.name,
                      text,
                    },
                  };
                }
                return prepared;
              },
              onPrepared: (_input, progress) => {
                if (owner.signal.aborted) return;
                const row = rowAt(progress);
                if (row) row.status = "preview-ready";
                state.previewReady++;
                state.timing.firstPreviewMs ??= now() - eventStart;
                changed();
              },
              onPreparationComplete: () => {
                if (owner.signal.aborted) return;
                state.timing.previewsMs = now() - eventStart;
                changed();
              },
              onFileFailure: (failure, progress) => {
                const row = rowAt(progress);
                if (row) {
                  row.status = "failed";
                  row.error = failure.message;
                }
                state.failed++;
                state.failures.push(failure);
                changed();
              },
              onDuplicate: (progress) => {
                const row = rowAt(progress);
                if (row) row.status = "duplicate";
                state.duplicates++;
                changed();
              },
              save: (input) => store.addPhotosWithDocuments([input]),
              onCommitted: (receipt, progress) => {
                // Even a late cancellation must retain a transaction that actually committed.
                const row = rowAt(progress),
                  photo = receipt.photos[0]!;
                if (row) {
                  row.status = "saved";
                  row.photoId = photo.id;
                }
                state.saved++;
                state.selectedId ??= photo.id;
                changed();
              },
            });
            if (result.fatalError) pause(new Error(result.fatalError));
            if (!result.fatalError && !state.error)
              state.phase = result.stopped ? "cancelled" : "complete";
          } catch (error) {
            await fail(error);
          } finally {
            // Hold the cross-tab lock until the final durable report is acknowledged.
            await finish();
          }
        },
      );
    } catch (error) {
      // Failed lock admission must not mutate another tab's import report.
      await fail(error);
      await finish();
    }
  }
  function track(discovery: Promise<DroppedFilesResult>, owner: AbortController) {
    // Observe discovery before lock/journal admission: those waits must not inflate
    // the registration metric. Never let an aborted owner's late result change state.
    const measuredDiscovery = discovery.then((result) => {
      if (controller === owner && !owner.signal.aborted) {
        register(result.files);
        state.timing.registeredMs ??= now() - eventStart;
        changed();
      }
      return result;
    });
    // Attach immediately: discovery begins inside the original drop event.
    void measuredDiscovery.catch(() => undefined);
    const unloadTarget =
      dependencies.unloadTarget === undefined
        ? typeof window === "undefined"
          ? null
          : window
        : dependencies.unloadTarget;
    const beforeUnload = (event: Event) => {
      event.preventDefault();
      (event as BeforeUnloadEvent).returnValue = "";
    };
    // React views may all unmount while this owner still has handles or writes.
    // Only a document unload is fenced: ordinary in-app route changes stay free.
    unloadTarget?.addEventListener("beforeunload", beforeUnload);
    running = execute(measuredDiscovery, owner).finally(() => {
      // A cancelled/complete phase can precede owned save, discovery, or lock drains.
      // Release only with this running promise, never from status or subscribers.
      unloadTarget?.removeEventListener("beforeunload", beforeUnload);
      if (admittedJobId !== null) lastSettledOwnedJobId = admittedJobId;
      running = null;
      controller = null;
    });
    return running;
  }
  return {
    getSnapshot: () => published,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    startFiles(files: readonly File[]) {
      const owner = begin();
      const distinct = [...new Set(files)];
      register(distinct);
      state.timing.registeredMs = now() - eventStart;
      return track(
        Promise.resolve({
          files: distinct,
          warnings: [],
          directories: 0,
          duplicates: files.length - distinct.length,
        }),
        owner,
      );
    },
    startDrop(transfer: DataTransfer) {
      const owner = begin();
      // Never insert an await above this call: browser drag handles expire after the event.
      const discovery = (dependencies.collect ?? collectDroppedFiles)(transfer, {
        signal: owner.signal,
        onFiles: register,
      });
      return track(discovery, owner);
    },
    cancel() {
      controller?.abort();
    },
    isRunning: () => running !== null,
    whenSettled: () => running ?? Promise.resolve(),
    async restore() {
      if (running || state.jobId) return;
      const prior = await store.readImportJob();
      if (running || state.jobId || !prior) return;
      state = {
        ...emptySnapshot(),
        ...prior,
        jobId: prior.id,
        phase: terminal(prior.phase) ? prior.phase : "interrupted",
        error: terminal(prior.phase)
          ? prior.error
          : "Import was interrupted. Saved photos are intact; reselect the folder to continue remaining files.",
      };
      publish(true);
    },
  };
}

export type DevelopImportSession = ReturnType<typeof createDevelopImportSession>;
const sessions: Map<string, DevelopImportSession> =
  import.meta.hot?.data["developImportSessions"] ?? new Map();
if (import.meta.hot)
  import.meta.hot.dispose((data) => {
    data["developImportSessions"] = sessions;
  });
export function getDevelopImportSession(options: DevelopStoreOptions): DevelopImportSession {
  const key = JSON.stringify([options.scope, options.libraryId]);
  let session = sessions.get(key);
  if (!session) {
    session = createDevelopImportSession(options, { store: createDevelopStore(options) });
    sessions.set(key, session);
  }
  return session;
}

/** Called on verified account change, never on route unmount. Saves already committed remain. */
export function cancelDevelopImportsOutsideScope(scope: string) {
  for (const [key, session] of sessions) if (JSON.parse(key)[0] !== scope) session.cancel();
}
