import { describe, expect, test } from "bun:test";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
import { PHOTO_ID_MAX_LENGTH } from "../src/lib/photo-identity";
import {
  advanceDevelopImportJob,
  advanceShootManifest,
  createDevelopDocument,
  createDevelopStore,
  developDocumentForImport,
  developPhotoFromFile,
  developPhotoFromShot,
  mergeDevelopImportCommit,
  parseDevelopRecovery,
  pushHistory,
  type DevelopImportJob,
  type DevelopPhoto,
  type ShootManifest,
} from "../src/lib/develop/store";
import {
  createShootRepository,
  projectDevelopPhotoToStudio,
} from "../src/lib/develop/shoot-repository";
import { developIdbDouble } from "./fixtures/develop-idb-double";

function legacy(patch: Partial<Shot> = {}): Shot {
  return {
    id: "old",
    name: "old.ARW",
    file: new File([], "old.preview.jpg"),
    sourceAvailable: false,
    previewUrl: null,
    isRaw: true,
    width: 0,
    height: 0,
    sizeMb: 22,
    sharpness: 12,
    brightness: 30,
    clippedHighlights: 0,
    clippedShadows: 0,
    hash: "1010",
    score: 65,
    flags: ["soft"],
    verdict: "keep",
    edits: { ...DEFAULT_EDITS, crop: "4:5" },
    develop: {
      origin: "sidecar",
      at: 1,
      rating: 4,
      label: "Client selects",
      caption: "Original caption",
      processVersion: "11.0",
    },
    ...patch,
  };
}
function photo(patch: Partial<Shot> = {}): DevelopPhoto {
  return { ...developPhotoFromShot(legacy(patch)), createdAt: 1, sourceAvailable: false };
}
const manifest = (ids = ["a", "b"]): ShootManifest => ({
  version: 1,
  revision: 2,
  photoIds: ids,
  selectedId: ids[0] ?? null,
  filter: "all",
});
function job(): DevelopImportJob {
  return {
    version: 1,
    revision: 0,
    id: "job-one",
    phase: "processing",
    startedAt: 1,
    finishedAt: null,
    rows: [{ id: "one", name: "one.jpg", path: "folder/one.jpg", status: "found" }],
    found: 1,
    previewReady: 0,
    analyzed: 0,
    saved: 0,
    failed: 0,
    duplicates: 0,
    error: null,
  };
}

