/// <reference lib="webworker" />
import { asDevelopPreviewBlob } from "./decode-preview";
import {
  analyzeDevelopPixelTiles,
  validatePixelAnalysisBlob,
  validatePixelAnalysisDimensions,
  type PixelAnalysisRequest,
  type PixelAnalysisReply,
} from "./pixel-analysis-core";

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async (event: MessageEvent<PixelAnalysisRequest>) => {
  const { id, blob, clipping } = event.data;
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap !== "function") {
    scope.postMessage({
      id,
      error: "Worker canvas is unavailable",
      unsupported: true,
    } satisfies PixelAnalysisReply);
    return;
  }
  let bitmap: ImageBitmap | undefined;
  let canvas: OffscreenCanvas | undefined;
  try {
    validatePixelAnalysisBlob(blob);
    bitmap = await createImageBitmap(await asDevelopPreviewBlob(blob));
    validatePixelAnalysisDimensions(bitmap.width, bitmap.height);
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
    if (!context) throw new Error("Could not read the preview canvas.");
    context.drawImage(bitmap, 0, 0);
    const result = await analyzeDevelopPixelTiles(
      bitmap.width,
      bitmap.height,
      (x, y, width, height) => context.getImageData(x, y, width, height).data,
      clipping ? { clipping } : {},
    );
    const reply: PixelAnalysisReply = { id, result };
    scope.postMessage(reply, result.clipping ? [result.clipping.buffer] : []);
  } catch (error) {
    scope.postMessage({
      id,
      error: error instanceof Error ? error.message : "Could not analyze the preview pixels.",
    } satisfies PixelAnalysisReply);
  } finally {
    bitmap?.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
};
