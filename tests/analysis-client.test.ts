import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  analyseFile,
  disposeAnalysisWorkers,
  type AnalysisRequest,
  type AnalysisResponse,
} from "../src/lib/studio/analysis-client";
import type { FileAnalysisPreview } from "../src/lib/imaging";

const preview = (): FileAnalysisPreview => ({
  width: 1280,
  height: 853,
  analysis: {
    sharpness: 400,
    brightness: 120,
    clippedHighlights: 0,
    clippedShadows: 0,
    hash: "0".repeat(64),
    tone: {
      black: 0,
      white: 255,
      median: 128,
      rMean: 120,
      gMean: 120,
      bMean: 120,
      satMean: 0,
    },
  },
  previewBlob: new Blob(["preview"], { type: "image/jpeg" }),
  // Prevent a main-thread face pass: these tests exercise scheduling, not pixels.
  faceDetectionAvailable: true,
});

class ControlledWorker {
  static instances: ControlledWorker[] = [];
  static started: string[] = [];
  static active = 0;
  static activeRaw = 0;
  static maxActive = 0;
  static maxRaw = 0;

  onmessage: ((event: MessageEvent<AnalysisResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  request: AnalysisRequest | null = null;
  terminated = false;

  constructor() {
    ControlledWorker.instances.push(this);
  }

  postMessage(request: AnalysisRequest) {
    if (this.request || this.terminated) throw new Error("Worker lane reused while busy.");
    this.request = request;
    ControlledWorker.started.push(request.file.name);
    ControlledWorker.active += 1;
    if (request.file.name.endsWith(".nef")) ControlledWorker.activeRaw += 1;
    ControlledWorker.maxActive = Math.max(ControlledWorker.maxActive, ControlledWorker.active);
    ControlledWorker.maxRaw = Math.max(ControlledWorker.maxRaw, ControlledWorker.activeRaw);
  }

  private releaseRequest() {
    const request = this.request;
    if (!request) return null;
    this.request = null;
    ControlledWorker.active -= 1;
    if (request.file.name.endsWith(".nef")) ControlledWorker.activeRaw -= 1;
    return request;
  }

  complete() {
    const request = this.releaseRequest();
    if (!request || this.terminated) return;
    this.onmessage?.({
      data: { id: request.id, result: preview() },
    } as MessageEvent<AnalysisResponse>);
  }

  terminate() {
    this.releaseRequest();
    this.terminated = true;
  }

  static reset() {
    this.instances = [];
    this.started = [];
    this.active = 0;
    this.activeRaw = 0;
    this.maxActive = 0;
    this.maxRaw = 0;
  }
}

const mockedGlobals = ["navigator", "Worker", "OffscreenCanvas", "createImageBitmap"] as const;
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();

function defineGlobal(key: string, value: unknown) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

function finishAllWorkers() {
  // Deterministic completions avoid timing-dependent assertions and real timers.
  for (let pass = 0; ControlledWorker.active && pass < 100; pass++) {
    for (const worker of [...ControlledWorker.instances]) worker.complete();
  }
  expect(ControlledWorker.active).toBe(0);
}

const file = (name: string) => new File(["fixture"], name, { type: "image/jpeg" });

describe("photo analysis worker lifecycle", () => {
  beforeEach(() => {
    disposeAnalysisWorkers();
    ControlledWorker.reset();
    for (const key of mockedGlobals) {
      originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    }
    defineGlobal("navigator", { hardwareConcurrency: 8 });
    defineGlobal("Worker", ControlledWorker);
    defineGlobal("OffscreenCanvas", class {});
    defineGlobal("createImageBitmap", () => {
      throw new Error("Unexpected main-thread decode in worker scheduling test.");
    });
  });

  afterEach(() => {
    // Clear the client's worker timeout handles before restoring browser globals.
    disposeAnalysisWorkers();
    for (const key of mockedGlobals) {
      const descriptor = originalGlobals.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    originalGlobals.clear();
    ControlledWorker.reset();
  });

  test("bounds a mixed queue to four total jobs and two RAW containers", async () => {
    const pending = Array.from({ length: 18 }, (_, index) =>
      analyseFile(file(`frame-${index}.${index < 12 ? "nef" : "jpg"}`)),
    );

    expect(ControlledWorker.active).toBe(4);
    expect(ControlledWorker.activeRaw).toBe(2);
    finishAllWorkers();
    const results = await Promise.all(pending);

    expect(results).toHaveLength(18);
    expect(results.every((result) => result.backend === "worker")).toBe(true);
    expect(ControlledWorker.started).toHaveLength(18);
    expect(ControlledWorker.maxActive).toBe(4);
    expect(ControlledWorker.maxRaw).toBe(2);
  });

  test("aborts queued and active jobs without cancelling unrelated work", async () => {
    const controllers = Array.from({ length: 8 }, () => new AbortController());
    const pending = controllers.map((controller, index) =>
      analyseFile(file(`cancel-${index}.jpg`), { signal: controller.signal }),
    );
    const settled = Promise.allSettled(pending);
    const firstWorker = ControlledWorker.instances[0]!;

    // Cancel an actually queued file before freeing any busy lane.
    controllers[6]!.abort();
    expect(ControlledWorker.started).not.toContain("cancel-6.jpg");
    controllers[0]!.abort();
    expect(firstWorker.terminated).toBe(true);
    finishAllWorkers();

    const results = await settled;
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(6);
    for (const index of [0, 6]) {
      const result = results[index]!;
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(result.reason.name).toBe("AbortError");
    }
    expect(ControlledWorker.started).not.toContain("cancel-6.jpg");

    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await expect(
      analyseFile(file("already-aborted.jpg"), { signal: alreadyAborted.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(ControlledWorker.started).not.toContain("already-aborted.jpg");
  });

  test("dispose cancels every active and queued job and permits a clean restart", async () => {
    const pending = Array.from({ length: 10 }, (_, index) =>
      analyseFile(file(`dispose-${index}.jpg`)),
    );
    const settled = Promise.allSettled(pending);
    expect(ControlledWorker.active).toBe(4);
    expect(ControlledWorker.started).toHaveLength(4);

    disposeAnalysisWorkers();
    const results = await settled;
    expect(results).toHaveLength(10);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(result.reason.name).toBe("AbortError");
    }
    expect(ControlledWorker.active).toBe(0);
    expect(ControlledWorker.instances.every((worker) => worker.terminated)).toBe(true);
    expect(ControlledWorker.started).toHaveLength(4);

    const restarted = analyseFile(file("restart.jpg"));
    finishAllWorkers();
    expect((await restarted).backend).toBe("worker");
    expect(ControlledWorker.started).toHaveLength(5);
    expect(ControlledWorker.started.at(-1)).toBe("restart.jpg");
  });
});
