import { describe, expect, test } from "bun:test";
import { runDevelopImport } from "../src/lib/develop/import";
import { developDocumentForImport, type DevelopPhotoInput } from "../src/lib/develop/store";

const namespace = JSON.stringify(["synthetic-ordering", "shoot"]);
const ordering = { namespace, jobId: "synthetic-job" };
const file = (name: string, bytes = name) => new File([bytes], name);
const preview = (input: DevelopPhotoInput) => ({
  ...input,
  width: 2,
  height: 2,
  previewBlob: new Blob(["synthetic preview"]),
});
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("admitted imports save ready photos without changing input order", () => {
  test("a gated first RAW does not stop the following 299 JPEGs from saving", async () => {
    const raw = gate();
    const files = [
      file("first.arw"),
      ...Array.from({ length: 299 }, (_, index) => file(`${index}.jpg`)),
    ];
    const committed: DevelopPhotoInput[] = [];
    let active = 0,
      peak = 0,
      writers = 0,
      writerPeak = 0;
    const run = runDevelopImport(files, {
      existingIds: [],
      ordering,
      preparationConcurrency: 4,
      rawPreparationConcurrency: 2,
      preparePreview: async (_, input) => {
        active++;
        peak = Math.max(peak, active);
        try {
          if (input.isRaw) await raw.promise;
          else await Promise.resolve();
          return preview(input);
        } finally {
          active--;
        }
      },
      save: async (input) => {
        writerPeak = Math.max(writerPeak, ++writers);
        await Promise.resolve();
        committed.push(input);
        writers--;
        return {
          photos: [{ ...input, sourceAvailable: true, createdAt: 1 }],
          documents: { [input.id]: developDocumentForImport(input) },
          ordering: { order: input.importOrder!, inserted: true },
        };
      },
    });
    let beforeRelease: number;
    try {
      for (let attempt = 0; attempt < 200 && committed.length < 299; attempt++) await tick();
      beforeRelease = committed.length;
    } finally {
      raw.release();
    }
    const result = await run;
    expect(beforeRelease).toBe(299);
    expect(result.fatalError).toBeNull();
    expect(result.imported.map((photo) => photo.name)).toEqual(files.map((source) => source.name));
    expect(result.selectedId).toBe(result.imported[0]!.id);
    expect(committed[0]!.name).toBe("0.jpg");
    expect(committed.at(-1)!.name).toBe("first.arw");
    expect(peak).toBeLessThanOrEqual(4);
    expect(writerPeak).toBe(1);
    for (const input of committed) {
      const ordinal = files.findIndex((source) => source.name === input.name);
      expect(input.importOrder).toEqual({
        version: 1,
        ...ordering,
        ordinal,
        photoId: input.id,
        sourceDigest: input.sourceDigest,
      });
      expect(input.sourceBlob).toBe(files[ordinal]);
    }
    expect(committed.at(-1)!.importBefore).toEqual({
      photoId: committed[0]!.id,
      ordinal: 1,
    });
  });

  test("Stop drains a noncancellable RAW and retains every later JPEG durable receipt", async () => {
    const raw = gate(),
      controller = new AbortController();
    const files = [file("slow.arw"), ...Array.from({ length: 20 }, (_, i) => file(`${i}.jpg`))];
    const committed: DevelopPhotoInput[] = [];
    let settled = false,
      rawActive = false;
    const run = runDevelopImport(files, {
      existingIds: [],
      ordering,
      signal: controller.signal,
      preparationConcurrency: 4,
      rawPreparationConcurrency: 2,
      preparePreview: async (_, input) => {
        if (input.isRaw) {
          rawActive = true;
          await raw.promise;
          rawActive = false;
        }
        return preview(input);
      },
      save: async (input) => {
        committed.push(input);
        return {
          photos: [{ ...input, sourceAvailable: true, createdAt: 1 }],
          documents: { [input.id]: developDocumentForImport(input) },
          ordering: { order: input.importOrder!, inserted: true },
        };
      },
    }).finally(() => {
      settled = true;
    });
    try {
      for (let i = 0; i < 100 && committed.length < 20; i++) await tick();
      expect(committed).toHaveLength(20);
      controller.abort();
      await tick();
      expect(settled).toBe(false);
      expect(rawActive).toBe(true);
    } finally {
      controller.abort();
      raw.release();
    }
    const report = await run;
    expect(report.stopped).toBe(true);
    expect(report.fatalError).toBeNull();
    expect(report.imported.map((photo) => photo.name)).toEqual(
      files.slice(1).map((source) => source.name),
    );
    expect(committed).toHaveLength(20);
    expect(rawActive).toBe(false);
    for (const input of committed)
      expect(input.sourceBlob).toBe(files[Number(input.name.split(".")[0]) + 1]);
  });

  test("duplicates await the winning durable ACK, not successful preparation", async () => {
    const saving = gate(),
      winnerReady = gate();
    const files = [
      file("winner.arw", "same exact source"),
      file("duplicate.jpg", "same exact source"),
    ];
    let duplicateEvents = 0,
      writes = 0;
    const run = runDevelopImport(files, {
      existingIds: [],
      ordering,
      preparationConcurrency: 4,
      rawPreparationConcurrency: 2,
      preparePreview: async (_, input) => {
        winnerReady.release();
        return preview(input);
      },
      onDuplicate: () => {
        duplicateEvents++;
      },
      save: async () => {
        writes++;
        await saving.promise;
        throw new Error("Synthetic quota exceeded");
      },
    });
    await winnerReady.promise;
    await tick();
    expect(duplicateEvents).toBe(0);
    saving.release();
    const report = await run;
    expect(writes).toBe(1);
    expect(report.imported).toHaveLength(0);
    expect(report.duplicates).toBe(0);
    expect(duplicateEvents).toBe(0);
    expect(report.fatalError).toContain("Synthetic quota exceeded");
  });

  test("a failed earliest decode retries the earliest duplicate, preserving its sidecar ownership", async () => {
    const files = [
      file("first.arw", "same"),
      file("second.arw", "same"),
      file("third.jpg", "same"),
    ];
    const prepared: string[] = [],
      committed: DevelopPhotoInput[] = [];
    const report = await runDevelopImport(files, {
      existingIds: [],
      ordering,
      preparationConcurrency: 4,
      rawPreparationConcurrency: 2,
      preparePreview: async (_, input) => {
        prepared.push(input.name);
        await tick();
        if (input.name === "first.arw") throw new Error("Synthetic decode failure");
        return {
          ...preview(input),
          sidecar: { name: "second.xmp", path: "card/second.xmp", text: "second owner" },
        };
      },
      save: async (input) => {
        committed.push(input);
        return {
          photos: [{ ...input, sourceAvailable: true, createdAt: 1 }],
          documents: { [input.id]: developDocumentForImport(input) },
          ordering: { order: input.importOrder!, inserted: true },
        };
      },
    });
    expect(prepared).toEqual(["first.arw", "second.arw"]);
    expect(report.fatalError).toBeNull();
    expect(report.failures.map((failure) => failure.fileName)).toEqual(["first.arw"]);
    expect(report.duplicates).toBe(1);
    expect(committed).toHaveLength(1);
    expect(committed[0]!.importOrder!.ordinal).toBe(1);
    expect(committed[0]!.sourceBlob).toBe(files[1]);
    expect(committed[0]!.sidecar!.text).toBe("second owner");
  });
});
