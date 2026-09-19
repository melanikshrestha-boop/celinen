import { describe, expect, test } from "bun:test";
import { completeDevelopImportIds, runDevelopImport } from "../src/lib/develop/import";
import {
  createDevelopDocument,
  developPhotoFromFile,
  type DevelopPhoto,
  type DevelopPhotoInput,
} from "../src/lib/develop/store";

function fixture() {
  const previewed: string[] = [],
    stored: DevelopPhoto[] = [];
  const preparePreview = async (file: File, input: DevelopPhotoInput) => {
    previewed.push(file.name);
    if (file.name.startsWith("broken")) throw new Error("Decoder could not read this photo.");
    return {
      ...input,
      previewBlob: new Blob(["preview"], { type: "image/jpeg" }),
      width: 24,
      height: 16,
    };
  };
  const save = async (input: DevelopPhotoInput) => {
    const photo = { ...input, sourceAvailable: true, createdAt: 1 };
    stored.push(photo);
    return [photo];
  };
  return { previewed, stored, preparePreview, save, existingIds: [] as string[] };
}
const file = (name: string, bytes = name) => new File([bytes], name, { type: "image/jpeg" });

describe("Develop multi-photo import isolation", () => {
  test("an unreadable first photo does not prevent following valid photos from importing", async () => {
    const options = fixture();
    const report = await runDevelopImport([file("broken.ARW"), file("good.jpg")], options);
    expect(report.imported.map((p) => p.name)).toEqual(["good.jpg"]);
    expect(report.failures).toEqual([
      { fileName: "broken.ARW", message: "Decoder could not read this photo." },
    ]);
    expect(report.selectedId).toBe(report.imported[0]!.id);
    expect(report.fatalError).toBeNull();
  });

  test("bad middle files and unsupported sidecars are reported without hiding later photos", async () => {
    const options = fixture();
    const report = await runDevelopImport(
      [
        file("first.jpg"),
        file("broken.ARW"),
        new File(["metadata"], "edits.xmp"),
        file("last.jpg"),
      ],
      options,
    );
    expect(report.imported.map((p) => p.name)).toEqual(["first.jpg", "last.jpg"]);
    expect(report.failures.map((f) => f.fileName)).toEqual(["broken.ARW", "edits.xmp"]);
    expect(options.previewed).not.toContain("edits.xmp");
    expect(report.selectedId).toBe(report.imported[0]!.id);
  });

  test("a storage failure stops the batch while retaining earlier successful receipts", async () => {
    const options = fixture();
    const report = await runDevelopImport(
      [file("first.jpg"), file("second.jpg"), file("last.jpg")],
      {
        ...options,
        save: async (input) => {
          if (input.name === "second.jpg") throw new Error("Storage quota reached.");
          return options.save(input);
        },
      },
    );
    expect(report.imported.map((p) => p.name)).toEqual(["first.jpg"]);
    expect(report.fatalError).toContain("Storage quota reached.");
    expect(report.failures).toHaveLength(0);
    expect(options.previewed).toEqual(["first.jpg", "second.jpg"]);
  });

  test("abort during decoding does not save that photo or continue to later files", async () => {
    const options = fixture(),
      controller = new AbortController();
    const report = await runDevelopImport([file("one.jpg"), file("two.jpg")], {
      ...options,
      signal: controller.signal,
      preparePreview: async (source, input) => {
        const result = await options.preparePreview(source, input);
        controller.abort();
        return result;
      },
    });
    expect(report.stopped).toBe(true);
    expect(report.imported).toHaveLength(0);
    expect(options.stored).toHaveLength(0);
    expect(options.previewed).toEqual(["one.jpg"]);
  });

  test("abort after a committed save still reports those persisted bytes", async () => {
    const options = fixture(),
      controller = new AbortController();
    const report = await runDevelopImport([file("one.jpg"), file("two.jpg")], {
      ...options,
      signal: controller.signal,
      save: async (input) => {
        const result = await options.save(input);
        controller.abort();
        return result;
      },
    });
    expect(report.stopped).toBe(true);
    expect(report.imported.map((p) => p.name)).toEqual(["one.jpg"]);
    expect(report.selectedId).toBe(report.imported[0]!.id);
    expect(options.previewed).toEqual(["one.jpg"]);
  });

  test("duplicate source bytes are skipped before decoding across existing and new files", async () => {
    const options = fixture();
    const existing = file("existing.jpg");
    const known = await developPhotoFromFile(existing);
    options.existingIds.push(known.id);
    const report = await runDevelopImport(
      [existing, file("new.jpg", "same bytes"), file("copy.jpg", "same bytes")],
      options,
    );
    expect(report.duplicates).toBe(2);
    expect(report.imported.map((p) => p.name)).toEqual(["new.jpg"]);
    expect(options.previewed).toEqual(["new.jpg"]);
    expect(options.existingIds).toEqual([known.id]);
  });

  test("reimporting a preview-only photo reaches storage with its existing source identity", async () => {
    const original = file("recovered.jpg", "original camera bytes");
    const preview = new Blob(["saved preview"], { type: "image/jpeg" });
    const identified = await developPhotoFromFile(original, preview);
    const existing: DevelopPhoto = Object.freeze({
      ...identified,
      sourceBlob: null,
      sourceAvailable: false,
      createdAt: 17,
    });
    const options = fixture();
    const report = await runDevelopImport([original], {
      ...options,
      existingIds: completeDevelopImportIds([existing]),
    });
    expect(report.imported).toHaveLength(1);
    expect(report.imported[0]!.id).toBe(existing.id);
    expect(report.imported[0]!.sourceBlob).toBe(original);
    expect(report.selectedId).toBe(existing.id);
    expect(report.duplicates).toBe(0);
    expect(options.previewed).toEqual([original.name]);
    expect(existing.sourceBlob).toBeNull();
    expect(existing.previewBlob).toBe(preview);
    expect(existing.createdAt).toBe(17);
  });

  test("only nonempty originals with nonempty previews qualify as complete duplicates", () => {
    const source = file("original.jpg");
    const preview = new Blob(["preview"]);
    const empty = new Blob();
    const photos = Object.freeze([
      Object.freeze({ id: "complete", sourceBlob: source, previewBlob: preview }),
      Object.freeze({ id: "source-only", sourceBlob: source, previewBlob: null }),
      Object.freeze({ id: "preview-only", sourceBlob: null, previewBlob: preview }),
      Object.freeze({ id: "missing", sourceBlob: null, previewBlob: null }),
      Object.freeze({ id: "empty-source", sourceBlob: empty, previewBlob: preview }),
      Object.freeze({ id: "empty-preview", sourceBlob: source, previewBlob: empty }),
    ]);
    expect(completeDevelopImportIds(photos)).toEqual(["complete"]);
    expect(photos).toHaveLength(6);
    expect(photos[2]!.sourceBlob).toBeNull();
    expect(photos[2]!.previewBlob).toBe(preview);
  });

  test("source-first ingest saves originals even when preview decoding is deferred", async () => {
    const options = fixture();
    const source = file("game-day.jpg", "camera original");
    const report = await runDevelopImport([source], {
      ...options,
      requirePreview: false,
      preparePreview: async (_file, input) => input,
      existingIds: completeDevelopImportIds([], false),
    });

    expect(report.failures).toEqual([]);
    expect(report.imported).toHaveLength(1);
    expect(report.imported[0]!.sourceBlob).toBe(source);
    expect(report.imported[0]!.previewBlob).toBeNull();
    expect(completeDevelopImportIds(report.imported, false)).toEqual([report.imported[0]!.id]);
  });

  test("a source-only photo gets a preview and is then skipped on a complete reimport", async () => {
    const original = file("source-only.jpg");
    const existing = await developPhotoFromFile(original);
    const options = fixture();
    const first = await runDevelopImport([original, original], {
      ...options,
      existingIds: completeDevelopImportIds([existing]),
    });
    expect(first.imported).toHaveLength(1);
    expect(first.imported[0]!.id).toBe(existing.id);
    expect(first.imported[0]!.sourceBlob).toBe(original);
    expect(first.imported[0]!.previewBlob!.size).toBeGreaterThan(0);
    expect(first.duplicates).toBe(1);
    expect(options.previewed).toEqual([original.name]);
    const nextOptions = fixture();
    const second = await runDevelopImport([original], {
      ...nextOptions,
      existingIds: completeDevelopImportIds(first.imported),
    });
    expect(second.imported).toHaveLength(0);
    expect(second.duplicates).toBe(1);
    expect(second.selectedId).toBeNull();
    expect(nextOptions.previewed).toHaveLength(0);
    expect(nextOptions.stored).toHaveLength(0);
  });

  test("337 missing legacy records are not matched or mutated by a same-name normal import", async () => {
    const original = file("DSC6973.ARW", "reselected camera bytes");
    const legacy = Object.freeze(
      Array.from({ length: 337 }, (_, index) =>
        Object.freeze({
          id: `studio:legacy-${index}`,
          name: index === 0 ? original.name : `saved-${index}.ARW`,
          sourceBlob: null,
          previewBlob: null,
        }),
      ),
    );
    const options = fixture();
    const report = await runDevelopImport([original], {
      ...options,
      existingIds: completeDevelopImportIds(legacy),
    });
    expect(report.imported).toHaveLength(1);
    expect(report.imported[0]!.id).toStartWith("sha256:");
    expect(report.imported[0]!.id).not.toBe(legacy[0]!.id);
    expect(report.duplicates).toBe(0);
    expect(legacy).toHaveLength(337);
    expect(legacy.every((photo) => photo.sourceBlob === null && photo.previewBlob === null)).toBe(
      true,
    );
  });

  test("all failures remain visible and cannot select an unsaved photo", async () => {
    const options = fixture();
    const report = await runDevelopImport(
      [file("broken-one.ARW"), file("broken-two.ARW"), new File([], "empty.jpg")],
      options,
    );
    expect(report.failures).toHaveLength(3);
    expect(report.imported).toHaveLength(0);
    expect(report.selectedId).toBeNull();
    expect(report.stopped).toBe(false);
    expect(report.fatalError).toBeNull();
  });

  test("a failed decode never reserves its hash against a later successful retry", async () => {
    const options = fixture();
    const report = await runDevelopImport(
      [file("broken.ARW", "same source"), file("retry.ARW", "same source")],
      options,
    );
    expect(report.imported.map((p) => p.name)).toEqual(["retry.ARW"]);
    expect(report.duplicates).toBe(0);
    expect(report.failures).toHaveLength(1);
  });

  test("equal filenames with different bytes remain distinct photos", async () => {
    const options = fixture();
    const report = await runDevelopImport(
      [file("photo.jpg", "one"), file("photo.jpg", "two")],
      options,
    );
    expect(report.imported).toHaveLength(2);
    expect(report.imported[0]!.id).not.toBe(report.imported[1]!.id);
    expect(report.duplicates).toBe(0);
  });

  test("a preview callback cannot substitute another original or reserve its identity", async () => {
    const options = fixture();
    const report = await runDevelopImport([file("one.jpg"), file("two.jpg")], {
      ...options,
      preparePreview: async (source, input) => {
        const prepared = await options.preparePreview(source, input);
        return source.name === "one.jpg"
          ? { ...prepared, sourceBlob: file("replacement.jpg") }
          : prepared;
      },
    });
    expect(report.failures[0]!.message).toContain("changed the original photo identity");
    expect(report.imported.map((p) => p.name)).toEqual(["two.jpg"]);
  });

  test("empty decoded previews are file failures, not written originals", async () => {
    const options = fixture();
    const report = await runDevelopImport([file("one.jpg"), file("two.jpg")], {
      ...options,
      preparePreview: async (source, input) => {
        const prepared = await options.preparePreview(source, input);
        return source.name === "one.jpg" ? { ...prepared, previewBlob: new Blob() } : prepared;
      },
    });
    expect(report.failures[0]!.message).toContain("usable preview");
    expect(report.imported.map((p) => p.name)).toEqual(["two.jpg"]);
  });

  test("mutating the identification object cannot bypass the source identity check", async () => {
    const options = fixture();
    const report = await runDevelopImport([file("one.jpg")], {
      ...options,
      preparePreview: async (source, input) => {
        input.id = "studio:another-frame";
        return options.preparePreview(source, input);
      },
    });
    expect(report.failures[0]!.message).toContain("changed the original photo identity");
    expect(options.stored).toHaveLength(0);
  });

  test("pre-aborted batches perform no decoding or storage", async () => {
    const options = fixture(),
      controller = new AbortController();
    controller.abort();
    const report = await runDevelopImport([file("one.jpg")], {
      ...options,
      signal: controller.signal,
    });
    expect(report.stopped).toBe(true);
    expect(report.selectedId).toBeNull();
    expect(options.previewed).toHaveLength(0);
    expect(options.stored).toHaveLength(0);
  });

  test("progress is one-based and a display callback cannot discard imported files", async () => {
    const options = fixture();
    const progress: number[] = [];
    const report = await runDevelopImport([file("one.jpg"), file("two.jpg")], {
      ...options,
      onProgress: (value) => {
        progress.push(value.index);
        expect(value.total).toBe(2);
        if (value.index === 1) throw new Error("Display disconnected");
      },
    });
    expect(progress).toEqual([1, 2]);
    expect(report.imported).toHaveLength(2);
  });

  test("unexpected save receipts stop the batch instead of claiming a photo was saved", async () => {
    const options = fixture();
    const report = await runDevelopImport([file("one.jpg"), file("two.jpg")], {
      ...options,
      save: async () => [],
    });
    expect(report.fatalError).toContain("unexpected receipt");
    expect(report.selectedId).toBeNull();
    expect(report.imported).toHaveLength(0);
    expect(options.previewed).toEqual(["one.jpg"]);
  });

  test("committed photos become observable before the next decode with exact saved edit IDs", async () => {
    const options = fixture();
    const events: string[] = [];
    const savedDocuments = new Map<string, ReturnType<typeof createDevelopDocument>>();
    const report = await runDevelopImport([file("one.jpg"), file("two.jpg")], {
      ...options,
      preparePreview: async (source, input) => {
        events.push(`decode:${source.name}`);
        return options.preparePreview(source, input);
      },
      save: async (input) => {
        const photos = await options.save(input);
        const document = { ...createDevelopDocument(input.id), revision: 7 };
        document.metadata.rating = 4;
        savedDocuments.set(input.id, document);
        events.push(`committed:${input.name}`);
        return { photos, documents: { [input.id]: document } };
      },
      onCommitted: (receipt, progress) => {
        events.push(`observed:${progress.fileName}`);
        const photo = receipt.photos[0]!;
        expect(receipt.documents[photo.id]).toEqual(savedDocuments.get(photo.id));
        expect(receipt.documents[photo.id]!.revision).toBe(7);
        expect(progress.total).toBe(2);
        expect(progress.index).toBe(events.length / 3);
      },
    });
    expect(events).toEqual([
      "decode:one.jpg",
      "committed:one.jpg",
      "observed:one.jpg",
      "decode:two.jpg",
      "committed:two.jpg",
      "observed:two.jpg",
    ]);
    expect(report.imported).toHaveLength(2);
    expect(report.fatalError).toBeNull();
  });

  test("sync and async observers cannot lose commits, stop imports, or mutate saved receipts", async () => {
    const options = fixture();
    const savedDocuments = new Map<string, ReturnType<typeof createDevelopDocument>>();
    const observed: string[] = [];
    const report = await runDevelopImport(
      [file("one.jpg"), file("two.jpg"), file("three.jpg"), file("copy.jpg", "three.jpg")],
      {
        ...options,
        save: async (input) => {
          const photos = await options.save(input);
          const document = createDevelopDocument(input.id);
          savedDocuments.set(input.id, document);
          return { photos, documents: { [input.id]: document } };
        },
        onCommitted: (receipt, progress) => {
          observed.push(progress.fileName);
          if (progress.index === 1) throw new Error("Unmounted display");
          if (progress.index === 2) return Promise.reject(new Error("Display refresh failed"));
          const photo = receipt.photos[0]!;
          receipt.documents[photo.id]!.history[0]!.settings.exposure = 3;
          photo.id = "changed-by-observer";
          photo.name = "Changed";
        },
      },
    );
    expect(observed).toEqual(["one.jpg", "two.jpg", "three.jpg"]);
    expect(report.imported.map((photo) => photo.name)).toEqual(observed);
    expect(report.imported.every((photo) => photo.id.startsWith("sha256:"))).toBe(true);
    expect(
      [...savedDocuments.values()].every((doc) => doc.history[0]!.settings.exposure === 0),
    ).toBe(true);
    expect(report.duplicates).toBe(1);
    expect(report.fatalError).toBeNull();
    expect(report.stopped).toBe(false);
  });

  test("cancellation after a durable save still emits its committed receipt exactly once", async () => {
    const options = fixture();
    const controller = new AbortController();
    const observed: string[] = [];
    const report = await runDevelopImport([file("one.jpg"), file("two.jpg")], {
      ...options,
      signal: controller.signal,
      save: async (input) => {
        const photos = await options.save(input);
        controller.abort();
        return { photos, documents: { [input.id]: createDevelopDocument(input.id) } };
      },
      onCommitted: (receipt) => {
        observed.push(receipt.photos[0]!.name);
      },
    });
    expect(report.imported.map((photo) => photo.name)).toEqual(["one.jpg"]);
    expect(observed).toEqual(["one.jpg"]);
    expect(options.previewed).toEqual(["one.jpg"]);
    expect(report.stopped).toBe(true);
    expect(report.fatalError).toBeNull();
  });

  test("failed decodes, duplicates and failed storage never emit a committed preview", async () => {
    const options = fixture();
    const known = file("known.jpg");
    const observed: string[] = [];
    const report = await runDevelopImport(
      [known, file("broken.jpg"), file("good.jpg"), file("quota.jpg"), file("later.jpg")],
      {
        ...options,
        existingIds: [(await developPhotoFromFile(known)).id],
        save: async (input) => {
          if (input.name === "quota.jpg") throw new Error("Quota exceeded");
          const photos = await options.save(input);
          return { photos, documents: { [input.id]: createDevelopDocument(input.id) } };
        },
        onCommitted: (receipt) => {
          observed.push(receipt.photos[0]!.name);
        },
      },
    );
    expect(observed).toEqual(["good.jpg"]);
    expect(report.duplicates).toBe(1);
    expect(report.failures).toHaveLength(1);
    expect(report.fatalError).toContain("Quota exceeded");
    expect(options.previewed).not.toContain("later.jpg");
  });

  test("missing, mismatched or corrupt saved edit receipts cannot be adopted", async () => {
    for (const kind of ["missing", "extra", "wrong-id", "corrupt"]) {
      const options = fixture();
      let observed = 0;
      const report = await runDevelopImport([file("one.jpg"), file("two.jpg")], {
        ...options,
        save: async (input) => {
          const photos = await options.save(input);
          const document = createDevelopDocument(kind === "wrong-id" ? "other" : input.id);
          if (kind === "corrupt") document.cursor = 900;
          const documents = kind === "missing" ? {} : { [input.id]: document };
          if (kind === "extra") documents["other"] = createDevelopDocument("other");
          return { photos, documents };
        },
        onCommitted: () => {
          observed++;
        },
      });
      expect(observed).toBe(0);
      expect(report.fatalError).not.toBeNull();
      expect(report.imported).toHaveLength(0);
      expect(options.previewed).toEqual(["one.jpg"]);
    }
  });

  test("1,000 varied deterministic mixed batches match an independent receipt model", async () => {
    type Entry = { file: File; bytes: string; kind: "good" | "broken" | "empty" | "sidecar" };
    let random = 0x7a19c0de;
    const next = () => {
      random ^= random << 13;
      random ^= random >>> 17;
      random ^= random << 5;
      return random >>> 0;
    };
    const coverage = { mixed: 0, duplicates: 0, storageFatal: 0, cancelled: 0, badFirst: 0 };

    for (let scenario = 0; scenario < 1000; scenario++) {
      const makeEntry = (
        label: string,
        kind: Entry["kind"],
        bytes = `${scenario}:${label}:${next()}`,
      ): Entry => ({
        file: new File(
          kind === "empty" ? [] : [bytes],
          `${label}-${scenario}.${kind === "sidecar" ? "xmp" : kind === "broken" ? "ARW" : "jpg"}`,
          {
            type: kind === "sidecar" ? "application/xml" : "image/jpeg",
          },
        ),
        bytes: kind === "empty" ? "" : bytes,
        kind,
      });
      const originals = Array.from({ length: 3 + (next() % 3) }, (_, i) =>
        makeEntry(`source-${i}`, "good"),
      );
      const broken = Array.from({ length: 1 + (next() % 3) }, (_, i) =>
        makeEntry(`unreadable-${i}`, "broken"),
      );
      const duplicateOf = originals[next() % originals.length]!;
      const batch = [
        ...originals,
        ...broken,
        makeEntry("duplicate-a", "good", duplicateOf.bytes),
        makeEntry("duplicate-b", "good", duplicateOf.bytes),
        makeEntry("sidecar", "sidecar"),
        ...(scenario % 2 ? [makeEntry("empty", "empty")] : []),
      ];
      for (let i = batch.length - 1; i > 0; i--) {
        const j = next() % (i + 1);
        [batch[i], batch[j]] = [batch[j]!, batch[i]!];
      }
      // Deliberately include the reported broken-first failure as well as broken-middle orders.
      const firstBroken = batch.findIndex((entry) => entry.kind === "broken");
      const badPosition = scenario % 4 === 0 ? 0 : Math.floor(batch.length / 2);
      [batch[firstBroken], batch[badPosition]] = [batch[badPosition]!, batch[firstBroken]!];

      const existing = scenario % 3 === 0 ? originals[next() % originals.length]! : null;
      const existingIds = new Set(existing ? [(await developPhotoFromFile(existing.file)).id] : []);
      const originalExistingIds = [...existingIds];
      const mode = scenario % 8;
      const preAbort = mode === 5;
      const abortPrepareAt = mode === 2 ? 1 + (next() % 4) : mode === 6 ? 3 : 0;
      const abortAfterSaveAt = mode === 3 ? 1 + (next() % 3) : mode === 7 ? 2 : 0;
      const failSaveAt = mode === 1 ? 2 + (next() % 2) : mode === 4 ? 1 : mode === 6 ? 2 : 0;
      const storageMessage = `Injected storage failure ${scenario}`;

      // This model uses literal source bytes rather than production hashes, schemas or helper code.
      const expected = {
        imported: [] as Entry[],
        failures: [] as string[],
        decoded: [] as string[],
        saveAttempts: [] as string[],
        visited: [] as string[],
        duplicates: 0,
        stopped: preAbort,
        fatalError: null as string | null,
      };
      const expectedKnown = new Set(existing ? [existing.bytes] : []);
      let expectedPrepareCount = 0,
        expectedSaveCount = 0;
      for (const entry of batch) {
        if (expected.stopped) break;
        const name = entry.file.name;
        expected.visited.push(name);
        if (entry.kind === "empty" || entry.kind === "sidecar") {
          expected.failures.push(name);
          continue;
        }
        if (expectedKnown.has(entry.bytes)) {
          expected.duplicates++;
          continue;
        }
        expected.decoded.push(name);
        expectedPrepareCount++;
        if (abortPrepareAt === expectedPrepareCount) {
          expected.stopped = true;
          break;
        }
        if (entry.kind === "broken") {
          expected.failures.push(name);
          continue;
        }
        expected.saveAttempts.push(name);
        expectedSaveCount++;
        if (failSaveAt === expectedSaveCount) {
          expected.fatalError = `${name}: ${storageMessage}`;
          break;
        }
        expected.imported.push(entry);
        expectedKnown.add(entry.bytes);
        if (abortAfterSaveAt === expectedSaveCount) expected.stopped = true;
      }

      const controller = new AbortController();
      if (preAbort) controller.abort();
      const byFile = new Map(batch.map((entry) => [entry.file, entry]));
      const decoded: string[] = [],
        saveAttempts: string[] = [],
        visited: string[] = [],
        persisted: DevelopPhoto[] = [];
      let prepareCount = 0,
        saveCount = 0;
      const report = await runDevelopImport(
        batch.map((entry) => entry.file),
        {
          existingIds,
          signal: controller.signal,
          onProgress: (progress) => visited.push(progress.fileName),
          preparePreview: async (source, identified) => {
            decoded.push(source.name);
            prepareCount++;
            if (prepareCount === abortPrepareAt) controller.abort();
            if (byFile.get(source)!.kind === "broken")
              throw new Error(`Cannot decode ${source.name}`);
            return {
              ...identified,
              width: 24,
              height: 16,
              previewBlob: new Blob([`preview:${source.name}`], { type: "image/jpeg" }),
            };
          },
          save: async (input) => {
            saveAttempts.push(input.name);
            saveCount++;
            if (saveCount === failSaveAt) throw new Error(storageMessage);
            const receipt = { ...input, sourceAvailable: true, createdAt: scenario + 1 };
            persisted.push(receipt);
            if (saveCount === abortAfterSaveAt) controller.abort();
            return [receipt];
          },
        },
      );
      expect({
        scenario,
        names: report.imported.map((photo) => photo.name),
        bytes: await Promise.all(report.imported.map((photo) => photo.sourceBlob!.text())),
        failures: report.failures.map((failure) => failure.fileName),
        duplicates: report.duplicates,
        stopped: report.stopped,
        fatalError: report.fatalError,
        decoded,
        saveAttempts,
        visited,
      }).toEqual({
        scenario,
        names: expected.imported.map((entry) => entry.file.name),
        bytes: expected.imported.map((entry) => entry.bytes),
        failures: expected.failures,
        duplicates: expected.duplicates,
        stopped: expected.stopped,
        fatalError: expected.fatalError,
        decoded: expected.decoded,
        saveAttempts: expected.saveAttempts,
        visited: expected.visited,
      });
      expect(report.imported).toEqual(persisted);
      expect(report.selectedId).toBe(persisted[0]?.id ?? null);
      expect([...existingIds]).toEqual(originalExistingIds);
      if (report.imported.length && report.failures.length) coverage.mixed++;
      if (report.duplicates) coverage.duplicates++;
      if (report.fatalError) coverage.storageFatal++;
      if (report.stopped) coverage.cancelled++;
      if (report.failures[0]?.fileName === batch[0]!.file.name && batch[0]!.kind === "broken")
        coverage.badFirst++;
    }
    expect(coverage.mixed).toBeGreaterThan(100);
    expect(coverage.duplicates).toBeGreaterThan(100);
    expect(coverage.storageFatal).toBeGreaterThan(200);
    expect(coverage.cancelled).toBeGreaterThan(400);
    expect(coverage.badFirst).toBeGreaterThan(200);
  }, 30000);
});
