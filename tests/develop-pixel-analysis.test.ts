import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { analyzeDevelopPixels, clippingPixels } from "../src/lib/develop/histogram";
import { createDevelopPixelAnalyzer } from "../src/lib/develop/pixel-analysis";
import { DEVELOP_ENGINE_LIMITS } from "../src/lib/develop/contract";
import {
  analyzeDevelopPixelTiles,
  MAX_DEVELOP_ANALYSIS_BYTES,
  MAX_DEVELOP_ANALYSIS_PIXELS,
  validatePixelAnalysisBlob,
  validatePixelAnalysisDimensions,
  type DevelopPixelAnalysis,
  type PixelAnalysisReply,
  type PixelAnalysisRequest,
} from "../src/lib/develop/pixel-analysis-core";

function pixels(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      data.set(
        [(x * 13 + y) % 256, (y * 37 + x) % 256, (x + y * 71) % 256, (x + y) % 7 ? 255 : 0],
        offset,
      );
    }
  return data;
}
function rectangle(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  tileWidth: number,
  tileHeight: number,
) {
  const out = new Uint8ClampedArray(tileWidth * tileHeight * 4);
  for (let row = 0; row < tileHeight; row++)
    out.set(
      data.subarray(((y + row) * width + x) * 4, ((y + row) * width + x + tileWidth) * 4),
      row * tileWidth * 4,
    );
  return out;
}
const result = (color = 50): DevelopPixelAnalysis => ({
  width: 1,
  height: 1,
  histogram: analyzeDevelopPixels(new Uint8Array([color, color, color, 255])),
});
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
class FakeWorker {
  onmessage: ((event: MessageEvent<PixelAnalysisReply>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: ((event: Event) => void) | null = null;
  requests: PixelAnalysisRequest[] = [];
  terminated = 0;
  postMessage(request: PixelAnalysisRequest) {
    this.requests.push(request);
  }
  terminate() {
    this.terminated++;
  }
  emit(reply: PixelAnalysisReply) {
    this.onmessage?.({ data: reply } as MessageEvent<PixelAnalysisReply>);
  }
  ready(value = result()) {
    this.emit({ id: this.requests.at(-1)!.id, result: value });
  }
}
function workerAnalyzer() {
  const workers: FakeWorker[] = [];
  const analyzer = createDevelopPixelAnalyzer({
    workerFactory: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    },
    fallback: async () => {
      throw new Error("Unexpected fallback");
    },
  });
  return { analyzer, workers };
}

describe("Exact tiled pixel analysis", () => {
  test("accepts opt-in dimensions only within both 8192-edge and 36MP limits", () => {
    expect(MAX_DEVELOP_ANALYSIS_PIXELS).toBe(DEVELOP_ENGINE_LIMITS.maxOutputPixels);
    for (const [width, height] of [
      [4096, 4096], // Existing default remains valid.
      [4097, 4096],
      [6000, 6000], // Exact pixel ceiling, without allocating a full-resolution fixture.
      [8192, 4394],
      [4394, 8192],
      [8192, 1],
      [1, 8192],
    ])
      expect(() => validatePixelAnalysisDimensions(width!, height!)).not.toThrow();
    for (const [width, height] of [
      [6001, 6000],
      [8192, 4395],
      [4395, 8192],
      [8193, 1], // Edge ceiling also rejects narrow panoramas below the pixel ceiling.
      [1, 8193],
      [8192, 8192],
    ])
      expect(() => validatePixelAnalysisDimensions(width!, height!)).toThrow(/36,000,000.*8,192/);
  });
  test("long-edge opt-in reads preserve exact pixels and bounded tiles in both orientations", async () => {
    for (const [width, height] of [
      [8192, 17],
      [17, 8192],
    ] as const) {
      const data = pixels(width, height);
      let largestRead = 0;
      const actual = await analyzeDevelopPixelTiles(
        width,
        height,
        (x, y, w, h) => {
          largestRead = Math.max(largestRead, w * h * 4);
          return rectangle(data, width, x, y, w, h);
        },
        { clipping: { shadows: true, highlights: true } },
      );
      expect(actual.histogram).toEqual(analyzeDevelopPixels(data));
      expect(actual.clipping).toEqual(clippingPixels(data, true, true, "rgb"));
      expect(largestRead).toBeLessThanOrEqual(512 * 256 * 4);
      expect(largestRead).toBeLessThan(data.byteLength);
    }
  });
  test("matches a full-image histogram and RGB clipping without flipping or dropping edge tiles", async () => {
    const width = 1037,
      height = 519,
      data = pixels(width, height),
      before = data.slice();
    let reads = 0,
      yields = 0;
    const actual = await analyzeDevelopPixelTiles(
      width,
      height,
      (x, y, w, h) => {
        reads++;
        expect(w * h).toBeLessThanOrEqual(512 * 256);
        return rectangle(data, width, x, y, w, h);
      },
      {
        clipping: { shadows: true, highlights: true },
        cooperate: async () => {
          yields++;
        },
      },
    );
    expect(actual.histogram).toEqual(analyzeDevelopPixels(data));
    expect(actual.clipping).toEqual(clippingPixels(data, true, true, "rgb"));
    expect(data).toEqual(before);
    expect([reads, yields]).toEqual([9, 8]);
    expect([actual.width, actual.height]).toEqual([width, height]);
  });
  test("handles one-pixel, narrow and transparent images with no optional mask allocation", async () => {
    for (const [width, height] of [
      [1, 1],
      [1, 1025],
      [1025, 1],
      [513, 257],
    ]) {
      const data = pixels(width!, height!);
      const actual = await analyzeDevelopPixelTiles(width!, height!, (x, y, w, h) =>
        rectangle(data, width!, x, y, w, h),
      );
      expect(actual.histogram).toEqual(analyzeDevelopPixels(data));
      expect(actual.clipping).toBeUndefined();
    }
  });
  test("keeps old fully-black overlay semantics while explicitly supporting RGB shadows", () => {
    const data = new Uint8Array([0, 70, 90, 255, 0, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0]);
    expect([...clippingPixels(data, true, false)]).toEqual([
      0, 0, 0, 0, 0, 0, 255, 220, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect([...clippingPixels(data, true, true, "rgb")]).toEqual([
      0, 0, 255, 220, 0, 0, 255, 220, 255, 0, 0, 220, 0, 0, 0, 0,
    ]);
  });
  test("rejects invalid bounds, short tiles and canceled work before another pixel read", async () => {
    for (const [w, h] of [
      [0, 1],
      [1, -1],
      [NaN, 1],
      [1.5, 1],
      [6001, 6000],
      [MAX_DEVELOP_ANALYSIS_PIXELS + 1, 1],
    ])
      expect(() => validatePixelAnalysisDimensions(w!, h!)).toThrow();
    expect(() => validatePixelAnalysisDimensions(4096, 4096)).not.toThrow();
    let invalidReads = 0;
    await expect(
      analyzeDevelopPixelTiles(8193, 1, () => {
        invalidReads++;
        return new Uint8Array(4);
      }),
    ).rejects.toThrow();
    expect(invalidReads).toBe(0);
    expect(() => validatePixelAnalysisBlob(new Blob())).toThrow();
    const oversize = new Blob(["x"]);
    Object.defineProperty(oversize, "size", { value: MAX_DEVELOP_ANALYSIS_BYTES + 1 });
    expect(() => validatePixelAnalysisBlob(oversize)).toThrow();
    await expect(analyzeDevelopPixelTiles(2, 2, () => new Uint8Array(4))).rejects.toThrow(
      "incomplete",
    );
    const controller = new AbortController();
    let reads = 0;
    await expect(
      analyzeDevelopPixelTiles(
        1024,
        512,
        (_x, _y, w, h) => {
          reads++;
          return new Uint8Array(w * h * 4);
        },
        { signal: controller.signal, cooperate: async () => controller.abort() },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(reads).toBe(1);
    await expect(
      analyzeDevelopPixelTiles(
        1,
        1,
        () => {
          reads++;
          return new Uint8Array(4);
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(reads).toBe(1);
  });
});

describe("One bounded pixel worker lane", () => {
  test("runs FIFO without parallel decodes and reuses an exact Blob's completed statistics", async () => {
    const { analyzer, workers } = workerAnalyzer();
    const firstBlob = new Blob(["first"]),
      otherBlob = new Blob(["second"]);
    const a = analyzer.analyze(firstBlob),
      replay = analyzer.analyze(firstBlob),
      b = analyzer.analyze(otherBlob);
    expect(workers).toHaveLength(1);
    expect(workers[0]!.requests).toHaveLength(1);
    workers[0]!.ready(result(17));
    expect((await a).histogram.channels[0]![17]).toBe(1);
    expect(await replay).toEqual(await a);
    expect(workers[0]!.requests).toHaveLength(2);
    expect(workers[0]!.requests[1]!.blob).toBe(otherBlob);
    workers[0]!.ready(result(31));
    expect((await b).histogram.channels[0]![31]).toBe(1);
    expect((await analyzer.analyze(firstBlob)).clipping).toBeUndefined();
    expect(workers[0]!.requests).toHaveLength(2);
    const sameBytesDifferentIdentity = analyzer.analyze(new Blob(["first"]));
    expect(workers[0]!.requests).toHaveLength(3);
    workers[0]!.ready();
    await sameBytesDifferentIdentity;
    analyzer.dispose();
  });
  test("clipping requests do not reuse a stats-only result or retain an old overlay in the cache", async () => {
    const { analyzer, workers } = workerAnalyzer();
    const blob = new Blob(["image"]);
    const original = analyzer.analyze(blob);
    workers[0]!.ready();
    await original;
    const flags = { shadows: true, highlights: false };
    const withMask = analyzer.analyze(blob, { clipping: flags });
    flags.shadows = false;
    expect(workers[0]!.requests[1]!.clipping).toEqual({ shadows: true, highlights: false });
    const overlay = new Uint8ClampedArray([0, 0, 255, 220]);
    workers[0]!.ready({ ...result(), clipping: overlay });
    expect((await withMask).clipping).toBe(overlay);
    expect((await analyzer.analyze(blob)).clipping).toBeUndefined();
    analyzer.dispose();
  });
  test("queued cancellation is local to its caller, not another same-Blob request", async () => {
    const { analyzer, workers } = workerAnalyzer();
    const blob = new Blob(["photo"]),
      controller = new AbortController();
    const first = analyzer.analyze(blob);
    const canceled = analyzer
      .analyze(blob, { signal: controller.signal })
      .catch((error: unknown) => error);
    const third = analyzer.analyze(blob);
    controller.abort();
    expect(await canceled).toMatchObject({ name: "AbortError" });
    expect(workers[0]!.terminated).toBe(0);
    workers[0]!.ready();
    await first;
    await third;
    expect(workers[0]!.requests).toHaveLength(1);
    analyzer.dispose();
  });
  test("active cancellation terminates stale work and ignores its late messages", async () => {
    const { analyzer, workers } = workerAnalyzer();
    const controller = new AbortController();
    const first = analyzer
      .analyze(new Blob(["old"]), { signal: controller.signal })
      .catch((error: unknown) => error);
    const late = workers[0]!.onmessage!,
      oldId = workers[0]!.requests[0]!.id;
    const second = analyzer.analyze(new Blob(["new"]));
    let secondDone = false;
    void second.then(() => {
      secondDone = true;
    });
    controller.abort();
    expect(await first).toMatchObject({ name: "AbortError" });
    expect(workers[0]!.terminated).toBe(1);
    expect(workers).toHaveLength(2);
    late({ data: { id: oldId, result: result(1) } } as MessageEvent<PixelAnalysisReply>);
    await tick();
    expect(secondDone).toBe(false);
    workers[1]!.ready(result(2));
    expect((await second).histogram.channels[0]![2]).toBe(1);
    analyzer.dispose();
  });
  test("bounds outstanding requests and disposal rejects all callers without source changes", async () => {
    const { analyzer, workers } = workerAnalyzer();
    const queued = Array.from({ length: 8 }, (_, i) =>
      analyzer.analyze(new Blob([String(i)])).catch((error: unknown) => error),
    );
    await expect(analyzer.analyze(new Blob(["overflow"]))).rejects.toThrow("busy");
    expect(workers[0]!.requests).toHaveLength(1);
    analyzer.dispose();
    for (const error of await Promise.all(queued))
      expect(error).toMatchObject({ name: "AbortError" });
    expect(workers[0]!.terminated).toBe(1);
    await expect(analyzer.analyze(new Blob(["late"]))).rejects.toThrow("stopped");
  });
  test("a decode failure releases the lane for the next request", async () => {
    const { analyzer, workers } = workerAnalyzer();
    const failed = analyzer.analyze(new Blob(["bad"])).catch((error: unknown) => error);
    const valid = analyzer.analyze(new Blob(["good"]));
    workers[0]!.emit({ id: workers[0]!.requests[0]!.id, error: "Invalid preview" });
    expect(await failed).toMatchObject({ message: "Invalid preview" });
    expect(workers[0]!.requests).toHaveLength(2);
    workers[0]!.ready();
    await valid;
    analyzer.dispose();
  });
  test("unsupported worker canvas falls back once, and cancel waits for decode cleanup before starting another", async () => {
    const worker = new FakeWorker(),
      firstDecode = deferred<DevelopPixelAnalysis>();
    const started: { blob: Blob; signal?: AbortSignal }[] = [];
    const analyzer = createDevelopPixelAnalyzer({
      workerFactory: () => worker as unknown as Worker,
      fallback: async (blob, options) => {
        started.push({ blob, ...(options.signal ? { signal: options.signal } : {}) });
        return started.length === 1 ? firstDecode.promise : result(99);
      },
    });
    const controller = new AbortController(),
      one = new Blob(["one"]),
      two = new Blob(["two"]);
    const a = analyzer.analyze(one, { signal: controller.signal }).catch((error: unknown) => error);
    const b = analyzer.analyze(two);
    worker.emit({ id: worker.requests[0]!.id, error: "No canvas", unsupported: true });
    await tick();
    controller.abort();
    expect(await a).toMatchObject({ name: "AbortError" });
    expect(started).toHaveLength(1);
    expect(started[0]!.signal?.aborted).toBe(true);
    expect(worker.terminated).toBe(1);
    firstDecode.resolve(result(11));
    expect((await b).histogram.channels[0]![99]).toBe(1);
    expect(started).toHaveLength(2);
    expect(started[1]!.blob).toBe(two);
    // A canceled fallback did not cache a successful-looking result.
    expect((await analyzer.analyze(one)).histogram.channels[0]![99]).toBe(1);
    expect(started).toHaveLength(3);
    analyzer.dispose();
  });
  test("worker startup and message errors use the cooperative fallback without losing the lane", async () => {
    for (const mode of ["constructor", "error", "messageerror"] as const) {
      const worker = new FakeWorker();
      let fallbacks = 0;
      const analyzer = createDevelopPixelAnalyzer({
        workerFactory: () => {
          if (mode === "constructor") throw new Error("Blocked");
          return worker as unknown as Worker;
        },
        fallback: async () => {
          fallbacks++;
          return result();
        },
      });
      const a = analyzer.analyze(new Blob(["one"])),
        b = analyzer.analyze(new Blob(["two"]));
      if (mode !== "constructor")
        worker[mode === "error" ? "onerror" : "onmessageerror"]?.(
          new Event("error", { cancelable: true }),
        );
      await a;
      await b;
      expect(fallbacks).toBe(2);
      expect(worker.terminated).toBe(mode === "constructor" ? 0 : 1);
      analyzer.dispose();
    }
  });
  test("bad input and already-aborted requests never create a worker", async () => {
    const { analyzer, workers } = workerAnalyzer();
    const controller = new AbortController();
    controller.abort();
    await expect(
      analyzer.analyze(new Blob(["x"]), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(analyzer.analyze(new Blob())).rejects.toThrow("nonempty");
    await expect(
      analyzer.analyze(new Blob(["x"]), {
        clipping: { shadows: "yes" as unknown as boolean, highlights: false },
      }),
    ).rejects.toThrow("enabled or disabled");
    expect(workers).toHaveLength(0);
    analyzer.dispose();
  });
});

test("real worker and fallback handlers close decoded bitmaps on success, failure and cancellation", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(new URL("./develop-pixel-analysis-lifecycle.fixture.ts", import.meta.url)),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [output, errors, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(errors).toBe("");
  expect(code).toBe(0);
  expect(JSON.parse(output).passed).toBeGreaterThanOrEqual(20);
});
