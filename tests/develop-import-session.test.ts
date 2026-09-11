import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createDevelopImportSession } from "../src/lib/develop/import-session";
import {
  advanceDevelopImportJob,
  createDevelopDocument,
  type DevelopImportJob,
  type DevelopLibrary,
  type DevelopPhotoInput,
} from "../src/lib/develop/store";

const file = (name: string, path?: string) => {
  const value = new File([path ?? name], name, {
    type: /\.xmp$/.test(name) ? "text/xml" : "image/jpeg",
  });
  if (path) Object.defineProperty(value, "webkitRelativePath", { value: path });
  return value;
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
function fixture() {
  let job: DevelopImportJob | null = null;
  const library: DevelopLibrary = { photos: [], documents: {}, presets: [] };
  const events: string[] = [];
  const store = {
    loadLibrary: async () => library,
    readImportJob: async () => job,
    saveImportJob: async (input: DevelopImportJob, revision: number) => {
      job = advanceDevelopImportJob(job, input, revision);
      events.push(`job:${job.phase}`);
      return job;
    },
    addPhotosWithDocuments: async (input: DevelopPhotoInput) => {
      const photo = { ...input, createdAt: 1, sourceAvailable: true };
      const document = createDevelopDocument(input.id);
      library.photos.push(photo);
      library.documents[input.id] = document;
      events.push(`photo:${input.name}`);
      return { photos: [photo], documents: { [input.id]: document } };
    },
  };
  const preparePreview = async (_file: File, input: DevelopPhotoInput) => ({
    ...input,
    width: 12,
    height: 8,
    previewBlob: new Blob(["preview"], { type: "image/jpeg" }),
  });
  const withLock = async (_name: string, work: () => Promise<void>) => {
    events.push("lock");
    try {
      await work();
    } finally {
      events.push("unlock");
    }
  };
  const dependencies = {
    store: {
      ...store,
      addPhotosWithDocuments: (inputs: DevelopPhotoInput[]) =>
        store.addPhotosWithDocuments(inputs[0]!),
    },
    preparePreview,
    withLock,
  };
  return { dependencies, library, events, readJob: () => job };
}
const owner = { scope: "qa-import-account", libraryId: "shoot:qa-import-session" };
async function withoutWebLocks(work: () => Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  try {
    await work();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
}

describe("route-independent Develop import", () => {
  test("1000 metadata rows appear before decoding and remain separate from Saved", async () => {
    const f = fixture(),
      gate = deferred<void>();
    const session = createDevelopImportSession(owner, {
      ...f.dependencies,
      preparePreview: async (source, input) => {
        await gate.promise;
        return f.dependencies.preparePreview(source, input);
      },
    });
    const task = session.startFiles(Array.from({ length: 1000 }, (_, i) => file(`${i}.jpg`)));
    await new Promise((done) => setTimeout(done, 85));
    const state = session.getSnapshot();
    expect(state.found).toBe(1000);
    expect(state.saved).toBe(0);
    expect(state.previewReady).toBe(0);
    expect(new Set(state.rows.map((row) => row.id)).size).toBe(1000);
    expect(state.rows.every((row) => row.photoId === undefined)).toBe(true);
    session.cancel();
    gate.resolve();
    await task;
    expect(f.library.photos).toHaveLength(0);
    expect(session.getSnapshot().phase).toBe("cancelled");
  });
  test("a view unsubscribe does not stop saves and final report commits before lock release", async () => {
    const f = fixture(),
      session = createDevelopImportSession(owner, f.dependencies);
    const unsubscribe = session.subscribe(() => {});
    const task = session.startFiles([file("first.jpg"), file("second.jpg")]);
    unsubscribe();
    await task;
    expect(f.library.photos).toHaveLength(2);
    expect(session.getSnapshot().saved).toBe(2);
    expect(session.getSnapshot().analyzed).toBe(0);
    expect(f.events.at(-2)).toBe("job:complete");
    expect(f.events.at(-1)).toBe("unlock");
    expect(f.readJob()?.rows.map((row) => row.photoId)).toEqual(
      f.library.photos.map((photo) => photo.id),
    );
  });
  test("drop captures handles synchronously and late filename collision never steals a sidecar", async () => {
    const f = fixture(),
      discovery = deferred<{
        files: File[];
        warnings: [];
        directories: number;
        duplicates: number;
      }>();
    const first = file("photo.jpg", "card/photo.jpg"),
      second = file("photo.png", "card/photo.png"),
      xmp = file("photo.xmp", "card/photo.xmp");
    let captured = false;
    const session = createDevelopImportSession(owner, {
      ...f.dependencies,
      collect: (_transfer, options) => {
        captured = true;
        options?.onFiles?.([first]);
        return discovery.promise;
      },
    });
    const task = session.startDrop({} as DataTransfer);
    expect(captured).toBe(true);
    discovery.resolve({ files: [first, second, xmp], warnings: [], directories: 1, duplicates: 0 });
    await task;
    expect(f.library.photos).toHaveLength(2);
    expect(f.library.photos.every((photo) => !photo.sidecar)).toBe(true);
    expect(
      session.getSnapshot().failures.some((failure) => failure.message.includes("unambiguous")),
    ).toBe(true);
  });
  test("exact directory sidecars are retained verbatim without changing the native recipe", async () => {
    const f = fixture(),
      session = createDevelopImportSession(owner, f.dependencies);
    const source = file("photo.jpg", "card-a/photo.jpg");
    const xmp = file("photo.xmp", "card-a/photo.xmp"),
      unrelated = file("photo.xmp", "card-b/photo.xmp");
    await session.startFiles([source, xmp, unrelated]);
    expect(f.library.photos[0]!.sidecar?.text).toBe(await xmp.text());
    expect(f.library.photos[0]!.sidecar?.path).toBe("card-a/photo.xmp");
    expect(f.library.documents[f.library.photos[0]!.id]!.history).toHaveLength(1);
  });
  test("storage failure pauses with partial receipts instead of reporting the whole batch saved", async () => {
    const f = fixture();
    let calls = 0;
    const session = createDevelopImportSession(owner, {
      ...f.dependencies,
      store: {
        ...f.dependencies.store,
        addPhotosWithDocuments: async (inputs) => {
          if (++calls === 2) throw new Error("Quota reached");
          return f.dependencies.store.addPhotosWithDocuments(inputs);
        },
      },
    });
    await session.startFiles([file("first.jpg"), file("second.jpg"), file("third.jpg")]);
    expect(f.library.photos).toHaveLength(1);
    expect(session.getSnapshot().saved).toBe(1);
    expect(session.getSnapshot().phase).toBe("paused");
    expect(session.getSnapshot().error).toContain("Quota reached");
    await session.startFiles([file("remaining.jpg")]);
    expect(session.getSnapshot().phase).toBe("complete");
    expect(f.library.photos).toHaveLength(2);
  });
  test("competing-tab lock rejection does not overwrite the other import", async () => {
    const f = fixture();
    const session = createDevelopImportSession(owner, {
      ...f.dependencies,
      withLock: async () => {
        throw new Error("Importing in another tab");
      },
    });
    await session.startFiles([file("photo.jpg")]);
    expect(f.readJob()).toBeNull();
    expect(f.library.photos).toHaveLength(0);
    expect(session.getSnapshot().phase).toBe("paused");
  });
  test("an interrupted report restores honestly and a new import preserves previous committed photos", async () => {
    const f = fixture(),
      original = createDevelopImportSession(owner, f.dependencies);
    await original.startFiles([file("saved.jpg")]);
    const restored = createDevelopImportSession(owner, f.dependencies);
    await restored.restore();
    expect(restored.getSnapshot().saved).toBe(1);
    await restored.startFiles([file("saved.jpg"), file("new.jpg")]);
    expect(restored.getSnapshot().duplicates).toBe(1);
    expect(restored.getSnapshot().saved).toBe(1);
    expect(f.library.photos).toHaveLength(2);
  });
  test("without Web Locks a second tab cannot interrupt a live job or import alongside its owner", async () => {
    await withoutWebLocks(async () => {
      const f = fixture(),
        entered = deferred<void>(),
        gate = deferred<void>();
      const { withLock: _lock, ...dependencies } = f.dependencies;
      const original = createDevelopImportSession(owner, {
        ...dependencies,
        preparePreview: async (source, input) => {
          entered.resolve();
          await gate.promise;
          return f.dependencies.preparePreview(source, input);
        },
      });
      const first = original.startFiles([file("owner.jpg")]);
      try {
        await entered.promise;
        const before = structuredClone(f.readJob());
        const contender = createDevelopImportSession(owner, dependencies);
        await contender.startFiles([file("contender.jpg")]);
        expect(f.readJob()).toEqual(before);
        expect(f.library.photos).toHaveLength(0);
        expect(contender.getSnapshot().phase).toBe("paused");
        expect(contender.getSnapshot().error).toContain("Web Locks");
        expect(original.isRunning()).toBe(true);
      } finally {
        gate.resolve();
        await first;
      }
      expect(original.getSnapshot().phase).toBe("complete");
      expect(f.library.photos.map((photo) => photo.name)).toEqual(["owner.jpg"]);
    });
  });
  test("without Web Locks only the fully settled owner may retry its own paused job", async () => {
    await withoutWebLocks(async () => {
      const f = fixture();
      let calls = 0;
      const { withLock: _lock, ...dependencies } = f.dependencies;
      const original = createDevelopImportSession(owner, {
        ...dependencies,
        store: {
          ...dependencies.store,
          addPhotosWithDocuments: async (inputs) => {
            if (++calls === 2) throw new Error("Quota reached");
            return dependencies.store.addPhotosWithDocuments(inputs);
          },
        },
      });
      await original.startFiles([file("saved.jpg"), file("failed.jpg")]);
      expect(original.getSnapshot().phase).toBe("paused");
      const before = structuredClone(f.readJob());
      const foreign = createDevelopImportSession(owner, dependencies);
      await foreign.startFiles([file("foreign.jpg")]);
      expect(f.readJob()).toEqual(before);
      expect(f.library.photos).toHaveLength(1);
      await original.startFiles([file("retry.jpg")]);
      expect(original.getSnapshot().phase).toBe("complete");
      expect(f.library.photos.map((photo) => photo.name)).toEqual(["saved.jpg", "retry.jpg"]);
    });
  });
  test("HMR preserves the actual session owner so account cancellation still reaches live discovery", async () => {
    await withoutWebLocks(async () => {
      const f = fixture(),
        discovery = deferred<{
          files: File[];
          warnings: [];
          directories: number;
          duplicates: number;
        }>();
      let signal: AbortSignal | undefined;
      // Evaluate this real module twice with only imports/hot runtime injected. No shared mocks or database.
      const source = readFileSync(
        new URL("../src/lib/develop/import-session.ts", import.meta.url),
        "utf8",
      );
      const compiled = new Bun.Transpiler({ loader: "ts", target: "browser" })
        .transformSync(source.replace(/import\.meta\.hot/g, "hot"))
        .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "")
        .replace(/^export\s+(?=(?:async\s+)?function|const)/gm, "");
      const load = new Function(
        "hot",
        "createDevelopStore",
        "collectDroppedFiles",
        `${compiled}\nreturn { getDevelopImportSession, cancelDevelopImportsOutsideScope };`,
      );
      const disposers: ((data: Record<string, unknown>) => void)[] = [];
      const data: Record<string, unknown> = {};
      const hot = {
        data,
        dispose(callback: (data: Record<string, unknown>) => void) {
          disposers.push(callback);
        },
      };
      const collect = (_transfer: DataTransfer, options: { signal: AbortSignal }) => {
        signal = options.signal;
        return discovery.promise;
      };
      const first = load(
        hot,
        () => f.dependencies.store,
        collect,
      ) as typeof import("../src/lib/develop/import-session");
      const session = first.getDevelopImportSession(owner);
      const task = session.startDrop({} as DataTransfer);
      try {
        for (const dispose of disposers) dispose(data);
        const second = load(hot, () => f.dependencies.store, collect) as typeof first;
        expect(second.getDevelopImportSession(owner)).toBe(session);
        second.cancelDevelopImportsOutsideScope("different-account");
        expect(signal?.aborted).toBe(true);
      } finally {
        session.cancel();
        discovery.resolve({ files: [], warnings: [], directories: 0, duplicates: 0 });
        await task;
      }
      expect(f.library.photos).toHaveLength(0);
      expect(session.getSnapshot().phase).toBe("cancelled");
    });
  });
  test("cancellation during an atomic photo save still adopts exactly its durable receipt", async () => {
    const f = fixture(),
      entered = deferred<void>(),
      release = deferred<void>();
    const session = createDevelopImportSession(owner, {
      ...f.dependencies,
      store: {
        ...f.dependencies.store,
        addPhotosWithDocuments: async (inputs) => {
          const receipt = await f.dependencies.store.addPhotosWithDocuments(inputs);
          entered.resolve();
          await release.promise;
          return receipt;
        },
      },
    });
    const task = session.startFiles([file("committed.jpg"), file("not-saved.jpg")]);
    try {
      await entered.promise;
      session.cancel();
    } finally {
      release.resolve();
      await task;
    }
    expect(f.library.photos.map((photo) => photo.name)).toEqual(["committed.jpg"]);
    expect(session.getSnapshot().phase).toBe("cancelled");
    expect(session.getSnapshot().saved).toBe(1);
    expect(f.readJob()?.rows.map((row) => row.status)).toEqual(["saved", "cancelled"]);
    expect(f.readJob()?.rows[0]?.photoId).toBe(f.library.photos[0]?.id);
    expect(f.events.at(-2)).toBe("job:cancelled");
    expect(f.events.at(-1)).toBe("unlock");
  });
  test("a failed final journal write is paused, keeps committed photos, and can retry only after draining", async () => {
    await withoutWebLocks(async () => {
      const f = fixture(),
        entered = deferred<void>(),
        release = deferred<void>();
      const { withLock: _lock, ...dependencies } = f.dependencies;
      let failFinal = true;
      const session = createDevelopImportSession(owner, {
        ...dependencies,
        store: {
          ...dependencies.store,
          saveImportJob: async (input, revision) => {
            if (input.phase === "complete" && failFinal) {
              entered.resolve();
              await release.promise;
              failFinal = false;
              throw new Error("Import report could not be saved");
            }
            return dependencies.store.saveImportJob(input, revision);
          },
        },
      });
      const task = session.startFiles([file("preserved.jpg")]);
      try {
        await entered.promise;
        expect(session.isRunning()).toBe(true);
        expect(() => session.startFiles([file("too-early.jpg")])).toThrow("already running");
      } finally {
        release.resolve();
        await task;
      }
      expect(session.getSnapshot().phase).toBe("paused");
      expect(session.getSnapshot().saved).toBe(1);
      expect(session.getSnapshot().error).toContain("report could not be saved");
      expect(f.readJob()?.phase).toBe("discovering");
      expect(f.library.photos.map((photo) => photo.name)).toEqual(["preserved.jpg"]);
      await session.startFiles([file("next.jpg")]);
      expect(session.getSnapshot().phase).toBe("complete");
      expect(f.library.photos.map((photo) => photo.name)).toEqual(["preserved.jpg", "next.jpg"]);
    });
  });
  test("an actual granted Web Lock allows a new owner to recover an abandoned active report", async () => {
    await withoutWebLocks(async () => {
      const f = fixture();
      await f.dependencies.store.saveImportJob(
        {
          version: 1,
          revision: 0,
          id: "abandoned",
          phase: "processing",
          startedAt: 1,
          finishedAt: null,
          rows: [],
          found: 0,
          previewReady: 0,
          analyzed: 0,
          saved: 0,
          failed: 0,
          duplicates: 0,
          error: null,
        },
        0,
      );
      let acquired = false;
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {
          locks: {
            request: async (
              name: string,
              options: { ifAvailable: boolean },
              work: (lock: object) => Promise<void>,
            ) => {
              expect(name).toBe(`foto-import:${JSON.stringify([owner.scope, owner.libraryId])}`);
              expect(options.ifAvailable).toBe(true);
              acquired = true;
              await work({ name });
            },
          },
        },
      });
      const { withLock: _lock, ...dependencies } = f.dependencies;
      const session = createDevelopImportSession(owner, dependencies);
      await session.startFiles([file("recovered.jpg")]);
      expect(acquired).toBe(true);
      expect(f.events).toContain("job:interrupted");
      expect(f.library.photos).toHaveLength(1);
      expect(session.getSnapshot().phase).toBe("complete");
    });
  });
});
