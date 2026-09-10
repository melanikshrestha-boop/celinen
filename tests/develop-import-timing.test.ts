import { expect, test } from "bun:test";
import { createDevelopImportSession } from "../src/lib/develop/import-session";
import { runDevelopImport } from "../src/lib/develop/import";
import {
  advanceDevelopImportJob,
  createDevelopDocument,
  type DevelopImportJob,
  type DevelopPhotoInput,
} from "../src/lib/develop/store";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const tick = () => new Promise((done) => setTimeout(done, 90));
const source = () => new File(["isolated timing fixture"], "timing.jpg", { type: "image/jpeg" });
const owner = { scope: "qa-timing-only", libraryId: "shoot:timing" };
function fixture() {
  let clock = 0;
  let job: DevelopImportJob | null = null;
  return {
    now: () => clock,
    at(value: number) {
      clock = value;
    },
    withLock: async (_name: string, work: () => Promise<void>) => work(),
    preparePreview: async (_file: File, input: DevelopPhotoInput) => ({
      ...input,
      width: 2,
      height: 2,
      previewBlob: new Blob(["preview"], { type: "image/jpeg" }),
    }),
    store: {
      readImportJob: async () => job,
      loadLibrary: async () => ({ photos: [], documents: {}, presets: [] }),
      saveImportJob: async (incoming: DevelopImportJob, revision: number) => {
        job = advanceDevelopImportJob(job, incoming, revision);
        return job;
      },
      addPhotosWithDocuments: async (inputs: DevelopPhotoInput[]) => {
        const photo = { ...inputs[0]!, createdAt: 1 };
        return { photos: [photo], documents: { [photo.id]: createDevelopDocument(photo.id) } };
      },
    },
  };
}

test("drop registration timing excludes lock and journal admission delays", async () => {
  const f = fixture(),
    admission = deferred(),
    discovery = deferred<{
      files: File[];
      warnings: [];
      directories: number;
      duplicates: number;
    }>();
  const file = source();
  const session = createDevelopImportSession(owner, {
    ...f,
    store: {
      ...f.store,
      readImportJob: async () => {
        await admission.promise;
        return null;
      },
    },
    collect: (_transfer, options) => {
      options?.onFiles?.([file]);
      return discovery.promise;
    },
  });
  const task = session.startDrop({} as DataTransfer);
  try {
    f.at(25);
    discovery.resolve({ files: [file], warnings: [], directories: 1, duplicates: 0 });
    await tick();
    expect(session.getSnapshot().timing.registeredMs).toBe(25);
    expect(session.getSnapshot().saved).toBe(0);
    f.at(1000);
  } finally {
    admission.resolve();
    await task;
  }
  expect(session.getSnapshot().timing.registeredMs).toBe(25);
});

test("preview completion precedes slow photo persistence and durable completion waits for final journal", async () => {
  const f = fixture(),
    photoEntered = deferred(),
    photoRelease = deferred(),
    journalEntered = deferred(),
    journalRelease = deferred();
  const session = createDevelopImportSession(owner, {
    ...f,
    preparePreview: async (file, input) => {
      f.at(100);
      return f.preparePreview(file, input);
    },
    store: {
      ...f.store,
      addPhotosWithDocuments: async (inputs) => {
        photoEntered.resolve();
        await photoRelease.promise;
        return f.store.addPhotosWithDocuments(inputs);
      },
      saveImportJob: async (incoming, revision) => {
        if (incoming.phase === "complete") {
          journalEntered.resolve();
          await journalRelease.promise;
        }
        return f.store.saveImportJob(incoming, revision);
      },
    },
  });
  const task = session.startFiles([source()]);
  try {
    await photoEntered.promise;
    await tick();
    expect(session.getSnapshot().timing.firstPreviewMs).toBe(100);
    expect(session.getSnapshot().timing.previewsMs).toBe(100);
    expect(session.getSnapshot().timing.savedMs).toBeNull();
    f.at(900);
    photoRelease.resolve();
    await journalEntered.promise;
    await tick();
    expect(session.getSnapshot().timing.previewsMs).toBe(100);
    expect(session.getSnapshot().timing.savedMs).toBeNull();
    expect(session.isRunning()).toBe(true);
    f.at(1200);
  } finally {
    photoRelease.resolve();
    journalRelease.resolve();
    await task;
  }
  expect(session.getSnapshot().timing.savedMs).toBe(1200);
  expect(session.getSnapshot().phase).toBe("complete");
});

test("a failed final journal never reports a durable-completion time", async () => {
  const f = fixture();
  const session = createDevelopImportSession(owner, {
    ...f,
    preparePreview: async (file, input) => {
      f.at(100);
      return f.preparePreview(file, input);
    },
    store: {
      ...f.store,
      saveImportJob: async (incoming, revision) => {
        if (incoming.phase === "complete") throw new Error("Quota at final journal");
        return f.store.saveImportJob(incoming, revision);
      },
    },
  });
  await session.startFiles([source()]);
  expect(session.getSnapshot().phase).toBe("paused");
  expect(session.getSnapshot().saved).toBe(1);
  expect(session.getSnapshot().timing.previewsMs).toBe(100);
  expect(session.getSnapshot().timing.savedMs).toBeNull();
});

test("preparation completion counts failed and duplicate sources once without depending on saves", async () => {
  const f = fixture();
  let completed = 0,
    saved = 0;
  const first = source();
  const result = await runDevelopImport([first, new File(["bad"], "broken.jpg"), first], {
    existingIds: [],
    preparationConcurrency: 4,
    preparePreview: async (file, input) => {
      if (file.name === "broken.jpg") throw new Error("Corrupt photo");
      return f.preparePreview(file, input);
    },
    onPreparationComplete: () => {
      completed++;
      throw new Error("Display callback failure");
    },
    save: async (input) => {
      saved++;
      return f.store.addPhotosWithDocuments([input]);
    },
  });
  expect(completed).toBe(1);
  expect(saved).toBe(1);
  expect(result.duplicates).toBe(1);
  expect(result.failures).toHaveLength(1);
  expect(result.fatalError).toBeNull();
});

test("aborted preparation never claims all previews completed", async () => {
  const f = fixture(),
    entered = deferred(),
    release = deferred();
  const controller = new AbortController();
  let completed = 0;
  const task = runDevelopImport([source()], {
    existingIds: [],
    signal: controller.signal,
    preparePreview: async (file, input) => {
      entered.resolve();
      await release.promise;
      return f.preparePreview(file, input);
    },
    onPreparationComplete: () => {
      completed++;
    },
    save: (input) => f.store.addPhotosWithDocuments([input]),
  });
  await entered.promise;
  controller.abort();
  release.resolve();
  const result = await task;
  expect(completed).toBe(0);
  expect(result.stopped).toBe(true);
  expect(result.imported).toHaveLength(0);
});
