import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  createDevelopImportSession,
  developImportSummary,
} from "../src/lib/develop/import-session";
import {
  createDevelopStore,
  type DevelopImportJob,
  type DevelopStoreChange,
} from "../src/lib/develop/store";
import { developIdbDouble } from "./fixtures/develop-idb-double";

function gate<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));
async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 500; i++) {
    if (await check()) return;
    await tick();
  }
  throw new Error("Synthetic observer did not settle");
}
const options = () => ({ scope: `qa-observer-${crypto.randomUUID()}`, libraryId: "synthetic" });
function job(
  id: string,
  revision: number,
  phase: DevelopImportJob["phase"] = "processing",
): DevelopImportJob {
  return {
    version: 1,
    id,
    revision,
    phase,
    startedAt: 1,
    finishedAt: phase === "complete" ? 2 : null,
    rows: [
      {
        id: `${id}:0`,
        name: "frame.jpg",
        path: "frame.jpg",
        status: phase === "complete" ? "saved" : "found",
        ...(phase === "complete" ? { photoId: "synthetic-photo" } : {}),
      },
    ],
    found: 1,
    saved: phase === "complete" ? 1 : 0,
    analyzed: 0,
    previewReady: 0,
    failed: 0,
    duplicates: 0,
    error: null,
  };
}
function controlled() {
  let value: DevelopImportJob | null = job("job-a", 1);
  let read = async () => structuredClone(value);
  let reads = 0,
    writes = 0;
  const callbacks = new Set<(change: DevelopStoreChange) => void>();
  const store = {
    readImportJob: async () => {
      reads++;
      return read();
    },
    saveImportJob: async (incoming: DevelopImportJob) => {
      writes++;
      return incoming;
    },
    loadLibrary: async () => ({ photos: [], documents: {}, presets: [] }),
    addPhotosWithDocuments: async () => {
      writes++;
      throw new Error("Observer must never save photos");
    },
    subscribe: (callback: (change: DevelopStoreChange) => void) => {
      callbacks.add(callback);
      return () => {
        callbacks.delete(callback);
      };
    },
  };
  const session = createDevelopImportSession(options(), { store, unloadTarget: null });
  return {
    session,
    callbacks,
    reads: () => reads,
    writes: () => writes,
    set(valueNext: DevelopImportJob | null) {
      value = valueNext;
    },
    readWith(next: typeof read) {
      read = next;
    },
    notify() {
      for (const callback of callbacks)
        callback({ kind: "import-job", ids: [value?.id ?? "removed"] });
    },
  };
}

