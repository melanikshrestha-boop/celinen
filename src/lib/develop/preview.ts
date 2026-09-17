import { defaultDevelopSettings } from "./contract";
import { developEngineStatus, isHostedDevelopEngine, renderDevelop } from "./client";
import {
  asDevelopPreviewBlob,
  decodeDevelopPreview,
  developBlobIsViewable,
  isWebDevelopPreview,
  jpegFromBitmap,
  mintDevelopPreviewJpeg,
  sniffDevelopPreviewType,
} from "./decode-preview";
import type { DevelopPhoto } from "./store";

export type DevelopPreviewResult = {
  previewBlob: Blob;
  previewOrigin: "embedded" | "raw-demosaic" | "raster" | "unknown";
  width: number;
  height: number;
};

async function webPreviewBlob(blob: Blob): Promise<Blob> {
  const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (isWebDevelopPreview(sniffDevelopPreviewType(header))) return asDevelopPreviewBlob(blob);
  const bitmap = await decodeDevelopPreview(blob);
  try {
    return await jpegFromBitmap(bitmap);
  } finally {
    bitmap.close();
  }
}

async function measurePreview(preview: Blob, signal: AbortSignal) {
  signal.throwIfAborted();
  const bitmap = await decodeDevelopPreview(preview);
  try {
    signal.throwIfAborted();
    if (!bitmap.width || !bitmap.height) throw new Error("This photo could not be decoded.");
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/** Browser decode of the original bytes. Never substitutes a generated preview for a RAW sensor file. */
export async function rasterDevelopPreview(
  file: Blob,
  signal: AbortSignal,
): Promise<DevelopPreviewResult> {
  signal.throwIfAborted();
  const bitmap = await decodeDevelopPreview(file);
  try {
    signal.throwIfAborted();
    if (!bitmap.width || !bitmap.height) throw new Error("This photo could not be decoded.");
    const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const sniffed = sniffDevelopPreviewType(header);
    const namedWeb = isWebDevelopPreview(file.type);
    const previewBlob =
      isWebDevelopPreview(sniffed) || namedWeb
        ? await asDevelopPreviewBlob(file)
        : await jpegFromBitmap(bitmap);
    return {
      previewBlob,
      previewOrigin: "raster",
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}

/**
 * C++ preview when the local engine is up. JPEG/PNG/WebP still import if it is down:
 * the original file is the preview, original bytes stay the source.
 */
export async function prepareDevelopPreview(
  file: File,
  input: { isRaw: boolean },
  signal: AbortSignal,
  options: { priority?: "interactive" | "background" } = {},
): Promise<DevelopPreviewResult> {
  const status = await developEngineStatus();
  if (!input.isRaw && (!status?.ready || !status.token || isHostedDevelopEngine(status.engine)))
    return rasterDevelopPreview(file, signal);
  try {
    const preview = await renderDevelop(file, defaultDevelopSettings(), {
      edge: 1600,
      signal,
      ...(options.priority ? { priority: options.priority } : {}),
    });
    const size = await measurePreview(preview, signal);
    return {
      previewBlob: await webPreviewBlob(preview),
      previewOrigin: input.isRaw ? "unknown" : "raster",
      ...size,
    };
  } catch (error) {
    signal.throwIfAborted();
    if (input.isRaw) {
      if (!(await developEngineStatus())?.rawSupported) throw error;
      const preview = await renderDevelop(file, defaultDevelopSettings(), {
        edge: 1600,
        sourceMode: "raw",
        signal,
        ...(options.priority ? { priority: options.priority } : {}),
      });
      const size = await measurePreview(preview, signal);
      return { previewBlob: await webPreviewBlob(preview), previewOrigin: "raw-demosaic", ...size };
    }
    try {
      return await rasterDevelopPreview(file, signal);
    } catch {
      signal.throwIfAborted();
      throw error;
    }
  }
}

/**
 * Existing library rows may hold engine/IDB bytes that are not a web image.
 * C++ when local; otherwise recode through the browser decoder to JPEG.
 */
const cooking = new Map<string, Promise<Blob | null>>();

export async function cookDevelopPhotoPreview(
  photo: Pick<DevelopPhoto, "id" | "name" | "isRaw" | "previewBlob" | "sourceBlob">,
  signal: AbortSignal = AbortSignal.timeout(30_000),
): Promise<Blob | null> {
  const pending = cooking.get(photo.id);
  if (pending) return pending;
  const work = (async () => {
    if (await developBlobIsViewable(photo.previewBlob)) return photo.previewBlob;
    const source = photo.sourceBlob?.size ? photo.sourceBlob : photo.previewBlob;
    if (!source?.size) return null;
    const file =
      source instanceof File
        ? source
        : new File([source], photo.name || "photo.jpg", {
            type: source.type || "application/octet-stream",
          });
    try {
      const cooked = await prepareDevelopPreview(file, { isRaw: Boolean(photo.isRaw) }, signal);
      if (await developBlobIsViewable(cooked.previewBlob)) return cooked.previewBlob;
    } catch {
      signal.throwIfAborted();
    }
    try {
      return await mintDevelopPreviewJpeg(source);
    } catch {
      signal.throwIfAborted();
      return null;
    }
  })();
  cooking.set(photo.id, work);
  void work.finally(() => {
    if (cooking.get(photo.id) === work) cooking.delete(photo.id);
  });
  return work;
}
