import {
  analyseFaces,
  analyseFilePreview,
  attachCullReading,
  decodeFile,
  faceDetectionAvailable,
  isRawFile,
  measureCullFrame,
  type FileAnalysisPreview,
} from "@/lib/imaging";
import { analyseFileNative } from "./native-client";

export interface AnalysisRequest {
  id: number;
  file: File;
}

export type AnalysisResponse =
  { id: number; result: FileAnalysisPreview } | { id: number; error: string };

export type FileAnalysisResult = FileAnalysisPreview & {
  backend: "worker" | "main-thread" | "native-cpp";
  nativeCached?: boolean;
  captureTimeMs?: number | undefined;
  cameraKey?: string | undefined;
  captureTimeBasis?: "utc" | "camera_clock" | undefined;
};

type Job = AnalysisRequest & {
  resolve: (result: FileAnalysisResult) => void;
  reject: (reason: unknown) => void;
  signal: AbortSignal | undefined;
  abort: () => void;
  settled: boolean;
  controller: AbortController;
};

type Lane = {
  worker: Worker | null;
  job: Job | null;
  fallback: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

const queue: Job[] = [];
const lanes: Lane[] = [];
let nextId = 0;
let workersUnavailable = false;

function aborted() {
  return new DOMException("Photo analysis cancelled.", "AbortError");
}

function settle(job: Job, result?: FileAnalysisResult, error?: unknown) {
  if (job.settled) return;
  job.settled = true;
  job.signal?.removeEventListener("abort", job.abort);
  if (result) job.resolve(result);
  else job.reject(error);
}

function stopWorker(lane: Lane) {
  if (lane.timer) clearTimeout(lane.timer);
  lane.timer = null;
  lane.worker?.terminate();
  lane.worker = null;
}

function release(lane: Lane) {
  if (lane.timer) clearTimeout(lane.timer);
  lane.timer = null;
  lane.job = null;
  lane.fallback = false;
  pump();
}

async function fallback(lane: Lane, job: Job) {
  stopWorker(lane);
  lane.fallback = true;
  try {
    // Yield between files when a browser cannot run the worker path.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (!job.settled) {
      const result = await analyseFilePreview(job.file);
      settle(job, { ...result, backend: "main-thread" });
    }
  } catch (error) {
    settle(job, undefined, error);
  } finally {
    release(lane);
  }
}

async function finishWorker(lane: Lane, job: Job, result: FileAnalysisPreview) {
  if (lane.timer) clearTimeout(lane.timer);
  lane.timer = null;
  // Some browsers expose FaceDetector on Window but not in their workers.
  // Preserve the existing face checks instead of silently dropping them.
  lane.fallback = true;
  try {
    if (!result.faceDetectionAvailable && faceDetectionAvailable() && !job.settled) {
      const bitmap = await decodeFile(job.file, 1280);
      try {
        result.analysis.faces = await analyseFaces(bitmap);
        result.faceDetectionAvailable = true;
      } finally {
        bitmap.close();
      }
    }
    settle(job, { ...result, backend: "worker" });
  } catch (error) {
    settle(job, undefined, error);
  } finally {
    release(lane);
  }
}

function runBrowser(lane: Lane, job: Job) {
  if (
    workersUnavailable ||
    typeof Worker === "undefined" ||
    typeof OffscreenCanvas === "undefined" ||
    typeof createImageBitmap === "undefined"
  ) {
    void fallback(lane, job);
    return;
  }
  try {
    if (!lane.worker) {
      lane.worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), {
        type: "module",
      });
      lane.worker.onmessage = ({ data }: MessageEvent<AnalysisResponse>) => {
        const active = lane.job;
        if (!active || lane.fallback || data.id !== active.id) return;
        if ("error" in data) void fallback(lane, active);
        else void finishWorker(lane, active, data.result);
      };
      lane.worker.onerror = () => {
        const active = lane.job;
        workersUnavailable = true;
        if (active && !lane.fallback) void fallback(lane, active);
      };
      lane.worker.onmessageerror = () => {
        const active = lane.job;
        if (active && !lane.fallback) void fallback(lane, active);
      };
    }
    lane.timer = setTimeout(() => {
      if (lane.job === job && !lane.fallback) void fallback(lane, job);
    }, 120_000);
    lane.worker.postMessage({ id: job.id, file: job.file } satisfies AnalysisRequest);
  } catch {
    workersUnavailable = true;
    void fallback(lane, job);
  }
}

