import { describe, expect, test } from "bun:test";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
import { cullEngine } from "../src/lib/studio/cull/client";
import { cullShootSuggestions } from "../src/lib/studio/cull/shoot";
import { applyImportCull } from "../src/lib/studio/cull-on-import";

/** Photo-like detail: smooth value noise at three octaves. */
function detailed(width: number, height: number, amplitude = 60, base = 128, seed = 12345) {
  const corner = (x: number, y: number, salt: number) => {
    let v = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed + salt) >>> 0;
    v = Math.imul(v ^ (v >>> 13), 1274126177) >>> 0;
    return ((v ^ (v >>> 16)) & 0xffff) / 65535 - 0.5;
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

function blurred(rgba: Uint8ClampedArray, width: number, height: number, radius: number) {
  const out = new Uint8ClampedArray(rgba);
  for (let pass = 0; pass < 3; pass++)
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

function shot(id: string, extra: Partial<Shot> = {}): Shot {
  return {
    id,
    file: new File(["synthetic"], `${id}.jpg`, { type: "image/jpeg" }),
    name: `${id}.jpg`,
    isRaw: false,
    previewUrl: null,
    width: W,
    height: H,
    sizeMb: 2,
    sharpness: 100,
    brightness: 128,
    clippedHighlights: 0,
    clippedShadows: 0,
    hash: "0".repeat(64),
    score: 99,
    flags: [],
    verdict: "undecided",
    edits: { ...DEFAULT_EDITS },
    ...extra,
  };
}

describe("shoot-level cull pass", () => {
  test("keeps the sharp frame, rejects the soft one, and says why", async () => {
    const engine = await cullEngine();
    expect(engine).not.toBeNull();
    const sharp = engine!.measure(detailed(W, H), W, H);
    const soft = engine!.measure(blurred(detailed(W, H), W, H, 3), W, H);
    const frames = [
      shot("sharp", { cull: sharp, hash: sharp.hash, captureTimeMs: 1000 }),
      shot("soft", { cull: soft, hash: soft.hash, captureTimeMs: 120000 }),
    ];
    const suggestions = await cullShootSuggestions(frames);
    expect(suggestions).not.toBeNull();
    expect(suggestions!.get("sharp")!.verdict).toBe("keep");
    expect(suggestions!.get("soft")!.verdict).toBe("reject");
    expect(suggestions!.get("soft")!.reason).toBe("out-of-focus");

    const result = applyImportCull(frames, { engine: suggestions! });
    expect(result.shots.find((s) => s.id === "sharp")!.verdict).toBe("keep");
    expect(result.shots.find((s) => s.id === "soft")!.verdict).toBe("reject");
    // The score the photographer sees is the shoot-calibrated one, not the 99
    // every frame used to carry.
    expect(result.shots.find((s) => s.id === "soft")!.score).toBeLessThan(
      result.shots.find((s) => s.id === "sharp")!.score,
    );
    expect(result.shots.every((s) => s.score <= 99 && s.score >= 1)).toBe(true);
  });

  test("flags a burst's weaker frames as duplicates without touching the keeper", async () => {
    const engine = await cullEngine();
    const sharp = engine!.measure(detailed(W, H), W, H);
    const soft = engine!.measure(blurred(detailed(W, H), W, H, 3), W, H);
    const frames = [
      shot("a", { cull: sharp, hash: sharp.hash, captureTimeMs: 1000 }),
      shot("b", { cull: { ...soft, hash: sharp.hash, color: sharp.color }, captureTimeMs: 1300 }),
    ];
    const suggestions = await cullShootSuggestions(frames);
    const result = applyImportCull(frames, { engine: suggestions! });
    expect(result.shots.find((s) => s.id === "b")!.flags).toContain("duplicate");
    expect(result.shots.find((s) => s.id === "a")!.flags).not.toContain("duplicate");
    expect(result.flagged).toBe(1);
  });

  test("a frame the engine never measured still goes through the browser pass", async () => {
    const engine = await cullEngine();
    const sharp = engine!.measure(detailed(W, H), W, H);
    const frames = [
      shot("measured", { cull: sharp, hash: sharp.hash }),
      // An older session's frame: analyzed before the engine existed.
      shot("legacy", { hash: "1".repeat(64), score: 20, flags: ["blur"] }),
    ];
    const suggestions = await cullShootSuggestions(frames);
    expect(suggestions!.has("legacy")).toBe(false);
    const result = applyImportCull(frames, { engine: suggestions! });
    expect(result.shots.find((s) => s.id === "measured")!.verdict).toBe("keep");
    expect(result.shots.find((s) => s.id === "legacy")!.verdict).toBe("reject");
  });

  test("no measurements at all leaves the shoot to the browser pass", async () => {
    expect(await cullShootSuggestions([shot("plain")])).toBeNull();
    expect(await cullShootSuggestions([])).toBeNull();
  });

  test("an unreadable frame is never measured or judged", async () => {
    const engine = await cullEngine();
    const sharp = engine!.measure(detailed(W, H), W, H);
    const frames = [
      shot("ok", { cull: sharp, hash: sharp.hash }),
      shot("broken", { cull: sharp, error: "This photo could not be decoded." }),
    ];
    const suggestions = await cullShootSuggestions(frames);
    expect(suggestions!.has("broken")).toBe(false);
    const result = applyImportCull(frames, { engine: suggestions! });
    expect(result.shots.find((s) => s.id === "broken")!.verdict).toBe("undecided");
  });
});
