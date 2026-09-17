import { z } from "zod";
import { createDevelopAdmissionQueue } from "./admission";
import { BROWSER_DEVELOP_ENGINE, renderDevelopInBrowser } from "./browser-render";
import { asDevelopPreviewBlob } from "./decode-preview";
import {
  defaultDevelopSettings,
  DEVELOP_ENGINE_LIMITS,
  readDevelopSettings,
  developSourceModeSchema,
  type DevelopSourceMode,
  type DevelopSettings,
} from "./contract";

const statusSchema = z.object({
  ready: z.boolean(),
  token: z.string().nullable(),
  engine: z.string(),
  maxEdge: z.number(),
  maxFileBytes: z.number(),
  workingSpace: z.string(),
  rawSupported: z.boolean().default(false),
  maxRawSensorPixels: z.number().optional(),
  maxOutputPixels: z.number().optional(),
  defaultExportEdge: z.number().optional(),
});
const admissionQueue = createDevelopAdmissionQueue();
export type DevelopEngineStatus = z.infer<typeof statusSchema>;
let cached: Promise<DevelopEngineStatus | null> | null = null,
  inflight: Promise<DevelopEngineStatus | null> | null = null,
  checked = 0;
function isLocalDevelopHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Hosted sites cannot spawn the C++ binary. JPEG/PNG Develop still runs in the browser. */
export function browserDevelopEngineStatus(): DevelopEngineStatus {
  return {
    ready: true,
    token: "browser",
    engine: BROWSER_DEVELOP_ENGINE,
    maxEdge: DEVELOP_ENGINE_LIMITS.defaultExportEdge,
    maxFileBytes: DEVELOP_ENGINE_LIMITS.maxFileBytes,
    workingSpace: "sRGB preview",
    rawSupported: false,
    maxRawSensorPixels: DEVELOP_ENGINE_LIMITS.maxRawSensorPixels,
    maxOutputPixels: DEVELOP_ENGINE_LIMITS.maxOutputPixels,
    defaultExportEdge: DEVELOP_ENGINE_LIMITS.defaultExportEdge,
  };
}

