import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { instantiateIngestWasm, type IngestEngine } from "../src/lib/studio/cull/ingest-engine";

// Runs the committed binary: the camera's AF area from a Sony maker note, and
// the focus-hit judgment that comes back with it.
const binary = readFileSync(new URL("../src/lib/studio/cull/celinen-ingest.wasm", import.meta.url));
const photo = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/photos/${name}`, import.meta.url)));

let engine: IngestEngine;
beforeAll(async () => {
  engine = await instantiateIngestWasm(binary);
});

/** A little-endian TIFF: IFD0 at 8 (Make, optional Orientation, EXIF pointer),
 * the EXIF IFD at 256 pointing to a Sony maker note at 512. FocusLocation is
 * width, height, x, y. */
function sonyTiff(location: [number, number, number, number], orientation = 0): Uint8Array {
  const bytes = new Uint8Array(640);
  const view = new DataView(bytes.buffer);
  const u16 = (at: number, v: number) => view.setUint16(at, v, true);
  const u32 = (at: number, v: number) => view.setUint32(at, v, true);
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    u16(at, tag);
    u16(at + 2, type);
    u32(at + 4, count);
    u32(at + 8, value);
  };
  bytes.set([0x49, 0x49, 42, 0], 0);
  u32(4, 8);
  const ifd0 = orientation ? 3 : 2;
  u16(8, ifd0);
  bytes.set(new TextEncoder().encode("SONY\0"), 200);
  entry(10, 0x010f, 2, 5, 200); // Make "SONY"
  entry(22, 0x8769, 4, 1, 256); // EXIF IFD
  if (orientation) {
    entry(34, 0x0112, 3, 1, 0);
    u16(34 + 8, orientation);
  }
  u16(256, 1);
  entry(258, 0x927c, 7, 128, 512); // MakerNote
  bytes.set(new TextEncoder().encode("SONY DSC \0\0\0"), 512);
  u16(524, 1);
  entry(526, 0x2027, 3, 4, 560); // FocusLocation, values at TIFF offset 560
  location.forEach((value, i) => u16(560 + i * 2, value));
  return bytes;
}

/** A real, decodable photograph with an EXIF APP1 placed first, ahead of its own. */
function withExif(jpeg: Uint8Array, tiff: Uint8Array): Uint8Array {
  const length = tiff.length + 8;
  const segment = new Uint8Array(4 + 6 + tiff.length);
  segment.set([0xff, 0xe1, length >> 8, length & 0xff], 0);
  segment.set(new TextEncoder().encode("Exif\0\0"), 4);
  segment.set(tiff, 10);
  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(segment, 2);
  out.set(jpeg.subarray(2), 2 + segment.length);
  return out;
}

describe("C++ ingest: the camera's AF area", () => {
  const base = photo("basketball-action-usaf-pd.jpg");

  test("reads Sony FocusLocation from a camera JPEG and judges focus there", () => {
    const result = engine.read(withExif(base, sonyTiff([6000, 4000, 4500, 1000])));
    expect(result.afPoint).toBeDefined();
    const af = result.afPoint!;
    expect(af.x + af.w / 2).toBeCloseTo(0.75, 6);
    expect(af.y + af.h / 2).toBeCloseTo(0.25, 6);
    expect(af.w).toBeCloseTo(0.06, 6); // a bare point is a nominal 6% box
    expect(result.afConfirmed).toBeUndefined(); // Sony does not say
    const hit = result.focusHit!;
    expect(["on-subject", "front-or-back-focus", "missed", "unjudged"]).toContain(hit.verdict);
    expect(hit.hit).toBeGreaterThanOrEqual(0);
    expect(hit.hit).toBeLessThanOrEqual(1);
    expect(hit.bestAcuity).toBeGreaterThan(0);
    // Everything else about the frame is still read.
    expect(result.width).toBe(2256);
    expect(result.reading.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  test("rotates the AF area with the frame's orientation", () => {
    const result = engine.read(withExif(base, sonyTiff([6000, 4000, 4500, 1000], 6)));
    expect(result.frame.height).toBeGreaterThan(result.frame.width);
    const af = result.afPoint!;
    // Orientation 6: stored (u, v) lands at (1 - v, u).
    expect(af.x + af.w / 2).toBeCloseTo(0.75, 6);
    expect(af.y + af.h / 2).toBeCloseTo(0.75, 6);
  });

  test("reads the AF area from a RAW container when its preview JPEG has none", () => {
    const arw = sonyTiff([6000, 4000, 1500, 3000]);
    const result = engine.read(base, {}, arw);
    expect(result.afPoint!.x + result.afPoint!.w / 2).toBeCloseTo(0.25, 6);
    expect(result.afPoint!.y + result.afPoint!.h / 2).toBeCloseTo(0.75, 6);
    // The container is consumed: the next photo cannot inherit it.
    expect(engine.read(base).afPoint).toBeUndefined();
  });

  test("a file without an AF area, or with a hostile one, reads normally without it", () => {
    for (const name of [
      "basketball-action-usaf-pd.jpg",
      "basketball-hangar-usnavy-pd.jpg",
      "volleyball-portrait-cc0.jpg",
    ]) {
      const result = engine.read(photo(name));
      expect(result.afPoint).toBeUndefined();
      expect(result.focusHit).toBeUndefined();
    }
    const outside = engine.read(withExif(base, sonyTiff([6000, 4000, 9000, 1000])));
    expect(outside.afPoint).toBeUndefined();
    // A maker note whose value offset points past the segment.
    const forged = sonyTiff([6000, 4000, 4500, 1000]);
    new DataView(forged.buffer).setUint32(526 + 8, 0x7ffffff0, true);
    expect(engine.read(withExif(base, forged)).afPoint).toBeUndefined();
    // Garbage and truncated containers are no AF area, never an error.
    expect(
      engine.read(base, {}, new Uint8Array([0x49, 0x49, 42, 0, 0xff, 0xff, 0xff, 0xff])).afPoint,
    ).toBeUndefined();
    expect(
      engine.read(base, {}, sonyTiff([6000, 4000, 4500, 1000]).subarray(0, 530)).afPoint,
    ).toBeUndefined();
    engine.release();
  });
});
