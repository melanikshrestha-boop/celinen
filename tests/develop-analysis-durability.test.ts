import { describe, expect, test } from "bun:test";
import { createShootRepository } from "../src/lib/develop/shoot-repository";
import { createCullShootView } from "../src/lib/develop/cull-view";
import {
  developPhotoFromFile,
  developPhotoFromShot,
  reconnectDevelopPhoto,
  developAnalysisReceiptSchema,
  readDevelopPhotoAnalysis,
  mergeDevelopImportCommit,
  pushHistory,
  type DevelopPhotoInput,
  type DevelopAnalysisReceipt,
} from "../src/lib/develop/store";
import { attachImportAnalysis, isImportAnalyzed } from "../src/lib/studio/cull-on-import";
import { developAnalysisFromShot } from "../src/lib/develop/analysis";
import type { Analysis } from "../src/lib/imaging";
import { developIdbDouble } from "./fixtures/develop-idb-double";

// Fresh regression for the user-owned active-tree investigation. Synthetic I/O
// only; this file never imports Studio, a decoder, or another account's storage.
const measurements: Analysis = {
  sharpness: 200,
  brightness: 120,
  clippedHighlights: 0,
  clippedShadows: 0,
  hash: "01".repeat(32),
  tone: { black: 0, white: 255, median: 120, rMean: 120, gMean: 119, bMean: 118, satMean: 0.2 },
};
function receipt(photo: DevelopPhotoInput, namespace: string): DevelopAnalysisReceipt {
  return developAnalysisReceiptSchema.parse({
    version: 1,
    kind: "mechanical",
    namespace,
    photoId: photo.id,
    sourceDigest: photo.sourceDigest,
    engine: { name: "native-cpp", version: "synthetic-engine-v4" },
    representation: "embedded-preview",
    width: 12,
    height: 8,
    analysis: { ...measurements, clippedHighlights: 12.5, clippedShadows: 25, faces: null },
    captureTimeMs: 1700000000000,
    captureTimeBasis: "camera_clock",
    cameraKey: "Synthetic camera",
  });
}
async function fixture() {
  const db = developIdbDouble();
  const repository = createShootRepository({
    scope: `analysis-durability-${crypto.randomUUID()}`,
    libraryId: "reserved-shoot",
    factory: db.factory,
  });
  const photos = await Promise.all(
    ["a", "b", "c"].map(async (id) => ({
      ...(await developPhotoFromFile(
        new File([`synthetic-${id}`], `${id}.jpg`, { type: "image/jpeg" }),
      )),
      width: 12,
      height: 8,
      previewBlob: new Blob([`preview-${id}`], { type: "image/jpeg" }),
    })),
  );
  await repository.store.addPhotosWithDocuments(photos);
  const view = createCullShootView(repository);
  const loaded = await view.read();
  return { db, repository, photos, view, loaded };
}