function run(lane: Lane, job: Job) {
  lane.job = job;
  // Unit tests and production remain on the original worker path; native is local-dev only.
  if (!import.meta.env?.DEV || typeof window === "undefined") {
    runBrowser(lane, job);
    return;
  }
  lane.fallback = true;
  void (async () => {
    let delegatedToBrowser = false;
    try {
      const result = await analyseFileNative(job.file, job.controller.signal);
      if (job.settled) return;
      if (!result) {
        lane.fallback = false;
        delegatedToBrowser = true;
        runBrowser(lane, job);
        return;
      }
      // The local C++ engine returns its own preview and tone statistics; the
      // cull measurements come from the same engine the hosted site runs, so a
      // frame scores identically on this Mac and on lenslab.dev.
      const bitmap = await createImageBitmap(result.previewBlob);
      try {
        if (faceDetectionAvailable()) {
          result.analysis.faces = await analyseFaces(bitmap);
          result.faceDetectionAvailable = true;
        }
        attachCullReading(result.analysis, await measureCullFrame(bitmap, result.analysis.faces));
      } finally {
        bitmap.close();
      }
      settle(job, result);
    } catch (error) {
      settle(job, undefined, error);
    } finally {
      if (!delegatedToBrowser) release(lane);
    }
  })();
}

function pump() {
  for (const lane of lanes) {
    if (lane.job) continue;
    const activeRaw = lanes.filter((entry) => entry.job && isRawFile(entry.job.file)).length;
    const index = queue.findIndex((job) => !isRawFile(job.file) || activeRaw < 2);
    if (index < 0) continue;
    const [job] = queue.splice(index, 1);
    if (job) run(lane, job);
  }
}

/** Bounded local analysis: at most four JPEG decodes or two RAW containers at once. */
export function analyseFile(
  file: File,
  options: { signal?: AbortSignal } = {},
): Promise<FileAnalysisResult> {
  if (options.signal?.aborted) return Promise.reject(aborted());
  if (!lanes.length) {
    const cores = typeof navigator === "undefined" ? 2 : navigator.hardwareConcurrency || 2;
    const count = Math.min(4, Math.max(2, cores - 1));
    for (let i = 0; i < count; i++) {
      lanes.push({ worker: null, job: null, fallback: false, timer: null });
    }
  }
  return new Promise((resolve, reject) => {
    const job: Job = {
      id: ++nextId,
      file,
      resolve,
      reject,
      signal: options.signal,
      settled: false,
      controller: new AbortController(),
      abort: () => {
        job.controller.abort();
        settle(job, undefined, aborted());
        const index = queue.indexOf(job);
        if (index >= 0) queue.splice(index, 1);
        const lane = lanes.find((entry) => entry.job === job);
        if (lane && !lane.fallback) {
          stopWorker(lane);
          release(lane);
        }
      },
    };
    options.signal?.addEventListener("abort", job.abort, { once: true });
    queue.push(job);
    pump();
  });
}

/** Cancel pending work and release workers, e.g. when the Studio unmounts. */
export function disposeAnalysisWorkers() {
  for (const job of queue.splice(0)) settle(job, undefined, aborted());
  for (const lane of lanes) {
    if (lane.job) {
      lane.job.controller.abort();
      settle(lane.job, undefined, aborted());
    }
    stopWorker(lane);
    // A running main-thread fallback retains its slot until its bitmap is closed.
    if (!lane.fallback) lane.job = null;
  }
  workersUnavailable = false;
}
