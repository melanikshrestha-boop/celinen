import { describe, expect, test } from "bun:test";
import { defaultDevelopSettings } from "../src/lib/develop/contract";
import { planDevelopReconnect } from "../src/lib/develop/reconnect-plan";
import { runDevelopReconnect, type DevelopReconnectOptions } from "../src/lib/develop/reconnect";
import {
  addSnapshot,
  assertDevelopReconnectTarget,
  createDevelopStore,
  currentRecipe,
  DevelopSaveConflict,
  developPhotoFromFile,
  pushHistory,
  reconnectDevelopPhoto,
  type DevelopPhoto,
  type DevelopPhotoInput,
} from "../src/lib/develop/store";
import { fingerprintSource } from "../src/lib/studio/ingest";
import { developIdbDouble } from "./fixtures/develop-idb-double";

const decode: DevelopReconnectOptions["decode"] = async (file) => ({
  previewBlob: new Blob([`decoded-${file.name}`], { type: "image/jpeg" }),
  width: 1600,
  height: 900,
  previewOrigin: "raster",
});
async function fixture(count = 3, known = true) {
  const database = developIdbDouble();
  const store = createDevelopStore({
    scope: "qa-reconnect-unit",
    libraryId: "one",
    factory: database.factory,
  });
  const files = Array.from(
    { length: count },
    (_, index) =>
      new File([`original-${index}`], `source-${index}.jpg`, {
        type: "image/jpeg",
        lastModified: index + 1,
      }),
  );
  const inputs = await Promise.all(
    files.map(async (file, index) => {
      const identified = await developPhotoFromFile(file);
      return {
        ...identified,
        id: `studio:${index}`,
        name: `Display ${index}`,
        sourceBlob: null,
        sourceDigest: known ? identified.sourceDigest : null,
        previewBlob: new Blob([`old-preview-${index}`]),
        initialState: {
          settings: { ...defaultDevelopSettings(), exposure: (index % 5) / 4 },
          metadata: { rating: index % 6, flag: "pick", colorLabel: "purple" },
        },
      } satisfies DevelopPhotoInput;
    }),
  );
  const receipt = await store.addPhotosWithDocuments(inputs);
  const photos = receipt.photos;
  const plan = await planDevelopReconnect(photos, files, { namespace: store.namespace });
  const key = (id: string, library = "one") => JSON.stringify(["qa-reconnect-unit", library, id]);
  return { ...database, store, files, photos, plan, key };
}
function expected(photo: DevelopPhoto) {
  return { sourceFileName: photo.sourceFileName, sourceDigest: photo.sourceDigest };
}
async function prepared(photo: DevelopPhoto, file: File) {
  const preview = await decode(file, photo, new AbortController().signal);
  return reconnectDevelopPhoto(photo, file, preview.previewBlob, preview, preview.previewOrigin);
}

