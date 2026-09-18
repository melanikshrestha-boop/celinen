/**
 * The picture a camera already wrote inside its own RAW file.
 *
 * A page has no LibRaw, so it cannot demosaic sensor data; but every RAW
 * container carries at least one finished JPEG, and the C++ RAW container
 * reader (native/wasm/raw_wasm.cpp, the same engine Cull's loupe and thumbnails
 * use) says which one is best and which way up it belongs. Develop edits that
 * JPEG and labels it as such — it is a smaller picture than the sensor holds,
 * never a claim of a sensor-quality conversion.
 *
 * Only the RAW's head and the chosen preview's bytes are read; the original
 * stays on disk as the photo's source.
 */
import {
  inspectRawFile,
  orientedPreview,
  rawApi,
  type RawPreviewSource,
} from "../studio/cull/raw-container";
import { decodeDevelopPreview } from "./decode-preview";

export type RawEmbeddedPreview = {
  previewBlob: Blob;
  /** Size after the container's orientation is applied — what the editor shows. */
  width: number;
  height: number;
  /** Which structure inside the RAW the JPEG came from. */
  source: RawPreviewSource;
};

/** Below this a "preview" is a contact-sheet thumbnail, not something to edit. */
const MIN_EDITABLE_EDGE = 640;

/**
 * The largest embedded JPEG this RAW holds that the browser can actually
 * decode, already turned the right way up. Null when the container has none.
 */
export async function rawEmbeddedDevelopPreview(
  file: Blob,
  signal?: AbortSignal,
): Promise<RawEmbeddedPreview | null> {
  signal?.throwIfAborted();
  const api = await rawApi();
  signal?.throwIfAborted();
  const inspection = await inspectRawFile(file, api);
  signal?.throwIfAborted();
  // `previews` is ranked best first by the C++; a candidate that will not decode
  // must not hide the next one, so keep walking rather than failing the import.
  let best: RawEmbeddedPreview | null = null;
  for (const preview of inspection.previews) {
    signal?.throwIfAborted();
    let blob: Blob;
    try {
      blob = await orientedPreview(file, preview, api);
    } catch {
      continue;
    }
    signal?.throwIfAborted();
    let bitmap: ImageBitmap;
    try {
      bitmap = await decodeDevelopPreview(blob);
    } catch {
      continue;
    }
    const { width, height } = bitmap;
    bitmap.close();
    if (!width || !height) continue;
    const candidate: RawEmbeddedPreview = { previewBlob: blob, width, height, source: preview.source };
    if (Math.max(width, height) >= MIN_EDITABLE_EDGE) return candidate;
    // Remember a thumbnail-sized one, but keep looking for something editable.
    best ??= candidate;
  }
  return best;
}