describe("lossless legacy reference", () => {
  test("maximum legacy ID survives native document and recovery without trimming", () => {
    const id = "x".repeat(PHOTO_ID_MAX_LENGTH);
    const input = developPhotoFromShot(legacy({ id }));
    expect(input.id).toBe(`studio:${id}`);
    const doc = developDocumentForImport(input);
    const namespace = JSON.stringify(["qa", "shoot:one"]);
    const restored = parseDevelopRecovery(
      JSON.stringify({ version: 1, namespace, documents: { [input.id]: doc } }),
      { scope: "qa", libraryId: "shoot:one" },
    );
    expect(restored.documents[input.id]!.photoId).toBe(input.id);
    expect(() => developPhotoFromShot(legacy({ id: `${id}x` }))).toThrow();
  });
  test("keeps full legacy intent, unknown metadata, undefined and deferred crop without files/URLs", () => {
    const source = { ...legacy(), customField: { nested: ["kept", undefined] } };
    const input = developPhotoFromShot(source);
    expect(input.legacy!.unresolvedCrop).toBe("4:5");
    expect(input.legacy!.metadata["develop"]).toEqual(source.develop);
    expect(input.legacy!.metadata["customField"]).toEqual(source.customField);
    for (const key of ["file", "previewBlob", "previewUrl"])
      expect(Object.hasOwn(input.legacy!.metadata, key)).toBe(false);
    source.customField.nested[0] = "changed";
    source.edits.crop = "orig";
    expect(input.legacy!.metadata["customField"]).toEqual({ nested: ["kept", undefined] });
    expect((input.legacy!.metadata["edits"] as Shot["edits"]).crop).toBe("4:5");
  });
  test("known crop geometry converts but exact legacy recipe remains archived", () => {
    const input = developPhotoFromShot(legacy({ width: 6000, height: 4000 }));
    expect(input.legacy!.unresolvedCrop).toBeUndefined();
    expect(input.initialState!.settings.crop.width).toBeLessThan(1);
    expect((input.legacy!.metadata["edits"] as Shot["edits"]).crop).toBe("4:5");
  });
  test("rejects executable, cyclic or oversized extra metadata, never mutates source", () => {
    for (const custom of [() => {}, new Blob(["x"]), "x".repeat(1024 * 1024)])
      expect(() => developPhotoFromShot({ ...legacy(), custom } as Shot)).toThrow();
    const cycle: Record<string, unknown> = {};
    cycle["self"] = cycle;
    expect(() => developPhotoFromShot({ ...legacy(), cycle } as Shot)).toThrow();
  });
  test("receipt adoption detaches archived metadata and raw sidecar text", () => {
    const p = photo();
    p.sidecar = {
      name: "old.xmp",
      path: "folder/old.xmp",
      text: "<x:xmpmeta>unchanged</x:xmpmeta>",
    };
    const document = developDocumentForImport(p);
    const next = mergeDevelopImportCommit(
      { photos: [], documents: {}, presets: [] },
      { photos: [p], documents: { [p.id]: document } },
    );
    (p.legacy!.metadata["edits"] as Shot["edits"]).temp = 98;
    p.sidecar.text = "changed";
    expect((next.photos[0]!.legacy!.metadata["edits"] as Shot["edits"]).temp).toBe(0);
    expect(next.photos[0]!.sidecar!.text).toContain("unchanged");
  });
  test("projection uses canonical review values, preserves reference, and never claims native-to-legacy conversion", () => {
    const p = photo();
    const doc = developDocumentForImport(p);
    doc.metadata = { rating: 2, flag: "reject", colorLabel: "blue" };
    const settings = doc.history.at(-1)!.settings;
    const edited = pushHistory(doc, { ...settings, dehaze: 90 }, "Native change");
    const result = projectDevelopPhotoToStudio(p, edited);
    expect(result.shot.id).toBe("old");
    expect(result.shot.verdict).toBe("reject");
    expect(result.shot.develop?.rating).toBe(2);
    expect(result.shot.develop?.caption).toBe("Original caption");
    expect(result.shot.edits).toEqual(legacy().edits);
    expect(result.treatment).toBe("native");
    expect(result.shot.sourceAvailable).toBe(false);
    expect(result.shot.previewUrl).toBeNull();
    expect(result.needsAnalysis).toBe(false);
    const copy = { ...p, id: "copy:unique" };
    expect(projectDevelopPhotoToStudio(copy, { ...edited, photoId: copy.id }).shot.id).toBe(
      copy.id,
    );
  });
  test("new originals project without fabricated measured analysis or identity changes", async () => {
    const input = await developPhotoFromFile(new File(["source"], "new.jpg"));
    const p = { ...input, createdAt: 1, sourceAvailable: true };
    const result = projectDevelopPhotoToStudio(p, createDevelopDocument(p.id));
    expect(result.shot.file).toBe(input.sourceBlob as File);
    expect(result.needsAnalysis).toBe(true);
    expect(result.legacyAvailable).toBe(false);
    expect(() => projectDevelopPhotoToStudio(p, createDevelopDocument("another"))).toThrow();
  });
});

