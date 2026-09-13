import { describe, expect, test } from "bun:test";
import {
  applyCullReviewProposal,
  createCullLightroomVerdicts,
  createCullShootView,
  CullRefreshSuperseded,
  developViewFilter,
  mergeCullLightroomReviews,
  reconcileDevelopView,
  restoreCullReview,
} from "../src/lib/develop/cull-view";
import { proposeCull, proposeEdits } from "../src/lib/studio/proposals";
import type { ShootRepository } from "../src/lib/develop/shoot-repository";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
import {
  advanceShootManifest,
  createDevelopDocument,
  developDocumentForImport,
  developDocumentSchema,
  developPhotoFromFile,
  developPhotoFromShot,
  pushHistory,
  type DevelopDocument,
  type DevelopLibrary,
  type DevelopPhotoInput,
  type ShootManifest,
} from "../src/lib/develop/store";
import { defaultDevelopSettings } from "../src/lib/develop/contract";
import {
  admitImportCull,
  attachImportAnalysis,
  sameImportAnalysisSource,
  takeImportCullIds,
} from "../src/lib/studio/cull-on-import";

function fakeRepository() {
  const state: DevelopLibrary & { manifest: ShootManifest } = {
    photos: [],
    documents: {},
    presets: [],
    manifest: { version: 1, revision: 0, photoIds: [], selectedId: null, filter: "all" },
  };
  const clone = () => ({
    ...state,
    photos: [...state.photos],
    documents: structuredClone(state.documents),
    manifest: structuredClone(state.manifest),
  });
  const add = async (inputs: DevelopPhotoInput[]) => {
    for (const input of inputs)
      if (!state.photos.some((photo) => photo.id === input.id)) {
        state.photos.push({ ...input, sourceAvailable: Boolean(input.sourceBlob), createdAt: 1 });
        state.documents[input.id] = developDocumentForImport(input);
        state.manifest.photoIds.push(input.id);
      }
    return {
      photos: state.photos.filter((photo) => inputs.some((input) => input.id === photo.id)),
      documents: structuredClone(state.documents),
    };
  };
  let documentWrites = 0;
  const repository = {
    namespace: "cull-view-unit:shoot",
    read: async () => clone(),
    saveManifest: async (
      view: Parameters<ShootRepository["saveManifest"]>[0],
      revision: number,
    ) => {
      state.manifest = advanceShootManifest(
        state.manifest,
        view,
        revision,
        state.photos.map((p) => p.id),
      );
      return structuredClone(state.manifest);
    },
    store: {
      addPhotosWithDocuments: add,
      saveDocuments: async (updates: { document: DevelopDocument; expectedRevision: number }[]) => {
        for (const update of updates) {
          developDocumentSchema.parse(update.document);
          if (state.documents[update.document.photoId]?.revision !== update.expectedRevision)
            throw new Error("CAS conflict");
        }
        documentWrites += updates.length;
        return updates.map(
          ({ document }) =>
            (state.documents[document.photoId] = {
              ...structuredClone(document),
              revision: document.revision + 1,
            }),
        );
      },
    },
  } as unknown as ShootRepository;
  return { state, add, repository, writes: () => documentWrites };
}
function oldPhoto(id: string, patch: Partial<Shot> = {}): Shot {
  return {
    id,
    name: "same.ARW",
    file: new File([], "same.preview.jpg"),
    previewUrl: null,
    previewBlob: new Blob([id], { type: "image/jpeg" }),
    sourceAvailable: false,
    isRaw: true,
    width: 0,
    height: 0,
    sizeMb: 24,
    sharpness: 48,
    brightness: 50,
    clippedHighlights: 0,
    clippedShadows: 0,
    hash: "measured",
    score: 70,
    flags: [],
    verdict: "undecided",
    edits: { ...DEFAULT_EDITS },
    ...patch,
  };
}
describe("Cull is a canonical review projection", () => {
  test("a full durable reread retains the verified original handle and pending cull admission", async () => {
    const fake = fakeRepository();
    const input = await developPhotoFromFile(
      new File(["synthetic original bytes"], "new.jpg", { type: "image/jpeg", lastModified: 12 }),
    );
    await fake.add([input]);
    const originalDocument = structuredClone(fake.state.documents[input.id]);
    const read = fake.repository.read;
    // IndexedDB returns newly structured-cloned Blob handles, unlike the shallow
    // repository fake. A full catalog refresh must not impersonate a new source.
    fake.repository.read = async () => {
      const snapshot = await read();
      return {
        ...snapshot,
        photos: snapshot.photos.map((photo) => ({
          ...photo,
          sourceBlob:
            photo.sourceBlob?.slice(0, photo.sourceBlob.size, photo.sourceBlob.type) ?? null,
        })),
      };
    };
    const view = createCullShootView(fake.repository);
    const initial = await view.read();
    const pending = new Map<string, Shot>();
    admitImportCull(pending, initial.shots, [input.id]);
    expect(pending.size).toBe(1);
    for (let repeat = 0; repeat < 3; repeat++) {
      const refreshed = await view.read();
      expect(refreshed.shots[0]!.file).toBe(initial.shots[0]!.file);
      expect(sameImportAnalysisSource(initial.shots[0]!, refreshed.shots[0])).toBe(true);
      expect(takeImportCullIds(pending, refreshed.shots).size).toBe(0);
      expect(pending.size).toBe(1);
      expect(refreshed.shots[0]!.verdict).toBe("undecided");
    }
    const refreshed = await view.read();
    const analyzed = attachImportAnalysis(refreshed.shots[0]!, {
      width: 10,
      height: 10,
      backend: "native-cpp",
      analysis: {
        sharpness: 200,
        brightness: 120,
        clippedHighlights: 0,
        clippedShadows: 0,
        hash: "0".repeat(64),
      },
    });
    expect([...takeImportCullIds(pending, [analyzed])]).toEqual([input.id]);
    expect(pending.size).toBe(0);
    expect(await analyzed.file.text()).toBe("synthetic original bytes");
    expect(fake.writes()).toBe(0);
    expect(fake.state.documents[input.id]).toEqual(originalDocument);
  });

  test("source identity, availability and file metadata changes cannot reuse an old handle", async () => {
    const variants = [
      "digest",
      "missing-digest",
      "legacy-digest",
      "unavailable",
      "missing-original",
      "size",
      "type",
      "name",
      "modified",
      "raw",
      "recreated",
      "namespace",
    ] as const;
    for (const variant of variants) {
      const fake = fakeRepository();
      const input = await developPhotoFromFile(
        new File(["original"], "photo.jpg", { type: "image/jpeg", lastModified: 12 }),
      );
      await fake.add([input]);
      // Exercise Blob projection as it is reconstructed by IndexedDB.
      const photo = fake.state.photos[0]!;
      photo.sourceBlob = new Blob(["original"], { type: "image/jpeg" });
      if (variant === "missing-digest") photo.sourceDigest = null;
      if (variant === "legacy-digest") photo.sourceDigest = "unverified-legacy-fingerprint";
      const view = createCullShootView(fake.repository);
      const before = (await view.read()).shots[0]!;
      photo.sourceBlob = new Blob(["original"], { type: "image/jpeg" });
      switch (variant) {
        case "digest":
          photo.sourceDigest = `sha256:${"f".repeat(64)}`;
          break;
        case "unavailable":
          photo.sourceAvailable = false;
          break;
        case "missing-original":
          photo.sourceBlob = null;
          break;
        case "size":
          photo.sourceBlob = new Blob(["longer original"], { type: "image/jpeg" });
          break;
        case "type":
          photo.sourceBlob = new Blob(["original"], { type: "image/png" });
          break;
        case "name":
          photo.sourceFileName = "renamed.jpg";
          break;
        case "modified":
          photo.sourceLastModified++;
          break;
        case "raw":
          photo.isRaw = true;
          break;
        case "recreated":
          photo.createdAt++;
          break;
        case "namespace":
          Object.assign(fake.repository, { namespace: "other-owner:shoot" });
          break;
      }
      const after = (await view.read()).shots[0]!;
      expect(after.file).not.toBe(before.file);
      expect(sameImportAnalysisSource(before, after)).toBe(false);
      const pending = new Map([[before.id, before]]);
      expect(takeImportCullIds(pending, [after]).size).toBe(0);
      expect(pending.size).toBe(0);
      expect(fake.writes()).toBe(0);
    }
  });

  test("a verified preview-only photo never borrows an original File after source loss", async () => {
    const fake = fakeRepository();
    const input = await developPhotoFromFile(new File(["original"], "photo.jpg"));
    await fake.add([input]);
    const photo = fake.state.photos[0]!;
    photo.previewBlob = new Blob(["preview"], { type: "image/jpeg" });
    const view = createCullShootView(fake.repository);
    const original = (await view.read()).shots[0]!;
    photo.sourceAvailable = false;
    const preview = (await view.read()).shots[0]!;
    expect(preview.sourceAvailable).toBe(false);
    expect(preview.file).not.toBe(original.file);
    expect(await preview.file.text()).toBe("preview");
    photo.previewBlob = photo.previewBlob.slice(0, photo.previewBlob.size, photo.previewBlob.type);
    expect((await view.read()).shots[0]!.file).not.toBe(preview.file);
  });

  test("K/X and selection arriving during refresh are not adopted away or rebased onto stale data", async () => {
    const fake = fakeRepository();
    await fake.add([developPhotoFromShot(oldPhoto("one")), developPhotoFromShot(oldPhoto("two"))]);
    const view = createCullShootView(fake.repository);
    const loaded = await view.read();
    let generation = 0;
    let release!: () => void;
    let started!: () => void;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalRead = fake.repository.read;
    fake.repository.read = async () => {
      const snapshot = await originalRead();
      started();
      await gate;
      return snapshot;
    };
    const refresh = view.read(undefined, () => generation === 0);
    await began;
    const current = loaded.shots.map((shot) => ({
      ...shot,
      verdict: shot.id === "one" ? ("keep" as const) : ("reject" as const),
    }));
    generation++;
    release();
    await expect(refresh).rejects.toBeInstanceOf(CullRefreshSuperseded);
    fake.repository.read = originalRead;
    await view.save(current, "two", "all");
    const readback = await view.read();
    expect(readback.selectedId).toBe("two");
    expect(readback.shots.map((shot) => shot.verdict)).toEqual(["keep", "reject"]);
    expect(fake.state.manifest.selectedId).toBe("studio:two");
  });
  test("Develop preserves unsupported Cull filters and another tab's view until a real view gesture", () => {
    for (const filter of ["rejected", "todo", "flagged", "not-rejected", "keepers"]) {
      const manifest: ShootManifest = {
        version: 1,
        revision: 0,
        photoIds: ["one", "two"],
        selectedId: "one",
        filter,
      };
      const localFilter = developViewFilter(filter);
      const baseline = {
        selectedId: "one",
        filter: localFilter,
        sourceSelectedId: "one",
        sourceFilter: filter,
      };
      let untouched = reconcileDevelopView(manifest, baseline, "one", localFilter);
      expect(untouched.view.filter).toBe(filter);
      expect(untouched.view.selectedId).toBe("one");
      const remote = { ...manifest, selectedId: "two", filter: "rated" };
      for (let i = 0; i < 3; i++) {
        untouched = reconcileDevelopView(remote, untouched.baseline, "one", localFilter);
        expect(untouched.view.filter).toBe("rated");
        expect(untouched.view.selectedId).toBe("two");
      }
      expect(reconcileDevelopView(manifest, baseline, "one", "all", true).view.filter).toBe("all");
      expect(reconcileDevelopView(manifest, baseline, "two", localFilter).view).toMatchObject({
        selectedId: "two",
        filter,
      });
      expect(() =>
        reconcileDevelopView({ ...remote, selectedId: null }, baseline, "two", localFilter),
      ).toThrow("selection changed");
      expect(() => reconcileDevelopView(remote, baseline, "one", "all", true)).toThrow(
        "filter changed",
      );
    }
  });
  test("an unlabelled real-schema document remains nullable across unchanged and K/X saves", async () => {
    const fake = fakeRepository();
    const input = await developPhotoFromFile(new File(["source"], "photo.jpg"));
    await fake.add([input]);
    const view = createCullShootView(fake.repository);
    const loaded = await view.read();
    expect(loaded.shots[0]!.develop?.label).toBeNull();
    await view.save(loaded.shots, loaded.selectedId, loaded.filter);
    expect(fake.writes()).toBe(0);
    loaded.shots[0]!.verdict = "keep";
    await view.save(loaded.shots, loaded.shots[0]!.id, "all");
    expect(developDocumentSchema.parse(fake.state.documents[input.id]).metadata).toEqual({
      flag: "pick",
      rating: 0,
      colorLabel: null,
    });
    loaded.shots[0]!.verdict = "reject";
    await view.save(loaded.shots, loaded.shots[0]!.id, "all");
    expect(
      developDocumentSchema.parse(fake.state.documents[input.id]).metadata.colorLabel,
    ).toBeNull();
  });
  test("legacy undo checkpoints restore picks but never restore archived slider values", () => {
    const photo = oldPhoto("one", { edits: { ...DEFAULT_EDITS, exposure: 40 } });
    const checkpoint = { id: photo.id, verdict: "keep" as const, edits: { ...DEFAULT_EDITS } };
    const restored = restoreCullReview([photo], [checkpoint]);
    expect(restored[0]!.verdict).toBe("keep");
    expect(restored[0]!.edits).toBe(photo.edits);
    expect(photo.verdict).toBe("undecided");
  });
  test("old edit proposals cannot be applied but review-only proposals still work", () => {
    const photos = [oldPhoto("one")];
    const edits = proposeEdits(
      photos,
      "one",
      "selected",
      () => ({ ...DEFAULT_EDITS, exposure: 25 }),
      { title: "Old edit", description: "Old preview" },
    );
    expect(() => applyCullReviewProposal(photos, edits)).toThrow("reviewed in Develop");
    const picks = proposeCull(photos, () => "keep", { title: "Pick", description: "Review" });
    expect(applyCullReviewProposal(photos, picks)[0]!.verdict).toBe("keep");
    picks.frames[0]!.afterEdits.exposure = 99;
    expect(() => applyCullReviewProposal(photos, picks)).toThrow("reviewed in Develop");
    expect(photos[0]!.edits.exposure).toBe(0);
  });
  test("Lightroom imports only supported review metadata and never changes treatment or archived IPTC", async () => {
    const photo = oldPhoto("one", {
      relativePath: "shoot/same.ARW",
      edits: { ...DEFAULT_EDITS, exposure: 17 },
      develop: {
        origin: "sidecar",
        at: 1,
        caption: "Preserved caption",
        processVersion: "old",
        rating: 1,
      },
    });
    const bridge = [
      {
        file: photo.name,
        path: "/photos/shoot/same.ARW",
        rating: 4,
        pick: 1,
        label: "Blue",
        develop: { exposure: 4, temperature: 9000, processVersion: "new" },
        iptc: { caption: "Not silently imported" },
      },
    ];
    const merged = mergeCullLightroomReviews([photo], bridge, 2);
    expect(merged.matched).toBe(1);
    expect(merged.shots[0]!.edits).toBe(photo.edits);
    expect(merged.shots[0]!.develop).toEqual({ ...photo.develop, rating: 4, label: "Blue" });
    expect(merged.shots[0]!.verdict).toBe("keep");
    const fake = fakeRepository();
    const view = createCullShootView(fake.repository);
    const loaded = await view.read({
      shots: [photo],
      selectedId: photo.id,
      filter: "all",
      updatedAt: 1,
    });
    const updated = mergeCullLightroomReviews(loaded.shots, bridge, 2);
    await view.save(updated.shots, photo.id, "all");
    expect(fake.state.documents["studio:one"]!.metadata).toEqual({
      flag: "pick",
      rating: 4,
      colorLabel: "blue",
    });
    expect(fake.state.photos[0]!.legacy?.metadata).toBeDefined();
    const outgoing = createCullLightroomVerdicts(updated.shots);
    expect(outgoing[0]).not.toHaveProperty("develop");
    expect(outgoing[0]).not.toHaveProperty("score");
    expect(outgoing[0]!.rating).toBe(4);
    expect(outgoing[0]!.relativePath).toBe("shoot/same.ARW");
    expect(() =>
      mergeCullLightroomReviews([photo], [{ ...bridge[0], label: "Custom unsupported" }], 2),
    ).toThrow("color label");
  });
  test("repeated unchanged hidden Cull flushes preserve the newer Develop selection and filter", async () => {
    const fake = fakeRepository();
    const view = createCullShootView(fake.repository);
    const hidden = await view.read();
    const input = await developPhotoFromFile(new File(["source"], "photo.jpg"));
    await fake.add([input]);
    fake.state.manifest.selectedId = input.id;
    fake.state.manifest.filter = "not-rejected";
    for (let i = 0; i < 3; i++) await view.save(hidden.shots, hidden.selectedId, hidden.filter);
    expect(fake.state.manifest.selectedId).toBe(input.id);
    expect(fake.state.manifest.filter).toBe("not-rejected");
    const visible = await view.read();
    expect(visible.selectedId).toBe(input.id);
  });
  test("all337 archived identities and legacy fields survive; no history is replaced", async () => {
    const fake = fakeRepository();
    const shots = Array.from({ length: 337 }, (_, i) =>
      oldPhoto(`old-${i}`, {
        edits: { ...DEFAULT_EDITS, exposure: i % 100 },
        relativePath: `folder-${i}/same.ARW`,
      }),
    );
    await fake.add([developPhotoFromShot(shots[0]!)]);
    const settings = defaultDevelopSettings();
    settings.grain = 28;
    settings.masks = [];
    fake.state.documents["studio:old-0"] = pushHistory(
      fake.state.documents["studio:old-0"]!,
      settings,
      "Native look",
    );
    const nativeBefore = JSON.stringify(fake.state.documents["studio:old-0"]);
    const original = JSON.stringify(
      shots.map(({ file: _file, previewBlob: _blob, ...rest }) => rest),
    );
    const view = createCullShootView(fake.repository);
    const result = await view.read({ shots, selectedId: "old-10", filter: "all", updatedAt: 1 });
    expect(result.shots).toHaveLength(337);
    expect(fake.state.manifest.photoIds).toHaveLength(337);
    for (const [index, shot] of result.shots.entries()) {
      expect(shot.id).toBe(`old-${index}`);
      expect(shot.relativePath).toBe(`folder-${index}/same.ARW`);
      expect(view.photoId(shot.id)).toBe(`studio:${shot.id}`);
    }
    expect(JSON.stringify(fake.state.documents["studio:old-0"])).toBe(nativeBefore);
    expect(JSON.stringify(shots.map(({ file: _file, previewBlob: _blob, ...rest }) => rest))).toBe(
      original,
    );
    expect(fake.writes()).toBe(0);
  });
  test("reviewing a photo merges an independent native edit without converting its recipe", async () => {
    const fake = fakeRepository(),
      input = await developPhotoFromFile(new File(["original"], "photo.jpg"));
    await fake.add([input]);
    const view = createCullShootView(fake.repository),
      loaded = await view.read();
    const settings = defaultDevelopSettings();
    settings.exposure = 1.25;
    settings.hsl[3]!.hue = -12;
    fake.state.documents[input.id] = pushHistory(
      createDevelopDocument(input.id),
      settings,
      "After opening Cull",
    );
    const history = JSON.stringify(fake.state.documents[input.id]!.history);
    loaded.shots[0]!.verdict = "keep";
    await view.save(loaded.shots, loaded.shots[0]!.id, "all");
    expect(fake.state.documents[input.id]!.metadata.flag).toBe("pick");
    expect(JSON.stringify(fake.state.documents[input.id]!.history)).toBe(history);
    expect(fake.state.photos[0]!.sourceBlob).toBe(input.sourceBlob);
  });
  test("unknown analysis is explicit and same filenames remain distinct", async () => {
    const fake = fakeRepository();
    await fake.add(
      await Promise.all(
        ["one", "two"].map((data) => developPhotoFromFile(new File([data], "same.jpg"))),
      ),
    );
    const loaded = await createCullShootView(fake.repository).read();
    expect(loaded.unanalyzedIds.size).toBe(2);
    expect(new Set(loaded.shots.map((s) => s.id)).size).toBe(2);
    expect(loaded.shots.every((shot) => shot.verdict === "undecided")).toBe(true);
  });
  test("conflicting review fails without overwriting remote decisions", async () => {
    const fake = fakeRepository();
    await fake.add([developPhotoFromShot(oldPhoto("one"))]);
    const view = createCullShootView(fake.repository),
      loaded = await view.read();
    fake.state.documents["studio:one"]!.metadata.flag = "reject";
    loaded.shots[0]!.verdict = "keep";
    await expect(view.save(loaded.shots, "one", "all")).rejects.toThrow("review changed elsewhere");
    expect(fake.state.documents["studio:one"]!.metadata.flag).toBe("reject");
    expect(fake.writes()).toBe(0);
  });
  test("old sliders cannot overwrite any canonical treatment", async () => {
    const fake = fakeRepository();
    await fake.add([developPhotoFromShot(oldPhoto("one"))]);
    const view = createCullShootView(fake.repository),
      loaded = await view.read();
    loaded.shots[0]!.edits.exposure = 99;
    await expect(view.save(loaded.shots, "one", "all")).rejects.toThrow("edited in Develop");
    expect(fake.writes()).toBe(0);
  });
  test("late import membership remains when an older Cull view saves", async () => {
    const fake = fakeRepository();
    await fake.add([developPhotoFromShot(oldPhoto("one"))]);
    const view = createCullShootView(fake.repository),
      loaded = await view.read();
    await fake.add([developPhotoFromShot(oldPhoto("two"))]);
    loaded.shots[0]!.verdict = "keep";
    await view.save(loaded.shots, "one", "all");
    expect(fake.state.manifest.photoIds).toEqual(["studio:one", "studio:two"]);
    expect(Object.keys(fake.state.documents)).toHaveLength(2);
  });
});
