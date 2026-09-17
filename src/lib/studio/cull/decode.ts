/** Decoding a photo to at most a given size, off the main thread wherever the
 * browser allows. Shared by the loupe (to paint) and the preview worker (to
 * encode), so both agree on orientation and scaling.
 */
import { fitLongEdge, jpegGeometry, JPEG_HEADER_BYTES } from "./jpeg-geometry";

export function bitmapDecodeSupported(): boolean {
  return typeof createImageBitmap === "function";
}

/** createImageBitmap with the file's own EXIF orientation applied, falling back
 * to the browser default when it does not know the `imageOrientation` value
 * (a WebIDL enum it would reject outright). */
export async function orientedBitmap(
  source: ImageBitmapSource,
  options: ImageBitmapOptions = {},
): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(source, { ...options, imageOrientation: "from-image" });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return createImageBitmap(source, options);
  }
}

/**
 * Decodes `blob` so its long edge is at most `maxEdge`, with EXIF orientation
 * applied. A JPEG with no rotation is scaled inside the decode, which skips the
 * full-size bitmap entirely; anything else is decoded, then scaled.
 * The caller owns the result and must close it.
 */
export async function decodeScaled(blob: Blob, maxEdge: number): Promise<ImageBitmap> {
  if (blob.type === "image/jpeg" || blob.type === "") {
    const header = new Uint8Array(await blob.slice(0, JPEG_HEADER_BYTES).arrayBuffer());
    const geometry = jpegGeometry(header);
    // Whether resize happens before or after orientation differs between
    // engines, so a single-step scaled decode is used only when there is no
    // rotation to apply.
    if (geometry && geometry.orientation === 1) {
      const target = fitLongEdge(geometry.width, geometry.height, maxEdge);
      if (target.width < geometry.width)
        return orientedBitmap(blob, {
          resizeWidth: target.width,
          resizeHeight: target.height,
          resizeQuality: "high",
        });
    }
  }
  const full = await orientedBitmap(blob);
  const target = fitLongEdge(full.width, full.height, maxEdge);
  if (target.width >= full.width) return full;
  try {
    return await createImageBitmap(full, {
      resizeWidth: target.width,
      resizeHeight: target.height,
      resizeQuality: "high",
    });
  } finally {
    full.close();
  }
}
