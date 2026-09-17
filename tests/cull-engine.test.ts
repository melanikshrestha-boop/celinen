import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  instantiateCullWasm,
  type CullEngine,
  type CullFrameInput,
  type CullReading,
} from "../src/lib/studio/cull/engine";

// Runs the committed binary: the exact bytes lenslab.dev serves.
const binary = readFileSync(new URL("../src/lib/studio/cull/celinen-cull.wasm", import.meta.url));

/** Photo-like detail: smooth value noise at three octaves. */
function detailed(width: number, height: number, amplitude = 60, base = 128, seed = 12345) {
  const corner = (x: number, y: number, salt: number) => {
    let v = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed + salt) >>> 0;
    v = Math.imul(v ^ (v >>> 13), 1274126177) >>> 0;
    return (((v ^ (v >>> 16)) & 0xffff) / 65535 - 0.5) as number;
  };
  const octave = (x: number, y: number, cell: number, salt: number) => {
    const fx = x / cell,
      fy = y / cell;
    const x0 = Math.floor(fx),
      y0 = Math.floor(fy);
    const tx = fx - x0,
      ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx),
      sy = ty * ty * (3 - 2 * ty);
    const top = corner(x0, y0, salt) * (1 - sx) + corner(x0 + 1, y0, salt) * sx;
    const bottom = corner(x0, y0 + 1, salt) * (1 - sx) + corner(x0 + 1, y0 + 1, salt) * sx;
    return top * (1 - sy) + bottom * sy;
  };
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const value =
        base +
        amplitude * (octave(x, y, 2.2, 0) * 0.5 + octave(x, y, 7, 1) * 0.3 + octave(x, y, 23, 2) * 0.2);
      const i = (y * width + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = value;
      rgba[i + 3] = 255;
    }
  return rgba;
}

function blur(rgba: Uint8ClampedArray, width: number, height: number, radius: number, passes = 3) {
  let out = new Uint8ClampedArray(rgba);
  for (let pass = 0; pass < passes; pass++)
    for (const vertical of [false, true]) {
      const source = new Uint8ClampedArray(out);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          let sum = 0,
            count = 0;
          for (let d = -radius; d <= radius; d++) {
            const sx = vertical ? x : Math.min(width - 1, Math.max(0, x + d));
            const sy = vertical ? Math.min(height - 1, Math.max(0, y + d)) : y;
            sum += source[(sy * width + sx) * 4]!;
            count++;
          }
          const i = (y * width + x) * 4;
          out[i] = out[i + 1] = out[i + 2] = sum / count;
          out[i + 3] = 255;
        }
    }
  return out;
}

const W = 320,
  H = 240;
let engine: CullEngine;
let sharp: CullReading;
let soft: CullReading;

beforeAll(async () => {
  engine = await instantiateCullWasm(binary);
  sharp = engine.measure(detailed(W, H), W, H);
  soft = engine.measure(blur(detailed(W, H), W, H, 3), W, H);
});

const frame = (reading: CullReading, extra: Partial<CullFrameInput> = {}): CullFrameInput => ({
  reading,
  captureTimeMs: null,
  ...extra,
});

