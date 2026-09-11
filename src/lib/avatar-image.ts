export const AVATAR_SOURCE_LIMIT = 50 * 1024 * 1024;
export const AVATAR_PIXEL_LIMIT = 100_000_000;
export const AVATAR_PREVIEW_EDGE = 2048;

/** MIME labels and extensions are hints, not proof. Decode only supported raster bytes. */
export async function prepareAvatarImage(file: File): Promise<Blob> {
  if (file.size > AVATAR_SOURCE_LIMIT) throw new Error("Choose an image no larger than 50 MB.");
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const prefix = (value: number[], offset = 0) =>
    value.every((byte, index) => bytes[offset + index] === byte);
  const type = prefix([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    ? "image/png"
    : prefix([0xff, 0xd8, 0xff])
      ? "image/jpeg"
      : prefix([0x52, 0x49, 0x46, 0x46]) && prefix([0x57, 0x45, 0x42, 0x50], 8)
        ? "image/webp"
        : null;
  if (!type) throw new Error("Choose a JPEG, PNG or WebP image.");
  // Correct a missing or incorrect OS MIME label. The image decoder still validates the file.
  return file.slice(0, file.size, type);
}

function checkedDimensions(width: number, height: number) {
  if (!width || !height) throw new Error("Choose a valid JPEG, PNG or WebP image.");
  if (width * height > AVATAR_PIXEL_LIMIT || Math.max(width, height) > 30_000)
    throw new Error("Choose an image up to 100 megapixels and 30,000 pixels per side.");
  return { width, height };
}

/** Read dimensions before decoding; a tiny file must not request an enormous pixel buffer.
 * Header parsing is not image validation: the browser decoder still validates raster content.
 * WebP layout: https://developers.google.com/speed/webp/docs/riff_container
 */
export function avatarSourceDimensions(bytes: Uint8Array, type: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (type === "image/png" && bytes.length >= 24 && ascii(12, 16) === "IHDR")
    return checkedDimensions(view.getUint32(16), view.getUint32(20));
  if (type === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 0xda || marker === 0xd9) break;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        ) &&
        length >= 8
      )
        return checkedDimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
      offset += length;
    }
  }
  if (type === "image/webp" && bytes.length >= 30) {
    const chunk = ascii(12, 16);
    const u24 = (offset: number) =>
      view.getUint16(offset, true) + view.getUint8(offset + 2) * 65536;
    if (chunk === "VP8X") return checkedDimensions(u24(24) + 1, u24(27) + 1);
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return checkedDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a)
      return checkedDimensions(
        view.getUint16(26, true) & 0x3fff,
        view.getUint16(28, true) & 0x3fff,
      );
  }
  throw new Error("Choose a valid JPEG, PNG or WebP image. Try exporting a fresh copy.");
}

export async function decodeAvatarSource(file: File): Promise<ImageBitmap> {
  const image = await prepareAvatarImage(file);
  avatarSourceDimensions(
    new Uint8Array(await image.slice(0, 2 * 1024 * 1024).arrayBuffer()),
    image.type,
  );
  const full = await createImageBitmap(image, { imageOrientation: "from-image" });
  try {
    // Use decoded dimensions to preserve EXIF rotation and avoid stretched portraits.
    checkedDimensions(full.width, full.height);
    const scale = Math.min(1, AVATAR_PREVIEW_EDGE / Math.max(full.width, full.height));
    return await createImageBitmap(full, {
      resizeWidth: Math.max(1, Math.round(full.width * scale)),
      resizeHeight: Math.max(1, Math.round(full.height * scale)),
      resizeQuality: "high",
    });
  } finally {
    full.close();
  }
}

/** Keep the best crop that fits existing profile metadata; originals and EXIF are not uploaded. */
export function encodeAvatarCrop(canvas: HTMLCanvasElement, maxCharacters: number): string {
  const sizes = [
    ...new Set([canvas.width, 384, 256, 128, 96, 64].filter((size) => size <= canvas.width)),
  ];
  for (const size of sizes) {
    const target = size === canvas.width ? canvas : document.createElement("canvas");
    if (target !== canvas) {
      target.width = target.height = size;
      const context = target.getContext("2d");
      if (!context) throw new Error("Could not prepare the crop. Please try again.");
      context.drawImage(canvas, 0, 0, size, size);
    }
    for (const quality of [0.88, 0.78, 0.68, 0.58, 0.48]) {
      const result = target.toDataURL("image/jpeg", quality);
      if (result.startsWith("data:image/jpeg;base64,") && result.length <= maxCharacters)
        return result;
    }
  }
  throw new Error("Could not prepare the crop. Try a closer crop.");
}
