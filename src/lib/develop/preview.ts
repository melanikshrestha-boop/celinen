import { BROWSER_DEVELOP_ENGINE } from "./browser-render";
import { defaultDevelopSettings } from "./contract";
import { developEngineStatus, renderDevelop } from "./client";

export type DevelopPreviewResult = {
  previewBlob: Blob;
  previewOrigin: "embedded" | "raw-demosaic" | "raster" | "unknown";
  width: number;
  height: number;
};

async function measurePreview(preview: Blob, signal: AbortSignal) {
  signal.throwIfAborted();
  const bitmap = await createImageBitmap(preview);
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
  const size = await measurePreview(file, signal);
  return { previewBlob: file, previewOrigin: "raster", ...size };
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
  if (!input.isRaw && (!status?.ready || !status.token || status.engine === BROWSER_DEVELOP_ENGINE))
    return rasterDevelopPreview(file, signal);
  try {
    const preview = await renderDevelop(file, defaultDevelopSettings(), {
      edge: 1600,
      signal,
      ...(options.priority ? { priority: options.priority } : {}),
    });
    const size = await measurePreview(preview, signal);
    return {
      previewBlob: preview,
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
      return { previewBlob: preview, previewOrigin: "raw-demosaic", ...size };
    }
    try {
      return await rasterDevelopPreview(file, signal);
    } catch {
      signal.throwIfAborted();
      throw error;
    }
  }
}
