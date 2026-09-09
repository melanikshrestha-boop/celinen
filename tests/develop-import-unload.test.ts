import { describe, expect, test } from "bun:test";
import { createDevelopImportSession } from "../src/lib/develop/import-session";
import {
  advanceDevelopImportJob,
  createDevelopDocument,
  type DevelopImportJob,
  type DevelopLibrary,
} from "../src/lib/develop/store";
import type { DroppedFilesResult } from "../src/lib/studio/drop-import";

type Dependencies = Parameters<typeof createDevelopImportSession>[1];
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
class UnloadTarget extends EventTarget {
  readonly guards = new Set<EventListenerOrEventListenerObject>();
  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ) {
    if (type === "beforeunload" && callback) this.guards.add(callback);
    super.addEventListener(type, callback, options);
  }
  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ) {
    if (type === "beforeunload" && callback) this.guards.delete(callback);
    super.removeEventListener(type, callback, options);
  }
  unload() {
    const event = new Event("beforeunload", { cancelable: true });
    // BeforeUnloadEvent is not present in this isolated Bun environment.
    Object.defineProperty(event, "returnValue", { value: undefined, writable: true });
    this.dispatchEvent(event);
    return event;
  }
}
const emptyDiscovery = (): DroppedFilesResult => ({
  files: [],
  warnings: [],
  directories: 0,
  duplicates: 0,
});
function fixture(target = new UnloadTarget()) {
  let job: DevelopImportJob | null = null;
  const library: DevelopLibrary = { photos: [], documents: {}, presets: [] };
  const dependencies: Dependencies = {
    unloadTarget: target,
    store: {
      loadLibrary: async () => library,
      readImportJob: async () => job,
      saveImportJob: async (input, revision) => {
        job = advanceDevelopImportJob(job, input, revision);
        return job;
      },
      addPhotosWithDocuments: async (inputs) => {
        const photos = inputs.map((input) => ({ ...input, createdAt: 1, sourceAvailable: true }));
        const documents = Object.fromEntries(
          inputs.map((input) => [input.id, createDevelopDocument(input.id)]),
        );
        library.photos.push(...photos);
        Object.assign(library.documents, documents);
        return { photos, documents };
      },
    },
    preparePreview: async (_file, input) => ({
      ...input,
      width: 2,
      height: 2,
      previewBlob: new Blob(["preview"]),
    }),
    withLock: async (_name, work) => {
      await work();
    },
  };
  const create = (patch: Partial<Dependencies> = {}) =>
    createDevelopImportSession(
      { scope: "isolated-unload-qa", libraryId: `shoot:${crypto.randomUUID()}` },
      { ...dependencies, ...patch },
    );
  return { target, dependencies, create, library, job: () => job };
}
const source = () => new File(["synthetic source"], "qa.jpg", { type: "image/jpeg" });
function protectedBy(target: UnloadTarget, count = 1) {
  expect(target.guards.size).toBe(count);
  const event = target.unload();
  expect(event.defaultPrevented).toBe(true);
  expect(event.returnValue as unknown).toBe("");
}
function unprotected(target: UnloadTarget) {
  expect(target.guards.size).toBe(0);
  expect(target.unload().defaultPrevented).toBe(false);
}