describe("canonical mechanical analysis durability", () => {
  test("receipt namespaces accept the store's escaped account and shoot limits", async () => {
    const db = developIdbDouble();
    const repository = createShootRepository({
      scope: '"'.repeat(512),
      libraryId: '"'.repeat(512),
      factory: db.factory,
    });
    try {
      const photo = await developPhotoFromFile(new File(["synthetic"], "escaped-scope.jpg"));
      const analysis = receipt(photo, repository.namespace);
      await repository.store.addPhotosWithDocuments([{ ...photo, analysis }]);
      const saved = (await repository.store.readPhoto(photo.id))!;
      expect(readDevelopPhotoAnalysis(saved.photo, saved.document, repository.namespace)).toEqual(
        analysis,
      );
    } finally {
      repository.close();
    }
  });

  test("successful Cull measurements survive a fresh view without a legacy snapshot", async () => {
    const f = await fixture();
    try {
      const before = await f.repository.read();
      const shots = f.loaded.shots.map((shot) => ({
        ...attachImportAnalysis(shot, {
          width: 12,
          height: 8,
          analysis: measurements,
          backend: "worker",
        }),
        verdict: "keep" as const,
      }));
      expect(shots.every(isImportAnalyzed)).toBe(true);
      await f.view.save(shots, f.loaded.selectedId, "all");
      const after = await f.repository.read();
      expect(after.manifest.photoIds).toEqual(before.manifest.photoIds);
      for (const photo of after.photos) {
        expect(photo.sourceDigest).toBe(
          before.photos.find((item) => item.id === photo.id)!.sourceDigest,
        );
        expect(await photo.sourceBlob!.text()).toBe(
          await before.photos.find((item) => item.id === photo.id)!.sourceBlob!.text(),
        );
        expect(after.documents[photo.id]!.history).toEqual(before.documents[photo.id]!.history);
        expect(after.documents[photo.id]!.metadata.flag).toBe("pick");
      }
      const reopened = await createCullShootView(f.repository).read();
      expect(reopened.shots.filter(isImportAnalyzed)).toHaveLength(3);
      expect(reopened.unanalyzedIds.size).toBe(0);
      expect(reopened.shots.map((shot) => shot.tone)).toEqual(shots.map((shot) => shot.tone));
    } finally {
      f.repository.close();
    }
  });

  test("an unchanged canonical view does no library read or write during a flush", async () => {
    const f = await fixture();
    try {
      f.db.log.length = 0;
      await f.view.save(f.loaded.shots, f.loaded.selectedId, "all");
      expect(f.db.log).toEqual([]);
    } finally {
      f.repository.close();
    }
  });

  test("an analysis-only failed transaction is not acknowledged and is retryable", async () => {
    const f = await fixture();
    try {
      const shots = f.loaded.shots.map((shot) =>
        attachImportAnalysis(shot, {
          width: 12,
          height: 8,
          analysis: measurements,
          backend: "worker",
        }),
      );
      f.db.faults.complete = true;
      await expect(f.view.save(shots, f.loaded.selectedId, "all")).rejects.toThrow();
      f.db.faults.complete = false;
      expect((await createCullShootView(f.repository).read()).unanalyzedIds.size).toBe(3);
      await f.view.save(shots, f.loaded.selectedId, "all");
      expect((await createCullShootView(f.repository).read()).unanalyzedIds.size).toBe(0);
    } finally {
      f.repository.close();
    }
  });

  test("atomic import retains exact clipping percentages, provenance and source bytes", async () => {
    const f = await fixture();
    try {
      const input = { ...f.photos[0]!, id: "native-analyzed-import" };
      const analysis = receipt(input, f.repository.namespace);
      const committed = await f.repository.store.addPhotosWithDocuments([{ ...input, analysis }]);
      expect(committed.photos[0]).not.toHaveProperty("analysis");
      expect(
        readDevelopPhotoAnalysis(
          committed.photos[0]!,
          committed.documents[input.id],
          f.repository.namespace,
        ),
      ).toEqual(analysis);
      const view = createCullShootView(f.repository);
      const loaded = await view.read();
      const projected = loaded.shots.find((shot) => shot.id === input.id)!;
      expect(projected.clippedHighlights).toBe(12.5);
      expect(projected.clippedShadows).toBe(25);
      expect(projected.flags).toContain("overexposed");
      expect(projected.cameraKey).toBe("Synthetic camera");
      expect(projected.captureTimeBasis).toBe("camera_clock");
      f.db.log.length = 0;
      await view.save(loaded.shots, loaded.selectedId, loaded.filter);
      expect(f.db.log).toEqual([]);
      const saved = (await f.repository.store.readPhoto(input.id))!;
      expect(saved.document.analysis).toEqual(analysis);
      expect(await saved.photo.sourceBlob!.text()).toBe(await input.sourceBlob!.text());
    } finally {
      f.repository.close();
    }
  });

  test("native measurement dimensions and exact provenance survive larger preview projection and auto-cull saves", async () => {
    const f = await fixture();
    try {
      const input = { ...f.photos[0]!, id: "native-portrait", width: 960, height: 1280 };
      const analysis = {
        ...receipt(input, f.repository.namespace),
        width: 192,
        height: 256,
        engine: { name: "native-cpp" as const, version: "lenslabs-cpp-0.1" },
        representation: "source" as const,
      };
      await f.repository.store.addPhotosWithDocuments([{ ...input, analysis }]);
      const view = createCullShootView(f.repository);
      const loaded = await view.read();
      const projected = loaded.shots.find((shot) => shot.id === input.id)!;
      expect([projected.width, projected.height]).toEqual([960, 1280]);
      const reordered = {
        ...analysis,
        analysis: {
          ...analysis.analysis,
          tone: Object.fromEntries(Object.entries(analysis.analysis.tone).reverse()),
        },
      } as DevelopAnalysisReceipt;
      expect(developAnalysisFromShot(projected, input, f.repository.namespace, reordered)).toEqual(
        analysis,
      );
      for (const foreign of [
        { ...analysis, namespace: "another-account" },
        { ...analysis, photoId: "another-photo" },
        { ...analysis, sourceDigest: "another-source" },
      ])
        expect(() =>
          developAnalysisFromShot(projected, input, f.repository.namespace, foreign),
        ).toThrow("another source or shoot");
      const newer = developAnalysisFromShot(
        { ...projected, brightness: projected.brightness + 1 },
        input,
        f.repository.namespace,
        analysis,
      );
      expect(newer?.analysis.brightness).toBe(projected.brightness + 1);
      expect(newer?.engine.version).toBe("unversioned");
      const otherBackend = developAnalysisFromShot(
        { ...projected, analysisBackend: "worker" },
        input,
        f.repository.namespace,
        analysis,
      );
      expect(otherBackend?.engine).toEqual({ name: "worker", version: "unversioned" });
      const picked = loaded.shots.map((shot) =>
        shot.id === input.id ? { ...shot, verdict: "keep" as const } : shot,
      );
      await view.save(picked, loaded.selectedId, loaded.filter);
      const saved = (await f.repository.store.readPhoto(input.id))!;
      expect(saved.document.metadata.flag).toBe("pick");
      expect(saved.document.analysis).toEqual(analysis);
      const reopened = createCullShootView(f.repository);
      const restored = await reopened.read();
      f.db.log.length = 0;
      await reopened.save(restored.shots, restored.selectedId, restored.filter);
      expect(f.db.log).toEqual([]);
      expect((await f.repository.store.readPhoto(input.id))!.document.analysis).toEqual(analysis);
    } finally {
      f.repository.close();
    }
  });

  test("analysis writes touch documents only and stale editor saves cannot erase the receipt", async () => {
    const f = await fixture();
    try {
      const photo = f.photos[0]!;
      const before = (await f.repository.store.readPhoto(photo.id))!;
      const analysis = receipt(photo, f.repository.namespace);
      f.db.log.length = 0;
      await f.repository.store.savePhotoAnalyses([analysis]);
      expect(f.db.log.filter((entry) => entry.includes(":put:"))).toHaveLength(1);
      expect(f.db.log.find((entry) => entry.includes(":put:"))).toStartWith("documents:put:");
      const settings = structuredClone(before.document.history[0]!.settings);
      settings.exposure = 0.75;
      await expect(
        f.repository.store.saveDocument(pushHistory(before.document, settings)),
      ).rejects.toThrow("changed in another tab");
      const current = (await f.repository.store.readPhoto(photo.id))!;
      expect(current.document.analysis).toEqual(analysis);
      expect(current.document.history).toEqual(before.document.history);
      const withoutAnalysis = { ...current.document, analysis: undefined };
      const next = await f.repository.store.saveDocument(withoutAnalysis);
      expect(next.analysis).toEqual(analysis);
      expect(next.metadata).toEqual(before.document.metadata);
    } finally {
      f.repository.close();
    }
  });

  test("foreign namespace, photo, source, invalid units and duplicate receipts cannot partially save", async () => {
    const f = await fixture();
    try {
      const good = receipt(f.photos[0]!, f.repository.namespace);
      const other = receipt(f.photos[1]!, f.repository.namespace);
      for (const invalid of [
        { ...other, namespace: JSON.stringify(["another-account", "reserved-shoot"]) },
        { ...other, photoId: "unknown-photo" },
        { ...other, sourceDigest: good.sourceDigest },
        { ...other, analysis: { ...other.analysis, clippedHighlights: 100.1 } },
        { ...other, analysis: { ...other.analysis, brightness: NaN } },
        { ...other, kind: "semantic" },
      ]) {
        await expect(
          f.repository.store.savePhotoAnalyses([good, invalid as DevelopAnalysisReceipt]),
        ).rejects.toThrow();
        expect(
          (await f.repository.store.readPhoto(good.photoId))!.document.analysis,
        ).toBeUndefined();
      }
      await expect(f.repository.store.savePhotoAnalyses([good, good])).rejects.toThrow("twice");
      const source = (await f.repository.store.readPhoto(good.photoId))!;
      expect(
        readDevelopPhotoAnalysis(
          source.photo,
          { ...source.document, analysis: { ...good, namespace: "wrong" } },
          f.repository.namespace,
        ),
      ).toBeNull();
    } finally {
      f.repository.close();
    }
  });

  test("virtual copies keep their own receipt identity and missing-original previews stay missing", async () => {
    const f = await fixture();
    try {
      const missing = {
        ...f.photos[0]!,
        id: "missing-source",
        sourceBlob: null,
        sourceDigest: null,
      };
      const analysis = receipt(missing, f.repository.namespace);
      const committed = await f.repository.store.addPhotosWithDocuments([{ ...missing, analysis }]);
      const copy = await f.repository.store.createVirtualCopy(
        missing.id,
        committed.documents[missing.id]!.revision,
      );
      expect(copy.photo.sourceAvailable).toBe(false);
      expect(copy.photo.sourceBlob).toBeNull();
      expect(copy.document.analysis!.photoId).toBe(copy.photo.id);
      expect(
        readDevelopPhotoAnalysis(copy.photo, copy.document, f.repository.namespace),
      ).not.toBeNull();
      const loaded = await createCullShootView(f.repository).read();
      expect(loaded.unanalyzedIds.has(copy.photo.id)).toBe(false);
      expect(loaded.shots.find((shot) => shot.id === copy.photo.id)!.sourceAvailable).toBe(false);
      expect((await f.repository.read()).manifest.photoIds).toContain(missing.id);
    } finally {
      f.repository.close();
    }
  });

  test("reconnecting an unverified preview preserves inert analysis without blocking edits or promoting it", async () => {
    const f = await fixture();
    try {
      const analyzed = attachImportAnalysis(f.loaded.shots[0]!, {
        width: 12,
        height: 8,
        analysis: measurements,
        backend: "worker",
      });
      const input = developPhotoFromShot({
        ...analyzed,
        id: "unverified-preview",
        file: new File([], analyzed.name),
        sourceAvailable: false,
        sourceDigest: undefined,
        develop: undefined,
      });
      const analysis = {
        ...receipt(input, f.repository.namespace),
        engine: { name: "worker" as const, version: "unversioned" },
        representation: "unknown-preview" as const,
      };
      await f.repository.store.addPhotosWithDocuments([{ ...input, analysis }]);
      const missing = (await f.repository.store.readPhoto(input.id))!;
      const original = new File(
        ["explicitly reconnected synthetic original"],
        missing.photo.sourceFileName,
      );
      const reconnect = await reconnectDevelopPhoto(
        missing.photo,
        original,
        new Blob(["new preview"]),
        { width: 12, height: 8 },
      );
      f.db.log.length = 0;
      await f.repository.store.attachMissingOriginal(reconnect, reconnect.reconnectExpected!);
      expect(f.db.log.some((entry) => entry.startsWith("documents:put:"))).toBe(false);
      const attached = (await f.repository.store.readPhoto(input.id))!;
      expect(attached.document).toEqual(missing.document);
      expect(
        readDevelopPhotoAnalysis(attached.photo, attached.document, f.repository.namespace),
      ).toBeNull();
      const settings = structuredClone(attached.document.history[0]!.settings);
      settings.exposure = 0.75;
      const saved = await f.repository.store.saveDocument(pushHistory(attached.document, settings));
      expect(saved.analysis).toEqual(analysis);
      expect(saved.analysis!.sourceDigest).toBeNull();
      expect(saved.history.at(-1)!.settings.exposure).toBe(0.75);
      const reopened = await createCullShootView(f.repository).read();
      const shot = reopened.shots.find((frame) => frame.id === "unverified-preview")!;
      expect(reopened.unanalyzedIds.has(shot.id)).toBe(true);
      expect(isImportAnalyzed(shot)).toBe(false);
      for (const changed of [
        { ...analysis, engine: { ...analysis.engine, version: "invented-version" } },
        { ...analysis, namespace: "another-account" },
        { ...analysis, sourceDigest: "another-source" },
      ])
        await expect(
          f.repository.store.saveDocument({ ...saved, analysis: changed }),
        ).rejects.toThrow("another source or shoot");
      const current = (await f.repository.store.readPhoto(input.id))!;
      expect(current.document).toEqual(saved);
      const verified = receipt(current.photo, f.repository.namespace);
      await f.repository.store.savePhotoAnalyses([verified]);
      const final = (await f.repository.store.readPhoto(input.id))!;
      expect(readDevelopPhotoAnalysis(final.photo, final.document, f.repository.namespace)).toEqual(
        verified,
      );
      expect(final.document.history).toEqual(saved.history);
      expect(await final.photo.sourceBlob!.text()).toBe(await original.text());
      expect(final.photo.legacy).toEqual(missing.photo.legacy);
    } finally {
      f.repository.close();
    }
  });

  test("batched import notifications read only the exact manifest and retain its current order", async () => {
    const f = await fixture();
    try {
      const changes = [];
      for (const id of ["import-d", "import-e"]) {
        const commit = await f.repository.store.addPhotosWithDocuments([{ ...f.photos[0]!, id }]);
        changes.push({ kind: "photos" as const, ids: [id], commit });
      }
      const manifest = await f.repository.readManifest();
      await f.repository.saveManifest(
        { ...manifest, photoIds: [...manifest.photoIds].reverse(), selectedId: "import-e" },
        manifest.revision,
      );
      f.db.log.length = 0;
      const loaded = await f.view.read(undefined, () => true, changes);
      expect(loaded.shots.map((shot) => shot.id)).toEqual([...manifest.photoIds].reverse());
      expect(loaded.selectedId).toBe("import-e");
      expect(f.db.log.some((entry) => entry.includes(":index:"))).toBe(false);
      f.db.log.length = 0;
      await f.view.save(loaded.shots, loaded.selectedId, loaded.filter);
      expect(f.db.log).toEqual([]);
    } finally {
      f.repository.close();
    }
  });

  test("a buffered import receipt predating this view's pick falls back without undoing its saved document", async () => {
    const f = await fixture();
    try {
      const input = { ...f.photos[0]!, id: "buffered-import" };
      const analysis = receipt(input, f.repository.namespace);
      const commit = await f.repository.store.addPhotosWithDocuments([{ ...input, analysis }]);
      const view = createCullShootView(f.repository);
      const initial = await view.read();
      const picked = initial.shots.map((shot) =>
        shot.id === input.id ? { ...shot, verdict: "keep" as const } : shot,
      );
      await view.save(picked, input.id, initial.filter);
      const before = await f.repository.read();
      expect(before.documents[input.id]!.revision).toBeGreaterThan(
        commit.documents[input.id]!.revision,
      );
      // Direct callers still cannot merge an older document over a newer one.
      expect(() => mergeDevelopImportCommit(before, commit)).toThrow("changed in another tab");
      f.db.log.length = 0;
      const refreshed = await view.read(undefined, () => true, [
        { kind: "photos", ids: [input.id], commit },
      ]);
      expect(f.db.log).toContain("photos:index:namespace");
      expect(refreshed.shots.map((shot) => shot.id)).toEqual(before.manifest.photoIds);
      expect(refreshed.selectedId).toBe(input.id);
      expect(refreshed.shots.find((shot) => shot.id === input.id)!.verdict).toBe("keep");
      expect(refreshed.unanalyzedIds.has(input.id)).toBe(false);
      const after = await f.repository.read();
      expect(after.documents).toEqual(before.documents);
      expect(after.manifest).toEqual(before.manifest);
      expect(await after.photos.find((photo) => photo.id === input.id)!.sourceBlob!.text()).toBe(
        await input.sourceBlob!.text(),
      );
      f.db.log.length = 0;
      await view.save(refreshed.shots, refreshed.selectedId, refreshed.filter);
      expect(f.db.log).toEqual([]);
    } finally {
      f.repository.close();
    }
  });

  test("invalid buffered media and unsafe revisions are still rejected instead of treated as stale", async () => {
    const f = await fixture();
    try {
      const input = { ...f.photos[0]!, id: "invalid-buffered-import" };
      const commit = await f.repository.store.addPhotosWithDocuments([input]);
      const invalid = [
        {
          ...commit,
          photos: commit.photos.map((photo) => ({ ...photo, sourceBlob: new Blob([]) })),
        },
        { ...commit, documents: { [input.id]: { ...commit.documents[input.id]!, revision: -1 } } },
      ];
      for (const bad of invalid) {
        f.db.log.length = 0;
        await expect(
          f.view.read(undefined, () => true, [{ kind: "photos", ids: [input.id], commit: bad }]),
        ).rejects.toThrow();
        expect(f.db.log).toEqual([]);
      }
    } finally {
      f.repository.close();
    }
  });

  test("an incomplete import event batch falls back instead of dropping a saved photo", async () => {
    const f = await fixture();
    try {
      await f.repository.store.addPhotosWithDocuments([
        { ...f.photos[0]!, id: "unobserved-import" },
      ]);
      const commit = await f.repository.store.addPhotosWithDocuments([
        { ...f.photos[0]!, id: "observed-import" },
      ]);
      f.db.log.length = 0;
      const loaded = await f.view.read(undefined, () => true, [
        { kind: "photos", ids: ["observed-import"], commit },
      ]);
      expect(loaded.shots).toHaveLength(5);
      expect(loaded.shots.some((shot) => shot.id === "unobserved-import")).toBe(true);
      expect(f.db.log).toContain("photos:index:namespace");
    } finally {
      f.repository.close();
    }
  });
});