describe("C++ cull engine compiled to WebAssembly", () => {
  test("separates a sharp frame from a defocused one, which the old score could not", () => {
    expect(sharp.acuitySubject).toBeGreaterThan(0.65);
    expect(soft.acuitySubject).toBeLessThan(0.35);
    expect(sharp.quality).toBeGreaterThan(soft.quality + 25);
    expect(sharp.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(sharp.color.length).toBe(48);
  });

  test("a low-contrast frame in focus beats a high-contrast frame out of focus", () => {
    const faint = engine.measure(detailed(W, H, 30), W, H);
    const bold = engine.measure(blur(detailed(W, H, 110), W, H, 3), W, H);
    expect(faint.acuitySubject).toBeGreaterThan(bold.acuitySubject + 0.3);
    expect(faint.quality).toBeGreaterThan(bold.quality + 20);
  });

  test("carries face evidence through without inventing any of it", () => {
    const pixels = detailed(W, H);
    const open = engine.measure(pixels, W, H, [
      { x: 0.35, y: 0.2, width: 0.3, height: 0.35, sharpness: -1, eyesOpen: true },
    ]);
    const blink = engine.measure(pixels, W, H, [
      { x: 0.35, y: 0.2, width: 0.3, height: 0.35, sharpness: -1, eyesOpen: false },
    ]);
    expect(open.hasFace).toBe(true);
    expect(open.eyesClosed).toBe(false);
    expect(blink.eyesClosed).toBe(true);
    expect(blink.quality).toBeLessThan(open.quality * 0.6);
    // Without a detector there is no claim either way.
    expect(engine.measure(pixels, W, H).hasFace).toBe(false);
  });

  test("groups a burst, keeps its best frame and rejects the rest", () => {
    const rows = engine.shoot([
      frame(sharp, { captureTimeMs: 1000 }),
      frame({ ...soft, hash: sharp.hash, color: sharp.color }, { captureTimeMs: 1400 }),
      frame(engine.measure(detailed(W, H, 60, 128, 987), W, H), { captureTimeMs: 600000 }),
    ]);
    expect(rows[0]!.group).not.toBeNull();
    expect(rows[0]!.group).toBe(rows[1]!.group!);
    expect(rows[2]!.group).toBeNull();
    expect(rows[0]!.bestOfGroup).toBe(true);
    expect(rows[0]!.verdict).toBe("keep");
    expect(rows[1]!.verdict).toBe("reject");
    expect(rows[1]!.duplicate).toBe(true);
    expect(rows[0]!.score).toBeGreaterThan(rows[1]!.score);
  });

  test("names the reason it rejected a frame", () => {
    const shaken = { ...soft, globalSmear: true, motion: 0.8 };
    const missed = { ...soft, acuityBest: soft.acuitySubject + 0.4 };
    const rows = engine.shoot([
      frame(sharp),
      frame(soft),
      frame(shaken),
      frame(missed),
      frame({ ...sharp, eyesClosed: true, hasFace: true }),
      frame({ ...sharp, subjectLuma: 8 }),
    ]);
    expect(rows[1]!.reason).toBe("out-of-focus");
    expect(rows[2]!.reason).toBe("motion-blur");
    expect(rows[3]!.reason).toBe("missed-focus");
    expect(rows[4]!.reason).toBe("eyes-closed");
    expect(rows[5]!.reason).toBe("exposure");
    expect(rows[0]!.verdict).toBe("keep");
  });

  test("never overrules the photographer and never judges an unreadable file", () => {
    const rows = engine.shoot([
      frame(soft, { verdict: "keep" }),
      frame(sharp, { unreadable: true }),
      frame(sharp),
    ]);
    expect(rows[0]!.verdict).toBe("undecided");
    expect(rows[1]!.verdict).toBe("undecided");
    expect(rows[1]!.score).toBe(0);
    // A sharper near-duplicate of a frame they kept is worth a look, not a
    // matching reject.
    expect(rows[2]!.verdict).toBe("keep");
    const afterReject = engine.shoot([
      frame(sharp, { verdict: "reject" }),
      frame({ ...soft, hash: sharp.hash, color: sharp.color }),
    ]);
    expect(afterReject[1]!.reason).not.toBe("duplicate");
  });

  test("an entirely soft shoot keeps nothing", () => {
    const frames = Array.from({ length: 6 }, (_, i) =>
      frame(engine.measure(blur(detailed(W, H, 60, 120 + i * 4, i), W, H, 3), W, H), {
        captureTimeMs: i * 90000,
      }),
    );
    expect(engine.shoot(frames).every((row) => row.verdict !== "keep")).toBe(true);
  });

  test("rejects a torn frame and stays usable afterwards", () => {
    expect(() => engine.measure(new Uint8ClampedArray(16), W, H)).toThrow("incomplete frame");
    expect(() => engine.measure(new Uint8ClampedArray(4), 1, 1)).toThrow();
    expect(engine.measure(detailed(W, H), W, H).acuitySubject).toBeGreaterThan(0.65);
    expect(engine.shoot([])).toEqual([]);
    engine.release();
  });

  test("measures a full shoot's worth of frames quickly", () => {
    const pixels = detailed(1280, 854);
    const started = performance.now();
    for (let i = 0; i < 5; i++) engine.measure(pixels, 1280, 854);
    const perFrame = (performance.now() - started) / 5;
    const frames = Array.from({ length: 2000 }, (_, i) =>
      frame({ ...sharp, hash: sharp.hash.slice(0, 14) + (i % 97).toString(16).padStart(2, "0") }, {
        captureTimeMs: i * 500,
      }),
    );
    const grouped = performance.now();
    expect(engine.shoot(frames)).toHaveLength(2000);
    // Generous bounds: this asserts the engine is not accidentally quadratic,
    // not a benchmark of whichever machine runs the suite.
    expect(perFrame).toBeLessThan(400);
    expect(performance.now() - grouped).toBeLessThan(2000);
  }, 60_000);
});