describe("additive ordered manifest", () => {
  test("selection/filter and deliberate reorder advance atomically without dropping membership", () => {
    const old = manifest();
    const next = advanceShootManifest(
      old,
      { photoIds: ["b", "a"], selectedId: "b", filter: "keepers" },
      2,
      ["a", "b"],
    );
    expect(next).toEqual({
      version: 1,
      revision: 3,
      photoIds: ["b", "a"],
      selectedId: "b",
      filter: "keepers",
    });
    expect(old.photoIds).toEqual(["a", "b"]);
    expect(advanceShootManifest(next, next, 3, ["b", "a"]).revision).toBe(3);
  });
  test("stale, missing, foreign, duplicate and overflow states fail closed", () => {
    const old = manifest();
    expect(() => advanceShootManifest(old, old, 1, old.photoIds)).toThrow();
    for (const ids of [["a"], ["a", "b", "foreign"], ["a", "a"], []])
      expect(() => advanceShootManifest(old, { ...old, photoIds: ids }, 2, ["a", "b"])).toThrow();
    expect(() =>
      advanceShootManifest(old, { ...old, selectedId: "foreign" }, 2, ["a", "b"]),
    ).toThrow();
    expect(() =>
      advanceShootManifest(
        { ...old, revision: Number.MAX_SAFE_INTEGER - 1 },
        { ...old, filter: "rated" },
        Number.MAX_SAFE_INTEGER - 1,
        old.photoIds,
      ),
    ).toThrow();
  });
  test("retains all 337 identifiers and stable selected photo through varied reorder", () => {
    const ids = Array.from({ length: 337 }, (_, i) => `studio:legacy-${i}`);
    for (let offset = 0; offset < 337; offset++) {
      const ordered = [...ids.slice(offset), ...ids.slice(0, offset)];
      const next = advanceShootManifest(
        manifest(ids),
        { photoIds: ordered, selectedId: ids[100]!, filter: "all" },
        2,
        ids,
      );
      expect(next.photoIds).toEqual(ordered);
      expect(next.selectedId).toBe(ids[100]!);
    }
  });
});

describe("durable import report guards", () => {
  test("uses revision fences and requires explicit interruption before a new import", () => {
    const first = advanceDevelopImportJob(null, job(), 0);
    expect(first.revision).toBe(1);
    expect(() => advanceDevelopImportJob(first, job(), 0)).toThrow();
    expect(() => advanceDevelopImportJob(first, { ...first, id: "new" }, 1)).toThrow();
    const interrupted = advanceDevelopImportJob(
      first,
      { ...first, phase: "interrupted", finishedAt: 5 },
      1,
    );
    expect(
      advanceDevelopImportJob(interrupted, { ...job(), id: "new", revision: 2 }, 2).revision,
    ).toBe(3);
  });
  test("never forgets prior rows or successful commit receipts and caps metadata", () => {
    const prior = {
      ...job(),
      revision: 1,
      saved: 1,
      rows: [{ ...job().rows[0]!, status: "saved" as const, photoId: "photo" }],
    };
    expect(() => advanceDevelopImportJob(prior, { ...prior, rows: [] }, 1)).toThrow();
    expect(() =>
      advanceDevelopImportJob(
        prior,
        { ...prior, rows: [{ ...prior.rows[0]!, status: "cancelled" }] },
        1,
      ),
    ).toThrow();
    expect(() =>
      advanceDevelopImportJob(
        prior,
        { ...prior, rows: [{ ...prior.rows[0]!, photoId: "another" }] },
        1,
      ),
    ).toThrow();
    const finished = advanceDevelopImportJob(
      prior,
      { ...prior, phase: "complete", finishedAt: 3 },
      1,
    );
    expect(() =>
      advanceDevelopImportJob(finished, { ...finished, phase: "processing" }, 2),
    ).toThrow();
    expect(() =>
      advanceDevelopImportJob(null, { ...job(), rows: [job().rows[0]!, job().rows[0]!] }, 0),
    ).toThrow();
  });
});

