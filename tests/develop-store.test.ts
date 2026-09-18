import { describe, expect, spyOn, test } from "bun:test";
import { defaultDevelopSettings } from "../src/lib/develop/contract";
import {
  addSnapshot,
  canPreserveDevelopOriginalOnRestore,
  createDevelopDocument,
  createDevelopPreset,
  createDevelopStore,
  currentRecipe,
  DEVELOP_HISTORY_LIMIT,
  DEVELOP_RECOVERY_LIMITS,
  developDocumentSchema,
  developDocumentForImport,
  developInitialStateFromShot,
  developPhotoFromFile,
  developPhotoFromShot,
  developRecoveryDocuments,
  parseDevelopRecovery,
  prepareDevelopRecovery,
  jumpToHistory,
  mergeDevelopImportCommit,
  pushHistory,
  redoHistory,
  reconnectDevelopPhoto,
  removeSnapshot,
  restoreSnapshot,
  undoHistory,
  type DevelopDocument,
  type DevelopLibrary,
} from "../src/lib/develop/store";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
import { fingerprintSource } from "../src/lib/studio/ingest";

describe("Develop progressive import receipt merge", () => {
  test("clones trusted nested history without repeating deep schema validation", async () => {
    const source = await developPhotoFromFile(new File(["source"], "safe.jpg"));
    const photo = { ...source, createdAt: 1, sourceAvailable: true };
    const document = addSnapshot(createDevelopDocument(photo.id), "Saved look");
    const receipt = { photos: [photo], documents: { [photo.id]: document } };
    const parse = spyOn(developDocumentSchema, "parse");
    let merged: DevelopLibrary;
    try {
      merged = mergeDevelopImportCommit({ photos: [], documents: {}, presets: [] }, receipt);
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
    document.history[0]!.settings.hsl[0]!.hue = 75;
    document.history[0]!.settings.channelCurves.red[0]!.y = 0.25;
    document.snapshots[0]!.name = "Changed receipt";
    document.metadata.rating = 5;
    photo.name = "Changed receipt photo";
    expect(merged.documents[source.id]!.history[0]!.settings.hsl[0]!.hue).toBe(0);
    expect(merged.documents[source.id]!.history[0]!.settings.channelCurves.red[0]!.y).toBe(0);
    expect(merged.documents[source.id]!.snapshots[0]!.name).toBe("Saved look");
    expect(merged.documents[source.id]!.metadata.rating).toBe(0);
    expect(merged.photos[0]!.name).toBe("safe.jpg");
    expect(merged.photos[0]!.sourceBlob).toBe(source.sourceBlob);
    merged.documents[source.id]!.snapshots[0]!.settings.exposure = 2;
    expect(document.snapshots[0]!.settings.exposure).toBe(0);
  });

  test("trusted receipt merge still rejects invalid or unsafe revision boundaries", async () => {
    const source = await developPhotoFromFile(new File(["source"], "safe.jpg"));
    const photo = { ...source, createdAt: 1, sourceAvailable: true };
    const document = createDevelopDocument(photo.id);
    const empty: DevelopLibrary = { photos: [], documents: {}, presets: [] };
    for (const revision of [
      -1,
      0.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() =>
        mergeDevelopImportCommit(empty, {
          photos: [photo],
          documents: { [photo.id]: { ...document, revision } },
        }),
      ).toThrow("revision is invalid");
    }
    expect(() =>
      mergeDevelopImportCommit(
        {
          ...empty,
          photos: [photo],
          documents: { [photo.id]: { ...document, revision: NaN } },
        },
        { photos: [photo], documents: { [photo.id]: document } },
      ),
    ).toThrow("current edit revision is invalid");
  });

  test("receipt document keys cannot modify the prototype of the merged index", async () => {
    const source = await developPhotoFromFile(new File(["source"], "safe.jpg"));
    const library: DevelopLibrary = { photos: [], documents: {}, presets: [] };
    const photos = ["__proto__", "constructor", "toString"].map((id) => ({
      ...source,
      id,
      createdAt: 1,
      sourceAvailable: true,
    }));
    const documents = Object.fromEntries(
      photos.map((photo) => [photo.id, createDevelopDocument(photo.id)]),
    );
    const merged = mergeDevelopImportCommit(library, { photos, documents });
    expect(Object.getPrototypeOf(merged.documents)).toBeNull();
    expect(Object.keys(merged.documents)).toEqual(photos.map((photo) => photo.id));
    for (const photo of photos) expect(merged.documents[photo.id]!.photoId).toBe(photo.id);
    expect(Object.keys(library.documents)).toHaveLength(0);
  });

  test("keeps stable photo order and untouched entries while adopting exact saved history", async () => {
    const first = {
      ...(await developPhotoFromFile(new File(["one"], "one.jpg"))),
      createdAt: 1,
      sourceAvailable: true,
    };
    const second = {
      ...(await developPhotoFromFile(new File(["two"], "two.jpg"))),
      createdAt: 2,
      sourceAvailable: true,
    };
    const third = {
      ...(await developPhotoFromFile(new File(["three"], "three.jpg"))),
      createdAt: 3,
      sourceAvailable: true,
    };
    const fourth = {
      ...(await developPhotoFromFile(new File(["four"], "four.jpg"))),
      createdAt: 4,
      sourceAvailable: true,
    };
    const originalDocument = { ...createDevelopDocument(first.id), revision: 2 };
    const savedDocument = {
      ...addSnapshot(
        pushHistory(
          originalDocument,
          { ...currentRecipe(originalDocument), exposure: 0.75 },
          "Saved adjustment",
        ),
        "Keep this look",
      ),
      revision: 3,
      metadata: { rating: 4, flag: "pick" as const, colorLabel: null },
    };
    const library: DevelopLibrary = {
      photos: [first, second],
      documents: { [first.id]: originalDocument, [second.id]: createDevelopDocument(second.id) },
      presets: [createDevelopPreset("Keep preset", defaultDevelopSettings())],
    };
    const before = JSON.stringify(library.documents);
    Object.freeze(library.photos);
    Object.freeze(library.documents);
    const savedPhoto = { ...first, previewBlob: new Blob(["preview"], { type: "image/jpeg" }) };
    const merged = mergeDevelopImportCommit(library, {
      photos: [third, savedPhoto, fourth],
      documents: {
        [third.id]: createDevelopDocument(third.id),
        [first.id]: savedDocument,
        [fourth.id]: createDevelopDocument(fourth.id),
      },
    });
    expect(merged.photos.map((photo) => photo.id)).toEqual([
      first.id,
      second.id,
      third.id,
      fourth.id,
    ]);
    expect(merged.photos[0]!.sourceBlob).toBe(first.sourceBlob);
    expect(merged.photos[0]!.sourceFileName).toBe(first.sourceFileName);
    expect(merged.photos[1]).toBe(second);
    expect(merged.documents[second.id]).toBe(library.documents[second.id]);
    expect(merged.presets).toBe(library.presets);
    expect(merged.documents[first.id]).toEqual(savedDocument);
    expect(merged.documents[first.id]!.history.map((entry) => entry.id)).toEqual(
      savedDocument.history.map((entry) => entry.id),
    );
    expect(JSON.stringify(library.documents)).toBe(before);
    expect(library.photos).toHaveLength(2);
  });

  test("refuses duplicate, mismatched and stale receipts without changing the library", async () => {
    const photo = {
      ...(await developPhotoFromFile(new File(["one"], "one.jpg"))),
      createdAt: 1,
      sourceAvailable: true,
    };
    const document = { ...createDevelopDocument(photo.id), revision: 3 };
    const library: DevelopLibrary = {
      photos: [photo],
      documents: { [photo.id]: document },
      presets: [],
    };
    expect(mergeDevelopImportCommit(library, { photos: [], documents: {} })).toBe(library);
    expect(() =>
      mergeDevelopImportCommit(library, {
        photos: [photo, photo],
        documents: { [photo.id]: document },
      }),
    ).toThrow("receipt does not match");
    expect(() => mergeDevelopImportCommit(library, { photos: [photo], documents: {} })).toThrow(
      "receipt does not match",
    );
    expect(() =>
      mergeDevelopImportCommit(library, {
        photos: [photo],
        documents: { [photo.id]: createDevelopDocument("other") },
      }),
    ).toThrow("receipt does not match");
    expect(() =>
      mergeDevelopImportCommit(library, {
        photos: [photo],
        documents: { [photo.id]: { ...document, revision: 2 } },
      }),
    ).toThrow("another");
    expect(library.documents[photo.id]).toBe(document);
    expect(library.photos[0]).toBe(photo);
  });

  test("one progressive attachment retains all 337 legacy identities and other saved documents", async () => {
    const template = await developPhotoFromFile(new File(["original"], "DSC6973.ARW"));
    const photos = Array.from({ length: 337 }, (_, i) => ({
      ...template,
      id: `studio:legacy-${i}`,
      sourceBlob: null,
      previewBlob: null,
      sourceAvailable: false,
      createdAt: i,
    }));
    const documents = Object.fromEntries(
      photos.map((photo) => [photo.id, createDevelopDocument(photo.id)]),
    );
    const library: DevelopLibrary = { photos, documents, presets: [] };
    const target = photos[200]!;
    const receipt = {
      photos: [
        {
          ...target,
          sourceBlob: template.sourceBlob,
          previewBlob: new Blob(["preview"]),
          sourceAvailable: true,
        },
      ],
      documents: { [target.id]: documents[target.id]! },
    };
    const merged = mergeDevelopImportCommit(library, receipt);
    expect(merged.photos).toHaveLength(337);
    expect(merged.photos.map((photo) => photo.id)).toEqual(photos.map((photo) => photo.id));
    expect(Object.keys(merged.documents)).toHaveLength(337);
    expect(merged.photos[200]!.sourceBlob).toBe(template.sourceBlob);
    expect(photos[200]!.sourceBlob).toBeNull();
    for (const [index, photo] of photos.entries()) {
      if (index === 200) continue;
      expect(merged.photos[index]).toBe(photo);
      expect(merged.documents[photo.id]).toBe(documents[photo.id]);
    }
  });
});

describe("Develop non-destructive edit history", () => {
  test("starts neutral and never aliases the caller's settings or history", () => {
    const settings = defaultDevelopSettings();
    const doc = createDevelopDocument("photo", settings);
    settings.hsl[0]!.hue = 100;
    const displayed = currentRecipe(doc);
    displayed.hsl[0]!.hue = -100;
    expect(currentRecipe(doc).hsl[0]!.hue).toBe(0);
    expect(doc.history).toHaveLength(1);
    expect(doc.cursor).toBe(0);
    expect(doc.revision).toBe(0);
  });

  test("undo, redo and branches retain Original without mutating prior documents", () => {
    const original = createDevelopDocument("photo");
    const first = pushHistory(original, { ...currentRecipe(original), exposure: 1 }, "Exposure");
    const second = pushHistory(first, { ...currentRecipe(first), contrast: 20 }, "Contrast");
    expect(original.history).toHaveLength(1);
    expect(currentRecipe(undoHistory(second)).contrast).toBe(0);
    expect(currentRecipe(redoHistory(undoHistory(second))).contrast).toBe(20);
    const branch = pushHistory(
      undoHistory(second),
      { ...currentRecipe(first), saturation: 30 },
      "Saturation",
    );
    expect(branch.history.map((entry) => entry.label)).toEqual([
      "Original",
      "Exposure",
      "Saturation",
    ]);
    expect(currentRecipe(redoHistory(branch)).contrast).toBe(0);
    expect(currentRecipe(jumpToHistory(branch, 0))).toEqual(defaultDevelopSettings());
    expect(() => jumpToHistory(branch, 10)).toThrow();
    expect(() => jumpToHistory(branch, -1)).toThrow();
  });

  test("a no-op edit does not add duplicate history", () => {
    const doc = createDevelopDocument("photo");
    expect(pushHistory(doc, currentRecipe(doc))).toEqual(doc);
    expect(undoHistory(doc)).toEqual(doc);
    expect(redoHistory(doc)).toEqual(doc);
  });

  test("snapshots survive branching and can be restored as a new undoable edit", () => {
    const a = pushHistory(
      createDevelopDocument("photo"),
      { ...defaultDevelopSettings(), exposure: 2 },
      "Exposure",
    );
    const saved = addSnapshot(a, "Warm edit");
    const snapshotId = saved.snapshots[0]!.id;
    const changed = pushHistory(undoHistory(saved), {
      ...defaultDevelopSettings(),
      saturation: 80,
    });
    const restored = restoreSnapshot(changed, snapshotId);
    expect(currentRecipe(restored).exposure).toBe(2);
    expect(currentRecipe(undoHistory(restored)).saturation).toBe(80);
    expect(removeSnapshot(restored, snapshotId).snapshots).toHaveLength(0);
    expect(restored.snapshots).toHaveLength(1);
    expect(() => restoreSnapshot(restored, "missing")).toThrow("no longer available");
  });

  test("snapshot names and count have explicit limits", () => {
    let doc = createDevelopDocument("photo");
    expect(() => addSnapshot(doc, " ")).toThrow();
    for (let i = 0; i < 50; i++) doc = addSnapshot(doc, `Snapshot ${i}`);
    expect(() => addSnapshot(doc, "One too many")).toThrow("50 snapshots");
  });

  test("history cap keeps Original and the latest 200 steps, not stale redo branches", () => {
    let doc = createDevelopDocument("photo");
    const originalId = doc.history[0]!.id;
    doc = addSnapshot(doc, "Original saved");
    for (let i = 0; i < 250; i++)
      doc = pushHistory(doc, { ...currentRecipe(doc), exposure: i % 2 ? 1 : -1 }, `Step ${i}`);
    expect(doc.history).toHaveLength(DEVELOP_HISTORY_LIMIT + 1);
    expect(doc.history[0]!.id).toBe(originalId);
    expect(doc.history.at(-1)!.label).toBe("Step 249");
    expect(currentRecipe(jumpToHistory(doc, 0))).toEqual(defaultDevelopSettings());
    expect(doc.snapshots).toHaveLength(1);
  }, 60000);

  test("rejects corrupt cursor, duplicate snapshot IDs and invalid settings", () => {
    const doc = addSnapshot(createDevelopDocument("photo"), "One");
    expect(developDocumentSchema.safeParse({ ...doc, cursor: 99 }).success).toBe(false);
    expect(
      developDocumentSchema.safeParse({ ...doc, snapshots: [doc.snapshots[0], doc.snapshots[0]] })
        .success,
    ).toBe(false);
    expect(() => pushHistory(doc, { ...currentRecipe(doc), exposure: Number.NaN })).toThrow();
    expect(() =>
      pushHistory(doc, { ...currentRecipe(doc), masks: [{ id: "broken" }] as never }),
    ).toThrow();
  });

  test("presets deep-copy a recipe and do not consume saved history", () => {
    const settings = defaultDevelopSettings();
    const preset = createDevelopPreset("Clean color", settings);
    settings.grading.shadows.hue = 240;
    expect(preset.settings.grading.shadows.hue).toBe(0);
    expect(preset.revision).toBe(0);
    expect(() => createDevelopPreset("", settings)).toThrow();
  });

  test("recovery includes an uncommitted gesture without modifying saved documents", () => {
    const original = createDevelopDocument("one");
    const other = createDevelopDocument("two");
    const documents = { one: original, two: other };
    const recovered = developRecoveryDocuments(documents, "one", {
      ...defaultDevelopSettings(),
      exposure: 1.5,
    });
    expect(currentRecipe(recovered["one"]!).exposure).toBe(1.5);
    expect(currentRecipe(original).exposure).toBe(0);
    expect(recovered["one"]!.revision).toBe(original.revision);
    expect(recovered["one"]!.history.at(-1)!.label).toBe("Recovered adjustment");
    expect(recovered["two"]).toEqual(other);
    expect(recovered["two"]).not.toBe(other);
    expect(developRecoveryDocuments(documents, null, defaultDevelopSettings())["one"]).toEqual(
      original,
    );
  });

  test("1,000 deterministic edit/undo/redo/reload sequences preserve the selected recipe", () => {
    for (let seed = 1; seed <= 1000; seed++) {
      let random = seed;
      const next = () => {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        return random;
      };
      let doc = createDevelopDocument(`photo-${seed}`);
      let expected = [0],
        cursor = 0;
      for (let step = 0; step < 20; step++) {
        const operation = next() % 4;
        if (operation === 0) {
          doc = undoHistory(doc);
          cursor = Math.max(0, cursor - 1);
        } else if (operation === 1) {
          doc = redoHistory(doc);
          cursor = Math.min(expected.length - 1, cursor + 1);
        } else {
          const exposure = ((next() % 101) - 50) / 10;
          doc = pushHistory(doc, { ...currentRecipe(doc), exposure });
          if (exposure !== expected[cursor]) {
            expected = [...expected.slice(0, cursor + 1), exposure];
            cursor = expected.length - 1;
          }
        }
        // IndexedDB structured clones preserve the same JSON recipe/history data.
        doc = developDocumentSchema.parse(JSON.parse(JSON.stringify(doc)));
        expect(currentRecipe(doc).exposure).toBe(expected[cursor]!);
        expect(doc.cursor).toBe(cursor);
        expect(doc.history[0]!.settings).toEqual(defaultDevelopSettings());
      }
    }
  }, 60000);
});

describe("Develop local photo identity and workspace boundary", () => {
  function studioPhoto(patch: Partial<Shot> = {}): Shot {
    return {
      id: "studio-photo",
      name: "source.ARW",
      file: new File(["source"], "source.ARW"),
      width: 6000,
      height: 4000,
      isRaw: true,
      sourceAvailable: true,
      previewUrl: null,
      edits: { ...DEFAULT_EDITS },
      verdict: "undecided",
      score: 98,
      ...patch,
    } as Shot;
  }

  test("Studio imports transfer supported legacy parameters as an undoable initial treatment", () => {
    const shot = studioPhoto({
      edits: {
        exposure: 50,
        contrast: 12,
        temp: -18,
        highlights: -24,
        shadows: 33,
        saturation: 16,
        crop: "1:1",
      },
      verdict: "keep",
      develop: { origin: "lightroom", at: 1, rating: 4, label: " Blue " },
    });
    const previous = JSON.stringify({
      edits: shot.edits,
      develop: shot.develop,
      verdict: shot.verdict,
    });
    const input = developPhotoFromShot(shot),
      doc = developDocumentForImport(input),
      settings = currentRecipe(doc);
    expect(settings.exposure).toBeCloseTo(Math.log2(1.5), 12);
    expect(settings.temperature).toBe(-18);
    expect(settings.contrast).toBe(12);
    expect(settings.highlights).toBe(-24);
    expect(settings.shadows).toBe(33);
    expect(settings.saturation).toBe(16);
    expect(settings.crop.x).toBeCloseTo(1 / 6, 12);
    expect(settings.crop.width).toBeCloseTo(2 / 3, 12);
    expect(settings.crop.height).toBe(1);
    expect(doc.metadata).toEqual({ rating: 4, flag: "pick", colorLabel: "blue", hearted: false });
    expect(doc.history.map((entry) => entry.label)).toEqual(["Original", "Studio settings"]);
    expect(currentRecipe(undoHistory(doc))).toEqual(defaultDevelopSettings());
    expect(
      JSON.stringify({ edits: shot.edits, develop: shot.develop, verdict: shot.verdict }),
    ).toBe(previous);
  });

  test("Studio neutral metadata imports never invent stars or infer a pick from quality", () => {
    const doc = developDocumentForImport(developPhotoFromShot(studioPhoto()));
    expect(doc.history).toHaveLength(1);
    expect(doc.metadata).toEqual({ rating: 0, flag: null, colorLabel: null, hearted: false });
    expect(
      developInitialStateFromShot(
        studioPhoto({
          verdict: "reject",
          develop: { origin: "sidecar", at: 1, rating: -1, label: "Red" },
        }),
      ).metadata,
    ).toEqual({ rating: 0, flag: "reject", colorLabel: "red", hearted: false });
    expect(
      developInitialStateFromShot(
        studioPhoto({
          verdict: "undecided",
          develop: { origin: "sidecar", at: 1, rating: 5, label: "Personal custom label" },
        }),
      ).metadata,
    ).toEqual({ rating: 5, flag: null, colorLabel: null, hearted: false });
  });

  test("legacy gain conversion is finite and bounded at the black-exposure endpoint", () => {
    for (const [value, expected] of [
      [-100, -5],
      [-50, -1],
      [0, 0],
      [100, 1],
    ]) {
      const settings = developInitialStateFromShot(
        studioPhoto({ edits: { ...DEFAULT_EDITS, exposure: value! } }),
      ).settings;
      expect(settings.exposure).toBe(expected!);
    }
    expect(() =>
      developInitialStateFromShot(
        studioPhoto({ edits: { ...DEFAULT_EDITS, exposure: Number.NaN } }),
      ),
    ).toThrow("invalid saved adjustment");
  });

  test("legacy crop retains face-biased positioning and skips unknown image dimensions", () => {
    const focused = studioPhoto({
      edits: { ...DEFAULT_EDITS, crop: "1:1" },
      faces: { count: 1, faceSharpness: 10, eyesOpen: true, center: { x: 0.9, y: 0.5 } },
    });
    expect(developInitialStateFromShot(focused).settings.crop.x).toBeCloseTo(1 / 3, 12);
    expect(developInitialStateFromShot({ ...focused, width: 0, height: 0 }).settings.crop).toEqual(
      defaultDevelopSettings().crop,
    );
  });

  test("identical bytes reuse an ID, while same-name different photos never share edits", async () => {
    const a = new File(["one"], "portrait.jpg", { type: "image/jpeg", lastModified: 10 });
    const b = new File(["two"], "portrait.jpg", { type: "image/jpeg", lastModified: 10 });
    const renamed = new File(["one"], "renamed.jpg", { type: "image/jpeg", lastModified: 20 });
    const [pa, pb, pr] = await Promise.all([
      developPhotoFromFile(a),
      developPhotoFromFile(b),
      developPhotoFromFile(renamed),
    ]);
    expect(pa.id).not.toBe(pb.id);
    expect(pa.id).toBe(pr.id);
    expect(pa.sourceBlob).toBe(a);
    expect(pa.sourceDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("explicit reconnect attaches a missing original under its existing Studio identity", async () => {
    const original = new File(["original RAW bytes"], "source.ARW", { lastModified: 123 });
    const previousPreview = new Blob(["old preview"], { type: "image/jpeg" });
    const preview = new Blob(["new preview"], { type: "image/jpeg" });
    const photo = {
      ...developPhotoFromShot(
        studioPhoto({ sourceAvailable: false, width: 0, height: 0, previewBlob: previousPreview }),
      ),
      sourceAvailable: false,
      createdAt: 1,
    };
    const receipt = await reconnectDevelopPhoto(
      photo,
      original,
      preview,
      { width: 1600, height: 1067 },
      "raw-demosaic",
    );
    expect(receipt.id).toBe(photo.id);
    expect(receipt.id).toBe("studio:studio-photo");
    expect(receipt.name).toBe(photo.name);
    expect(receipt.sourceFileName).toBe(photo.sourceFileName);
    expect(receipt.sourceBlob).toBe(original);
    expect(receipt.previewBlob).toBe(preview);
    expect(receipt.previewOrigin).toBe("raw-demosaic");
    expect(receipt.width).toBe(1600);
    expect(receipt.sourceLastModified).toBe(123);
    expect(receipt.sourceDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(receipt.reconnectOriginal).toBe(true);
    expect(receipt.initialState).toBeUndefined();
    expect(photo.sourceBlob).toBeNull();
    expect(photo.previewBlob).toBe(previousPreview);
    expect(photo.sourceDigest).toBeNull();
  });

  test("reconnect rejects a wrong filename or different original bytes", async () => {
    const original = new File(["one"], "source.ARW", { lastModified: 1 });
    const preview = new Blob(["preview"], { type: "image/jpeg" });
    const known = await developPhotoFromFile(original);
    const photo = {
      ...developPhotoFromShot(studioPhoto({ sourceAvailable: false })),
      sourceDigest: known.sourceDigest,
      sourceAvailable: false,
      createdAt: 1,
    };
    await expect(
      reconnectDevelopPhoto(photo, new File(["one"], "SOURCE.ARW"), preview),
    ).rejects.toThrow("Choose the original named");
    await expect(
      reconnectDevelopPhoto(photo, new File(["two"], "source.ARW"), preview),
    ).rejects.toThrow("different bytes");
    const receipt = await reconnectDevelopPhoto(photo, original, preview, {
      width: 1600,
      height: 1067,
    });
    expect(receipt.sourceDigest).toBe(known.sourceDigest);
    expect(receipt.width).toBe(photo.width);
    expect(receipt.height).toBe(photo.height);
    await expect(
      reconnectDevelopPhoto({ ...photo, sourceDigest: "unknown-v1:receipt" }, original, preview),
    ).rejects.toThrow("cannot be verified");
    await expect(reconnectDevelopPhoto(photo, original, new Blob())).rejects.toThrow(
      "valid decoded preview",
    );
  });

  test("reconnect verifies historical chunked SHA-256 without changing its fingerprint format", async () => {
    const original = new File(["known chain source"], "source.ARW", { lastModified: 1 });
    const sourceDigest = await fingerprintSource(original);
    const photo = {
      ...developPhotoFromShot(studioPhoto({ sourceAvailable: false })),
      sourceDigest,
      sourceAvailable: false,
      createdAt: 1,
    };
    const preview = new Blob(["preview"], { type: "image/jpeg" });
    const receipt = await reconnectDevelopPhoto(photo, original, preview);
    expect(receipt.sourceDigest).toBe(sourceDigest);
    expect(receipt.sourceDigest).toStartWith("sha256-chain-v1:");
    await expect(
      reconnectDevelopPhoto(photo, new File(["different source"], "source.ARW"), preview),
    ).rejects.toThrow("different bytes");
  });

  test("reconnect never replaces an already stored original with different or unverified bytes", async () => {
    const original = new File(["stored original"], "source.ARW", { lastModified: 123 });
    const known = await developPhotoFromFile(original);
    const photo = { ...known, id: "studio:stable", sourceAvailable: true, createdAt: 1 };
    const preview = new Blob(["preview"], { type: "image/jpeg" });
    const receipt = await reconnectDevelopPhoto(
      photo,
      new File(["stored original"], "source.ARW", { lastModified: 456 }),
      preview,
    );
    expect(receipt.sourceBlob).toBe(original);
    expect(receipt.sourceLastModified).toBe(123);
    expect(photo.sourceBlob).toBe(original);
    await expect(
      reconnectDevelopPhoto(photo, new File(["replacement"], "source.ARW"), preview),
    ).rejects.toThrow("different bytes");
    await expect(
      reconnectDevelopPhoto({ ...photo, sourceDigest: null }, original, preview),
    ).rejects.toThrow("already has an original");
  });

  test("mixed fingerprint restoration preserves only a complete existing original without incoming bytes", async () => {
    const original = new File(["stored source"], "source.ARW");
    const saved = await developPhotoFromFile(original);
    const restored = {
      ...saved,
      sourceBlob: null,
      sourceDigest: await fingerprintSource(original),
    };
    expect(canPreserveDevelopOriginalOnRestore(saved, restored)).toBe(true);
    expect(canPreserveDevelopOriginalOnRestore(saved, { ...restored, sourceBlob: original })).toBe(
      false,
    );
    expect(canPreserveDevelopOriginalOnRestore({ ...saved, sourceBlob: null }, restored)).toBe(
      false,
    );
    expect(canPreserveDevelopOriginalOnRestore(saved, { ...restored, id: "another-photo" })).toBe(
      false,
    );
    expect(
      canPreserveDevelopOriginalOnRestore(saved, { ...restored, reconnectOriginal: true }),
    ).toBe(false);
    expect(
      canPreserveDevelopOriginalOnRestore(saved, {
        ...restored,
        sourceDigest: `sha256:${"0".repeat(64)}`,
      }),
    ).toBe(false);
    expect(
      canPreserveDevelopOriginalOnRestore(saved, {
        ...restored,
        sourceDigest: "unsupported:receipt",
      }),
    ).toBe(false);
    expect(canPreserveDevelopOriginalOnRestore(saved, { ...restored, sourceDigest: null })).toBe(
      false,
    );
    expect(await saved.sourceBlob!.text()).toBe("stored source");
  });

  test("Studio restored previews remain preview-only and Studio originals are untouched", () => {
    const preview = new Blob(["preview"], { type: "image/jpeg" });
    const original = new File(["RAW"], "frame.ARW", { lastModified: 123 });
    const shot = {
      id: "frame",
      name: "frame.ARW",
      width: 100,
      height: 80,
      isRaw: true,
      file: original,
      previewBlob: preview,
      sourceAvailable: false,
    } as Shot;
    const metadata = JSON.stringify({ ...shot, file: undefined, previewBlob: undefined });
    const imported = developPhotoFromShot(shot);
    expect(imported.sourceBlob).toBeNull();
    expect(imported.previewBlob).toBe(preview);
    expect(imported.sourceFileName).toBe("frame.ARW");
    expect(developPhotoFromShot({ ...shot, sourceAvailable: true }).sourceBlob).toBe(original);
    expect(JSON.stringify({ ...shot, file: undefined, previewBlob: undefined })).toBe(metadata);
  });

  test("337 legacy decode-failed RAW placeholders preserve every identity and edit without fabricating media", () => {
    const shots = Array.from({ length: 337 }, (_, index) =>
      studioPhoto({
        id: `legacy-${index}`,
        name: `DSC${String(index).padStart(5, "0")}.ARW`,
        width: 0,
        height: 0,
        file: new File([], `DSC${index}.preview.jpg`, { type: "image/jpeg", lastModified: 0 }),
        sourceAvailable: false,
        previewBlob: undefined,
        edits: { ...DEFAULT_EDITS, temp: index % 100 },
        verdict: index % 2 ? "keep" : "reject",
      }),
    );
    const before = JSON.stringify(shots);
    const photos = shots.map(developPhotoFromShot);
    expect(photos).toHaveLength(337);
    expect(new Set(photos.map((photo) => photo.id)).size).toBe(337);
    for (const [index, photo] of photos.entries()) {
      expect(photo.id).toBe(`studio:legacy-${index}`);
      expect(photo.sourceBlob).toBeNull();
      expect(photo.previewBlob).toBeNull();
      expect(photo.sourceFileName).toBe(shots[index]!.name);
      expect(photo.initialState?.settings.temperature).toBe(index % 100);
      expect(photo.initialState?.metadata.flag).toBe(index % 2 ? "pick" : "reject");
    }
    expect(JSON.stringify(shots)).toBe(before);
  });

  test("workspace and project namespaces cannot collide by delimiters", () => {
    const a = createDevelopStore({ scope: "a:b", libraryId: "c" });
    const b = createDevelopStore({ scope: "a", libraryId: "b:c" });
    expect(a.namespace).not.toBe(b.namespace);
    expect(createDevelopStore({ scope: "a", libraryId: "c" }).namespace).not.toBe(a.namespace);
    expect(() => createDevelopStore({ scope: "", libraryId: "c" })).toThrow();
    a.close();
    b.close();
  });

  test("unavailable local storage fails instead of pretending edits saved", async () => {
    const store = createDevelopStore({
      scope: "test",
      libraryId: "test",
      factory: {
        open() {
          throw new Error("IDB denied");
        },
      } as unknown as IDBFactory,
    });
    await expect(store.loadLibrary()).rejects.toThrow("IDB denied");
    store.close();
    await expect(store.loadLibrary()).rejects.toThrow("closed");
  });
});

describe("Develop explicit edit recovery", () => {
  const target = { scope: "recovery-test", libraryId: "project-one" };
  const namespace = JSON.stringify([target.scope, target.libraryId]);
  function exportText(documents: Record<string, DevelopDocument>) {
    return JSON.stringify({ version: 1, namespace, documents });
  }
  async function fixture(current = createDevelopDocument("studio:one")): Promise<DevelopLibrary> {
    const source = await developPhotoFromFile(new File(["protected original"], "original.ARW"));
    return {
      photos: [{ ...source, id: current.photoId, sourceAvailable: true, createdAt: 1 }],
      documents: { [current.photoId]: current },
      presets: [],
    };
  }

  test("parses actual v1 export shape including an unsaved draft and old additive defaults", () => {
    const saved = createDevelopDocument("studio:one");
    const draft = { ...currentRecipe(saved), exposure: 1.5 };
    const exported = JSON.parse(
      exportText(developRecoveryDocuments({ [saved.photoId]: saved }, saved.photoId, draft)),
    );
    for (const entry of exported.documents[saved.photoId].history) {
      delete entry.settings.channelCurves;
      delete entry.settings.filmFalloff;
    }
    const recovery = parseDevelopRecovery(JSON.stringify(exported), target);
    expect(currentRecipe(recovery.documents[saved.photoId]!).exposure).toBe(1.5);
    expect(currentRecipe(recovery.documents[saved.photoId]!).channelCurves).toEqual(
      defaultDevelopSettings().channelCurves,
    );
    expect(currentRecipe(recovery.documents[saved.photoId]!).filmFalloff).toBe(0);
    expect(currentRecipe(saved).exposure).toBe(0);
    expect(recovery.namespace).toBe(namespace);
    expect(recovery.documents[saved.photoId]!.revision).toBe(saved.revision);
  });

  test("rejects bad JSON, versions, scopes, projects, IDs and unknown payload fields", () => {
    const current = createDevelopDocument("studio:one");
    const payload = JSON.parse(exportText({ [current.photoId]: current }));
    expect(() => parseDevelopRecovery("not json", target)).toThrow("not valid JSON");
    expect(() => parseDevelopRecovery(JSON.stringify({ ...payload, version: 2 }), target)).toThrow(
      "version 1",
    );
    expect(() =>
      parseDevelopRecovery(JSON.stringify(payload), { ...target, scope: "another" }),
    ).toThrow("different workspace or project");
    expect(() =>
      parseDevelopRecovery(JSON.stringify(payload), { ...target, libraryId: "another" }),
    ).toThrow("different workspace or project");
    expect(() =>
      parseDevelopRecovery(JSON.stringify({ ...payload, documents: { wrong: current } }), target),
    ).toThrow("photo ID");
    expect(() => parseDevelopRecovery(JSON.stringify({ ...payload, photos: [] }), target)).toThrow(
      "version 1",
    );
    expect(() =>
      parseDevelopRecovery(JSON.stringify({ ...payload, documents: [] }), target),
    ).toThrow("document index");
    expect(() =>
      parseDevelopRecovery(
        JSON.stringify({
          ...payload,
          documents: { [current.photoId]: { ...current, sourceBlob: "injected" } },
        }),
        target,
      ),
    ).toThrow("invalid");
    expect(() =>
      parseDevelopRecovery(
        JSON.stringify({ ...payload, documents: JSON.parse('{"__proto__":{}}') }),
        target,
      ),
    ).toThrow("invalid photo identifier");
    expect(Object.hasOwn({}, "polluted")).toBe(false);
  });

  test("caps file size, photo count, history, snapshots and settings ranges", () => {
    const current = createDevelopDocument("studio:one");
    const invalid = (doc: unknown) =>
      JSON.stringify({ version: 1, namespace, documents: { [current.photoId]: doc } });
    expect(() =>
      parseDevelopRecovery(" ".repeat(DEVELOP_RECOVERY_LIMITS.maxBytes + 1), target),
    ).toThrow("32 MB");
    expect(() =>
      parseDevelopRecovery("é".repeat(DEVELOP_RECOVERY_LIMITS.maxBytes / 2 + 1), target),
    ).toThrow("32 MB");
    expect(() =>
      parseDevelopRecovery(
        JSON.stringify({
          version: 1,
          namespace,
          documents: Object.fromEntries(
            Array.from({ length: DEVELOP_RECOVERY_LIMITS.maxDocuments + 1 }, (_, i) => [
              `photo:${i}`,
              null,
            ]),
          ),
        }),
        target,
      ),
    ).toThrow("2,000");
    expect(() =>
      parseDevelopRecovery(JSON.stringify({ version: 1, namespace, documents: {} }), target),
    ).toThrow("between 1");
    const history = Array.from({ length: DEVELOP_HISTORY_LIMIT + 2 }, (_, i) => ({
      ...current.history[0],
      id: `history:${i}`,
    }));
    expect(() => parseDevelopRecovery(invalid({ ...current, history }), target)).toThrow("invalid");
    const snapshots = Array.from({ length: 51 }, (_, i) => ({
      id: `snapshot:${i}`,
      name: "Snapshot",
      settings: currentRecipe(current),
      at: 1,
    }));
    expect(() => parseDevelopRecovery(invalid({ ...current, snapshots }), target)).toThrow(
      "invalid",
    );
    expect(() => parseDevelopRecovery(invalid({ ...current, cursor: 99 }), target)).toThrow(
      "invalid",
    );
    expect(() =>
      parseDevelopRecovery(
        invalid({
          ...current,
          history: [
            { ...current.history[0], settings: { ...currentRecipe(current), exposure: 99 } },
          ],
        }),
        target,
      ),
    ).toThrow("invalid");
  });

  test("prepares an undoable treatment while preserving current metadata, snapshots and original bytes", async () => {
    const saved = addSnapshot(createDevelopDocument("studio:one"), "Keep this snapshot");
    saved.metadata = { rating: 5, flag: "pick", colorLabel: "green", hearted: false };
    saved.revision = 7;
    const library = await fixture(saved);
    const imported = pushHistory(
      createDevelopDocument(saved.photoId),
      { ...defaultDevelopSettings(), exposure: 2 },
      "Unsaved treatment",
    );
    imported.metadata = { rating: 1, flag: "reject", colorLabel: "red", hearted: false };
    imported.revision = 99;
    const recovery = parseDevelopRecovery(exportText({ [saved.photoId]: imported }), target);
    const before = JSON.stringify({ saved, imported });
    const original = library.photos[0]!.sourceBlob;
    const plan = prepareDevelopRecovery(recovery, library, {
      ...target,
      photoIds: [saved.photoId],
    });
    const restored = plan.updates[0]!.document;
    expect(plan.expectedRevisions[saved.photoId]).toBe(7);
    expect(plan.updates[0]!.expectedRevision).toBe(7);
    expect(restored.revision).toBe(7);
    expect(currentRecipe(restored).exposure).toBe(2);
    expect(currentRecipe(undoHistory(restored)).exposure).toBe(0);
    expect(restored.metadata).toEqual(saved.metadata);
    expect(restored.snapshots).toEqual(saved.snapshots);
    expect(restored.history[0]).toEqual(saved.history[0]);
    expect(plan.unchangedPhotoIds).toHaveLength(0);
    expect(library.photos[0]!.sourceBlob).toBe(original);
    expect(await original!.text()).toBe("protected original");
    expect(JSON.stringify({ saved, imported })).toBe(before);
    restored.metadata.rating = 0;
    restored.history[0]!.settings.exposure = -5;
    expect(saved.metadata.rating).toBe(5);
    expect(currentRecipe(saved).exposure).toBe(0);
  });

  test("recovery retains saved redo branches and undo returns to the previously visible treatment", async () => {
    const first = pushHistory(createDevelopDocument("studio:one"), {
      ...defaultDevelopSettings(),
      exposure: 1,
    });
    const saved = undoHistory(pushHistory(first, { ...defaultDevelopSettings(), exposure: 2 }));
    const recovered = pushHistory(createDevelopDocument(saved.photoId), {
      ...defaultDevelopSettings(),
      exposure: -2,
    });
    const library = await fixture(saved);
    const plan = prepareDevelopRecovery(
      parseDevelopRecovery(exportText({ [saved.photoId]: recovered }), target),
      library,
      { ...target, photoIds: [saved.photoId] },
    );
    const restored = plan.updates[0]!.document;
    expect(restored.history.slice(0, saved.history.length)).toEqual(saved.history);
    expect(restored.history.at(-2)!.label).toBe("Before recovery");
    expect(currentRecipe(undoHistory(restored)).exposure).toBe(1);
    expect(currentRecipe(redoHistory(undoHistory(restored))).exposure).toBe(-2);
    expect(restored.metadata).toEqual(saved.metadata);
  });

  test("identical recovery is a no-op and a full history is never silently trimmed", async () => {
    const saved = createDevelopDocument("studio:one");
    saved.history = Array.from({ length: DEVELOP_HISTORY_LIMIT + 1 }, (_, i) => ({
      ...saved.history[0]!,
      id: `history:${i}`,
      settings: { ...defaultDevelopSettings(), exposure: i % 2 },
    }));
    saved.cursor = 1;
    const library = await fixture(saved);
    const same = pushHistory(createDevelopDocument(saved.photoId), currentRecipe(saved));
    const unchanged = prepareDevelopRecovery(
      parseDevelopRecovery(exportText({ [saved.photoId]: same }), target),
      library,
      { ...target, photoIds: [saved.photoId] },
    );
    expect(unchanged.updates).toHaveLength(0);
    expect(unchanged.unchangedPhotoIds).toEqual([saved.photoId]);
    const different = pushHistory(createDevelopDocument(saved.photoId), {
      ...defaultDevelopSettings(),
      exposure: -3,
    });
    const before = JSON.stringify(saved);
    expect(() =>
      prepareDevelopRecovery(
        parseDevelopRecovery(exportText({ [saved.photoId]: different }), target),
        library,
        { ...target, photoIds: [saved.photoId] },
      ),
    ).toThrow("no history was removed");
    expect(JSON.stringify(saved)).toBe(before);
  });

  test("requires explicit unique selections already in the current library", async () => {
    const saved = createDevelopDocument("studio:one");
    const recovery = parseDevelopRecovery(exportText({ [saved.photoId]: saved }), target);
    const library = await fixture(saved);
    expect(() => prepareDevelopRecovery(recovery, library, { ...target, photoIds: [] })).toThrow();
    expect(() =>
      prepareDevelopRecovery(recovery, library, {
        ...target,
        photoIds: [saved.photoId, saved.photoId],
      }),
    ).toThrow("only once");
    expect(() =>
      prepareDevelopRecovery(recovery, library, { ...target, photoIds: ["missing"] }),
    ).toThrow("not in this recovery");
    expect(() =>
      prepareDevelopRecovery(
        recovery,
        { ...library, photos: [] },
        { ...target, photoIds: [saved.photoId] },
      ),
    ).toThrow("missing from this library");
    expect(() =>
      prepareDevelopRecovery(
        recovery,
        { ...library, documents: {} },
        { ...target, photoIds: [saved.photoId] },
      ),
    ).toThrow("missing from this library");
    expect(() =>
      prepareDevelopRecovery(recovery, library, {
        ...target,
        scope: "wrong",
        photoIds: [saved.photoId],
      }),
    ).toThrow("different workspace or project");
  });
});
