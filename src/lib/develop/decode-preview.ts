/** Browser-viewable stills. RAW sensor files never become an <img> URL. */

export type DevelopPreviewMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/heic"
  | "image/avif";

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heif", "heis"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);
const WEB_PREVIEW = new Set(["image/jpeg", "image/png", "image/webp"]);

function ftypBrand(header: Uint8Array): string | null {
  if (header.length < 12) return null;
  if (header[4] !== 0x66 || header[5] !== 0x74 || header[6] !== 0x79 || header[7] !== 0x70)
    return null;
  return String.fromCharCode(header[8]!, header[9]!, header[10]!, header[11]!).toLowerCase();
}

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
  const brand = ftypBrand(header);
  if (brand && HEIC_BRANDS.has(brand)) return "image/heic";
  if (brand && AVIF_BRANDS.has(brand)) return "image/avif";
  return null;
}

export function isWebDevelopPreview(type: string | null | undefined): type is "image/jpeg" | "image/png" | "image/webp" {
  return Boolean(type && WEB_PREVIEW.has(type));
}

async function retag(blob: Blob, type: DevelopPreviewMime): Promise<Blob> {
  if (blob.type === type) return blob;
  return new Blob([await blob.arrayBuffer()], { type });
}

/** IndexedDB and some engine receipts drop MIME. Canvas and thumbs need a real image type. */
export async function asDevelopPreviewBlob(blob: Blob): Promise<Blob> {
  const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const sniffed = sniffDevelopPreviewType(header);
  if (sniffed) return retag(blob, sniffed);
  return blob;
}

export async function jpegFromBitmap(bitmap: ImageBitmap): Promise<Blob> {
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(bitmap.width, bitmap.height)
      : typeof document !== "undefined"
        ? Object.assign(document.createElement("canvas"), {
            width: bitmap.width,
            height: bitmap.height,
          })
        : null;
  if (!canvas) throw new Error("This photo could not be decoded.");
  const ctx = canvas.getContext("2d");
  if (!ctx || typeof ctx.drawImage !== "function") throw new Error("This photo could not be decoded.");
  ctx.drawImage(bitmap, 0, 0);
  if ("convertToBlob" in canvas && typeof canvas.convertToBlob === "function")
    return canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
  if (!("toBlob" in canvas)) throw new Error("This photo could not be decoded.");
  return new Promise((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (next) =>
        next ? resolve(next) : reject(new Error("This photo could not be decoded.")),
      "image/jpeg",
      0.92,
    );
  });
}

/** Null when the bytes are not a JPEG/PNG/WebP. Never hand a broken-image `?` a URL. */
export async function asDevelopViewBlob(blob: Blob | null | undefined): Promise<Blob | null> {
  if (!blob?.size) return null;
  const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const sniffed = sniffDevelopPreviewType(header);
  if (!isWebDevelopPreview(sniffed)) return null;
  return retag(blob, sniffed);
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
  const sources = typed === blob ? [typed] : [typed, blob];
  for (const source of sources) {
    for (const options of [{ imageOrientation: "from-image" as const }, {}]) {
      try {
        const bitmap = await createImageBitmap(source, options);
        if (bitmap.width && bitmap.height) return bitmap;
        bitmap.close();
      } catch {
        /* Safari ImageIO and untyped IDB blobs disagree on orientation. */
      }
    }
  }
  const url = URL.createObjectURL(isWebDevelopPreview(typed.type) ? typed : blob);
  return bitmapFromImageUrl(url, true);
}

/** Force a browser-paintable JPEG. C++/ImageIO stills that are not JPEG/PNG/WebP get recoded. */
export async function mintDevelopPreviewJpeg(blob: Blob): Promise<Blob> {
  const view = await asDevelopViewBlob(blob);
  if (view) return view;
  const bitmap = await decodeDevelopPreview(blob);
  try {
    const jpeg = await jpegFromBitmap(bitmap);
    if (!jpeg.size) throw new Error("This preview could not be decoded.");
    return jpeg.type === "image/jpeg" ? jpeg : new Blob([jpeg], { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
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
