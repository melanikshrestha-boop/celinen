/** Develop's sensor render: the photograph at the resolution the sensor holds.
 *
 * Three pictures exist for a RAW, and the difference between them is the whole
 * point of this file:
 *
 *  - The embedded JPEG. The camera's own rendering, 1616x1080 on a Sony ARW.
 *    It paints instantly because it is already a finished picture, and it is
 *    what Develop shows the moment a RAW is opened.
 *  - The editing render. Full resolution and full quality when the picture is
 *    small enough to decode quickly — which a Sony APS-C crop is — and
 *    otherwise the sensor at half size, each 2x2 Bayer quad binned into one
 *    pixel, which interpolates nothing. Either way it is well past the
 *    embedded JPEG and arrives while she is still looking at the frame.
 *  - The export render. The sensor at full resolution with the gradient-
 *    corrected demosaic. Slower, so it is only asked for on export.
 *
 * Which of the three is on screen is never guessed at: `RawSensorRender.kind`
 * says, and Develop prints it.
 */
import {
  type RawDecodeRequest,
  type RawDemosaic,
  type RawSensorDescription,
} from "./wasm/raw-decode-engine";
import type { RawDecodeReply, RawDecodeRequest as WorkerRequest } from "./wasm/raw-decode-messages";

export type { RawSensorDescription } from "./wasm/raw-decode-engine";

/** What the render is for. The editor's may be full resolution or half,
 * decided by the worker from the picture's own size; the export's never is. */
export type RawSensorQuality = "editing" | "export";

export type RawSensorRender = {
  kind: RawSensorQuality;
  width: number;
  height: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
  /** What the render's white balance resolved to, in real Kelvin. */
  kelvin: number;
  tint: number;
  whiteBalanceFromFile: boolean;
  description: RawSensorDescription;
  /** Wall-clock milliseconds the decode took, for the performance panel. */
  elapsed: number;
  /** Peak bytes the engine held. */
  residentBytes: number;
};

/** Refused by name rather than decoded: a camera with no profile here, a
 * packing this converter does not read, a container it cannot parse. Not an
 * error — the embedded JPEG stays on screen and Develop says why. */
export class RawSensorUnsupported extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "RawSensorUnsupported";
  }
}

export type RawSensorOptions = {
  quality?: RawSensorQuality;
  /** 0 or undefined keeps the camera's own white balance. */
  kelvin?: number;
  tint?: number;
  exposure?: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
};

// What the editing render asks for before the worker has seen the picture's
// size. Nothing is interpolated at half size, so even when the worker keeps
// this the render invents nothing: it is a smaller true picture, not a guess
// at a larger one.
function demosaicFor(quality: RawSensorQuality): RawDemosaic {
  return quality === "editing" ? "half" : "gradient";
}

// A band of 64 rows is a few milliseconds of work, which is a fine enough
// grain both for a progress bar and for noticing a cancel.
const BAND_ROWS = 64;

type Pending = {
  resolve: (render: RawSensorRender) => void;
  reject: (error: unknown) => void;
  onProgress: ((progress: number) => void) | undefined;
  quality: RawSensorQuality;
  started: number;
  cleanup: () => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./raw-decode.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }: MessageEvent<RawDecodeReply>) => {
    const job = pending.get(data.id);
    if (!job) return;
    if (data.kind === "progress") {
      job.onProgress?.(data.progress);
      return;
    }
    if (data.kind === "opened") return;
    pending.delete(data.id);
    job.cleanup();
    if (data.kind === "decoded") {
      job.resolve({
        kind: job.quality,
        width: data.width,
        height: data.height,
        rgba: data.rgba,
        kelvin: data.kelvin,
        tint: data.tint,
        whiteBalanceFromFile: data.whiteBalanceFromFile,
        description: data.description,
        elapsed: Date.now() - job.started,
        residentBytes: data.residentBytes,
      });
    } else if (data.kind === "unsupported") {
      job.reject(new RawSensorUnsupported(data.reason));
    } else if (data.kind === "cancelled") {
      job.reject(new DOMException("The sensor render was cancelled.", "AbortError"));
    } else {
      job.reject(new Error(data.error));
    }
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || "The RAW decoder stopped.");
    for (const [, job] of pending) {
      job.cleanup();
      job.reject(error);
    }
    pending.clear();
    // A worker that threw at module scope will not recover; the next call
    // starts a fresh one rather than posting into a dead port.
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** True once the page has a worker running; used by tests and teardown. */
export function rawSensorWorkerStarted() {
  return worker !== null;
}

