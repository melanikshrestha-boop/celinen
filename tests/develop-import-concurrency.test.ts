import { describe, expect, test } from "bun:test";
import { runDevelopImport } from "../src/lib/develop/import";
import { type DevelopPhotoInput } from "../src/lib/develop/store";
import { defaultDevelopSettings } from "../src/lib/develop/contract";

const file = (name: string, bytes = name) => new File([bytes], name, { type: "image/jpeg" });
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const preview = (input: DevelopPhotoInput) => ({
  ...input,
  previewBlob: new Blob(["preview"]),
  width: 24,
  height: 16,
});
const stored = (input: DevelopPhotoInput) => [{ ...input, sourceAvailable: true, createdAt: 1 }];

describe("bounded parallel Develop preparation", () => {
  test("a prepared observer cannot change nested import settings or metadata saved later", async () => {
    const settings = defaultDevelopSettings();
    settings.exposure = 0.5;
    let received: DevelopPhotoInput | undefined;
    const original = file("original.jpg");
    const report = await runDevelopImport([original], {
      existingIds: [],
      preparationConcurrency: 4,
      preparePreview: async (_, input) => ({
        ...preview(input),
        initialState: {
          settings,
          metadata: { rating: 4, flag: "pick", colorLabel: null },
        },
      }),
      onPrepared: (input) => {
        input.initialState!.settings.exposure = 5;
        input.initialState!.metadata.rating = 0;
        settings.exposure = -2; // The preparation callback retained this original object.
      },
      save: async (input) => {
        received = input;
        return stored(input);
      },
    });
    expect(report.imported).toHaveLength(1);
    expect(received!.initialState!.settings.exposure).toBe(0.5);
    expect(received!.initialState!.metadata.rating).toBe(4);
    expect(received!.sourceBlob).toBe(original);
  });

  test("1,000 concurrent candidates preserve exact ordered receipts and duplicate/failure totals", async () => {
    const sources = Array.from({ length: 1000 }, (_, i) =>
      file(`${i % 31 === 0 ? "bad-" : ""}${i}.jpg`, `bytes:${Math.floor(i / 2)}`),
    );
    const expected: string[] = [],
      known = new Set<string>();
    let duplicates = 0,
      failures = 0;
    for (let i = 0; i < sources.length; i++) {
      const identity = `bytes:${Math.floor(i / 2)}`;
      if (known.has(identity)) {
        duplicates++;
        continue;
      }
      if (sources[i]!.name.startsWith("bad-")) {
        failures++;
        continue;
      }
      known.add(identity);
      expected.push(sources[i]!.name);
    }
    let active = 0,
      peak = 0,
      writers = 0,
      writerPeak = 0;
    const saved: string[] = [];
    const report = await runDevelopImport(sources, {
      existingIds: [],
      preparationConcurrency: 4,
      preparePreview: async (_, input) => {
        active++;
        peak = Math.max(peak, active);
        try {
          if (input.name.startsWith("bad-")) throw new Error("fixture decode error");
          if (Number(input.name.split(".")[0]) % 17 === 0) await tick();
          return preview(input);
        } finally {
          active--;
        }
      },
      save: async (input) => {
        writers++;
        writerPeak = Math.max(writerPeak, writers);
        await Promise.resolve();
        saved.push(input.name);
        writers--;
        return stored(input);
      },
    });
    expect(report.imported.map((photo) => photo.name)).toEqual(expected);
    expect(saved).toEqual(expected);
    expect(report.duplicates).toBe(duplicates);
    expect(report.failures).toHaveLength(failures);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    expect(writerPeak).toBe(1);
    expect(report.fatalError).toBeNull();
    expect(report.stopped).toBe(false);
  });

  test("invalid queue limits fail before registration or reading", async () => {
    let registered = 0,
      decoded = 0;
    for (const limits of [
      { preparationConcurrency: 0 },
      { preparationConcurrency: 5 },
      { preparationConcurrency: 1.5 },
      { rawPreparationConcurrency: 0 },
      { rawPreparationConcurrency: 3 },
    ]) {
      await expect(
        runDevelopImport([file("one.jpg")], {
          ...limits,
          existingIds: [],
          onRegistered: () => {
            registered++;
          },
          preparePreview: async (_, input) => {
            decoded++;
            return preview(input);
          },
          save: async (input) => stored(input),
        }),
      ).rejects.toThrow("Import preparation allows");
    }
    expect(registered).toBe(0);
    expect(decoded).toBe(0);
  });

  test("a later failed read cannot let its successor steal an earlier slow duplicate's name", async () => {
    const hold = gate(),
      original = file("first.jpg", "same"),
      copy = file("later.jpg", "same");
    const originalRead = original.arrayBuffer.bind(original);
    Object.defineProperty(original, "arrayBuffer", {
      value: async () => {
        await hold.promise;
        return originalRead();
      },
    });
    const started: string[] = [];
    const run = runDevelopImport([original, new File([], "empty.jpg"), copy], {
      existingIds: [],
      preparationConcurrency: 3,
      preparePreview: async (_, input) => {
        started.push(input.name);
        return preview(input);
      },
      save: async (input) => stored(input),
    });
    try {
      await tick();
      await tick();
      expect(started).toEqual([]);
    } finally {
      hold.resolve();
    }
    const report = await run;
    expect(started).toEqual(["first.jpg"]);
    expect(report.imported.map((photo) => photo.name)).toEqual(["first.jpg"]);
    expect(report.failures.map((failure) => failure.fileName)).toEqual(["empty.jpg"]);
    expect(report.duplicates).toBe(1);
  });

  test("all registration/preview/failure/duplicate observer exceptions are isolated", async () => {
    const report = await runDevelopImport(
      [file("good.jpg"), file("copy.jpg", "good.jpg"), new File([], "empty.jpg")],
      {
        existingIds: [],
        preparationConcurrency: 3,
        onRegistered: () => {
          throw new Error("display");
        },
        onPrepared: () => {
          throw new Error("display");
        },
        onFileFailure: () => {
          throw new Error("display");
        },
        onDuplicate: () => {
          throw new Error("display");
        },
        preparePreview: async (_, input) => preview(input),
        save: async (input) => stored(input),
      },
    );
    expect(report.imported.map((photo) => photo.name)).toEqual(["good.jpg"]);
    expect(report.duplicates).toBe(1);
    expect(report.failures).toHaveLength(1);
    expect(report.fatalError).toBeNull();
  });

  test("registers all handles before reads, prepares four concurrently, and commits in order with one writer", async () => {
    const release = Array.from({ length: 7 }, gate);
    const started: number[] = [],
      saved: number[] = [],
      registered: number[] = [],
      prepared: number[] = [];
    let active = 0,
      peak = 0,
      writing = 0,
      peakWriting = 0;
    const run = runDevelopImport(
      release.map((_, i) => file(`${i}.jpg`)),
      {
        existingIds: [],
        preparationConcurrency: 4,
        onRegistered: (value) => registered.push(value.index),
        onPrepared: (input, progress) => {
          prepared.push(progress.index);
          input.name = "observer mutation";
        },
        preparePreview: async (_, input) => {
          expect(registered).toEqual([1, 2, 3, 4, 5, 6, 7]);
          const index = Number(input.name.split(".")[0]);
          started.push(index);
          active++;
          peak = Math.max(peak, active);
          await release[index]!.promise;
          active--;
          return preview(input);
        },
        save: async (input) => {
          writing++;
          peakWriting = Math.max(peakWriting, writing);
          await tick();
          writing--;
          saved.push(Number(input.name.split(".")[0]));
          return stored(input);
        },
      },
    );
    try {
      for (let i = 0; i < 30 && started.length < 4; i++) await tick();
      expect(started).toEqual([0, 1, 2, 3]);
      release[3]!.resolve();
      release[2]!.resolve();
      release[1]!.resolve();
      await tick();
      expect(saved).toEqual([]);
      expect(started).toHaveLength(4); // bounded ready-result queue, not1,000 prepared Blobs
      release.forEach((item) => item.resolve());
      const result = await run;
      expect(peak).toBe(4);
      expect(peakWriting).toBe(1);
      expect(saved).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(result.imported.map((photo) => photo.name)).toEqual(saved.map((i) => `${i}.jpg`));
      expect(prepared).toHaveLength(7);
    } finally {
      release.forEach((item) => item.resolve());
      await run;
    }
  });

  test("one RAW preview does not block a raster sibling and raw admission remains bounded", async () => {
    const hold = gate();
    let raw = 0,
      peakRaw = 0;
    const started: string[] = [];
    const run = runDevelopImport([file("0.ARW"), file("1.ARW"), file("2.jpg"), file("3.ARW")], {
      existingIds: [],
      preparationConcurrency: 4,
      rawPreparationConcurrency: 1,
      preparePreview: async (_, input) => {
        started.push(input.name);
        if (input.isRaw) {
          raw++;
          peakRaw = Math.max(peakRaw, raw);
          await hold.promise;
          raw--;
        }
        return preview(input);
      },
      save: async (input) => stored(input),
    });
    try {
      for (let i = 0; i < 30 && !started.includes("2.jpg"); i++) await tick();
      expect(started).toContain("2.jpg");
      expect(started.filter((name) => name.endsWith("ARW"))).toHaveLength(1);
    } finally {
      hold.resolve();
    }
    expect((await run).imported).toHaveLength(4);
    expect(peakRaw).toBe(1);
  });

  test("a RAW prefix cannot occupy every preparation slot and starve a later JPEG", async () => {
    const hold = gate();
    const sources = [0, 1, 2, 3, 4, 5].map((index) => file(`${index}.ARW`));
    sources.push(file("tail.jpg"));
    const started: string[] = [],
      saved: string[] = [];
    let retained = 0,
      peakRetained = 0,
      rawActive = 0,
      peakRaw = 0;
    const run = runDevelopImport(sources, {
      existingIds: [],
      preparationConcurrency: 4,
      rawPreparationConcurrency: 1,
      preparePreview: async (_, input) => {
        started.push(input.name);
        retained++;
        peakRetained = Math.max(peakRetained, retained);
        if (input.isRaw) {
          rawActive++;
          peakRaw = Math.max(peakRaw, rawActive);
          if (input.name === "0.ARW") await hold.promise;
          rawActive--;
        }
        return preview(input);
      },
      save: async (input) => {
        saved.push(input.name);
        retained--;
        return stored(input);
      },
    });
    try {
      for (let i = 0; i < 30 && !started.includes("tail.jpg"); i++) await tick();
      expect(started).toContain("tail.jpg");
      expect(started.filter((name) => name.endsWith("ARW"))).toEqual(["0.ARW"]);
      expect(saved).toEqual([]); // An early preview never changes committed library order.
    } finally {
      hold.resolve();
      await run;
    }
    expect((await run).imported.map((photo) => photo.name)).toEqual(
      sources.map((source) => source.name),
    );
    expect(saved).toEqual(sources.map((source) => source.name));
    expect(peakRetained).toBeLessThanOrEqual(4);
    expect(peakRaw).toBe(1);
  });

  test("duplicate RAW waiters do not consume raster slots and the earliest failed copy owns retry", async () => {
    const hold = gate();
    const sources = [
      file("bad-first.ARW", "same"),
      file("bad-second.ARW", "same"),
      file("first-usable.jpg", "same"),
      file("later-usable.jpg", "same"),
      file("another-copy.ARW", "same"),
      file("independent.jpg"),
    ];
    const started: string[] = [],
      saved: string[] = [];
    const run = runDevelopImport(sources, {
      existingIds: [],
      preparationConcurrency: 4,
      rawPreparationConcurrency: 1,
      preparePreview: async (_, input) => {
        started.push(input.name);
        if (input.name === "bad-first.ARW") await hold.promise;
        if (input.name.startsWith("bad-")) throw new Error("Invalid RAW encoding");
        return preview(input);
      },
      save: async (input) => {
        saved.push(input.name);
        return stored(input);
      },
    });
    try {
      for (let i = 0; i < 30 && !started.includes("independent.jpg"); i++) await tick();
      expect(started).toEqual(["bad-first.ARW", "independent.jpg"]);
      expect(saved).toEqual([]);
    } finally {
      hold.resolve();
      await run;
    }
    const result = await run;
    expect(started).toEqual([
      "bad-first.ARW",
      "independent.jpg",
      "bad-second.ARW",
      "first-usable.jpg",
    ]);
    expect(saved).toEqual(["first-usable.jpg", "independent.jpg"]);
    expect(result.duplicates).toBe(2);
    expect(result.failures.map((failure) => failure.fileName)).toEqual([
      "bad-first.ARW",
      "bad-second.ARW",
    ]);
    expect(result.imported[0]!.sourceBlob).toBe(sources[2]);
  });

  test("independent bounded fingerprint and preview stages never exceed four buffers or two RAW decodes", async () => {
    const hold = gate();
    const sources = Array.from({ length: 20 }, (_, i) => file(`${i}.ARW`));
    sources.push(...Array.from({ length: 8 }, (_, i) => file(`raster-${i}.jpg`)));
    let readActive = 0,
      readPeak = 0,
      previewHeld = 0,
      previewPeak = 0,
      rawActive = 0,
      rawPeak = 0;
    for (const source of sources) {
      const read = source.arrayBuffer.bind(source);
      Object.defineProperty(source, "arrayBuffer", {
        value: async () => {
          readActive++;
          readPeak = Math.max(readPeak, readActive);
          try {
            await tick();
            return await read();
          } finally {
            readActive--;
          }
        },
      });
    }
    const started: string[] = [],
      saved: string[] = [];
    const run = runDevelopImport(sources, {
      existingIds: [],
      preparationConcurrency: 4,
      rawPreparationConcurrency: 2,
      preparePreview: async (_, input) => {
        started.push(input.name);
        previewHeld++;
        previewPeak = Math.max(previewPeak, previewHeld);
        if (input.isRaw) {
          rawActive++;
          rawPeak = Math.max(rawPeak, rawActive);
          await hold.promise;
          rawActive--;
        }
        return preview(input);
      },
      save: async (input) => {
        saved.push(input.name);
        previewHeld--;
        return stored(input);
      },
    });
    try {
      for (let i = 0; i < 60 && !started.includes("raster-1.jpg"); i++) await tick();
      expect(started).toEqual(["0.ARW", "1.ARW", "raster-0.jpg", "raster-1.jpg"]);
      expect(saved).toEqual([]);
      expect(readPeak).toBe(4);
      expect(readActive).toBeLessThanOrEqual(4);
      expect(previewHeld).toBe(4);
    } finally {
      hold.resolve();
      await run;
    }
    expect((await run).fatalError).toBeNull();
    expect(saved).toEqual(sources.map((source) => source.name));
    expect(previewPeak).toBe(4);
    expect(rawPeak).toBe(2);
    expect(readPeak).toBe(4);
  });

  test("three ahead-ready JPEGs leave capacity for an earlier RAW duplicate retry", async () => {
    const hold = gate(),
      controller = new AbortController();
    const started: string[] = [],
      saved: string[] = [];
    const sources = [
      file("bad.ARW", "same"),
      file("retry.ARW", "same"),
      ...Array.from({ length: 6 }, (_, i) => file(`later-${i}.jpg`)),
    ];
    const timeout = setTimeout(() => controller.abort(), 1000);
    const run = runDevelopImport(sources, {
      existingIds: [],
      preparationConcurrency: 4,
      signal: controller.signal,
      preparePreview: async (_, input) => {
        started.push(input.name);
        if (input.name === "bad.ARW") {
          await hold.promise;
          throw new Error("Retry a matching source");
        }
        return preview(input);
      },
      save: async (input) => {
        saved.push(input.name);
        return stored(input);
      },
    });
    try {
      for (let i = 0; i < 30 && started.length < 4; i++) await tick();
      expect(started).toEqual(["bad.ARW", "later-0.jpg", "later-1.jpg", "later-2.jpg"]);
      expect(saved).toEqual([]);
    } finally {
      hold.resolve();
      await run;
      clearTimeout(timeout);
    }
    const result = await run;
    expect(result.stopped).toBe(false);
    expect(result.failures.map((failure) => failure.fileName)).toEqual(["bad.ARW"]);
    expect(result.duplicates).toBe(0);
    expect(saved).toEqual(sources.slice(1).map((source) => source.name));
    expect(result.imported[0]!.sourceBlob).toBe(sources[1]);
  });

  test("cancellation drains all four active source reads and admits no later fingerprint or preview", async () => {
    const hold = gate(),
      controller = new AbortController();
    const sources = Array.from({ length: 12 }, (_, i) => file(`${i}.ARW`));
    const reads: string[] = [],
      previews: string[] = [],
      saves: string[] = [];
    for (const source of sources) {
      const read = source.arrayBuffer.bind(source);
      Object.defineProperty(source, "arrayBuffer", {
        value: async () => {
          reads.push(source.name);
          await hold.promise;
          return read();
        },
      });
    }
    let settled = false;
    const run = runDevelopImport(sources, {
      existingIds: [],
      preparationConcurrency: 4,
      signal: controller.signal,
      preparePreview: async (_, input) => {
        previews.push(input.name);
        return preview(input);
      },
      save: async (input) => {
        saves.push(input.name);
        return stored(input);
      },
    }).then((result) => {
      settled = true;
      return result;
    });
    try {
      for (let i = 0; i < 30 && reads.length < 4; i++) await tick();
      expect(reads).toHaveLength(4);
      controller.abort();
      await tick();
      expect(settled).toBe(false);
      expect(reads).toHaveLength(4);
    } finally {
      hold.resolve();
      await run;
    }
    expect((await run).stopped).toBe(true);
    expect(reads).toHaveLength(4);
    expect(previews).toEqual([]);
    expect(saves).toEqual([]);
  });

  test("mixed RAW/raster retry schedules match an independent input-order model at every queue limit", async () => {
    for (const concurrency of [1, 2, 3, 4]) {
      for (const rawConcurrency of [1, 2]) {
        for (let seed = 0; seed < 8; seed++) {
          const sources = Array.from({ length: 12 }, (_, index) => {
            const group = (index * 3 + seed) % 5;
            const bad = (index + seed) % 4 === 0;
            const name = `${bad ? "bad-" : "good-"}${index}.${index < 5 || (seed + index) % 2 ? "ARW" : "jpg"}`;
            return { source: file(name, `group:${group}`), group, bad, index };
          });
          const claimed = new Set<number>();
          const expectedSaved: File[] = [],
            expectedFailed: string[] = [];
          let expectedDuplicates = 0;
          for (const entry of sources) {
            if (claimed.has(entry.group)) expectedDuplicates++;
            else if (entry.bad) expectedFailed.push(entry.source.name);
            else {
              claimed.add(entry.group);
              expectedSaved.push(entry.source);
            }
          }
          let retained = 0,
            peak = 0;
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 1000);
          try {
            const result = await runDevelopImport(
              sources.map((entry) => entry.source),
              {
                existingIds: [],
                preparationConcurrency: concurrency,
                rawPreparationConcurrency: rawConcurrency,
                signal: controller.signal,
                preparePreview: async (source, input) => {
                  retained++;
                  peak = Math.max(peak, retained);
                  const entry = sources.find((item) => item.source === source)!;
                  if ((entry.index + seed) % 3 === 0) await tick();
                  if (entry.bad) {
                    retained--;
                    throw new Error("Deterministic corrupt file");
                  }
                  return preview(input);
                },
                save: async (input) => {
                  await Promise.resolve();
                  retained--;
                  return stored(input);
                },
              },
            );
            expect(result.stopped).toBe(false);
            expect(result.fatalError).toBeNull();
            expect(result.imported.map((photo) => photo.name)).toEqual(
              expectedSaved.map((source) => source.name),
            );
            result.imported.forEach((photo, index) =>
              expect(photo.sourceBlob).toBe(expectedSaved[index]),
            );
            expect(result.failures.map((failure) => failure.fileName)).toEqual(expectedFailed);
            expect(result.duplicates).toBe(expectedDuplicates);
            expect(peak).toBeLessThanOrEqual(concurrency);
          } finally {
            clearTimeout(timeout);
            controller.abort();
          }
        }
      }
    }
  });

  test("concurrent duplicate inputs decode once, preserving first-input identity/name", async () => {
    const started: string[] = [],
      duplicates: number[] = [];
    const result = await runDevelopImport(
      [file("first.jpg", "same"), file("copy.jpg", "same"), file("last.jpg", "other")],
      {
        existingIds: [],
        preparationConcurrency: 4,
        onDuplicate: (progress) => duplicates.push(progress.index),
        preparePreview: async (_, input) => {
          started.push(input.name);
          await tick();
          return preview(input);
        },
        save: async (input) => stored(input),
      },
    );
    expect(started).toEqual(["first.jpg", "last.jpg"]);
    expect(result.imported.map((photo) => photo.name)).toEqual(["first.jpg", "last.jpg"]);
    expect(result.duplicates).toBe(1);
    expect(duplicates).toEqual([2]);
  });

  test("failed duplicate preparation permits the later copy to retry", async () => {
    const failed: number[] = [];
    const result = await runDevelopImport([file("bad.jpg", "same"), file("retry.jpg", "same")], {
      existingIds: [],
      preparationConcurrency: 4,
      onFileFailure: (_, progress) => failed.push(progress.index),
      preparePreview: async (_, input) => {
        if (input.name === "bad.jpg") throw new Error("decode failed");
        return preview(input);
      },
      save: async (input) => stored(input),
    });
    expect(result.imported.map((photo) => photo.name)).toEqual(["retry.jpg"]);
    expect(result.duplicates).toBe(0);
    expect(failed).toEqual([1]);
  });

  test("storage failure aborts in-flight preparation, drains it, and never starts another save", async () => {
    const release = gate(),
      slowStarted = gate();
    let aborted = false,
      finished = false,
      settled = false;
    const saved: string[] = [];
    const run = runDevelopImport([file("first.jpg"), file("slow.jpg"), file("third.jpg")], {
      existingIds: [],
      preparationConcurrency: 3,
      preparePreview: async (_, input, signal) => {
        if (input.name === "slow.jpg") {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
            },
            { once: true },
          );
          slowStarted.resolve();
          await release.promise;
          finished = true;
        }
        return preview(input);
      },
      save: async (input) => {
        saved.push(input.name);
        await slowStarted.promise;
        throw new Error("quota");
      },
    }).then((value) => {
      settled = true;
      return value;
    });
    try {
      for (let i = 0; i < 30 && !aborted; i++) await tick();
      expect(aborted).toBe(true);
      expect(settled).toBe(false);
      expect(finished).toBe(false);
    } finally {
      release.resolve();
    }
    const result = await run;
    expect(finished).toBe(true);
    expect(saved).toEqual(["first.jpg"]);
    expect(result.imported).toEqual([]);
    expect(result.fatalError).toContain("quota");
    expect(result.stopped).toBe(false);
  });

  test("cancel during a completed transaction keeps its exact receipt and drains prepared siblings", async () => {
    const controller = new AbortController();
    const saved: string[] = [],
      prepared: string[] = [];
    const result = await runDevelopImport(
      [file("first.jpg"), file("second.jpg"), file("third.jpg")],
      {
        existingIds: [],
        preparationConcurrency: 3,
        signal: controller.signal,
        onPrepared: (input) => prepared.push(input.name),
        preparePreview: async (_, input) => preview(input),
        save: async (input) => {
          saved.push(input.name);
          controller.abort();
          return stored(input);
        },
      },
    );
    expect(saved).toEqual(["first.jpg"]);
    expect(result.imported.map((photo) => photo.name)).toEqual(["first.jpg"]);
    expect(result.stopped).toBe(true);
    expect(result.selectedId).toBe(result.imported[0]!.id);
    expect(prepared.length).toBeGreaterThan(0);
  });
});