export async function developEngineStatus(refresh = false): Promise<DevelopEngineStatus | null> {
  if (typeof window === "undefined") return null;
  if (!isLocalDevelopHost(window.location.hostname)) return browserDevelopEngineStatus();
  if (!refresh && cached && Date.now() - checked < 5000) return cached;
  if (!refresh && inflight) return inflight;
  const request = (async () => {
    try {
      const response = await fetch("/__develop/status", {
        headers: { "x-lenslabs-request": "studio" },
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return null;
      return statusSchema.parse(await response.json());
    } catch {
      return null;
    }
  })();
  inflight = request;
  void request.then((status) => {
    if (inflight === request) inflight = null;
    // A miss must not occupy the 5s cache. JPEG import retries instead of failing four files.
    if (status?.ready && status.token) {
      cached = Promise.resolve(status);
      checked = Date.now();
    } else {
      cached = null;
      checked = 0;
    }
  });
  return request;
}
export function encodeDevelopRequest(
  source: Blob,
  settings: DevelopSettings,
  edge: number = DEVELOP_ENGINE_LIMITS.previewEdge,
  quality: number = 0.9,
  sourceMode: DevelopSourceMode = "preview",
): Blob {
  if (!source.size || source.size > DEVELOP_ENGINE_LIMITS.maxFileBytes)
    throw new Error("Choose a photo under 128 MiB.");
  if (
    !Number.isInteger(edge) ||
    edge < 32 ||
    edge > DEVELOP_ENGINE_LIMITS.maxEdge ||
    !Number.isFinite(quality) ||
    quality < 0.5 ||
    quality > 1
  )
    throw new Error("Invalid Develop export size or quality.");
  const header = new TextEncoder().encode(
    JSON.stringify({
      settings: readDevelopSettings(settings),
      edge,
      quality,
      sourceMode: developSourceModeSchema.parse(sourceMode),
    }),
  );
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, header.length, false);
  return new Blob([length, header, source], { type: "application/x-foto-develop" });
}

// Only a definite worker-busy response may be replayed. The total scheduled
// wait is at most four seconds, independent of the one token-renewal attempt.
// A cancelled child usually releases its lane quickly. Retry that handoff early,
// then back off while real work is still running. Never increase native lanes.
const busyRetryDelaysMs = [100, 200, 300, 400, 600, 700, 800, 900] as const;
function waitForDevelopWorker(delayMs: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new DOMException("Develop render cancelled.", "AbortError"));
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function renderDevelop(
  source: Blob,
  settings: DevelopSettings = defaultDevelopSettings(),
  options: {
    edge?: number;
    quality?: number;
    signal?: AbortSignal;
    sourceMode?: DevelopSourceMode;
    priority?: "interactive" | "background";
  } = {},
): Promise<Blob> {
  // Snapshot the immutable packet and options once. An obsolete render cannot
  // pick up a newer recipe, source mode, or signal while waiting for a worker.
  const { edge, quality, sourceMode = "preview", signal } = options;
  signal?.throwIfAborted();
  const recipe = readDevelopSettings(settings);
  const body = encodeDevelopRequest(source, recipe, edge, quality, sourceMode);
  return admissionQueue.run(
    {
      raw: sourceMode === "raw",
      exclusive:
        (edge ?? DEVELOP_ENGINE_LIMITS.previewEdge) > DEVELOP_ENGINE_LIMITS.defaultExportEdge,
      ...(signal ? { signal } : {}),
      ...(options.priority ? { priority: options.priority } : {}),
    },
    async () => {
      let busyRetries = 0,
        renewedToken = false,
        refreshStatus = false;
      for (;;) {
        signal?.throwIfAborted();
        const status = await developEngineStatus(refreshStatus);
        refreshStatus = false;
        signal?.throwIfAborted();
        if (!status?.ready || !status.token) {
          const raster = sourceMode === "raw" ? null : await asDevelopPreviewBlob(source);
          if (!raster?.type.startsWith("image/"))
            throw new Error(
              "The local C++ Develop engine is unavailable. Build it with make -C native and reopen Develop.",
            );
          return renderDevelopInBrowser(raster, recipe, {
            edge: edge ?? DEVELOP_ENGINE_LIMITS.previewEdge,
            quality: quality ?? 0.9,
            ...(signal ? { signal } : {}),
          });
        }
        if (sourceMode === "raw" && !status.rawSupported)
          throw new Error(
            status.engine === BROWSER_DEVELOP_ENGINE
              ? "RAW development needs the local app."
              : "Rebuild the local C++ engine to enable sensor RAW development.",
          );
        if ((edge ?? DEVELOP_ENGINE_LIMITS.previewEdge) > status.maxEdge)
          throw new Error("Rebuild the local C++ engine to enable this larger export size.");
        if (status.engine === BROWSER_DEVELOP_ENGINE)
          return renderDevelopInBrowser(source, recipe, {
            edge: edge ?? DEVELOP_ENGINE_LIMITS.previewEdge,
            quality: quality ?? 0.9,
            ...(signal ? { signal } : {}),
          });
        const response = await fetch("/__develop/render", {
          method: "POST",
          headers: {
            "content-type": "application/x-foto-develop",
            "x-lenslabs-request": "studio",
            "x-lenslabs-token": status.token,
          },
          body,
          cache: "no-store",
          ...(signal ? { signal } : {}),
        });
        signal?.throwIfAborted();
        if (response.status === 403 && !renewedToken) {
          renewedToken = true;
          refreshStatus = true;
          continue;
        }
        if (response.status === 429 && busyRetries < busyRetryDelaysMs.length) {
          await waitForDevelopWorker(busyRetryDelaysMs[busyRetries++]!, signal);
          continue;
        }
        if (!response.ok) {
          let message = `Develop processing failed (${response.status}).`;
          try {
            const parsed: unknown = await response.json();
            if (
              parsed &&
              typeof parsed === "object" &&
              "error" in parsed &&
              typeof parsed.error === "string"
            )
              message = parsed.error;
          } catch {
            /* Retain bounded fallback. */
          }
          throw new Error(message);
        }
        const size = Number(response.headers.get("content-length"));
        if (
          !Number.isSafeInteger(size) ||
          size < 4 ||
          size > 32 * 1024 * 1024 ||
          response.headers.get("content-type") !== "image/jpeg" ||
          response.headers.get("x-foto-source") !==
            (sourceMode === "raw" ? "raw-demosaic" : "preview")
        )
          throw new Error("Develop returned an invalid image receipt.");
        const result = await response.blob();
        signal?.throwIfAborted();
        if (result.size !== size) throw new Error("Develop returned an incomplete image.");
        return result;
      }
    },
  );
}