/** Stops the worker and rejects anything still in flight. */
export function stopRawSensorWorker() {
  for (const [, job] of pending) {
    job.cleanup();
    job.reject(new DOMException("The RAW decoder was stopped.", "AbortError"));
  }
  pending.clear();
  worker?.terminate();
  worker = null;
}

/**
 * Decodes a RAW's sensor data. The file is transferred into the worker, so
 * `file` must be a fresh ArrayBuffer the caller no longer needs.
 *
 * Throws RawSensorUnsupported when the file is one the converter does not
 * read, which callers must treat as "keep showing the embedded JPEG" rather
 * than as a failure.
 */
export async function decodeRawSensor(
  file: ArrayBuffer,
  options: RawSensorOptions = {},
): Promise<RawSensorRender> {
  const quality = options.quality ?? "editing";
  options.signal?.throwIfAborted();
  const port = ensureWorker();
  const id = nextId++;
  const request: RawDecodeRequest = {
    quality: demosaicFor(quality),
    kelvin: options.kelvin ?? 0,
    tint: options.tint ?? 0,
    exposure: options.exposure ?? 0,
    band: BAND_ROWS,
  };
  return new Promise<RawSensorRender>((resolve, reject) => {
    const abort = () => {
      port.postMessage({ id, kind: "cancel" } satisfies WorkerRequest);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    pending.set(id, {
      resolve,
      reject,
      onProgress: options.onProgress,
      quality,
      started: Date.now(),
      cleanup: () => options.signal?.removeEventListener("abort", abort),
    });
    port.postMessage(
      // The editing render lets the worker choose its demosaic once it knows
      // the picture's size; an export is always the full-quality one.
      { id, kind: "decode", file, request, adaptive: quality === "editing" } satisfies WorkerRequest,
      [file],
    );
  });
}

/** What the viewer should call the picture on screen. Said the same way
 * everywhere so the label, the histogram and the export panel cannot
 * disagree about which decode is being edited. */
export function rawSensorLabel(render: RawSensorRender | null, isRaw: boolean): string {
  if (!render) return isRaw ? "Embedded camera JPEG" : "";
  // Only say half size when it is: below the worker's bound the editing render
  // is the full picture, and claiming otherwise would undersell it.
  const half = render.width < render.description.width;
  return `Sensor RAW · ${half ? "half size · " : ""}${render.width} × ${render.height}`;
}

/**
 * The render as a Blob, which is what the rest of Develop takes as a source.
 *
 * The editing proxy is a JPEG: it is re-rendered by the engine on every slider
 * move, and a 3000x2000 PNG would cost more to hand around than the last
 * fraction of a percent is worth. The export render is a PNG, because that one
 * is what the downloaded file is made from and compressing it twice would be
 * throwing away the resolution this whole path exists to recover.
 */
export async function rawSensorBlob(render: RawSensorRender): Promise<Blob> {
  const canvas = new OffscreenCanvas(render.width, render.height);
  const context = canvas.getContext("2d", { colorSpace: "srgb" });
  if (!context) throw new Error("This browser would not open a drawing surface for the render.");
  context.putImageData(new ImageData(render.rgba, render.width, render.height), 0, 0);
  const blob = await canvas.convertToBlob(
    render.kind === "export" ? { type: "image/png" } : { type: "image/jpeg", quality: 0.95 },
  );
  canvas.width = canvas.height = 0;
  if (blob.size < 4) throw new Error("The sensor render could not be encoded.");
  return blob;
}
