import {
  analyzeDevelopPixelTiles,
  checkPixelAnalysisSignal,
  pixelAnalysisAborted,
  validatePixelAnalysisBlob,
  validatePixelAnalysisDimensions,
  type DevelopPixelAnalysis,
  type DevelopPixelClipping,
  type PixelAnalysisReply,
  type PixelAnalysisRequest,
} from "./pixel-analysis-core";

export type { DevelopPixelAnalysis, DevelopPixelClipping } from "./pixel-analysis-core";
export type DevelopPixelAnalysisOptions = { signal?: AbortSignal; clipping?: DevelopPixelClipping };
type Fallback = (blob: Blob, options: DevelopPixelAnalysisOptions) => Promise<DevelopPixelAnalysis>;

const cooperate = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Browsers without worker canvas support still yield between exact, bounded pixel tiles. */
export async function analyzeDevelopBlobOnMain(
  blob: Blob,
  options: DevelopPixelAnalysisOptions = {},
): Promise<DevelopPixelAnalysis> {
  validatePixelAnalysisBlob(blob);
  checkPixelAnalysisSignal(options.signal);
  if (typeof document === "undefined")
    throw new Error("Browser canvas is unavailable for pixel analysis.");
  let bitmap: ImageBitmap | undefined;
  let image: HTMLImageElement | undefined;
  let objectUrl: string | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    await cooperate();
    checkPixelAnalysisSignal(options.signal);
    if (typeof createImageBitmap === "function") bitmap = await createImageBitmap(blob);
    else {
      objectUrl = URL.createObjectURL(blob);
      image = new Image();
      const target = image;
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          cleanup();
          target.removeAttribute("src");
          reject(pixelAnalysisAborted());
        };
        const cleanup = () => {
          target.onload = null;
          target.onerror = null;
          options.signal?.removeEventListener("abort", abort);
        };
        target.onload = () => {
          cleanup();
          resolve();
        };
        target.onerror = () => {
          cleanup();
          reject(new Error("Could not decode the preview image."));
        };
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
        else target.src = objectUrl!;
      });
    }
    checkPixelAnalysisSignal(options.signal);
    const width = bitmap?.width ?? image!.naturalWidth,
      height = bitmap?.height ?? image!.naturalHeight;
    validatePixelAnalysisDimensions(width, height);
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
    if (!context) throw new Error("Could not read the preview canvas.");
    context.drawImage(bitmap ?? image!, 0, 0);
    await cooperate();
    checkPixelAnalysisSignal(options.signal);
    return await analyzeDevelopPixelTiles(
      width,
      height,
      (x, y, tileWidth, tileHeight) => context.getImageData(x, y, tileWidth, tileHeight).data,
      { ...options, cooperate },
    );
  } finally {
    bitmap?.close();
    if (image) {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute("src");
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

/** One lane and eight outstanding requests. Abort kills active worker work, never merely hides it. */
export function createDevelopPixelAnalyzer(
  dependencies: {
    workerFactory?: () => Worker | null;
    fallback?: Fallback;
  } = {},
) {
  type Job = {
    id: number;
    blob: Blob;
    options: DevelopPixelAnalysisOptions;
    controller: AbortController;
    resolve: (result: DevelopPixelAnalysis) => void;
    reject: (reason: unknown) => void;
    cleanup: () => void;
    settled: boolean;
    fallback: boolean;
  };
  const cached = new WeakMap<Blob, DevelopPixelAnalysis>();
  const queue: Job[] = [];
  let nextId = 0,
    active: Job | null = null,
    worker: Worker | null = null;
  let noWorker = false,
    disposed = false;
  const fallback = dependencies.fallback ?? analyzeDevelopBlobOnMain;
  const workerFactory =
    dependencies.workerFactory ??
    (() =>
      typeof Worker === "undefined"
        ? null
        : new Worker(new URL("./pixel-analysis.worker.ts", import.meta.url), { type: "module" }));

  function closeWorker() {
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    worker = null;
  }
  function settle(job: Job, result?: DevelopPixelAnalysis, error?: unknown) {
    if (job.settled) return;
    job.settled = true;
    job.cleanup();
    if (result) {
      // Identity-only cache. No clipping buffers or original bytes are retained in its value.
      cached.set(job.blob, {
        histogram: result.histogram,
        width: result.width,
        height: result.height,
      });
      job.resolve(result);
    } else job.reject(error ?? new Error("Could not analyze the preview pixels."));
  }
  function complete(job: Job, result?: DevelopPixelAnalysis, error?: unknown) {
    if (active !== job) return;
    settle(job, result, error);
    active = null;
    pump();
  }
  function startFallback(job: Job) {
    job.fallback = true;
    void Promise.resolve()
      .then(() => fallback(job.blob, { ...job.options, signal: job.controller.signal }))
      .then(
        (result) => complete(job, result),
        (error: unknown) => complete(job, undefined, error),
      );
  }
  function pump() {
    if (active || disposed) return;
    const job = queue.shift();
    if (!job) return;
    active = job;
    const known = cached.get(job.blob);
    if (known && !job.options.clipping) {
      complete(job, known);
      return;
    }
    if (noWorker) {
      startFallback(job);
      return;
    }
    try {
      if (!worker) {
        worker = workerFactory();
        if (!worker) {
          noWorker = true;
          startFallback(job);
          return;
        }
        const current = worker;
        current.onmessage = (event: MessageEvent<PixelAnalysisReply>) => {
          if (worker !== current || !active || event.data?.id !== active.id) return;
          const owner = active,
            reply = event.data;
          if ("result" in reply) complete(owner, reply.result);
          else if (reply.unsupported) {
            noWorker = true;
            closeWorker();
            startFallback(owner);
          } else complete(owner, undefined, new Error(reply.error));
        };
        const failed = (event: Event) => {
          event.preventDefault();
          if (worker !== current || !active) return;
          const owner = active;
          noWorker = true;
          closeWorker();
          startFallback(owner);
        };
        current.onerror = failed;
        current.onmessageerror = failed;
      }
      const request: PixelAnalysisRequest = {
        id: job.id,
        blob: job.blob,
        ...(job.options.clipping ? { clipping: job.options.clipping } : {}),
      };
      worker.postMessage(request);
    } catch {
      noWorker = true;
      closeWorker();
      startFallback(job);
    }
  }
  function cancel(job: Job) {
    job.controller.abort();
    settle(job, undefined, pixelAnalysisAborted());
    if (active === job) {
      if (job.fallback) return; // Finish decode cleanup before another fallback acquires the lane.
      closeWorker();
      active = null;
    } else {
      const index = queue.indexOf(job);
      if (index >= 0) queue.splice(index, 1);
    }
    pump();
  }
  function analyze(
    blob: Blob,
    options: DevelopPixelAnalysisOptions = {},
  ): Promise<DevelopPixelAnalysis> {
    const signal = options.signal;
    return new Promise((resolve, reject) => {
      try {
        if (disposed) throw new Error("Pixel analysis has stopped.");
        validatePixelAnalysisBlob(blob);
        checkPixelAnalysisSignal(signal);
        if (
          options.clipping &&
          (typeof options.clipping.shadows !== "boolean" ||
            typeof options.clipping.highlights !== "boolean")
        )
          throw new Error("Clipping controls must be enabled or disabled.");
        const known = cached.get(blob);
        if (known && !options.clipping) {
          resolve(known);
          return;
        }
        if (queue.length + (active ? 1 : 0) >= 8)
          throw new Error("Pixel analysis is busy. Try again after a preview finishes.");
        const job: Job = {
          id: ++nextId,
          blob,
          options: {
            ...(signal ? { signal } : {}),
            ...(options.clipping ? { clipping: { ...options.clipping } } : {}),
          },
          controller: new AbortController(),
          resolve,
          reject,
          cleanup: () => signal?.removeEventListener("abort", abort),
          settled: false,
          fallback: false,
        };
        const abort = () => cancel(job);
        signal?.addEventListener("abort", abort, { once: true });
        queue.push(job);
        if (signal?.aborted) cancel(job);
        else pump();
      } catch (error) {
        reject(error);
      }
    });
  }
  function dispose() {
    disposed = true;
    const jobs = [...queue, ...(active ? [active] : [])];
    queue.length = 0;
    for (const job of jobs) {
      job.controller.abort();
      settle(job, undefined, pixelAnalysisAborted());
    }
    closeWorker();
    active = null;
  }
  return { analyze, dispose };
}

const analyzer = createDevelopPixelAnalyzer();
export const analyzeDevelopBlob = analyzer.analyze;
if (import.meta.hot) import.meta.hot.dispose(() => analyzer.dispose());
