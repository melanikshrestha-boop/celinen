import { describe, expect, test } from "bun:test";
import { createDevelopImportSession } from "../src/lib/develop/import-session";
import { createShootRepository } from "../src/lib/develop/shoot-repository";
import { readDevelopPhotoAnalysis, type DevelopPhotoInput } from "../src/lib/develop/store";
import { developIdbDouble } from "./fixtures/develop-idb-double";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const options = {
    scope: `synthetic-analysis-${crypto.randomUUID()}`,
    libraryId: "reserved-shoot",
    factory: developIdbDouble().factory,
  };
  const repository = createShootRepository(options);
  const preparePreview = async (
    _file: File,
    input: DevelopPhotoInput,
  ): Promise<DevelopPhotoInput> => ({
    ...input,
    width: 12,
    height: 8,
    previewBlob: new Blob(["synthetic preview"]),
    previewOrigin: "embedded",
    analysis: {
      version: 1,
      kind: "mechanical",
      namespace: repository.namespace,
      photoId: input.id,
      sourceDigest: input.sourceDigest,
      engine: { name: "native-cpp", version: "lenslabs-cpp-0.1" },
      representation: "embedded-preview",
      width: 12,
      height: 8,
      analysis: {
        sharpness: 150,
        brightness: 120,
        clippedHighlights: 12.5,
        clippedShadows: 25,
        hash: "01".repeat(32),
        tone: {
          black: 0,
          white: 255,
          median: 120,
          rMean: 120,
          gMean: 120,
          bMean: 120,
          satMean: 0.2,
        },
      },
    },
  });
  const dependencies = {
    store: repository.store,
    preparePreview,
    unloadTarget: null,
    withLock: async (_name: string, work: () => Promise<void>) => work(),
  };
  return { options, repository, dependencies };
}

describe("import counts only durable source-bound mechanical analysis", () => {
  test("two RAW preparations remain bounded while an independent JPEG can prepare", async () => {
    const f = fixture(),
      release = deferred<void>(),
      started = deferred<void>();
    let rawActive = 0,
      rawPeak = 0;
    const prepared: string[] = [];
    const files = ["first.ARW", "second.ARW", "third.ARW", "independent.jpg"].map(
      (name) => new File([name], name),
    );
    const session = createDevelopImportSession(f.options, {
      ...f.dependencies,
      preparePreview: async (file, input) => {
        if (input.isRaw) {
          rawActive++;
          rawPeak = Math.max(rawPeak, rawActive);
          await release.promise;
          rawActive--;
        }
        prepared.push(file.name);
        if (!input.isRaw) started.resolve();
        return f.dependencies.preparePreview(file, input);
      },
    });
    try {
      const task = session.startFiles(files);
      await started.promise;
      expect(rawActive).toBe(2);
      expect(prepared).toEqual(["independent.jpg"]);
      expect(session.getSnapshot().saved).toBe(0);
      release.resolve();
      await task;
      expect(rawPeak).toBe(2);
      expect(session.getSnapshot()).toMatchObject({ saved: 4, analyzed: 4, phase: "complete" });
      expect((await f.repository.read()).photos.map((photo) => photo.name)).toEqual(
        files.map((file) => file.name),
      );
    } finally {
      release.resolve();
      f.repository.close();
    }
  });

  test("analysis is not counted before save acknowledgement, but late committed cancellation stays counted", async () => {
    const f = fixture(),
      saved = deferred<void>(),
      release = deferred<void>();
    const file = new File(["immutable synthetic original"], "reserved.ARW");
    let clock = 0;
    const session = createDevelopImportSession(f.options, {
      ...f.dependencies,
      now: () => clock,
      store: {
        ...f.repository.store,
        addPhotosWithDocuments: async (inputs) => {
          const receipt = await f.repository.store.addPhotosWithDocuments(inputs);
          saved.resolve();
          await release.promise;
          return receipt;
        },
      },
    });
    try {
      const task = session.startFiles([file]);
      await saved.promise;
      expect(session.getSnapshot().analyzed).toBe(0);
      expect(session.getSnapshot().saved).toBe(0);
      expect(session.getSnapshot().timing.analyzedMs).toBeNull();
      session.cancel();
      clock = 200;
      release.resolve();
      await task;
      expect(session.getSnapshot()).toMatchObject({ analyzed: 1, saved: 1, phase: "cancelled" });
      expect(session.getSnapshot().timing.analyzedMs).toBe(200);
      expect(session.getSnapshot().timing.savedMs).toBeNull();
      const library = await f.repository.read(),
        photo = library.photos[0]!;
      expect(await photo.sourceBlob!.text()).toBe(await file.text());
      expect(
        readDevelopPhotoAnalysis(photo, library.documents[photo.id]!, f.repository.namespace),
      ).not.toBeNull();
      expect((await f.repository.store.readImportJob())?.analyzed).toBe(1);
    } finally {
      release.resolve();
      f.repository.close();
    }
  });

  test("failed persistence never turns an available measurement into Analyzed or Saved", async () => {
    const f = fixture();
    const session = createDevelopImportSession(f.options, {
      ...f.dependencies,
      store: {
        ...f.repository.store,
        addPhotosWithDocuments: async () => {
          throw new Error("Synthetic quota failure");
        },
      },
    });
    try {
      await session.startFiles([new File(["synthetic original"], "reserved.ARW")]);
      expect(session.getSnapshot()).toMatchObject({ analyzed: 0, saved: 0, phase: "paused" });
      expect(session.getSnapshot().timing.analyzedMs).toBeNull();
      expect((await f.repository.read()).photos).toHaveLength(0);
      expect((await f.repository.store.readImportJob())?.analyzed).toBe(0);
    } finally {
      f.repository.close();
    }
  });

  test("preview-only import never invents an analysis acknowledgement time", async () => {
    const f = fixture();
    const session = createDevelopImportSession(f.options, {
      ...f.dependencies,
      preparePreview: async (file, input) => {
        const { analysis: _analysis, ...preview } = await f.dependencies.preparePreview(
          file,
          input,
        );
        return preview;
      },
    });
    try {
      await session.startFiles([new File(["synthetic fallback"], "fallback.ARW")]);
      expect(session.getSnapshot()).toMatchObject({ analyzed: 0, saved: 1 });
      expect(session.getSnapshot().timing.analyzedMs).toBeNull();
    } finally {
      f.repository.close();
    }
  });
});
