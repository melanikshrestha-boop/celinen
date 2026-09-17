/** Finding the camera's own JPEG inside a RAW file, without reading the sensor data. */

/** Where a JPEG that starts at `start` really ends, or -1 when it is not one.
 * Walks the length-prefixed segments instead of searching for the first
 * end-of-image marker: a camera preview carries its own EXIF thumbnail, and that
 * thumbnail's end marker would otherwise cut the preview short.
 */
export function jpegEnd(bytes: Uint8Array, start: number): number {
  let at = start + 2;
  // The end marker is the last two bytes of a file, so the loop may only demand
  // a length field once it knows the marker has one.
  while (at + 2 <= bytes.length) {
    if (bytes[at] !== 0xff) return -1;
    const marker = bytes[at + 1]!;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    if (marker === 0xd9) return at + 2;
    if (marker >= 0xd0 && marker <= 0xd7) {
      at += 2;
      continue;
    }
    if (at + 4 > bytes.length) return -1;
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    if (length < 2) return -1;
    if (marker !== 0xda) {
      at += 2 + length;
      continue;
    }
    // Entropy-coded data: the next marker that is not a stuffed zero or a
    // restart marker ends the scan.
    at += 2 + length;
    while (at + 1 < bytes.length) {
      if (bytes[at] === 0xff) {
        const next = bytes[at + 1]!;
        if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7) && next !== 0xff) break;
      }
      at += 1;
    }
  }
  return -1;
}

/** RAW containers keep a full-size JPEG inside them. It is the only part of a
 * RAW this engine reads — the sensor data belongs to Develop, not to a cull.
 */
export function embeddedJpeg(bytes: Uint8Array): Uint8Array | null {
  let best: { at: number; size: number } | null = null;
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] !== 0xff || bytes[i + 1] !== 0xd8 || bytes[i + 2] !== 0xff) continue;
    const end = jpegEnd(bytes, i);
    if (end < 0) continue;
    if (!best || end - i > best.size) best = { at: i, size: end - i };
    i = end - 1; // everything inside this JPEG, including its thumbnail, is covered
  }
  // Anything under 64 KiB is a navigation thumbnail, not a frame to judge.
  return best && best.size > 64 * 1024 ? bytes.subarray(best.at, best.at + best.size) : null;
}
