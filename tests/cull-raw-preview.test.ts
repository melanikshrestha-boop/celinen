import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { embeddedJpeg, jpegEnd } from "../src/lib/studio/cull/raw-preview";

const photo = new Uint8Array(
  readFileSync(new URL("./fixtures/photos/basketball-hangar-usnavy-pd.jpg", import.meta.url)),
);

/** A minimal but complete JPEG: SOI, one APP0 segment, SOS with entropy bytes, EOI. */
function tinyJpeg(payload: number[]): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    0xda,
    0x00,
    0x02,
    ...payload,
    0xff,
    0xd9,
  ]);
}

describe("RAW embedded preview", () => {
  test("measures a real JPEG to its true end", () => {
    expect(jpegEnd(photo, 0)).toBe(photo.length);
  });

  test("a stuffed zero or restart marker inside the scan does not end it", () => {
    const jpeg = tinyJpeg([0x12, 0xff, 0x00, 0x34, 0xff, 0xd3, 0x56]);
    expect(jpegEnd(jpeg, 0)).toBe(jpeg.length);
  });

  test("finds the full preview inside a container, past a smaller thumbnail", () => {
    const thumbnail = tinyJpeg([1, 2, 3]);
    const container = new Uint8Array(512 + thumbnail.length + 256 + photo.length + 2048);
    container.set([0x49, 0x49, 0x2a, 0x00], 0); // a TIFF header, as NEF/CR2/ARW begin
    container.set(thumbnail, 512);
    container.set(photo, 512 + thumbnail.length + 256);
    const found = embeddedJpeg(container);
    expect(found).not.toBeNull();
    expect(found!.length).toBe(photo.length);
    expect(found![0]).toBe(0xff);
    expect(found![found!.length - 1]).toBe(0xd9);
  });

  test("a preview carrying its own EXIF thumbnail is not cut short", () => {
    // Nest a complete JPEG inside an APP1 segment, the way cameras store the
    // EXIF thumbnail, then follow it with the rest of a real preview.
    const inner = tinyJpeg([9, 9, 9]);
    const app1Length = 2 + inner.length;
    const wrapped = new Uint8Array(2 + 2 + app1Length + (photo.length - 2));
    wrapped.set([0xff, 0xd8, 0xff, 0xe1, app1Length >> 8, app1Length & 0xff], 0);
    wrapped.set(inner, 6);
    wrapped.set(photo.subarray(2), 6 + inner.length);
    expect(jpegEnd(wrapped, 0)).toBe(wrapped.length);
    expect(embeddedJpeg(wrapped)!.length).toBe(wrapped.length);
  });

  test("a file with only a navigation thumbnail, or none, yields nothing", () => {
    expect(embeddedJpeg(tinyJpeg([1, 2, 3]))).toBeNull();
    expect(embeddedJpeg(new Uint8Array(4096))).toBeNull();
    expect(jpegEnd(photo.slice(0, 1000), 0)).toBe(-1);
  });
});
