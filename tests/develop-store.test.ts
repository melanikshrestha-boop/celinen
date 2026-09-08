import { describe, expect, test } from "bun:test";
import { defaultDevelopSettings } from "../src/lib/develop/contract";
import {
  addSnapshot,
  createDevelopDocument,
  createDevelopPreset,
  createDevelopStore,
  currentRecipe,
  DEVELOP_HISTORY_LIMIT,
  developDocumentSchema,
  developDocumentForImport,
  developInitialStateFromShot,
  developPhotoFromFile,
  developPhotoFromShot,
  developRecoveryDocuments,
  jumpToHistory,
  pushHistory,
  redoHistory,
  removeSnapshot,
  restoreSnapshot,
  undoHistory,
} from "../src/lib/develop/store";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";

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
    expect(doc.metadata).toEqual({ rating: 4, flag: "pick", colorLabel: "blue" });
    expect(doc.history.map((entry) => entry.label)).toEqual(["Original", "Studio settings"]);
    expect(currentRecipe(undoHistory(doc))).toEqual(defaultDevelopSettings());
    expect(
      JSON.stringify({ edits: shot.edits, develop: shot.develop, verdict: shot.verdict }),
    ).toBe(previous);
  });

  test("Studio neutral metadata imports never invent stars or infer a pick from quality", () => {
    const doc = developDocumentForImport(developPhotoFromShot(studioPhoto()));
    expect(doc.history).toHaveLength(1);
    expect(doc.metadata).toEqual({ rating: 0, flag: null, colorLabel: null });
    expect(
      developInitialStateFromShot(
        studioPhoto({
          verdict: "reject",
          develop: { origin: "sidecar", at: 1, rating: -1, label: "Red" },
        }),
      ).metadata,
    ).toEqual({ rating: 0, flag: "reject", colorLabel: "red" });
    expect(
      developInitialStateFromShot(
        studioPhoto({
          verdict: "undecided",
          develop: { origin: "sidecar", at: 1, rating: 5, label: "Personal custom label" },
        }),
      ).metadata,
    ).toEqual({ rating: 5, flag: null, colorLabel: null });
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
