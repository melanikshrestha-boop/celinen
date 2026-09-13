import { describe, expect, test } from "bun:test";
import { createDevelopImportSession } from "../src/lib/develop/import-session";
import { createCullShootView } from "../src/lib/develop/cull-view";
import { createShootRepository } from "../src/lib/develop/shoot-repository";
import { collectDroppedFiles } from "../src/lib/studio/drop-import";
import {
  developPhotoFromFile,
  pushHistory,
  type DevelopImportJob,
  type DevelopPhotoInput,
  type DevelopStoreChange,
} from "../src/lib/develop/store";
import { developIdbDouble } from "./fixtures/develop-idb-double";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}
const preview = (input: DevelopPhotoInput) => ({
  ...input,
  width: 12,
  height: 8,
  previewBlob: new Blob([`preview-${input.name}`]),
});
function dropEntry(file: File, path: string, delay = 0, fail = false): FileSystemEntry {
  return {
    name: file.name,
    fullPath: `/${path}`,
    isFile: true,
    isDirectory: false,
    file: (success: (file: File) => void, failure: (error: Error) => void) => {
      setTimeout(
        () => (fail ? failure(new Error("Synthetic unreadable entry")) : success(file)),
        delay,
      );
    },
  } as unknown as FileSystemFileEntry;
}
function dropTransfer(entries: FileSystemEntry[]): DataTransfer {
  return {
    files: [],
    items: entries.map((entry) => ({
      kind: "file",
      webkitGetAsEntry: () => entry,
      getAsFile: () => null,
    })),
  } as unknown as DataTransfer;
}
function fixture() {
  const db = developIdbDouble();
  const options = { scope: `ordered-${crypto.randomUUID()}`, libraryId: "synthetic-shoot" };
  const repository = createShootRepository({ ...options, factory: db.factory });
  return { db, options, repository, store: repository.store };
}
function job(files: File[], id = crypto.randomUUID()): DevelopImportJob {
  return {
    version: 1,
    revision: 0,
    id,
    phase: "processing",
    startedAt: 1,
    finishedAt: null,
    rows: files.map((file, ordinal) => ({
      id: `${id}:${ordinal}`,
      name: file.name,
      path: file.name,
      status: "found",
    })),
    found: files.length,
    previewReady: 0,
    analyzed: 0,
    saved: 0,
    failed: 0,
    duplicates: 0,
    error: null,
  };
}
async function ordered(
  file: File,
  namespace: string,
  jobId: string,
  ordinal: number,
  before?: { photoId: string; ordinal: number },
): Promise<DevelopPhotoInput> {
  const input = preview(await developPhotoFromFile(file));
  return {
    ...input,
    importOrder: {
      version: 1,
      namespace,
      jobId,
      ordinal,
      photoId: input.id,
      sourceDigest: input.sourceDigest!,
    },
    ...(before ? { importBefore: before } : {}),
  };
}

