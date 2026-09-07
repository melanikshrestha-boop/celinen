/** Browser transport for the local C++ engine. No pixel kernels live here. */
import { z } from "zod";
import type { FileAnalysisPreview } from "@/lib/imaging";

const statusSchema = z.object({
  ready: z.boolean(),
  token: z.string().nullable(),
  engine: z.string(),
  maxFileBytes: z.number().int().positive(),
});
type NativeStatus = z.infer<typeof statusSchema>;
let statusPromise: Promise<NativeStatus | null> | null = null;
let checkedAt = 0;

export function nativeEngineStatus(): Promise<NativeStatus | null> {
  if (
    !import.meta.env?.DEV ||
    typeof window === "undefined" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
  )
    return Promise.resolve(null);
  if (statusPromise && Date.now() - checkedAt < 5000) return statusPromise;
  checkedAt = Date.now();
  statusPromise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch("/__native/status", {
        headers: { "x-lenslabs-request": "studio" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const parsed = statusSchema.safeParse(await response.json());
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  })();
  return statusPromise;
}

export async function nativeStudioRequest(
  path: "/__native/bursts" | "/__native/analyze",
  init: RequestInit,
): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (init.signal?.aborted) throw new DOMException("Native job cancelled.", "AbortError");
    const status = await nativeEngineStatus();
    if (!status?.ready || !status.token)
      throw new Error(
        "The local C++ engine is unavailable. Build it with make -C native and reopen Studio.",
      );
    const headers = new Headers(init.headers);
    headers.set("x-lenslabs-request", "studio");
    headers.set("x-lenslabs-token", status.token);
    const response = await fetch(path, { ...init, headers, cache: "no-store" });
    if (response.status === 403 && attempt === 0) {
      statusPromise = null;
      continue;
    }
    if (!response.ok) {
      let message = `Native processing failed (${response.status}).`;
      try {
        const body: unknown = await response.json();
        if (body && typeof body === "object" && "error" in body && typeof body.error === "string")
          message = body.error;
      } catch {
        /* Keep the status when an upstream response is not JSON. */
      }
      throw new Error(message);
    }
    return response;
  }
  throw new Error("Native session could not be renewed.");
}

const channel = z.number().finite().min(0).max(255);
const nativeFrameSchema = z.object({
  ok: z.literal(true),
  engine: z.string(),
  width: z.number().int().min(1).max(2048),
  height: z.number().int().min(1).max(2048),
  source_width: z.number().int().positive(),
  source_height: z.number().int().positive(),
  preview_bytes: z
    .number()
    .int()
    .min(4)
    .max(16 * 1024 * 1024),
  sharpness: z.number().finite().min(0).max(1e9),
  brightness: channel,
  clipped_highlights: z.number().finite().min(0).max(100),
  clipped_shadows: z.number().finite().min(0).max(100),
  hash: z.string().regex(/^[0-9a-f]{16}$/i),
  tone: z.object({
    black: channel,
    white: channel,
    median: channel.min(1),
    rMean: channel,
    gMean: channel,
    bMean: channel,
    satMean: z.number().finite().min(0).max(1),
  }),
  captured_at_ms: z.number().int().positive().nullable().optional(),
  camera_key: z.string().max(512).nullable().optional(),
  capture_time_basis: z.enum(["utc", "camera_clock"]).nullable().optional(),
  cached: z.boolean().default(false),
});

export type NativeAnalysisPreview = FileAnalysisPreview & {
  backend: "native-cpp";
  nativeCached: boolean;
  captureTimeMs?: number | undefined;
  cameraKey?: string | undefined;
  captureTimeBasis?: "utc" | "camera_clock" | undefined;
};

export function decodeNativeFrame(buffer: ArrayBuffer): NativeAnalysisPreview {
  const bytes = new Uint8Array(buffer);
  if (bytes.length > 16 * 1024 * 1024 + 65536) throw new Error("Native preview exceeds its limit.");
  const newline = bytes.indexOf(10);
  if (newline < 0 || newline > 65536) throw new Error("Native receipt is incomplete.");
  const frame = nativeFrameSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, newline))),
  );
  const jpeg = bytes.subarray(newline + 1);
  if (
    jpeg.length !== frame.preview_bytes ||
    jpeg[0] !== 0xff ||
    jpeg[1] !== 0xd8 ||
    jpeg.at(-2) !== 0xff ||
    jpeg.at(-1) !== 0xd9
  )
    throw new Error("Native preview was truncated or malformed.");
  return {
    width: frame.width,
    height: frame.height,
    previewBlob: new Blob([jpeg], { type: "image/jpeg" }),
    faceDetectionAvailable: false,
    backend: "native-cpp",
    nativeCached: frame.cached,
    captureTimeMs: frame.captured_at_ms ?? undefined,
    cameraKey: frame.camera_key || undefined,
    captureTimeBasis: frame.capture_time_basis ?? undefined,
    analysis: {
      sharpness: frame.sharpness,
      brightness: frame.brightness,
      clippedHighlights: frame.clipped_highlights,
      clippedShadows: frame.clipped_shadows,
      hash: BigInt(`0x${frame.hash}`).toString(2).padStart(64, "0"),
      tone: frame.tone,
    },
  };
}

/** A missing local engine may use the existing browser path; a failed native job may not silently do so. */
export async function analyseFileNative(
  file: File,
  signal?: AbortSignal,
): Promise<NativeAnalysisPreview | null> {
  const status = await nativeEngineStatus();
  if (signal?.aborted) throw new DOMException("Photo analysis cancelled.", "AbortError");
  if (!status?.ready) return null;
  if (!file.size || file.size > status.maxFileBytes)
    throw new Error("Native import accepts nonempty photos up to 128 MiB each.");
  const response = await nativeStudioRequest("/__native/analyze", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: file,
    ...(signal ? { signal } : {}),
  });
  const contentLength = Number(response.headers.get("content-length"));
  if (
    !Number.isFinite(contentLength) ||
    contentLength < 4 ||
    contentLength > 16 * 1024 * 1024 + 65536 ||
    response.headers.get("content-type") !== "application/x-lenslabs-frame"
  )
    throw new Error("Invalid native preview response.");
  return decodeNativeFrame(await response.arrayBuffer());
}
