/** Reading one photo, whatever it is: the decision tree the ingest lane runs.
 *
 * Camera JPEG → the C++ engine. RAW → its largest embedded preview, turned the
 * way the container says, then the next preview if that one is damaged.
 * Anything else, or anything the engine could not read → the browser's own
 * decoder, whose upright pixels the same C++ then measures, so a WebP is
 * scored exactly like a JPEG. A frame is only unreadable when every path failed.
 */
import { orientedBitmap } from "./decode";
import type { DecodedPixels, IngestEngine, IngestOptions, IngestResult } from "./ingest-engine";
import { fitLongEdge } from "./jpeg-geometry";
import {
  BrowserDecodeUnavailable,
  formatName,
  ingestRoute,
  SNIFF_BYTES,
  unreadableReason,
  type IngestRoute,
  type ReadFailure,
} from "./ingest-route";
import { inspectRawFile, RAW_HEAD_MAX_BYTES } from "./raw-container";

/** How much of a RAW the engine reads its orientation, capture time and AF area
 * from. TIFF RAWs and CR3 put their IFDs and maker note well inside this, and
 * so do the preview headers, so one read answers every question about the file. */
export const RAW_METADATA_BYTES = RAW_HEAD_MAX_BYTES;
/** Of a non-RAW file, enough for EXIF (capped at 64 KiB by the format). */
const METADATA_BYTES = 128 * 1024;

export type IngestDeps = {
  engine: IngestEngine;
  /** Decodes a file the engine cannot read, at most `maxEdge` on the long side.
   * Throws BrowserDecodeUnavailable where the browser has no decoder here. */
  decodePixels: (file: Blob, maxEdge: number) => Promise<DecodedPixels>;
};

export type PhotoRead = IngestResult & { route: IngestRoute };

const message = (error: unknown) =>
  error instanceof Error ? error.message : "This photo could not be read.";

const bytes = async (file: Blob, start: number, end: number) =>
  new Uint8Array(await file.slice(start, Math.min(end, file.size)).arrayBuffer());

export async function readPhoto(
  file: File | Blob,
  options: IngestOptions,
  deps: IngestDeps,
): Promise<PhotoRead> {
  if (!file.size) throw new Error("This file is empty.");
  const name = "name" in file ? file.name : "";
  const sniff = await bytes(file, 0, Math.min(file.size, SNIFF_BYTES));
  const route = ingestRoute(sniff);
  const failures: ReadFailure[] = [];
  const raw = deps.engine.raw;
  let rawPreviews = 0;
  // The RAW's own head: its orientation, capture time, maker note and the
  // headers of the previews inside it, all from one read.
  const head =
    route === "raw" ? await bytes(file, 0, Math.min(file.size, RAW_METADATA_BYTES)) : sniff;

  if (route === "jpeg") {
    try {
      return { ...deps.engine.read(await bytes(file, 0, file.size), options), route };
    } catch (error) {
      failures.push({ stage: "engine", error: message(error) });
    }
  }

  if (route === "raw" && raw) {
    // The container head goes with every attempt: the preview carries neither
    // the orientation nor the maker note, and the RAW carries both.
    const container = head;
    let damaged: IngestResult | null = null;
    try {
      const inspection = await inspectRawFile(file, raw, head);
      rawPreviews = inspection.previews.length;
      for (const preview of inspection.previews) {
        try {
          const jpeg = await bytes(file, preview.offset, preview.offset + preview.length);
          const result = deps.engine.read(jpeg, options, container);
          // A cut-off preview is still a picture, but a whole smaller one is better.
          if (!result.damaged) return { ...result, route };
          damaged ??= result;
        } catch (error) {
          failures.push({ stage: "raw-preview", error: message(error) });
        }
      }
    } catch (error) {
      failures.push({ stage: "raw-preview", error: message(error) });
    }
    if (damaged) return { ...damaged, route };
  }

  // The browser's own decoder, and the same C++ measurement on its pixels.
  let browserDecode = true;
  if (deps.engine.readPixels) {
    try {
      const measureEdge = options.measureEdge ?? 640;
      // Twice the working edge: the last step down stays the engine's own box
      // average, so a WebP and a JPEG of the same photo measure alike.
      const pixels = await deps.decodePixels(file, measureEdge * 2);
      // EXIF for the capture time, camera and AF area of a file the browser
      // decoded: its own first bytes, whatever the format.
      const metadata =
        head.length >= Math.min(file.size, METADATA_BYTES)
          ? head.subarray(0, Math.min(head.length, METADATA_BYTES))
          : await bytes(file, 0, Math.min(file.size, METADATA_BYTES));
      return { ...deps.engine.readPixels(pixels, options, metadata), route };
    } catch (error) {
      browserDecode = !(error instanceof BrowserDecodeUnavailable);
      failures.push({ stage: "browser", error: message(error) });
    }
  } else {
    browserDecode = false;
  }

  throw new Error(
    unreadableReason({
      route,
      format: formatName(sniff, name),
      rawPreviews,
      failures,
      browserDecode,
    }),
  );
}

/** The real browser decode, for the worker: ImageBitmap with the file's own
 * orientation applied, drawn down to the working size on an OffscreenCanvas. */
export async function browserPixels(file: Blob, maxEdge: number): Promise<DecodedPixels> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined")
    throw new BrowserDecodeUnavailable();
  const bitmap = await orientedBitmap(file);
  try {
    const target = fitLongEdge(bitmap.width, bitmap.height, maxEdge);
    const canvas = new OffscreenCanvas(target.width, target.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new BrowserDecodeUnavailable();
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, target.width, target.height);
    const image = context.getImageData(0, 0, target.width, target.height);
    return {
      rgba: image.data,
      width: target.width,
      height: target.height,
      sourceWidth: bitmap.width,
      sourceHeight: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}