describe("scoped atomic missing-original attachment", () => {
  test("single-photo read checks only its pair and preserves saved documents exactly at attachment", async () => {
    const f = await fixture(2);
    const target = f.photos[0]!;
    const current = await f.store.readPhoto(target.id);
    const edited = addSnapshot(
      pushHistory(
        current!.document,
        { ...currentRecipe(current!.document), exposure: 0.75 },
        "Exposure",
      ),
      "Client select",
    );
    const saved = await f.store.saveDocument(edited);
    const rawDocumentBefore = structuredClone(f.rows.documents.get(f.key(target.id)));
    const unrelatedBefore = structuredClone(f.rows.photos.get(f.key(f.photos[1]!.id)));
    f.log.length = 0;
    const pair = await f.store.readPhoto(target.id);
    expect(f.log.filter((entry) => entry.includes(":get:"))).toEqual([
      `photos:get:${f.key(target.id)}`,
      `documents:get:${f.key(target.id)}`,
    ]);
    const incoming = await prepared(pair!.photo, f.files[0]!);
    f.log.length = 0;
    const receipt = await f.store.attachMissingOriginal(incoming, expected(target));
    expect(f.log.at(-1)).toBe("complete");
    expect(f.log.some((entry) => entry.startsWith("documents:put"))).toBe(false);
    expect(receipt.documents[target.id]).toEqual(saved);
    expect(f.rows.documents.get(f.key(target.id))).toEqual(rawDocumentBefore);
    expect(f.rows.photos.get(f.key(f.photos[1]!.id))).toEqual(unrelatedBefore);
    const attached = receipt.photos[0]!;
    expect(await attached.sourceBlob!.text()).toBe("original-0");
    expect(await attached.previewBlob!.text()).toBe("decoded-source-0.jpg");
    expect(attached.name).toBe(target.name);
    expect(attached.createdAt).toBe(target.createdAt);
    expect(attached.sourceFileName).toBe(target.sourceFileName);
    expect(attached).not.toHaveProperty("reconnectOriginal");
    expect(attached).not.toHaveProperty("reconnectExpected");
    expect(attached).not.toHaveProperty("initialState");
    expect(receipt.documents[target.id]!.revision).toBe(saved.revision);
  });

  test("stale single reconnect cannot fill a different no-digest original's missing preview", async () => {
    const f = await fixture(1, false);
    const stale = { ...f.photos[0]!, previewBlob: null };
    // Start with no media, as a legacy missing-source record can be restored.
    const raw = f.rows.photos.get(f.key(stale.id)) as { value: DevelopPhoto };
    raw.value.previewBlob = null;
    const incoming = await prepared(stale, f.files[0]!);
    const otherOriginal = new File(["different original from another tab"], stale.sourceFileName);
    await f.store.addPhotos([{ ...stale, sourceBlob: otherOriginal, sourceDigest: null }]);
    const before = structuredClone(f.rows.photos.get(f.key(stale.id)));
    const docBefore = structuredClone(f.rows.documents.get(f.key(stale.id)));
    // Exercises the existing single-reconnect addPhotos path, not only the new method.
    await expect(f.store.addPhotos([incoming])).rejects.toBeInstanceOf(DevelopSaveConflict);
    expect(f.rows.photos.get(f.key(stale.id))).toEqual(before);
    expect(f.rows.documents.get(f.key(stale.id))).toEqual(docBefore);
    const result = await f.store.readPhoto(stale.id);
    expect(await result!.photo.sourceBlob!.text()).toBe("different original from another tab");
    expect(result!.photo.previewBlob).toBeNull();
  });

  test("two concurrent explicit unknown attachments commit exactly one original", async () => {
    const f = await fixture(1, false);
    const photo = f.photos[0]!;
    const first = await prepared(photo, f.files[0]!);
    const second = await prepared(photo, new File(["other bytes"], photo.sourceFileName));
    const result = await Promise.allSettled([
      f.store.attachMissingOriginal(first, expected(photo)),
      f.store.attachMissingOriginal(second, expected(photo)),
    ]);
    expect(result.map((item) => item.status)).toEqual(["fulfilled", "rejected"]);
    expect(await (await f.store.readPhoto(photo.id))!.photo.sourceBlob!.text()).toBe("original-0");
  });

  test("known identity, filename, availability and operation guards cannot be weakened", async () => {
    const f = await fixture(1);
    const photo = f.photos[0]!;
    for (const changed of [
      { ...photo, sourceDigest: null },
      { ...photo, sourceDigest: "sha256:" + "0".repeat(64) },
      { ...photo, sourceFileName: "other.jpg" },
      { ...photo, sourceBlob: f.files[0]!, sourceAvailable: true },
    ])
      expect(() => assertDevelopReconnectTarget(changed, expected(photo))).toThrow(
        DevelopSaveConflict,
      );
    const incoming = await prepared(photo, f.files[0]!);
    await expect(
      f.store.attachMissingOriginal(incoming, { ...expected(photo), sourceDigest: null }),
    ).rejects.toThrow("reviewed source identity");
    const { reconnectExpected: _guard, ...unguarded } = incoming;
    await expect(f.store.addPhotos([unguarded])).rejects.toThrow("reviewed identity");
    const changedOriginal = { ...incoming, sourceFileName: "other.jpg" };
    await expect(f.store.attachMissingOriginal(changedOriginal, expected(photo))).rejects.toThrow(
      "does not match",
    );
    expect((await f.store.readPhoto(photo.id))!.photo.sourceBlob).toBeNull();
  });

  test("identity change after preparation aborts commit, while later treatment changes are retained", async () => {
    const f = await fixture(1, false);
    const photo = f.photos[0]!;
    const incoming = await prepared(photo, f.files[0]!);
    const row = f.rows.photos.get(f.key(photo.id)) as { value: DevelopPhoto };
    row.value.sourceDigest = "sha256:" + "f".repeat(64);
    const before = structuredClone(row);
    await expect(f.store.attachMissingOriginal(incoming, expected(photo))).rejects.toBeInstanceOf(
      DevelopSaveConflict,
    );
    expect(f.rows.photos.get(f.key(photo.id))).toEqual(before);
  });

  test("wrong library, missing document, bad index, quota and failed transaction never claim attachment", async () => {
    const f = await fixture(1);
    const photo = f.photos[0]!;
    const incoming = await prepared(photo, f.files[0]!);
    const other = createDevelopStore({
      scope: "qa-reconnect-unit",
      libraryId: "two",
      factory: f.factory,
    });
    expect(await other.readPhoto(photo.id)).toBeNull();
    await expect(other.attachMissingOriginal(incoming, expected(photo))).rejects.toThrow(
      "target is no longer",
    );
    expect(f.rows.photos.size).toBe(1);
    for (const fault of ["put", "complete"] as const) {
      f.faults[fault] = true;
      await expect(f.store.attachMissingOriginal(incoming, expected(photo))).rejects.toThrow();
      f.faults[fault] = false;
      expect((await f.store.readPhoto(photo.id))!.photo.sourceBlob).toBeNull();
    }
    const doc = f.rows.documents.get(f.key(photo.id)) as { namespace: string };
    doc.namespace = other.namespace;
    await expect(f.store.readPhoto(photo.id)).rejects.toThrow("index is invalid");
    f.rows.documents.delete(f.key(photo.id));
    await expect(f.store.readPhoto(photo.id)).rejects.toThrow("edits are missing");
    await expect(f.store.attachMissingOriginal(incoming, expected(photo))).rejects.toThrow(
      "edits are missing",
    );
  });
});