describe("shared scoped flush fence", () => {
  test("same-window subscriptions remain available when BroadcastChannel is blocked", () => {
    const previous = globalThis.BroadcastChannel;
    Object.defineProperty(globalThis, "BroadcastChannel", {
      configurable: true,
      value: class {
        constructor() {
          throw new Error("Blocked messaging");
        }
      },
    });
    const repository = createShootRepository({
      scope: `qa-${crypto.randomUUID()}`,
      libraryId: "one",
    });
    try {
      const unsubscribe = repository.subscribe(() => {});
      expect(typeof unsubscribe).toBe("function");
      unsubscribe();
    } finally {
      repository.close();
      Object.defineProperty(globalThis, "BroadcastChannel", {
        configurable: true,
        value: previous,
      });
    }
  });
  test("identical scope instances share, serialize, and await flushes; other accounts do not", async () => {
    const scope = `qa-${crypto.randomUUID()}`;
    const a = createShootRepository({ scope, libraryId: "one" });
    const b = createShootRepository({ scope, libraryId: "one" });
    const c = createShootRepository({ scope: `${scope}-other`, libraryId: "one" });
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    let calls = 0;
    a.registerFlushParticipant("draft", async () => {
      calls++;
      await gate;
      return true;
    });
    try {
      const first = b.flush(),
        second = a.flush();
      expect(second).toBe(first);
      expect(await c.flush()).toBe(true);
      await Promise.resolve();
      expect(calls).toBe(1);
      release();
      expect(await first).toBe(true);
    } finally {
      release();
      a.close();
      b.close();
      c.close();
    }
  });
  test("false/throw stops navigation, later retry can succeed, cleanup is owner-specific", async () => {
    const options = { scope: `qa-${crypto.randomUUID()}`, libraryId: "one" };
    const a = createShootRepository(options),
      b = createShootRepository(options);
    let success = false,
      later = 0;
    const remove = a.registerFlushParticipant("first", async () => success);
    b.registerFlushParticipant("second", async () => {
      later++;
      return true;
    });
    try {
      expect(await b.flush()).toBe(false);
      expect(later).toBe(0);
      success = true;
      expect(await b.flush()).toBe(true);
      expect(later).toBe(1);
      expect(() => b.registerFlushParticipant("first", async () => true)).toThrow();
      remove();
      a.close();
      expect(await b.flush()).toBe(true);
      expect(later).toBe(2);
      const drop = b.registerFlushParticipant("throw", async () => {
        throw new Error("save failed");
      });
      expect(await b.flush()).toBe(false);
      drop();
      expect(await b.flush()).toBe(true);
    } finally {
      a.close();
      b.close();
    }
  });
});

