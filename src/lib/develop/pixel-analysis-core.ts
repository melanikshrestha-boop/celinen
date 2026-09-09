import { analyzeDevelopPixels, clippingPixels, type DevelopHistogramData } from "./histogram";
import { DEVELOP_ENGINE_LIMITS } from "./contract";

export const MAX_DEVELOP_ANALYSIS_PIXELS = DEVELOP_ENGINE_LIMITS.maxOutputPixels;
export const MAX_DEVELOP_ANALYSIS_BYTES = 128 * 1024 * 1024;
export type DevelopPixelClipping = { shadows: boolean; highlights: boolean };
export type DevelopPixelAnalysis = {
  histogram: DevelopHistogramData;
  width: number;
  height: number;
  clipping?: Uint8ClampedArray<ArrayBuffer>;
};
export type PixelAnalysisRequest = { id: number; blob: Blob; clipping?: DevelopPixelClipping };
export type PixelAnalysisReply =
  | { id: number; result: DevelopPixelAnalysis }
  | { id: number; error: string; unsupported?: boolean };

export function pixelAnalysisAborted(): DOMException {
  return new DOMException("Pixel analysis canceled", "AbortError");
}
export function checkPixelAnalysisSignal(signal?: AbortSignal): void {
  if (signal?.aborted) throw pixelAnalysisAborted();
}
export function validatePixelAnalysisBlob(blob: Blob): void {
  if (!(blob instanceof Blob) || blob.size < 1 || blob.size > MAX_DEVELOP_ANALYSIS_BYTES)
    throw new Error("Pixel analysis needs a nonempty preview of at most 128 MB.");
}
export function validatePixelAnalysisDimensions(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > DEVELOP_ENGINE_LIMITS.maxEdge ||
    height > DEVELOP_ENGINE_LIMITS.maxEdge ||
    width * height > MAX_DEVELOP_ANALYSIS_PIXELS
  )
    throw new Error(
      "Pixel analysis is limited to 36,000,000 preview pixels and an 8,192-pixel edge.",
    );
}

/** Exact pixel counts, tiled to bound transient memory and support cooperative main-thread reads. */
export async function analyzeDevelopPixelTiles(
  width: number,
  height: number,
  read: (x: number, y: number, width: number, height: number) => Uint8ClampedArray | Uint8Array,
  options: {
    signal?: AbortSignal;
    clipping?: DevelopPixelClipping;
    cooperate?: () => Promise<void>;
  } = {},
): Promise<DevelopPixelAnalysis> {
  validatePixelAnalysisDimensions(width, height);
  checkPixelAnalysisSignal(options.signal);
  const histogram = analyzeDevelopPixels([]);
  const clipping = options.clipping ? new Uint8ClampedArray(width * height * 4) : undefined;
  for (let y = 0; y < height; y += 256) {
    for (let x = 0; x < width; x += 512) {
      checkPixelAnalysisSignal(options.signal);
      const tileWidth = Math.min(512, width - x),
        tileHeight = Math.min(256, height - y);
      const pixels = read(x, y, tileWidth, tileHeight);
      if (pixels.length !== tileWidth * tileHeight * 4)
        throw new Error("Pixel analysis received an incomplete preview tile.");
      const tile = analyzeDevelopPixels(pixels);
      for (const key of ["luminance", "encodedLuminance", "maximum"] as const)
        for (let i = 0; i < histogram[key].length; i++) histogram[key][i]! += tile[key][i]!;
      for (let channel = 0; channel < 3; channel++)
        for (let i = 0; i < 256; i++)
          histogram.channels[channel]![i]! += tile.channels[channel]![i]!;
      histogram.pixels += tile.pixels;
      histogram.shadows += tile.shadows;
      histogram.shadowClipped += tile.shadowClipped;
      histogram.highlights += tile.highlights;
      if (clipping && options.clipping) {
        const overlay = clippingPixels(
          pixels,
          options.clipping.shadows,
          options.clipping.highlights,
          "rgb",
        );
        for (let row = 0; row < tileHeight; row++)
          clipping.set(
            overlay.subarray(row * tileWidth * 4, (row + 1) * tileWidth * 4),
            ((y + row) * width + x) * 4,
          );
      }
      if (options.cooperate && (x + tileWidth < width || y + tileHeight < height))
        await options.cooperate();
    }
  }
  checkPixelAnalysisSignal(options.signal);
  return { histogram, width, height, ...(clipping ? { clipping } : {}) };
}
