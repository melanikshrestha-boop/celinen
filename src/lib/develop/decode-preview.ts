/** JPEG/PNG/WebP only. Never pass untyped engine bytes to createImageBitmap. */

export type DevelopPreviewMime = "image/jpeg" | "image/png" | "image/webp";

export function sniffDevelopPreviewType(header: Uint8Array): DevelopPreviewMime | null {
  if (header.length >= 2 && header[0] === 0xff && header[1] === 0xd8) return "image/jpeg";
  if (
    header.length >= 8 &&
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47
  )
    return "image/png";
  if (
    header.length >= 12 &&
    header[0] === 0x52 &&
    header[1] === 0x49 &&
    header[2] === 0x46 &&
    header[3] === 0x46 &&
    header[8] === 0x57 &&
    header[9] === 0x45 &&
    header[10] === 0x42 &&
    header[11] === 0x50
  )
    return "image/webp";
  return null;
}

function isPreviewMime(type: string): type is DevelopPreviewMime {
  return type === "image/jpeg" || type === "image/png" || type === "image/webp";
}

/** IndexedDB and some engine receipts drop MIME. Canvas and thumbs need a real image type. */
export async function asDevelopPreviewBlob(blob: Blob): Promise<Blob> {
  if (isPreviewMime(blob.type)) return blob;
  const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const type = sniffDevelopPreviewType(header);
  if (!type) return blob;
  return new Blob([blob], { type });
}

export async function decodeDevelopPreview(blob: Blob): Promise<ImageBitmap> {
  const typed = await asDevelopPreviewBlob(blob);
  let last: unknown;
  try {
    const bitmap = await createImageBitmap(typed, { imageOrientation: "from-image" });
    if (bitmap.width && bitmap.height) return bitmap;
    bitmap.close();
  } catch (error) {
    last = error;
  }
  if (typeof Image === "undefined") {
    throw last instanceof Error ? last : new Error("This preview could not be decoded.");
  }
  const url = URL.createObjectURL(typed);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("This preview could not be decoded."));
      image.src = url;
    });
    const bitmap = await createImageBitmap(image);
    if (!bitmap.width || !bitmap.height) {
      bitmap.close();
      throw new Error("This preview could not be decoded.");
    }
    return bitmap;
  } finally {
    URL.revokeObjectURL(url);
  }
}
