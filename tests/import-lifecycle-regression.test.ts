/** Isolated coordinator regression: no browser, original files, network, or real storage. */
import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

if (!process.argv.includes("--import-periodic-journal-fixture")) {
  test("periodic journal quota pauses admission and drains uncancelable previews before retry", () => {
    const result = Bun.spawnSync(
      [process.execPath, fileURLToPath(import.meta.url), "--import-periodic-journal-fixture"],
      { stdout: "pipe", stderr: "pipe", timeout: 4000 },
    );
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
    expect(new TextDecoder().decode(result.stdout)).toContain("IMPORT_PERIODIC_JOURNAL_OK");
  });
} else {
  await runFixture();
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function runFixture() {
  globalThis.fetch = (() => {
    throw new Error("Unexpected import QA network access");
  }) as typeof fetch;
  const { createDevelopImportSession } = await import("../src/lib/develop/import-session");
  const { advanceDevelopImportJob, createDevelopDocument } =
    await import("../src/lib/develop/store");
  type Job = import("../src/lib/develop/store").DevelopImportJob;
  type Library = import("../src/lib/develop/store").DevelopLibrary;
  type Input = import("../src/lib/develop/store").DevelopPhotoInput;

  // Capture only the coordinator's periodic 500ms journal timer. Trigger its real
  // callback deterministically; publication timers and async hashing remain real.
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const periodic = new Map<ReturnType<typeof setTimeout>, () => void>();
  let nextTimer = 1000000;
  globalThis.setTimeout = ((callback: () => void, delay?: number, ...args: unknown[]) => {
    if (delay !== 500) return originalSetTimeout(callback, delay, ...args);
    const handle = nextTimer++ as unknown as ReturnType<typeof setTimeout>;
    periodic.set(handle, () => callback(...args));
    return handle;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
    if (!periodic.delete(handle)) originalClearTimeout(handle);
  }) as typeof clearTimeout;

  let job: Job | null = null;
  let journalCalls = 0;
  let previewStarts = 0;
  let previewFinishes = 0;
  let abortedPreviews = 0;
  let lockOwned = false;
  const events: string[] = [];
  const library: Library = { photos: [], documents: {}, presets: [] };
  const blockedPreviews = deferred(),
    firstCommit = deferred(),
    releasePreviews = deferred();
  const finalJournal = deferred(),
    releaseJournal = deferred(),
    paused = deferred();
  const guards = new Set<EventListenerOrEventListenerObject>();
  const unloadTarget: Pick<EventTarget, "addEventListener" | "removeEventListener"> = {
    addEventListener(type, callback) {
      if (type === "beforeunload" && callback) guards.add(callback);
    },
    removeEventListener(type, callback) {
      if (type === "beforeunload" && callback) guards.delete(callback);
    },
  };
  const session = createDevelopImportSession(
    { scope: "qa-memory-only", libraryId: "periodic-journal" },
    {
      unloadTarget,
      withLock: async (_name, work) => {
        assert.equal(lockOwned, false);
        lockOwned = true;
        try {
          await work();
        } finally {
          lockOwned = false;
          events.push("unlock");
        }
      },
      store: {
        readImportJob: async () => job,
        loadLibrary: async () => library,
        saveImportJob: async (input, revision) => {
          if (++journalCalls === 2) {
            events.push("periodic-quota");
            throw new Error("Periodic import journal quota exceeded");
          }
          if (input.phase === "paused") {
            finalJournal.resolve();
            await releaseJournal.promise;
            events.push("final-paused-journal");
          }
          job = advanceDevelopImportJob(job, input, revision);
          return job;
        },
        addPhotosWithDocuments: async (inputs: Input[]) => {
          const input = inputs[0]!;
          const photo = { ...input, createdAt: 1, sourceAvailable: true };
          const document = createDevelopDocument(input.id);
          library.photos.push(photo);
          library.documents[photo.id] = document;
          events.push(`photo:${photo.name}`);
          firstCommit.resolve();
          return { photos: [photo], documents: { [photo.id]: document } };
        },
      },
      preparePreview: async (file, input, signal) => {
        previewStarts++;
        if (file.name.startsWith("held-")) {
          signal.addEventListener(
            "abort",
            () => {
              abortedPreviews++;
            },
            { once: true },
          );
          if (previewStarts === 3) blockedPreviews.resolve();
          // Deliberately uncancelable: a late worker must drain but cannot be saved.
          await releasePreviews.promise;
        }
        previewFinishes++;
        return { ...input, width: 2, height: 2, previewBlob: new Blob(["preview"]) };
      },
    },
  );
  const unsubscribe = session.subscribe(() => {
    if (session.getSnapshot().phase === "paused") paused.resolve();
  });
  const source = (name: string) => new File([name], name, { type: "image/jpeg" });
  let task: Promise<void> | undefined;
  try {
    task = session.startFiles([source("saved.jpg"), source("held-a.jpg"), source("held-b.jpg")]);
    await Promise.all([blockedPreviews.promise, firstCommit.promise]);
    assert.equal(periodic.size, 1, "one coalesced periodic journal write is scheduled");
    const [timer, flush] = [...periodic][0]!;
    periodic.delete(timer);
    flush();
    await paused.promise;
    const committedId = library.photos[0]!.id;
    assert.equal(session.getSnapshot().saved, 1);
    assert.match(session.getSnapshot().error!, /Periodic import journal quota/);
    assert.equal(session.isRunning(), true, "paused status must not release owned workers");
    assert.equal(lockOwned, true);
    assert.equal(guards.size, 1);
    assert.equal(abortedPreviews, 2);
    assert.equal(previewFinishes, 1);
    assert.throws(() => session.startFiles([source("too-early.jpg")]), /already running/);
    assert.deepEqual(
      library.photos.map((photo) => photo.name),
      ["saved.jpg"],
    );

    releasePreviews.resolve();
    await finalJournal.promise;
    assert.equal(previewFinishes, 3);
    assert.equal(previewStarts, 3);
    assert.equal(session.getSnapshot().previewReady, 1, "late aborted previews must not publish");
    assert.equal(session.isRunning(), true, "final journal acknowledgment still owns the job");
    assert.equal(lockOwned, true);
    assert.equal(guards.size, 1);
    assert.deepEqual(
      library.photos.map((photo) => photo.id),
      [committedId],
    );
    releaseJournal.resolve();
    await task;
    assert.equal(session.getSnapshot().phase, "paused");
    assert.equal(session.getSnapshot().saved, 1);
    assert.equal(session.isRunning(), false);
    assert.equal(lockOwned, false);
    assert.equal(guards.size, 0);
    assert.ok(job);
    assert.equal(job.phase, "paused");
    assert.equal(job.rows[0]!.photoId, committedId);
    assert.equal(job.rows[0]!.status, "saved");
    assert.ok(
      job.rows.slice(1).every((row) => row.photoId === undefined && row.status !== "saved"),
    );
    assert.deepEqual(events.slice(-2), ["final-paused-journal", "unlock"]);

    await session.startFiles([source("retry.jpg")]);
    assert.equal(session.getSnapshot().phase, "complete");
    assert.deepEqual(
      library.photos.map((photo) => photo.name),
      ["saved.jpg", "retry.jpg"],
    );
    assert.equal(library.photos[0]!.id, committedId);
    assert.equal(guards.size, 0);
    assert.equal(periodic.size, 0);
    console.log("IMPORT_PERIODIC_JOURNAL_OK");
  } finally {
    session.cancel();
    releasePreviews.resolve();
    releaseJournal.resolve();
    await task;
    unsubscribe();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
}
