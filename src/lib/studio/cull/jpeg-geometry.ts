/** A JPEG's pixel size and EXIF orientation, read from its header alone.
 *
 * Decoding a 24 MP frame only to learn which way is up costs a hundred
 * milliseconds and a hundred megabytes. The header holds both answers in its
 * first few kilobytes, so a scaled decode can be asked for in one step.
 */

export type JpegGeometry = {
  /** Stored pixel size, before orientation. */
  width: number;
  height: number;
  /** EXIF orientation 1–8; 1 when the file carries none. */
  orientation: number;
};

/** How many leading bytes to hand `jpegGeometry`. The EXIF block (with its own
 * thumbnail) is capped at 64 KiB by the format, and the frame header follows it. */
export const JPEG_HEADER_BYTES = 256 * 1024;

export function jpegGeometry(bytes: Uint8Array): JpegGeometry | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let orientation = 1;
  // Chromium, Firefox and WebKit all read the *first* EXIF block and ignore any
  // later one. A file that carries two (a tool that prepended its own) must be
  // read the same way here, or a decode would be scaled against the size of a
  // frame the browser then turns — a squashed preview.
  let exifRead = false;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    // Start of scan or end of image before a frame header: not a usable JPEG.
    if (marker === 0xda || marker === 0xd9) return null;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2; // standalone markers carry no length
      continue;
    }
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    if (length < 2) return null;
    const body = at + 4;
    if (marker === 0xe1 && !exifRead) {
      const found = exifOrientation(bytes, body, Math.min(bytes.length, at + 2 + length));
      if (found !== null) {
        exifRead = true; // an EXIF block with no orientation still means "upright"
        if (found > 0) orientation = found;
      }
    } else if (isFrameHeader(marker)) {
      if (body + 5 > bytes.length) return null;
      const height = (bytes[body + 1]! << 8) | bytes[body + 2]!;
      const width = (bytes[body + 3]! << 8) | bytes[body + 4]!;
      return width && height ? { width, height, orientation } : null;
    }
    at += 2 + length;
  }
  return null;
}

// SOF0–SOF15, less DHT (C4), JPG (C8) and DAC (CC), which share the range.
function isFrameHeader(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** The orientation an EXIF APP1 segment names: 1-8, 0 when the block is EXIF
 * but names none, null when the segment is not a readable EXIF block at all. */
function exifOrientation(bytes: Uint8Array, start: number, end: number): number | null {
  // "Exif\0\0", then a TIFF header.
  if (end - start < 14) return null;
  const signature = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  for (let i = 0; i < 6; i++) if (bytes[start + i] !== signature[i]) return null;
  const tiff = start + 6;
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
  if (!little && !big) return null;
  const u16 = (offset: number) =>
    little
      ? bytes[offset]! | (bytes[offset + 1]! << 8)
      : (bytes[offset]! << 8) | bytes[offset + 1]!;
  const u32 = (offset: number) =>
    little
      ? (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)) +
        bytes[offset + 3]! * 0x1000000
      : bytes[offset]! * 0x1000000 +
        ((bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!);
  if (tiff + 8 > end) return null;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return 0;
    if (u16(entry) !== 0x0112) continue;
    const value = u16(entry + 8); // SHORT, left-justified in the value field
    return value >= 1 && value <= 8 ? value : 0;
  }
  return 0;
}

/** The size a frame shows at once its orientation is applied. */
export function orientedSize(geometry: JpegGeometry): { width: number; height: number } {
  // Orientations 5–8 turn the frame a quarter.
  return geometry.orientation >= 5
    ? { width: geometry.height, height: geometry.width }
    : { width: geometry.width, height: geometry.height };
}

/** Scales a size so its long edge is at most `maxEdge`; never enlarges. */
export function fitLongEdge(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height };
  const scale = maxEdge / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