describe("durable import order with the real store and isolated transaction double", () => {
  test("one ready commit reads only its compact admission and row, not the entire import journal", async () => {
    const f = fixture();
    const files = Array.from({ length: 1000 }, (_, i) => new File([`${i}`], `${i}.jpg`));
    try {
      const admitted = await f.store.saveImportJob(job(files), 0);
      const input = await ordered(files[999]!, f.repository.namespace, admitted.id, 999);
      f.db.log.length = 0;
      await f.store.addPhotosWithDocuments([input]);
      expect(f.db.log).not.toContain(`importJobs:get:${f.repository.namespace}`);
      expect(f.db.log.filter((event) => event.startsWith("importJobs:get:"))).toHaveLength(3);
    } finally {
      f.repository.close();
    }
  });

  test("admission index is atomic, updates with journal status, and preserves old journal resumability", async () => {
    const f = fixture(),
      files = [new File(["original"], "first.jpg")];
    try {
      const legacy = { ...job(files), revision: 4 };
      // Synthetic pre-index database: the existing journal format stays valid.
      f.db.rows.importJobs.set(f.repository.namespace, {
        key: f.repository.namespace,
        value: legacy,
      });
      expect(await f.store.readImportJob()).toEqual(legacy);
      f.db.faults.complete = true;
      await expect(f.store.saveImportJob(legacy, legacy.revision)).rejects.toThrow();
      f.db.faults.complete = false;
      expect(f.db.rows.importJobs.size).toBe(1);
      expect(await f.store.readImportJob()).toEqual(legacy);
      const indexed = await f.store.saveImportJob(legacy, legacy.revision);
      expect(indexed).toEqual(legacy); // Indexing is not permission to rewrite the journal.
      const input = await ordered(files[0]!, f.repository.namespace, indexed.id, 0);
      const failed = await f.store.saveImportJob(
        {
          ...indexed,
          failed: 1,
          rows: [{ ...indexed.rows[0]!, status: "failed" }],
        },
        indexed.revision,
      );
      await expect(f.store.addPhotosWithDocuments([input])).rejects.toThrow();
      expect((await f.store.loadLibrary()).photos).toHaveLength(0);
      const ended = await f.store.saveImportJob(
        { ...failed, phase: "interrupted", finishedAt: 2 },
        failed.revision,
      );
      const resumed = await f.store.saveImportJob(
        { ...job(files), revision: ended.revision },
        ended.revision,
      );
      await expect(f.store.addPhotosWithDocuments([input])).rejects.toThrow();
      const result = await f.store.addPhotosWithDocuments([
        await ordered(files[0]!, f.repository.namespace, resumed.id, 0),
      ]);
      expect(result.ordering!.inserted).toBe(true);
      expect(await result.photos[0]!.sourceBlob!.text()).toBe("original");
    } finally {
      f.repository.close();
    }
  });
  test("ready JPEGs appear before slow RAW, then Cull projects exact manifest order without losing a pick", async () => {
    const f = fixture(),
      raw = gate();
    const files = [
      new File(["slow raw"], "first.arw"),
      ...Array.from({ length: 6 }, (_, i) => new File([`original-${i}`], `${i}.jpg`)),
    ];
    const view = createCullShootView(f.repository);
    await view.read();
    const changes: DevelopStoreChange[] = [];
    const unsubscribe = f.repository.subscribe((change) => {
      if (change.kind === "photos") changes.push(change);
    });
    let clock = 7;
    const session = createDevelopImportSession(f.options, {
      store: f.store,
      now: () => clock,
      unloadTarget: null,
      withLock: async (_, work) => work(),
      preparePreview: async (_, input) => {
        if (input.isRaw) await raw.promise;
        return preview(input);
      },
    });
    const run = session.startFiles(files);
    try {
      for (let i = 0; i < 200 && changes.length < 6; i++) await tick();
      expect(changes).toHaveLength(6);
      const first = await view.read(undefined, () => true, changes.splice(0));
      expect(first.shots.map((shot) => shot.name)).toEqual(files.slice(1).map((file) => file.name));
      const picked = first.shots.map((shot, i) =>
        i === 2 ? { ...shot, verdict: "keep" as const } : shot,
      );
      await view.save(picked, picked[2]!.id, "keepers");
      const before = await f.repository.read();
      clock = 37;
      raw.release();
      await run;
      const final = await view.read(undefined, () => true, changes.splice(0));
      expect(final.shots.map((shot) => shot.name)).toEqual(files.map((file) => file.name));
      expect(final.selectedId).toBe(picked[2]!.id);
      expect(final.filter).toBe("keepers");
      expect(final.shots.find((shot) => shot.id === picked[2]!.id)!.verdict).toBe("keep");
      const persisted = await f.repository.read();
      expect(persisted.manifest.photoIds).toEqual(persisted.photos.map((photo) => photo.id));
      for (const photo of persisted.photos) {
        expect(await photo.sourceBlob!.text()).toBe(
          await files.find((file) => file.name === photo.name)!.text(),
        );
        expect(photo).not.toHaveProperty("importOrder");
        expect(photo).not.toHaveProperty("importBefore");
        if (before.documents[photo.id])
          expect(persisted.documents[photo.id]).toEqual(before.documents[photo.id]);
      }
      expect(session.getSnapshot()).toMatchObject({ phase: "complete", saved: 7, found: 7 });
      expect(session.getSnapshot().timing.registeredMs).toBe(0);
      expect(session.getSnapshot().timing.savedMs).toBe(30);
      expect((await f.store.readImportJob())!.rows.every((row) => row.status === "saved")).toBe(
        true,
      );
    } finally {
      raw.release();
      await run;
      unsubscribe();
      f.repository.close();
    }
  });

  test("source/ordinal binding and anchor validation are atomic and reject stale owners", async () => {
    const f = fixture();
    const files = [0, 1, 2].map((n) => new File([`source-${n}`], "same.jpg"));
    const admitted = await f.store.saveImportJob(job(files), 0);
    try {
      const last = await ordered(files[2]!, f.repository.namespace, admitted.id, 2);
      await f.store.addPhotosWithDocuments([last]);
      const first = await ordered(files[0]!, f.repository.namespace, admitted.id, 0, {
        photoId: last.id,
        ordinal: 2,
      });
      await f.store.addPhotosWithDocuments([first]);
      const before = await f.repository.read();
      expect(before.manifest.photoIds).toEqual([first.id, last.id]);
      const impostor = await ordered(
        new File(["different bytes"], "same.jpg"),
        f.repository.namespace,
        admitted.id,
        0,
      );
      await expect(f.store.addPhotosWithDocuments([impostor])).rejects.toThrow();
      const middle = await ordered(files[1]!, f.repository.namespace, admitted.id, 1, {
        photoId: last.id,
        ordinal: 2,
      });
      for (const invalid of [
        { ...middle, importOrder: { ...middle.importOrder!, namespace: "foreign" } },
        { ...middle, importOrder: { ...middle.importOrder!, sourceDigest: first.sourceDigest! } },
        { ...middle, importBefore: { photoId: first.id, ordinal: 2 } },
        { ...middle, sourceBlob: null },
        { ...middle, previewBlob: null },
      ])
        await expect(f.store.addPhotosWithDocuments([invalid])).rejects.toThrow();
      expect(await f.repository.read()).toEqual(before);
      const ended = await f.store.saveImportJob(
        { ...admitted, phase: "interrupted", finishedAt: 2 },
        admitted.revision,
      );
      const nextOwner = await f.store.saveImportJob(
        { ...job(files), revision: ended.revision },
        ended.revision,
      );
      // An old owner's delayed periodic journal cannot reinstall its admission.
      await expect(
        f.store.saveImportJob({ ...admitted, previewReady: 1 }, admitted.revision),
      ).rejects.toThrow();
      expect(await f.store.readImportJob()).toEqual(nextOwner);
      await expect(f.store.addPhotosWithDocuments([middle])).rejects.toThrow();
      expect(await f.repository.read()).toEqual(before);
    } finally {
      f.repository.close();
    }
  });

  test("a failed transaction retains no photo, document, manifest, or ordinal claim", async () => {
    const f = fixture(),
      file = new File(["original"], "quota.jpg");
    const admitted = await f.store.saveImportJob(job([file]), 0);
    const input = await ordered(file, f.repository.namespace, admitted.id, 0);
    const rowsBefore = structuredClone([...f.db.rows.importJobs]);
    try {
      f.db.faults.complete = true;
      await expect(f.store.addPhotosWithDocuments([input])).rejects.toThrow();
      f.db.faults.complete = false;
      expect([...f.db.rows.importJobs]).toEqual(rowsBefore);
      expect(f.db.rows.photos.size).toBe(0);
      expect(f.db.rows.documents.size).toBe(0);
      expect(f.db.rows.manifests.size).toBe(0);
      const retried = await f.store.addPhotosWithDocuments([input]);
      expect(retried.ordering).toEqual({ order: input.importOrder, inserted: true });
      expect(await retried.photos[0]!.sourceBlob!.text()).toBe("original");
      const copy = await f.store.createVirtualCopy(input.id, retried.documents[input.id]!.revision);
      expect(copy.photo.sourceDigest).toBe(input.sourceDigest);
      expect(copy.photo).not.toHaveProperty("importOrder");
    } finally {
      f.repository.close();
    }
  });

  test("enriching an existing missing source retains its history/order and cannot anchor new imports", async () => {
    const f = fixture();
    const oldFile = new File(["legacy-original"], "legacy.jpg"),
      newFile = new File(["new-original"], "new.jpg");
    const old = preview(await developPhotoFromFile(oldFile));
    await f.store.addPhotosWithDocuments([{ ...old, sourceBlob: null }]);
    const initial = (await f.store.readPhoto(old.id))!;
    const edited = pushHistory(
      initial.document,
      { ...initial.document.history[0]!.settings, exposure: 0.7 },
      "Saved treatment",
    );
    edited.metadata.flag = "pick";
    await f.store.saveDocument(edited, initial.document.revision);
    const saved = (await f.store.readPhoto(old.id))!;
    const admitted = await f.store.saveImportJob(job([newFile, oldFile]), 0);
    try {
      const restored = await ordered(oldFile, f.repository.namespace, admitted.id, 1);
      const receipt = await f.store.addPhotosWithDocuments([restored]);
      expect(receipt.ordering!.inserted).toBe(false);
      expect(receipt.documents[old.id]).toEqual(saved.document);
      const incoming = await ordered(newFile, f.repository.namespace, admitted.id, 0, {
        photoId: old.id,
        ordinal: 1,
      });
      await expect(f.store.addPhotosWithDocuments([incoming])).rejects.toThrow();
      delete incoming.importBefore;
      await f.store.addPhotosWithDocuments([incoming]);
      expect((await f.store.readManifest()).photoIds).toEqual([old.id, incoming.id]);
      expect(await (await f.store.readPhoto(old.id))!.photo.sourceBlob!.text()).toBe(
        "legacy-original",
      );
      expect((await f.store.readPhoto(old.id))!.document).toEqual(saved.document);
    } finally {
      f.repository.close();
    }
  });

  test("actual drop registration uses photo-only ordinals across sidecars, unreadable entries and equal folder filenames", async () => {
    const f = fixture(),
      raw = gate();
    const sources = [
      new File(["raw original"], "first.arw"),
      new File(["A original"], "same.jpg"),
      new File(["B original"], "same.jpg"),
      new File(["A original"], "duplicate.jpg"),
    ];
    const paths = ["A/first.arw", "A/same.jpg", "B/same.jpg", "C/duplicate.jpg"];
    const repeated = dropEntry(sources[1]!, paths[1]!);
    const entries = [
      dropEntry(new File(["RAW sidecar"], "first.xmp"), "A/first.xmp"),
      dropEntry(sources[0]!, paths[0]!, 10),
      dropEntry(new File(["ignored"], "notes.txt"), "A/notes.txt"),
      repeated,
      dropEntry(new File(["A sidecar"], "same.xmp"), "A/same.xmp"),
      dropEntry(new File(["unreadable"], "unreadable.jpg"), "A/unreadable.jpg", 0, true),
      repeated,
      dropEntry(sources[2]!, paths[2]!),
      dropEntry(new File(["B sidecar"], "same.xmp"), "B/same.xmp"),
      dropEntry(sources[3]!, paths[3]!),
      dropEntry(new File(["not the winning sidecar"], "duplicate.xmp"), "C/duplicate.xmp"),
    ];
    const saved: DevelopPhotoInput[] = [],
      registered: string[] = [];
    const session = createDevelopImportSession(f.options, {
      store: {
        ...f.store,
        addPhotosWithDocuments: async (inputs) => {
          const receipt = await f.store.addPhotosWithDocuments(inputs);
          saved.push(inputs[0]!);
          return receipt;
        },
      },
      unloadTarget: null,
      withLock: async (_, work) => work(),
      collect: (transfer, options) =>
        collectDroppedFiles(transfer, {
          ...options,
          onFiles: (files) => {
            registered.push(...files.map((file) => file.webkitRelativePath));
            options?.onFiles?.(files);
          },
        }),
      preparePreview: async (_, input) => {
        if (input.isRaw) await raw.promise;
        return preview(input);
      },
    });
    const run = session.startDrop(dropTransfer(entries));
    try {
      for (let i = 0; i < 200 && saved.length < 2; i++) await tick();
      expect(saved).toHaveLength(2);
      const admitted = (await f.store.readImportJob())!;
      expect(admitted.rows.map((row) => row.path)).toEqual(paths);
      expect(admitted.rows.map((row) => row.id)).toEqual(
        paths.map((_, ordinal) => `${admitted.id}:${ordinal}`),
      );
      expect(registered).not.toContain("A/unreadable.jpg");
      expect(registered.filter((path) => path === "A/same.jpg")).toHaveLength(1);
      expect(saved.map((input) => input.importOrder!.ordinal)).toEqual([1, 2]);
      raw.release();
      await run;
      const snapshot = session.getSnapshot();
      expect(snapshot).toMatchObject({ phase: "complete", found: 4, saved: 3, duplicates: 1 });
      expect(snapshot.rows.map((row) => row.status)).toEqual([
        "saved",
        "saved",
        "saved",
        "duplicate",
      ]);
      const library = await f.repository.read();
      expect(library.photos.map((photo) => photo.id)).toEqual(
        await Promise.all(
          sources.slice(0, 3).map(async (file) => (await developPhotoFromFile(file)).id),
        ),
      );
      expect(library.photos.map((photo) => photo.sidecar?.text)).toEqual([
        "RAW sidecar",
        "A sidecar",
        "B sidecar",
      ]);
      expect(library.photos.map((photo) => photo.sidecar?.path)).toEqual([
        "A/first.xmp",
        "A/same.xmp",
        "B/same.xmp",
      ]);
      expect(await Promise.all(library.photos.map((photo) => photo.sourceBlob!.text()))).toEqual([
        "raw original",
        "A original",
        "B original",
      ]);
      expect(saved.map((input) => input.importOrder!.ordinal)).toEqual([1, 2, 0]);
      expect(snapshot.failures.some((failure) => failure.fileName === "A/unreadable.jpg")).toBe(
        true,
      );
    } finally {
      raw.release();
      await run;
      f.repository.close();
    }
  });

  test("file-picker repeated handles and unsupported files do not shift admitted photo ordinals", async () => {
    const f = fixture();
    const first = new File(["first"], "first.jpg"),
      last = new File(["last"], "last.jpg");
    const saved: DevelopPhotoInput[] = [];
    const session = createDevelopImportSession(f.options, {
      store: {
        ...f.store,
        addPhotosWithDocuments: async (inputs) => {
          const receipt = await f.store.addPhotosWithDocuments(inputs);
          saved.push(inputs[0]!);
          return receipt;
        },
      },
      preparePreview: async (_, input) => preview(input),
      unloadTarget: null,
      withLock: async (_, work) => work(),
    });
    try {
      await session.startFiles([
        new File(["sidecar"], "first.xmp"),
        first,
        new File(["ignored"], "note.txt"),
        first,
        last,
      ]);
      expect(session.getSnapshot()).toMatchObject({ phase: "complete", found: 2, saved: 2 });
      expect(saved.map((input) => input.importOrder!.ordinal)).toEqual([0, 1]);
      expect((await f.store.readImportJob())!.rows.map((row) => row.name)).toEqual([
        "first.jpg",
        "last.jpg",
      ]);
      expect((await f.repository.read()).photos.map((photo) => photo.name)).toEqual([
        "first.jpg",
        "last.jpg",
      ]);
    } finally {
      f.repository.close();
    }
  });

  test("a changed final discovery order pauses before source reads instead of misbinding ordinals", async () => {
    const f = fixture(),
      first = new File(["first"], "same.jpg"),
      last = new File(["last"], "same.jpg");
    let reads = 0,
      prepares = 0;
    for (const file of [first, last]) {
      const slice = file.slice.bind(file);
      file.slice = (...args) => {
        reads++;
        return slice(...args);
      };
    }
    const session = createDevelopImportSession(f.options, {
      store: f.store,
      unloadTarget: null,
      withLock: async (_, work) => work(),
      collect: async (_, options) => {
        options?.onFiles?.([first, last]);
        return { files: [last, first], warnings: [], directories: 0, duplicates: 0 };
      },
      preparePreview: async (_, input) => {
        prepares++;
        return preview(input);
      },
    });
    try {
      await session.startDrop({} as DataTransfer);
      expect(session.getSnapshot()).toMatchObject({ phase: "paused", found: 2, saved: 0 });
      expect(session.getSnapshot().error).toContain("order changed");
      expect(reads).toBe(0);
      expect(prepares).toBe(0);
      expect((await f.store.loadLibrary()).photos).toHaveLength(0);
    } finally {
      f.repository.close();
    }
  });
});
