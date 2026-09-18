/** Hand-built RAW containers for the Develop import path.
 *
 * Small on purpose: Develop only needs to find the embedded JPEG and turn it
 * the right way up. The full container precedence rules (thumbnail vs preview
 * vs sensor IFD, CR3, RAF) are covered by tests/cull-raw-container.test.ts
 * against the same C++.
 */
import { readFileSync } from "node:fs";

/** A real photograph, because the C++ reader will not accept a token JPEG. */
export function fixturePhoto(name = "volleyball-portrait-cc0.jpg"): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./fixtures/photos/${name}`, import.meta.url)));
}

export const previews = {
  /** A little-endian TIFF shaped like a Sony ARW: IFD0 carries the preview. */
  arw(preview: Uint8Array = fixturePhoto(), orientation = 8): File {
    const previewOffset = 512;
    const bytes = new Uint8Array(previewOffset + preview.length + 32);
    const view = new DataView(bytes.buffer);
    const u16 = (at: number, value: number) => view.setUint16(at, value, true);
    const u32 = (at: number, value: number) => view.setUint32(at, value, true);
    const fields: [number, number, number, number][] = [
      [0x00fe, 4, 1, 1], // NewSubfileType: a reduced-resolution preview
      [0x0103, 3, 1, 6], // Compression: JPEG
      [0x0112, 3, 1, orientation],
      [0x0201, 4, 1, previewOffset], // JPEGInterchangeFormat
      [0x0202, 4, 1, preview.length], // JPEGInterchangeFormatLength
    ];
    bytes.set([0x49, 0x49, 42, 0], 0);
    u32(4, 8);
    u16(8, fields.length);
    fields.forEach(([tag, type, count, value], index) => {
      const entry = 8 + 2 + index * 12;
      u16(entry, tag);
      u16(entry + 2, type);
      u32(entry + 4, count);
      if (type === 3 && count === 1) u16(entry + 8, value);
      else u32(entry + 8, value);
    });
    u32(8 + 2 + fields.length * 12, 0);
    bytes.set(preview, previewOffset);
    return new File([bytes], "_DSC9001.ARW");
  },
};
