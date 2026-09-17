/// <reference lib="webworker" />
/** The preview lane: turns an original into a 2048 px review JPEG and writes it
 * to the private file system. It runs one photo at a time after a card has
 * been read, so it never competes with the ingest pool for cores.
 */
import { decodeScaled } from "./decode";
import { isQuotaError, openFolder, writeFile, type OpfsDirectory } from "./opfs";
import type { PreviewReply, PreviewRequest } from "./preview-messages";
import { embeddedJpeg } from "./raw-preview";

const scope = self as unknown as DedicatedWorkerGlobalScope;

const PAINTABLE = /^image\/(jpeg|png|webp|gif|avif|bmp)$/;

/** What the browser can decode: the file itself, or the JPEG a RAW carries inside. */
async function decodable(file: File): Promise<Blob> {
  if (PAINTABLE.test(file.type)) return file;
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] === 0xff && head[1] === 0xd8) return file.slice(0, file.size, "image/jpeg");
  const jpeg = embeddedJpeg(new Uint8Array(await file.arrayBuffer()));
  if (jpeg) return new Blob([jpeg as Uint8Array<ArrayBuffer>], { type: "image/jpeg" });
  // HEIC and friends: let the browser try; Safari can.
  return file;
}

async function encode(request: PreviewRequest): Promise<PreviewReply> {
  const { id } = request;
  let jpeg: Blob;
  let width: number;
  let height: number;
  try {
    const bitmap = await decodeScaled(await decodable(request.file), request.maxEdge);
    try {
      // Drawn at the target size even when the decode was already scaled: an
      // engine that ignored the resize request still produces the right size.
      const scale = Math.min(1, request.maxEdge / Math.max(bitmap.width, bitmap.height));
      width = Math.max(1, Math.round(bitmap.width * scale));
      height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No 2D canvas in this worker.");
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, width, height);
      jpeg = await canvas.convertToBlob({ type: "image/jpeg", quality: request.quality });
    } finally {
      bitmap.close();
    }
  } catch (error) {
    return {
      id,
      kind: "failed",
      error: error instanceof Error ? error.message : "This photo could not be decoded.",
    };
  }

  try {
    const root = (await navigator.storage.getDirectory()) as unknown as OpfsDirectory;
    const folder = await openFolder(root, request.folder, true);
    if (!folder) throw new Error("The preview folder could not be created.");
    await writeFile(folder, request.name, new Uint8Array(await jpeg.arrayBuffer()));
  } catch (error) {
    if (isQuotaError(error)) return { id, kind: "quota" };
    return {
      id,
      kind: "unavailable",
      error: error instanceof Error ? error.message : "The preview could not be saved.",
    };
  }
  return { id, kind: "written", bytes: jpeg.size, width, height };
}

scope.onmessage = async ({ data }: MessageEvent<PreviewRequest>) => {
  scope.postMessage(await encode(data));
};