describe("import lifetime owns beforeunload protection independently of routes", () => {
  test("discovery is protected without subscribers and cancellation retains protection until discovery drains", async () => {
    const f = fixture(),
      discovery = deferred<DroppedFilesResult>();
    const session = f.create({ collect: () => discovery.promise });
    unprotected(f.target);
    const task = session.startDrop({} as DataTransfer);
    try {
      protectedBy(f.target);
      const spa = new Event("popstate", { cancelable: true });
      f.target.dispatchEvent(spa);
      expect(spa.defaultPrevented).toBe(false);
      session.cancel();
      expect(session.isRunning()).toBe(true);
      protectedBy(f.target);
    } finally {
      discovery.resolve(emptyDiscovery());
      await task;
    }
    expect(session.getSnapshot().phase).toBe("cancelled");
    unprotected(f.target);
  });

  test("unsubscribing every view leaves preview processing protected through successful completion", async () => {
    const f = fixture(),
      entered = deferred(),
      release = deferred();
    const session = f.create({
      preparePreview: async (file, input, signal) => {
        entered.resolve();
        await release.promise;
        return f.dependencies.preparePreview!(file, input, signal);
      },
    });
    const unsubscribe = session.subscribe(() => {});
    const task = session.startFiles([source()]);
    unsubscribe();
    try {
      await entered.promise;
      protectedBy(f.target);
    } finally {
      release.resolve();
      await task;
    }
    expect(session.getSnapshot().phase).toBe("complete");
    expect(f.library.photos).toHaveLength(1);
    unprotected(f.target);
  });

  test("cancel during an owned photo save keeps protection through its receipt and final durable report", async () => {
    const f = fixture(),
      saving = deferred(),
      save = deferred(),
      finishing = deferred(),
      finish = deferred();
    const session = f.create({
      store: {
        ...f.dependencies.store,
        addPhotosWithDocuments: async (inputs) => {
          const receipt = await f.dependencies.store.addPhotosWithDocuments(inputs);
          saving.resolve();
          await save.promise;
          return receipt;
        },
        saveImportJob: async (input, revision) => {
          if (input.phase === "cancelled") {
            finishing.resolve();
            await finish.promise;
          }
          return f.dependencies.store.saveImportJob(input, revision);
        },
      },
    });
    const task = session.startFiles([source()]);
    try {
      await saving.promise;
      session.cancel();
      protectedBy(f.target);
      save.resolve();
      await finishing.promise;
      expect(session.isRunning()).toBe(true);
      protectedBy(f.target);
    } finally {
      save.resolve();
      finish.resolve();
      await task;
    }
    expect(session.getSnapshot().saved).toBe(1);
    expect(f.job()?.phase).toBe("cancelled");
    unprotected(f.target);
  });

  test("complete phase does not release protection before final report and lock drain settle", async () => {
    const f = fixture(),
      writing = deferred(),
      write = deferred(),
      draining = deferred(),
      drain = deferred();
    const session = f.create({
      store: {
        ...f.dependencies.store,
        saveImportJob: async (input, revision) => {
          if (input.phase === "complete") {
            writing.resolve();
            await write.promise;
          }
          return f.dependencies.store.saveImportJob(input, revision);
        },
      },
      withLock: async (_name, work) => {
        await work();
        draining.resolve();
        await drain.promise;
      },
    });
    const task = session.startFiles([source()]);
    try {
      await writing.promise;
      protectedBy(f.target);
      write.resolve();
      await draining.promise;
      expect(session.getSnapshot().phase).toBe("complete");
      expect(session.isRunning()).toBe(true);
      protectedBy(f.target);
    } finally {
      write.resolve();
      drain.resolve();
      await task;
    }
    unprotected(f.target);
  });

  test("failed admission retains protection while discovery drains then releases without writing another job", async () => {
    const f = fixture(),
      rejected = deferred(),
      discovery = deferred<DroppedFilesResult>();
    const session = f.create({
      collect: () => discovery.promise,
      withLock: async () => {
        rejected.resolve();
        throw new Error("Other owner holds this shoot");
      },
    });
    const task = session.startDrop({} as DataTransfer);
    try {
      await rejected.promise;
      protectedBy(f.target);
    } finally {
      discovery.resolve(emptyDiscovery());
      await task;
    }
    expect(session.getSnapshot().phase).toBe("paused");
    expect(f.job()).toBeNull();
    unprotected(f.target);
  });

  test("a failed final journal save releases its guard only once settled and a retry owns a fresh guard", async () => {
    const f = fixture(),
      writing = deferred(),
      release = deferred();
    let fail = true;
    const session = f.create({
      store: {
        ...f.dependencies.store,
        saveImportJob: async (input, revision) => {
          if (input.phase === "complete" && fail) {
            writing.resolve();
            await release.promise;
            fail = false;
            throw new Error("Final report unavailable");
          }
          return f.dependencies.store.saveImportJob(input, revision);
        },
      },
    });
    const task = session.startFiles([source()]);
    try {
      await writing.promise;
      protectedBy(f.target);
    } finally {
      release.resolve();
      await task;
    }
    expect(session.getSnapshot().phase).toBe("paused");
    unprotected(f.target);
    const retry = session.startFiles([]);
    try {
      protectedBy(f.target);
    } finally {
      await retry;
    }
    expect(session.getSnapshot().phase).toBe("complete");
    unprotected(f.target);
  });

  test("settling one shoot cannot remove another shoot's independent unload protection", async () => {
    const target = new UnloadTarget(),
      a = fixture(target),
      b = fixture(target);
    const aReady = deferred(),
      bReady = deferred(),
      aRelease = deferred(),
      bRelease = deferred();
    const first = a.create({
      preparePreview: async (file, input, signal) => {
        aReady.resolve();
        await aRelease.promise;
        return a.dependencies.preparePreview!(file, input, signal);
      },
    });
    const second = b.create({
      preparePreview: async (file, input, signal) => {
        bReady.resolve();
        await bRelease.promise;
        return b.dependencies.preparePreview!(file, input, signal);
      },
    });
    const firstTask = first.startFiles([source()]),
      secondTask = second.startFiles([source()]);
    try {
      await Promise.all([aReady.promise, bReady.promise]);
      protectedBy(target, 2);
      first.cancel();
      aRelease.resolve();
      await firstTask;
      protectedBy(target);
      expect(second.isRunning()).toBe(true);
    } finally {
      aRelease.resolve();
      bRelease.resolve();
      await Promise.all([firstTask, secondTask]);
    }
    expect(second.getSnapshot().phase).toBe("complete");
    unprotected(target);
  });
});
