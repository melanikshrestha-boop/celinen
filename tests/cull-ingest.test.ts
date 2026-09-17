import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { instantiateIngestWasm, type IngestEngine } from "../src/lib/studio/cull/ingest-engine";

// Runs the committed binary against the real photographs in tests/fixtures.
const binary = readFileSync(new URL("../src/lib/studio/cull/celinen-ingest.wasm", import.meta.url));
const photo = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/photos/${name}`, import.meta.url)));

let engine: IngestEngine;
beforeAll(async () => {
  engine = await instantiateIngestWasm(binary);
});

describe("C++ ingest: one call per photo", () => {
  test("reads a real photograph: EXIF, a scaled decode, the measurement and a thumbnail", () => {
    const result = engine.read(photo("basketball-hangar-usnavy-pd.jpg"));
    expect([result.width, result.height]).toEqual([4256, 2832]);
    // The working frame is normalized, so frames from different bodies compare.
    expect(Math.max(result.frame.width, result.frame.height)).toBe(640);
    expect(result.cameraKey).toBe("nikon corporation|nikon d700|2311811");
    expect(result.captureTimeBasis).toBe("camera_clock");
    expect(new Date(result.captureTimeMs!).getUTCFullYear()).toBe(2013);
    expect(result.reading.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(result.reading.acuitySubject).toBeGreaterThan(0.35);
    expect(result.thumbnail.type).toBe("image/jpeg");
    expect(result.thumbnail.size).toBeGreaterThan(2000);
  });

  test("applies the camera's own orientation and time offset", () => {
    const result = engine.read(photo("volleyball-portrait-cc0.jpg"));
    // The file is 4000x3000 with orientation 6: upright it is taller than wide.
    expect([result.width, result.height]).toEqual([4000, 3000]);
    expect(result.frame.height).toBeGreaterThan(result.frame.width);
    expect(result.cameraKey).toBe("samsung|galaxy s23+");
    expect(result.captureTimeBasis).toBe("utc");
    expect(result.reading.acuitySubject).toBeGreaterThan(0.8);
  });

  test("measures the same frame the same way at any decode scale", () => {
    const bytes = photo("basketball-hangar-usnavy-pd.jpg");
    const small = engine.read(bytes, { measureEdge: 480 });
    const large = engine.read(bytes, { measureEdge: 640 });
    expect(Math.abs(small.reading.acuitySubject - large.reading.acuitySubject)).toBeLessThan(0.08);
    // Resampling moves a perceptual hash by a bit or two; what matters is that
    // it stays far inside the distance at which two frames count as the same
    // framing (6 of 64), so a re-import still lands in its own burst.
    let distance = 0;
    for (let i = 0; i < 16; i++) {
      const bits =
        Number.parseInt(small.reading.hash[i]!, 16) ^ Number.parseInt(large.reading.hash[i]!, 16);
      distance += (bits & 1) + ((bits >> 1) & 1) + ((bits >> 2) & 1) + ((bits >> 3) & 1);
    }
    expect(distance).toBeLessThanOrEqual(4);
  });

  test("says why a file cannot be read instead of inventing a frame", () => {
    expect(() => engine.read(new Uint8Array([1, 2, 3, 4]))).toThrow();
    expect(() => engine.read(new Uint8Array(0))).toThrow();
    const truncated = photo("basketball-action-usaf-pd.jpg").slice(0, 400);
    expect(() => engine.read(truncated)).toThrow();
    // Still usable afterwards.
    expect(engine.read(photo("basketball-action-usaf-pd.jpg")).width).toBe(2256);
  });

  test("reads a full-size frame fast enough for a ten-thousand frame card", () => {
    const bytes = photo("basketball-hangar-usnavy-pd.jpg");
    engine.read(bytes);
    const runs = 10;
    const started = performance.now();
    for (let i = 0; i < runs; i++) engine.read(bytes);
    const perFrame = (performance.now() - started) / runs;
    // Measured at about 35ms for a 12MP frame on an M-series Mac, including the
    // thumbnail. The bound is generous: it exists to catch a change that makes
    // ingest quadratic or drops back to a full-size decode, not to time a CPU.
    expect(perFrame).toBeLessThan(400);
    engine.release();
  }, 60_000);
});
