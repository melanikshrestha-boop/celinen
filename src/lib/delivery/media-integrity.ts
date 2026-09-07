/** Read JPEG frame dimensions without decoding pixels or introducing another image engine. */
export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 14 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9)
    throw new Error("Truncated JPEG image.");
  return jpegHeaderDimensions(bytes);
}

/** The caller must separately verify the complete file's size, checksum and end marker. */
export function jpegHeaderDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8)
    throw new Error("Delivery files must be JPEG images.");
  let offset = 2;
  let dimensions: { width: number; height: number } | null = null;
  const components = new Set<number>();
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) throw new Error("Invalid JPEG marker.");
    while (bytes[offset] === 0xff) offset++;
    if (offset + 3 > bytes.length) throw new Error("Truncated JPEG marker.");
    const marker = bytes[offset++]!;
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const size = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (size < 2 || offset + size > bytes.length) throw new Error("Truncated JPEG.");
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      const count = bytes[offset + 7]!;
      if (size < 11 || count < 1 || count > 4 || size !== 8 + 3 * count || bytes[offset + 2] !== 8)
        throw new Error("Invalid JPEG frame.");
      const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
      const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      if (!width || !height) throw new Error("Invalid JPEG dimensions.");
      for (let i = 0; i < count; i++) {
        const component = bytes[offset + 8 + i * 3]!;
        if (components.has(component)) throw new Error("Invalid JPEG components.");
        components.add(component);
      }
      dimensions = { width, height };
    }
    if (marker === 0xda) {
      const count = bytes[offset + 2]!;
      if (
        !dimensions ||
        count < 1 ||
        count > components.size ||
        size !== 6 + 2 * count ||
        offset + size + 2 >= bytes.length
      )
        throw new Error("Missing or invalid JPEG scan.");
      const scanComponents = new Set<number>();
      for (let i = 0; i < count; i++) {
        const component = bytes[offset + 3 + 2 * i]!;
        if (!components.has(component) || scanComponents.has(component))
          throw new Error("Invalid JPEG scan components.");
        scanComponents.add(component);
      }
      return dimensions;
    }
    offset += size;
  }
  throw new Error("Unsupported JPEG frame; export a standard JPEG and retry.");
}