describe("read-only import report observers", () => {
  test("browser observer fixture refuses non-isolated and overlapping runs before any imports", async () => {
    const body = readFileSync(
      new URL("./develop-import-observer.browser.js", import.meta.url),
      "utf8",
    );
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const run = new AsyncFunction("globalThis", "location", "crypto", body);
    await expect(run({}, { origin: "http://127.0.0.1:8085" }, crypto)).rejects.toThrow("isolated");
    await expect(
      run({ fotoIsolatedQaProfile: true }, { origin: "http://127.0.0.1:8085" }, crypto),
    ).rejects.toThrow("role");
    await expect(
      run(
        {
          fotoIsolatedQaProfile: true,
          fotoImportObserverQaRole: "owner",
          fotoImportObserverQa: { state: "owner-waiting" },
        },
        { origin: "http://127.0.0.1:8085" },
        crypto,
      ),
    ).rejects.toThrow("already running");
  });
  test("a second session follows the live owner through completion and its next job without stealing cancellation", async () => {
    const db = developIdbDouble(),
      scope = options(),
      raw = gate();
    const ownerStore = createDevelopStore({ ...scope, factory: db.factory });
    const observerStore = createDevelopStore({ ...scope, factory: db.factory });
    const owner = createDevelopImportSession(scope, {
      store: ownerStore,
      unloadTarget: null,
      withLock: async (_, work) => work(),
      preparePreview: async (_, input) => {
        if (input.isRaw) await raw.promise;
        return { ...input, width: 2, height: 2, previewBlob: new Blob(["preview"]) };
      },
    });
    const observer = createDevelopImportSession(scope, {
      store: observerStore,
      unloadTarget: null,
    });
    const unsubscribe = observer.subscribe(() => {});
    const run = owner.startFiles([
      new File(["pending"], "pending.arw"),
      new File(["saved"], "saved.jpg"),
    ]);
    try {
      await until(async () => (await ownerStore.loadLibrary()).photos.length === 1);
      await observer.restore();
      expect(observer.getSnapshot()).toMatchObject({ phase: "processing", observing: true });
      expect(observer.getSnapshot().error).toBeNull();
      observer.cancel();
      expect(owner.isRunning()).toBe(true);
      raw.resolve();
      await run;
      await until(() => observer.getSnapshot().phase === "complete");
      expect(observer.getSnapshot().saved).toBe(2);
      expect(observer.getSnapshot().timing.savedMs).toBeNull();
      await owner.startFiles([new File(["next job"], "next.jpg")]);
      await until(
        () =>
          observer.getSnapshot().jobId === owner.getSnapshot().jobId &&
          observer.getSnapshot().phase === "complete",
      );
      expect(observer.getSnapshot().saved).toBe(1);
      expect((await observerStore.loadLibrary()).photos).toHaveLength(3);
    } finally {
      raw.resolve();
      await run;
      unsubscribe();
      ownerStore.close();
      observerStore.close();
    }
  });

  test("an old nonterminal journal remains explicitly unverified, not declared interrupted or alive", async () => {
    const f = controlled();
    await f.session.restore();
    expect(f.session.getSnapshot()).toMatchObject({ phase: "processing", observing: true });
    expect(f.session.getSnapshot().error).toBeNull();
    expect(developImportSummary(f.session.getSnapshot())).toContain("Activity is unverified");
    expect(f.session.isRunning()).toBe(false);
    f.session.cancel();
    expect(f.writes()).toBe(0);
    expect(f.session.getSnapshot().phase).toBe("processing");
  });

  test("closing the last subscription fences in-flight reads; reopening reads the current report", async () => {
    const f = controlled();
    const unsubscribe = f.session.subscribe(() => {});
    await f.session.restore();
    const deferred = gate<DevelopImportJob | null>();
    f.readWith(() => deferred.promise);
    f.set(job("job-b", 2, "complete"));
    f.notify();
    await tick();
    const before = f.session.getSnapshot();
    unsubscribe();
    deferred.resolve(job("job-b", 2, "complete"));
    await tick();
    expect(f.session.getSnapshot()).toEqual(before);
    expect(f.callbacks.size).toBe(0);
    f.readWith(async () => job("job-b", 2, "complete"));
    const reopened = f.session.subscribe(() => {});
    try {
      await f.session.restore();
      expect(f.session.getSnapshot()).toMatchObject({ jobId: "job-b", saved: 1, observing: true });
    } finally {
      reopened();
    }
  });

  test("notification bursts coalesce and a newer notification prevents adoption of an older deferred read", async () => {
    const f = controlled(),
      snapshots: string[] = [];
    const unsubscribe = f.session.subscribe(() => {
      snapshots.push(f.session.getSnapshot().jobId ?? "none");
    });
    try {
      await f.session.restore();
      snapshots.length = 0;
      const deferred = gate<DevelopImportJob | null>();
      f.readWith(() => deferred.promise);
      f.notify();
      await tick();
      const beforeReads = f.reads();
      for (let i = 0; i < 100; i++) f.notify();
      f.readWith(async () => job("job-c", 3, "complete"));
      deferred.resolve(job("job-b", 2, "complete"));
      await until(() => f.session.getSnapshot().jobId === "job-c");
      expect(snapshots).not.toContain("job-b");
      expect(f.reads() - beforeReads).toBe(1);
      expect(f.writes()).toBe(0);
    } finally {
      unsubscribe();
    }
  });

  test("status read failures retain copied report state and later notifications recover", async () => {
    const f = controlled();
    const unsubscribe = f.session.subscribe(() => {});
    try {
      f.set(job("job-a", 1, "complete"));
      await f.session.restore();
      const before = f.session.getSnapshot();
      f.readWith(async () => {
        throw new Error("Synthetic status read failed");
      });
      f.notify();
      await until(() => Boolean(f.session.getSnapshot().observationError));
      expect(f.session.getSnapshot()).toMatchObject({
        jobId: before.jobId,
        saved: before.saved,
        rows: before.rows,
      });
      expect(f.session.getSnapshot().observationError).toContain("Synthetic status read failed");
      f.readWith(async () => job("job-b", 2, "complete"));
      f.notify();
      await until(() => f.session.getSnapshot().jobId === "job-b");
      expect(f.session.getSnapshot().observationError).toBeNull();
      expect(f.writes()).toBe(0);
    } finally {
      unsubscribe();
    }
  });

  test("account-scope suspension ignores late reports until explicitly restored", async () => {
    const f = controlled();
    const unsubscribe = f.session.subscribe(() => {});
    try {
      await f.session.restore();
      const deferred = gate<DevelopImportJob | null>();
      f.readWith(() => deferred.promise);
      f.notify();
      await tick();
      f.session.stopObserving();
      deferred.resolve(job("foreign-late", 2, "complete"));
      await tick();
      expect(f.session.getSnapshot().jobId).toBe("job-a");
      expect(f.callbacks.size).toBe(0);
      f.readWith(async () => job("returned", 3, "complete"));
      await f.session.restore();
      expect(f.session.getSnapshot().jobId).toBe("returned");
      expect(f.writes()).toBe(0);
    } finally {
      unsubscribe();
    }
  });

  test("a stale lower revision cannot replace a newer job or mutate copied report rows", async () => {
    const f = controlled();
    const unsubscribe = f.session.subscribe(() => {});
    try {
      const newest = job("job-c", 3, "complete");
      f.readWith(async () => newest);
      await f.session.restore();
      newest.rows[0]!.name = "mutated callback input";
      expect(f.session.getSnapshot().rows[0]!.name).toBe("frame.jpg");
      f.readWith(async () => job("stale", 2));
      f.notify();
      await tick();
      expect(f.session.getSnapshot()).toMatchObject({
        jobId: "job-c",
        phase: "complete",
        saved: 1,
      });
    } finally {
      unsubscribe();
    }
  });

  test("starting a local job fences an earlier deferred observation", async () => {
    const f = controlled(),
      deferred = gate<DevelopImportJob | null>();
    let first = true;
    f.readWith(async () => {
      if (first) {
        first = false;
        return deferred.promise;
      }
      return null;
    });
    const unsubscribe = f.session.subscribe(() => {});
    try {
      await tick();
      await f.session.startFiles([]);
      const local = f.session.getSnapshot();
      expect(local).toMatchObject({ phase: "complete", observing: false });
      deferred.resolve(job("stale-observer", 99));
      await tick();
      expect(f.session.getSnapshot()).toEqual(local);
      expect(local.timing.savedMs).not.toBeNull();
    } finally {
      deferred.resolve(null);
      unsubscribe();
    }
  });
});
