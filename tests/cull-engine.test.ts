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
        amplitude *
          (octave(x, y, 2.2, 0) * 0.5 + octave(x, y, 7, 1) * 0.3 + octave(x, y, 23, 2) * 0.2);
      const i = (y * width + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = value;
      rgba[i + 3] = 255;
    }
  return rgba;
}

function blur(rgba: Uint8ClampedArray, width: number, height: number, radius: number, passes = 3) {
  const out = new Uint8ClampedArray(rgba);
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
    const face = { x: 0.35, y: 0.2, width: 0.3, height: 0.35, sharpness: 0.8, score: 0.9 };
    const open = engine.measure(pixels, W, H, [
      { ...face, eyesOpen: null, closedProbability: 0.04, confidence: 0.9 },
    ]);
    const blink = engine.measure(pixels, W, H, [
      { ...face, eyesOpen: null, closedProbability: 0.95, confidence: 0.9 },
    ]);
    expect(open.hasFace).toBe(true);
    expect(open.faceCount).toBe(1);
    expect(open.eyesClosed).toBe(false);
    expect(open.eyesUncertain).toBe(false);
    expect(blink.eyesClosed).toBe(true);
    expect(blink.eyesClosedProbability).toBeCloseTo(0.95, 5);
    expect(blink.eyesConfidence).toBeCloseTo(0.9, 5);
    expect(blink.quality).toBeLessThan(open.quality * 0.6);

    // The same probability without the confidence to back it: a look, never a reject.
    const doubtful = engine.measure(pixels, W, H, [
      { ...face, eyesOpen: null, closedProbability: 0.95, confidence: 0.4 },
    ]);
    expect(doubtful.eyesClosed).toBe(false);
    expect(doubtful.eyesUncertain).toBe(true);
    expect(doubtful.quality).toBeCloseTo(open.quality, 5);

    // A browser detector's bare guess is evidence, not proof.
    const guessed = engine.measure(pixels, W, H, [{ ...face, sharpness: -1, eyesOpen: false }]);
    expect(guessed.eyesClosed).toBe(false);
    expect(guessed.eyesUncertain).toBe(true);

    // Without a detector there is no claim either way.
    const none = engine.measure(pixels, W, H);
    expect(none.hasFace).toBe(false);
    expect(none.eyesUncertain).toBe(false);
    expect(none.eyesClosedProbability).toBe(-1);
  });

  test("decides the eyes from the subject, not from the crowd", () => {
    const eyes = (x: number, size: number, p: number, c: number, sharpness = 0.8) => ({
      x,
      y: 0.2,
      width: size,
      height: size * 1.3,
      sharpness,
      eyesOpen: null,
      score: 0.9,
      closedProbability: p,
      confidence: c,
    });
    const player = eyes(0.42, 0.16, 0.04, 0.9);
    const fan = eyes(0.04, 0.04, 0.98, 0.95);
    expect(engine.judgeEyes([fan, player], W / H)).toEqual({ state: "open", primary: 1 });
    expect(engine.judgeEyes([fan, eyes(0.42, 0.16, 0.92, 0.9)], W / H)).toEqual({
      state: "closed",
      primary: 1,
    });
    // A second player of nearly the same standing blinking: worth a look, not a reject.
    const pair = engine.judgeEyes([eyes(0.4, 0.15, 0.03, 0.9), eyes(0.7, 0.15, 0.95, 0.9)], W / H);
    expect(pair).toEqual({ state: "uncertain", primary: 0 });
    // A face too far off the frame's subject to count as one: no effect at all.
    expect(
      engine.judgeEyes([eyes(0.4, 0.15, 0.03, 0.9), eyes(0.9, 0.05, 0.95, 0.9)], W / H),
    ).toEqual({
      state: "open",
      primary: 0,
    });
    // Eyes that could not be read are unknown, never closed.
    expect(engine.judgeEyes([eyes(0.42, 0.16, -1, 0)], W / H)).toEqual({
      state: "unknown",
      primary: 0,
    });
    expect(engine.judgeEyes([], W / H)).toEqual({ state: "unknown", primary: -1 });
    // The thresholds are the engine's, and the evaluation can move them.
    expect(engine.judgeEyes([eyes(0.42, 0.16, 0.8, 0.8)], W / H).state).toBe("closed");
    expect(
      engine.judgeEyes([eyes(0.42, 0.16, 0.8, 0.8)], W / H, { minConfidence: 0.95 }).state,
    ).toBe("uncertain");
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

  test("a frame whose eyes are uncertain is left for the photographer", () => {
    const rows = engine.shoot([
      frame(sharp),
      frame({ ...sharp, eyesUncertain: true, hasFace: true }),
      frame({ ...soft, eyesUncertain: true, hasFace: true }),
    ]);
    expect(rows[0]!.verdict).toBe("keep");
    // Sharp and otherwise a keeper, but possibly a blink: undecided, and named.
    expect(rows[1]!.verdict).toBe("undecided");
    expect(rows[1]!.reason).toBe("eyes-uncertain");
    // A soft frame is still rejected for what is certainly wrong with it.
    expect(rows[2]!.verdict).toBe("reject");
    expect(rows[2]!.reason).toBe("out-of-focus");
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
      frame(
        { ...sharp, hash: sharp.hash.slice(0, 14) + (i % 97).toString(16).padStart(2, "0") },
        {
          captureTimeMs: i * 500,
        },
      ),
    );
    const grouped = performance.now();
    expect(engine.shoot(frames)).toHaveLength(2000);
    // Generous bounds: this asserts the engine is not accidentally quadratic,
    // not a benchmark of whichever machine runs the suite.
    expect(perFrame).toBeLessThan(400);
    expect(performance.now() - grouped).toBeLessThan(2000);
  }, 60_000);
});
