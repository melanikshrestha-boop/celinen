/// <reference lib="webworker" />
/** The preview lane: turns an original into the review JPEG this screen can
 * actually show (its own pixels, capped by what the file holds) and writes it
 * to the private file system. It runs one photo at a time after a card has
 * been read, so it never competes with the ingest pool for cores.
 */
import { decodeScaled } from "./decode";
import { ingestRoute } from "./ingest-route";
import { isQuotaError, openFolder, writeFile, type OpfsDirectory } from "./opfs";
import type { PreviewReply, PreviewRequest } from "./preview-messages";
import { inspectRawFile, orientedPreview, rawApi } from "./raw-container";

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** What to try decoding, best first: for a RAW, every picture inside it,
 * largest first and tagged with the container's orientation; otherwise the file
 * itself, which the browser may well decode (Safari opens HEIC). */
async function decodable(file: File): Promise<Blob[]> {
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const route = ingestRoute(head);
  if (route === "jpeg") return [file.slice(0, file.size, "image/jpeg")];
  if (route === "raw") {
    try {
      const api = await rawApi();
      const inspection = await inspectRawFile(file, api);
      const previews = await Promise.all(
        inspection.previews.map((preview) => orientedPreview(file, preview, api)),
      );
      // The file itself stays last: some browsers decode RAW through the system.
      return [...previews, file];
    } catch {
      return [file];
    }
  }
  // PNG, WebP, GIF, AVIF, BMP and (in Safari) HEIC: the browser's own decoder.
  return [file];
}

async function encode(request: PreviewRequest): Promise<PreviewReply> {
  const { id } = request;
  let jpeg: Blob;
  let width: number;
  let height: number;
  try {
    const sources = await decodable(request.file);
    let failure: unknown = new Error("This photo could not be decoded.");
    let written: { jpeg: Blob; width: number; height: number } | null = null;
    for (const source of sources) {
      try {
        const bitmap = await decodeScaled(source, request.maxEdge);
        try {
          // Drawn at the target size even when the decode was already scaled: an
          // engine that ignored the resize request still produces the right size.
          const scale = Math.min(1, request.maxEdge / Math.max(bitmap.width, bitmap.height));
          const w = Math.max(1, Math.round(bitmap.width * scale));
          const h = Math.max(1, Math.round(bitmap.height * scale));
          const canvas = new OffscreenCanvas(w, h);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("No 2D canvas in this worker.");
          context.imageSmoothingQuality = "high";
          context.drawImage(bitmap, 0, 0, w, h);
          written = {
            jpeg: await canvas.convertToBlob({ type: "image/jpeg", quality: request.quality }),
            width: w,
            height: h,
          };
        } finally {
          bitmap.close();
        }
        break;
      } catch (error) {
        failure = error;
      }
    }
    if (!written) throw failure;
    ({ jpeg, width, height } = written);
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
