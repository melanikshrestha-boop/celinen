import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { instantiateIngestWasm, type IngestEngine } from "../src/lib/studio/cull/ingest-engine";

// Runs the committed binary against the real photographs in tests/fixtures.
const binary = readFileSync(new URL("../src/lib/studio/cull/celinen-ingest.wasm", import.meta.url));
const photo = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/photos/${name}`, import.meta.url)));
const modelFile = (name: string) => {
  const bytes = readFileSync(new URL(`../src/lib/studio/cull/models/${name}`, import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

// One engine without the face models, one with them: the difference between
// them is exactly what reading eyes adds.
let engine: IngestEngine;
let seeing: IngestEngine;
beforeAll(async () => {
  engine = await instantiateIngestWasm(binary);
  seeing = await instantiateIngestWasm(binary);
  seeing.loadFaceModels({
    detector: modelFile("face_detection_yunet_2023mar.onnx"),
    landmarks: modelFile("face_landmarks_detector.tflite"),
    blendshapes: modelFile("face_blendshapes.tflite"),
  });
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

  test("renders the working frame from coefficients exactly as libjpeg decodes it", () => {
    // The file is entropy-decoded once and the working frame is rebuilt from
    // the coefficients, so a face crop costs no second decode. That is only
    // allowed to be faster, never different: every byte must match libjpeg's
    // own scaled decode, on 4:2:0 and 4:2:2, landscape and rotated portrait.
    for (const name of [
      "basketball-hangar-usnavy-pd.jpg",
      "basketball-action-usaf-pd.jpg",
      "volleyball-portrait-cc0.jpg",
    ]) {
      const bytes = photo(name);
      const coefficients = engine.read(bytes);
      const streaming = engine.read(bytes, { streamingDecode: true });
      expect([coefficients.frame.width, coefficients.frame.height]).toEqual([
        streaming.frame.width,
        streaming.frame.height,
      ]);
      expect(coefficients.frame.rgba).toEqual(streaming.frame.rgba);
      expect(coefficients.reading.hash).toBe(streaming.reading.hash);
      expect(coefficients.reading.acuitySubject).toBe(streaming.reading.acuitySubject);
    }
  });

  test("finds the faces on a real sports frame and reads the subject's eyes", () => {
    const result = seeing.read(photo("basketball-action-usaf-pd.jpg"));
    const faces = result.faces ?? [];
    // Eleven people are in frame around two players; the engine finds the
    // sideline as well as the subject, at 640px of working frame.
    expect(faces.length).toBeGreaterThanOrEqual(8);
    expect(result.reading.faceCount).toBeGreaterThanOrEqual(8);
    const primary = faces.find((face) => face.primary);
    expect(primary).toBeDefined();
    // The player carrying the ball, about 95 pixels of face in a 2,256px frame.
    expect(primary!.pixels).toBeGreaterThan(80);
    expect(primary!.x).toBeGreaterThan(0.4);
    expect(primary!.x).toBeLessThan(0.6);
    expect(primary!.judged).toBe(true);
    expect(primary!.presence).toBeGreaterThan(0.9);
    // His eyes are open, and the engine says so without claiming certainty it
    // does not have: he is turned away and looking down.
    expect(primary!.closedProbability).toBeLessThan(0.45);
    expect(result.reading.eyesClosed).toBe(false);
    expect(result.reading.eyesUncertain).toBe(false);
    expect(Math.abs(primary!.yaw)).toBeGreaterThan(20);
    expect(primary!.confidence).toBeLessThan(0.5);
    // Only the subject and a companion are worth a landmark pass.
    expect(faces.filter((face) => face.judged).length).toBeLessThanOrEqual(2);
    // Without the models nothing is claimed about faces at all.
    const blind = engine.read(photo("basketball-action-usaf-pd.jpg"));
    expect(blind.faces).toBeNull();
    expect(blind.reading.hasFace).toBe(false);
    expect(blind.reading.eyesClosedProbability).toBe(-1);
  });

  test("says unknown, never closed, when there is nothing to read", () => {
    // The back of a head and a face turned up into the light: the landmark
    // model does not recognize a face, so the frame's eyes stay unknown.
    const result = seeing.read(photo("basketball-hangar-usnavy-pd.jpg"));
    const primary = (result.faces ?? []).find((face) => face.primary);
    expect(primary).toBeDefined();
    expect(primary!.presence).toBeLessThan(0.5);
    expect(primary!.closedProbability).toBe(-1);
    expect(result.reading.eyesClosed).toBe(false);
    expect(result.reading.eyesUncertain).toBe(false);
    expect(result.reading.eyesClosedProbability).toBe(-1);
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