describe("reviewed sequential reconnect execution", () => {
  test("unknown matches are unchecked and are not executed unless explicitly selected", async () => {
    const f = await fixture(2, false);
    expect(f.plan.entries.every((entry) => !entry.selectedByDefault)).toBe(true);
    f.log.length = 0;
    const none = await runDevelopReconnect(f.plan, [], { store: f.store, decode });
    expect(none.attached).toEqual([]);
    expect(f.log).toEqual([]);
    const report = await runDevelopReconnect(f.plan, [f.photos[1]!.id], { store: f.store, decode });
    expect(report.attached.map((photo) => photo.id)).toEqual([f.photos[1]!.id]);
    expect((await f.store.readPhoto(f.photos[0]!.id))!.photo.sourceBlob).toBeNull();
  });

  test("unbound, cross-scope, ambiguous, duplicate and nonexistent selections reject before reads", async () => {
    const f = await fixture(1, false);
    const ambiguous = await planDevelopReconnect(
      f.photos,
      [f.files[0]!, new File(["other"], f.files[0]!.name)],
      { namespace: f.store.namespace },
    );
    f.log.length = 0;
    const options = { store: f.store, decode };
    await expect(
      runDevelopReconnect({ ...f.plan, namespace: null }, [f.photos[0]!.id], options),
    ).rejects.toThrow("another library");
    await expect(
      runDevelopReconnect(
        { ...f.plan, namespace: JSON.stringify(["another-account", "one"]) },
        [f.photos[0]!.id],
        options,
      ),
    ).rejects.toThrow("another library");
    await expect(runDevelopReconnect(ambiguous, [f.photos[0]!.id], options)).rejects.toThrow(
      "unambiguous",
    );
    await expect(
      runDevelopReconnect(f.plan, [f.photos[0]!.id, f.photos[0]!.id], options),
    ).rejects.toThrow("duplicate");
    await expect(runDevelopReconnect(f.plan, ["missing-id"], options)).rejects.toThrow(
      "unambiguous",
    );
    expect(f.log).toEqual([]);
  });

  test("corrupt first and middle images do not stop independently valid later originals", async () => {
    const f = await fixture(4);
    const beforeDocs = [...f.rows.documents.values()].map((row) => JSON.stringify(row));
    let active = 0,
      maximum = 0;
    const seen: string[] = [],
      committed: string[] = [];
    const report = await runDevelopReconnect(
      f.plan,
      f.photos.map((photo) => photo.id),
      {
        store: f.store,
        decode: async (file, photo, signal) => {
          active++;
          maximum = Math.max(maximum, active);
          seen.push(photo.id);
          try {
            await Promise.resolve();
            if (photo.id === "studio:0" || photo.id === "studio:2") throw new Error("Bad image");
            return await decode(file, photo, signal);
          } finally {
            active--;
          }
        },
        onCommitted: (receipt) => {
          expect(f.log.at(-1)).toBe("complete");
          committed.push(receipt.photos[0]!.id);
        },
      },
    );
    expect(seen).toEqual(f.photos.map((photo) => photo.id));
    expect(maximum).toBe(1);
    expect(report.failures.map((failure) => failure.targetId)).toEqual(["studio:0", "studio:2"]);
    expect(report.attached.map((photo) => photo.id)).toEqual(["studio:1", "studio:3"]);
    expect(committed).toEqual(["studio:1", "studio:3"]);
    expect(report.selectedId).toBe("studio:1");
    expect(report.fatalError).toBeNull();
    expect([...f.rows.documents.values()].map((row) => JSON.stringify(row))).toEqual(beforeDocs);
    expect(f.rows.photos.size).toBe(4);
  });

  test("scan-time verified identity cannot downgrade to unknown before decode", async () => {
    const f = await fixture(2);
    const row = f.rows.photos.get(f.key(f.photos[0]!.id)) as { value: DevelopPhoto };
    row.value.sourceDigest = null;
    let decodes = 0;
    const report = await runDevelopReconnect(
      f.plan,
      f.photos.map((photo) => photo.id),
      {
        store: f.store,
        decode: async (...args) => {
          decodes++;
          return decode(...args);
        },
      },
    );
    expect(report.fatalError).toContain("changed in another tab");
    expect(report.attached).toEqual([]);
    expect(decodes).toBe(0);
  });

  test("CAS during decode stops without overwriting another tab's original or saved treatment", async () => {
    const f = await fixture(2, false);
    const photo = f.photos[0]!;
    const beforeDocs = structuredClone([...f.rows.documents.values()]);
    const report = await runDevelopReconnect(
      f.plan,
      f.photos.map((item) => item.id),
      {
        store: f.store,
        decode: async (...args) => {
          const incoming = await prepared(
            photo,
            new File(["other selected original"], photo.sourceFileName),
          );
          await f.store.attachMissingOriginal(incoming, expected(photo));
          return decode(...args);
        },
      },
    );
    expect(report.fatalError).toContain("changed in another tab");
    expect(report.attached).toEqual([]);
    expect(await (await f.store.readPhoto(photo.id))!.photo.sourceBlob!.text()).toBe(
      "other selected original",
    );
    expect((await f.store.readPhoto(f.photos[1]!.id))!.photo.sourceBlob).toBeNull();
    expect([...f.rows.documents.values()]).toEqual(beforeDocs);
  });

  test("storage failure stops after prior durable attachments; later decodes are not started", async () => {
    const f = await fixture();
    const seen: string[] = [];
    const report = await runDevelopReconnect(
      f.plan,
      f.photos.map((photo) => photo.id),
      {
        store: f.store,
        decode: async (file, photo, signal) => {
          seen.push(photo.id);
          if (photo.id === "studio:1") f.faults.put = true;
          return decode(file, photo, signal);
        },
      },
    );
    expect(report.attached).toHaveLength(1);
    expect(report.fatalError).toContain("not enough browser storage");
    expect(report.failures).toEqual([]);
    expect(seen).toEqual(["studio:0", "studio:1"]);
  });

  test("a treatment saved during decoding is returned exactly without resetting its revision or history", async () => {
    const f = await fixture(1);
    const photo = f.photos[0]!;
    let savedDocument: unknown;
    const report = await runDevelopReconnect(f.plan, [photo.id], {
      store: f.store,
      decode: async (...args) => {
        const pair = await f.store.readPhoto(photo.id);
        savedDocument = await f.store.saveDocument(
          pushHistory(
            pair!.document,
            { ...currentRecipe(pair!.document), exposure: 0.75 },
            "Other tab exposure",
          ),
        );
        return decode(...args);
      },
    });
    expect(report.fatalError).toBeNull();
    expect(report.receipt.documents[photo.id]).toEqual(savedDocument);
    expect(report.receipt.documents[photo.id]!.revision).toBe(1);
    expect(currentRecipe(report.receipt.documents[photo.id]!).exposure).toBe(0.75);
    expect((await f.store.readPhoto(photo.id))!.document).toEqual(savedDocument);
  });

  test("review and store ownership are captured before asynchronous work starts", async () => {
    const f = await fixture(1);
    const other = createDevelopStore({
      scope: "qa-reconnect-unit",
      libraryId: "two",
      factory: f.factory,
    });
    const options: DevelopReconnectOptions = {
      store: f.store,
      decode,
      onProgress(progress) {
        options.store = other;
        f.plan.entries[0]!.expectedSourceDigest = null;
        f.plan.entries[0]!.sourceFileName = "changed.jpg";
        f.plan.namespace = other.namespace;
        progress.fileName = "wrong display.jpg";
      },
    };
    const report = await runDevelopReconnect(f.plan, [f.photos[0]!.id], options);
    expect(report.attached).toHaveLength(1);
    expect(report.fatalError).toBeNull();
    expect(await other.readPhoto(f.photos[0]!.id)).toBeNull();
    expect((await f.store.readPhoto(f.photos[0]!.id))!.photo.sourceAvailable).toBe(true);
  });

  test("cancelled review, cancellation during read and cancellation during decode cause no writes", async () => {
    for (const phase of ["plan", "read", "decode"] as const) {
      const f = await fixture(1);
      const controller = new AbortController();
      const before = [...f.rows.photos.values()].map((row) => JSON.stringify(row));
      const report = await runDevelopReconnect(
        phase === "plan" ? { ...f.plan, cancelled: true } : f.plan,
        [f.photos[0]!.id],
        {
          store: {
            ...f.store,
            readPhoto: async (id) => {
              const pair = await f.store.readPhoto(id);
              if (phase === "read") controller.abort(new Error("Stop"));
              return pair;
            },
          },
          signal: controller.signal,
          decode: async (...args) => {
            controller.abort();
            return decode(...args);
          },
        },
      );
      expect(report.stopped).toBe(true);
      expect(report.attached).toEqual([]);
      expect(report.fatalError).toBeNull();
      expect([...f.rows.photos.values()].map((row) => JSON.stringify(row))).toEqual(before);
    }
  });

  test("abort immediately after transaction still returns and notifies the committed receipt", async () => {
    const f = await fixture(2);
    const controller = new AbortController();
    const observed: string[] = [];
    const report = await runDevelopReconnect(
      f.plan,
      f.photos.map((photo) => photo.id),
      {
        store: {
          ...f.store,
          attachMissingOriginal: async (...args) => {
            const receipt = await f.store.attachMissingOriginal(...args);
            controller.abort();
            return receipt;
          },
        },
        decode,
        signal: controller.signal,
        onCommitted: (receipt) => {
          observed.push(receipt.photos[0]!.id);
        },
      },
    );
    expect(report.stopped).toBe(true);
    expect(report.attached).toHaveLength(1);
    expect(observed).toEqual([f.photos[0]!.id]);
    expect(Object.keys(report.receipt.documents)).toEqual([f.photos[0]!.id]);
    expect(report.fatalError).toBeNull();
    expect((await f.store.readPhoto(f.photos[1]!.id))!.photo.sourceBlob).toBeNull();
  });

  test("observer exceptions stop safely after counting the commit, without mutating the receipt or history", async () => {
    const f = await fixture(2);
    const beforeDocs = structuredClone([...f.rows.documents.values()]);
    const report = await runDevelopReconnect(
      f.plan,
      f.photos.map((photo) => photo.id),
      {
        store: f.store,
        decode,
        onCommitted: (receipt) => {
          receipt.photos[0]!.name = "Observer changed title";
          receipt.documents[receipt.photos[0]!.id]!.metadata.rating = 5;
          throw new Error("UI refresh failed");
        },
      },
    );
    expect(report.attached).toHaveLength(1);
    expect(report.fatalError).toContain("original was attached");
    expect(report.attached[0]!.name).toBe("Display 0");
    expect(report.receipt.documents[f.photos[0]!.id]!.metadata.rating).toBe(0);
    expect([...f.rows.documents.values()]).toEqual(beforeDocs);
    expect((await f.store.readPhoto(f.photos[1]!.id))!.photo.sourceBlob).toBeNull();
  });

  test("legacy chain fingerprint is preserved while the original is restored", async () => {
    const f = await fixture(1);
    const photo = f.photos[0]!;
    const legacy = await fingerprintSource(f.files[0]!);
    const row = f.rows.photos.get(f.key(photo.id)) as { value: DevelopPhoto };
    row.value.sourceDigest = legacy;
    const current = (await f.store.readPhoto(photo.id))!.photo;
    const plan = await planDevelopReconnect([current], f.files, { namespace: f.store.namespace });
    const report = await runDevelopReconnect(plan, [photo.id], { store: f.store, decode });
    expect(report.attached[0]!.sourceDigest).toBe(legacy);
    expect(report.fatalError).toBeNull();
  });

  test("337 explicitly selected legacy originals preserve every ID and full existing edit document", async () => {
    const f = await fixture(337, false);
    const beforeDocs = [...f.rows.documents.entries()].map(([key, row]) => [
      key,
      JSON.stringify(row),
    ]);
    const report = await runDevelopReconnect(
      f.plan,
      f.photos.map((photo) => photo.id),
      { store: f.store, decode },
    );
    expect(report.attached).toHaveLength(337);
    expect(report.failures).toEqual([]);
    expect(report.fatalError).toBeNull();
    expect(report.attached.map((photo) => photo.id)).toEqual(f.photos.map((photo) => photo.id));
    expect([...f.rows.documents.entries()].map(([key, row]) => [key, JSON.stringify(row)])).toEqual(
      beforeDocs,
    );
    expect(f.rows.photos.size).toBe(337);
    expect(f.rows.documents.size).toBe(337);
    expect(report.receipt.photos.every((photo) => photo.sourceAvailable)).toBe(true);
  });
});
