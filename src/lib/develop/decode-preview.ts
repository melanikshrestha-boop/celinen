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
  return new Blob([await blob.arrayBuffer()], { type });
}

/** Null when the bytes are not a JPEG/PNG/WebP. Never hand a broken-image `?` a URL. */
export async function asDevelopViewBlob(blob: Blob | null | undefined): Promise<Blob | null> {
  if (!blob?.size) return null;
  const typed = await asDevelopPreviewBlob(blob);
  return typed.type.startsWith("image/") ? typed : null;
}

export async function developBlobIsViewable(blob: Blob | null | undefined): Promise<boolean> {
  return Boolean(await asDevelopViewBlob(blob));
}

export async function developPhotoViewBlob(photo: {
  previewBlob?: Blob | null;
  sourceBlob?: Blob | null;
  isRaw?: boolean;
}): Promise<Blob | null> {
  const preview = await asDevelopViewBlob(photo.previewBlob);
  if (preview) return preview;
  if (photo.isRaw) return null;
  return asDevelopViewBlob(photo.sourceBlob);
}

async function bitmapFromImageUrl(url: string, revoke = false): Promise<ImageBitmap> {
  if (typeof Image === "undefined") {
    throw new Error("This preview could not be decoded.");
  }
  const image = new Image();
  image.decoding = "async";
  try {
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
    if (revoke) URL.revokeObjectURL(url);
  }
}

export async function decodeDevelopPreview(blob: Blob): Promise<ImageBitmap> {
  const typed = await asDevelopPreviewBlob(blob);
  try {
    const bitmap = await createImageBitmap(typed, { imageOrientation: "from-image" });
    if (bitmap.width && bitmap.height) return bitmap;
    bitmap.close();
  } catch {
    /* Image element can still paint a blob the filmstrip already shows. */
  }
  return bitmapFromImageUrl(URL.createObjectURL(typed), true);
}

/** Same pixels the filmstrip <img> already painted. */
export function decodeDevelopPreviewUrl(url: string): Promise<ImageBitmap> {
  return bitmapFromImageUrl(url);
}

/** Keep a decoded loupe if the photographer is still on the same frame bytes. */
export function cullBitmapStillCurrent(
  current: { file?: File; previewBlob?: Blob } | undefined,
  started: { file?: File; previewBlob?: Blob },
): boolean {
  if (!current) return false;
  if (started.previewBlob && current.previewBlob)
    return started.previewBlob.size === current.previewBlob.size;
  if (started.file && current.file)
    return started.file.size === current.file.size && started.file.name === current.file.name;
  return true;
}