describe("canonical store transactions (isolated IDB double)", () => {
  async function setup() {
    const db = developIdbDouble();
    const options = { scope: `qa-${crypto.randomUUID()}`, libraryId: "one", factory: db.factory };
    const writer = createDevelopStore(options),
      reader = createDevelopStore(options);
    const foreign = createDevelopStore({ ...options, libraryId: "other" });
    const inputs = await Promise.all(
      ["z", "a"].map(async (name) =>
        developPhotoFromFile(new File([name], `${name}.jpg`), new Blob([`${name}-preview`])),
      ),
    );
    return {
      db,
      options,
      writer,
      reader,
      foreign,
      inputs,
      close() {
        writer.close();
        reader.close();
        foreign.close();
      },
    };
  }
  test("photo, initial document and ordered manifest share one durable receipt; local observers are isolated", async () => {
    const f = await setup();
    const events: unknown[] = [],
      unrelated: unknown[] = [];
    f.reader.subscribe((change) => {
      expect(f.db.log.at(-1)).toBe("complete");
      events.push(change);
      if (change.commit) change.commit.documents[f.inputs[0]!.id]!.metadata.rating = 5;
    });
    f.foreign.subscribe((change) => unrelated.push(change));
    try {
      const receipt = await f.writer.addPhotosWithDocuments(f.inputs);
      expect(events).toHaveLength(1);
      expect(unrelated).toHaveLength(0);
      expect(receipt.documents[f.inputs[0]!.id]!.metadata.rating).toBe(0);
      const library = await f.reader.loadLibraryWithManifest();
      expect(library.manifest.photoIds).toEqual(f.inputs.map((p) => p.id));
      expect(library.photos.map((p) => p.name)).toEqual(["z.jpg", "a.jpg"]);
      expect(library.manifest.revision).toBe(1);
      expect(library.documents[f.inputs[0]!.id]!.metadata.rating).toBe(0);
      expect((await f.foreign.loadLibrary()).photos).toEqual([]);
    } finally {
      f.close();
    }
  });
  test("completion/quota failures publish no events or partial photo/document/manifest writes", async () => {
    for (const fault of ["put", "complete"] as const) {
      const f = await setup();
      const events: unknown[] = [];
      f.reader.subscribe((change) => events.push(change));
      try {
        f.db.faults[fault] = true;
        await expect(f.writer.addPhotosWithDocuments(f.inputs)).rejects.toThrow();
        expect(events).toEqual([]);
        expect(f.db.rows.photos.size).toBe(0);
        expect(f.db.rows.documents.size).toBe(0);
        expect(f.db.rows.manifests.size).toBe(0);
        f.db.faults[fault] = false;
        await f.writer.addPhotosWithDocuments(f.inputs);
        expect((await f.reader.loadLibraryWithManifest()).photos).toHaveLength(2);
      } finally {
        f.close();
      }
    }
  });
  test("two writers cannot overwrite each other's selected photo and no import drops old membership", async () => {
    const f = await setup();
    try {
      await f.writer.addPhotosWithDocuments(f.inputs);
      const before = await f.writer.readManifest();
      const results = await Promise.allSettled([
        f.writer.saveManifest({ ...before, selectedId: f.inputs[1]!.id }, before.revision),
        f.reader.saveManifest({ ...before, filter: "rated" }, before.revision),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      const original = await f.writer.readPhoto(f.inputs[0]!.id);
      const copy = await f.writer.createVirtualCopy(
        original!.photo.id,
        original!.document.revision,
      );
      const after = await f.reader.loadLibraryWithManifest();
      expect(after.manifest.photoIds).toEqual([...before.photoIds, copy.photo.id]);
      expect(after.manifest.selectedId).toBe(f.inputs[1]!.id);
      expect(after.documents[original!.photo.id]).toEqual(original!.document);
    } finally {
      f.close();
    }
  });
  test("one-time archive attachment never replaces the original, subsequent archive, sidecar or native history", async () => {
    const f = await setup();
    try {
      const fromShot = developPhotoFromShot(legacy());
      const { legacy: _legacy, ...prior } = fromShot;
      const inserted = await f.writer.addPhotosWithDocuments([prior]);
      const original = inserted.documents[prior.id]!;
      const edited = pushHistory(
        original,
        { ...original.history[0]!.settings, dehaze: 34 },
        "Native treatment",
      );
      const saved = await f.writer.saveDocument(edited);
      const sidecar = {
        name: "old.xmp",
        path: "folder/old.xmp",
        text: "<xmp>exact source text</xmp>",
      };
      await f.writer.addPhotosWithDocuments([{ ...fromShot, sidecar }]);
      const changed = developPhotoFromShot(legacy({ edits: { ...DEFAULT_EDITS, temp: 90 } }));
      await f.writer.addPhotosWithDocuments([
        { ...changed, sidecar: { ...sidecar, text: "different" } },
      ]);
      const result = await f.writer.readPhoto(prior.id);
      expect(result!.document).toEqual(saved);
      expect(result!.photo.legacy!.unresolvedCrop).toBe("4:5");
      expect((result!.photo.legacy!.metadata["edits"] as Shot["edits"]).temp).toBe(0);
      expect(result!.photo.sidecar!.text).toBe(sidecar.text);
      expect(result!.photo.sourceBlob).toBeNull();
    } finally {
      f.close();
    }
  });
  test("targeted reads do not fetch unrelated blobs and job snapshots have independent CAS", async () => {
    const f = await setup();
    try {
      await f.writer.addPhotosWithDocuments(f.inputs);
      f.db.log.length = 0;
      const receipt = await f.reader.readPhotosWithDocuments([f.inputs[1]!.id]);
      expect(receipt.photos.map((p) => p.id)).toEqual([f.inputs[1]!.id]);
      expect(f.db.log.some((line) => line.includes(":index:"))).toBe(false);
      expect(f.db.log.filter((line) => line.includes(":get:")).length).toBe(2);
      const jobs = await Promise.allSettled([
        f.writer.saveImportJob(job(), 0),
        f.reader.saveImportJob({ ...job(), id: "other" }, 0),
      ]);
      expect(jobs.filter((value) => value.status === "fulfilled")).toHaveLength(1);
      expect((await f.writer.readImportJob())!.revision).toBe(1);
      expect(await f.foreign.readImportJob()).toBeNull();
      expect((await f.writer.readPhoto(f.inputs[1]!.id))!.document).toEqual(
        receipt.documents[f.inputs[1]!.id]!,
      );
    } finally {
      f.close();
    }
  });
});
