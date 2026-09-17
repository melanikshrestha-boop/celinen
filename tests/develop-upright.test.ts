import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { unsupportedBrowserDevelopEdits } from "../src/lib/develop/browser-capabilities";
import {
  defaultDevelopSettings,
  developSettingsSchema,
  readDevelopSettings,
  type DevelopSettings,
} from "../src/lib/develop/contract";
import { isNeutralDevelopRecipe } from "../src/lib/develop/neutral";
import { createPresetPackage, parsePresetPackage } from "../src/lib/develop/preset-package";
import { createDevelopDocument, currentRecipe } from "../src/lib/develop/store";
import {
  currentUprightSolution,
  defaultDevelopGeometry,
  uprightNeedsSolve,
  uprightProtocolLine,
  uprightTransformValues,
  type UprightSolution,
} from "../src/lib/develop/upright";
import { instantiateDevelopWasm, type DevelopWasmEngine } from "../src/lib/develop/wasm/engine";

const solved = (patch: Partial<UprightSolution> = {}): UprightSolution => ({
  mode: "vertical",
  applied: "vertical",
  fallback: false,
  roll: 2.5,
  pitch: -11,
  yaw: 0,
  focal: 0.81,
  focalSource: "exif",
  confidence: 0.9,
  guides: [],
  ...patch,
});

function withGeometry(patch: Partial<DevelopSettings["geometry"]>): DevelopSettings {
  const settings = defaultDevelopSettings();
  settings.geometry = { ...settings.geometry, ...patch };
  return settings;
}

describe("Upright settings", () => {
  test("recipes saved before Upright read with a neutral transform", () => {
    const legacy = structuredClone(defaultDevelopSettings()) as Partial<DevelopSettings>;
    delete legacy.geometry;
    const read = readDevelopSettings(legacy);
    expect(read.geometry).toEqual(defaultDevelopGeometry());
    expect(isNeutralDevelopRecipe(read)).toBe(true);
  });

  test("mode, sliders, guides and the solved camera round-trip through a saved document", () => {
    const settings = withGeometry({
      upright: "guided",
      vertical: -12,
      horizontal: 7,
      rotate: -1.5,
      aspect: 20,
      scale: 110,
      xOffset: -4,
      yOffset: 3,
      constrainCrop: true,
      guides: [
        { x1: 0.2, y1: 0.1, x2: 0.22, y2: 0.9 },
        { x1: 0.8, y1: 0.12, x2: 0.77, y2: 0.88 },
      ],
      solved: solved({ mode: "guided", applied: "guided", focalSource: "guided" }),
    });
    settings.geometry.solved!.guides = settings.geometry.guides.map((g) => ({ ...g }));
    const json = JSON.parse(JSON.stringify(settings));
    expect(developSettingsSchema.parse(json)).toEqual(settings);
    const recipe = currentRecipe(createDevelopDocument("upright-photo", settings));
    expect(recipe.geometry).toEqual(settings.geometry);
  });

  test("out-of-range values and a fifth guide are rejected", () => {
    const guide = { x1: 0.1, y1: 0.1, x2: 0.1, y2: 0.9 };
    for (const bad of [
      { rotate: 10.5 },
      { scale: 49 },
      { vertical: 101 },
      { guides: [guide, guide, guide, guide, guide] },
      { guides: [{ ...guide, x2: 1.2 }] },
      { solved: solved({ pitch: 46 }) },
    ])
      expect(developSettingsSchema.safeParse(withGeometry(bad)).success).toBe(false);
  });

  test("a solution only applies to the mode and guides it was measured for", () => {
    const geometry = {
      ...defaultDevelopGeometry(),
      upright: "vertical" as const,
      solved: solved(),
    };
    expect(currentUprightSolution(geometry)).toEqual(solved());
    expect(uprightNeedsSolve(geometry)).toBe(false);
    expect(currentUprightSolution({ ...geometry, upright: "full" })).toBeNull();
    expect(uprightNeedsSolve({ ...geometry, upright: "full" })).toBe(true);
    expect(uprightNeedsSolve({ ...geometry, upright: "off" })).toBe(false);
    const guide = { x1: 0.3, y1: 0.1, x2: 0.32, y2: 0.9 };
    const guided = {
      ...geometry,
      upright: "guided" as const,
      guides: [guide],
      solved: solved({ mode: "guided", applied: "guided", guides: [guide] }),
    };
    expect(currentUprightSolution(guided)).not.toBeNull();
    expect(currentUprightSolution({ ...guided, guides: [{ ...guide, x2: 0.4 }] })).toBeNull();
    // Guided without guides has nothing to measure yet.
    expect(uprightNeedsSolve({ ...guided, guides: [] })).toBe(false);
  });

  test("the engine line carries 13 values in protocol order, and nothing when neutral", () => {
    expect(uprightTransformValues(defaultDevelopGeometry())).toBeNull();
    expect(uprightProtocolLine(defaultDevelopGeometry())).toBe("");
    // Constrain Crop alone moves no pixel.
    expect(uprightTransformValues({ ...defaultDevelopGeometry(), constrainCrop: true })).toBeNull();
    // A stale solution is not rendered.
    expect(
      uprightTransformValues({ ...defaultDevelopGeometry(), upright: "full", solved: solved() }),
    ).toBeNull();
    const geometry = {
      ...defaultDevelopGeometry(),
      upright: "vertical" as const,
      solved: solved(),
      scale: 105,
      constrainCrop: true,
    };
    expect(uprightTransformValues(geometry)).toEqual([
      2.5, -11, 0, 0.81, 0, 0, 0, 0, 0, 105, 0, 0, 1,
    ]);
    expect(uprightProtocolLine(geometry)).toBe("UPRIGHT_1 2.5 -11 0 0.81 0 0 0 0 0 105 0 0 1\n");
    expect(uprightTransformValues({ ...defaultDevelopGeometry(), xOffset: -0 })).toBeNull();
  });

  test("an active transform is not neutral, needs the C++ engine and stays out of presets", () => {
    const settings = withGeometry({ vertical: -20 });
    expect(isNeutralDevelopRecipe(settings)).toBe(false);
    expect(unsupportedBrowserDevelopEdits(settings)).toContain("Upright");
    settings.exposure = 0.4;
    const pack = createPresetPackage({ title: "Look" }, settings);
    expect(pack.settings.geometry).toEqual(defaultDevelopGeometry());
    expect(pack.settings.exposure).toBe(0.4);
    const text = JSON.stringify({ ...pack, settings: withGeometry({ rotate: 2 }) });
    expect(() => parsePresetPackage(text)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// The committed WebAssembly engine, measuring a scene with known geometry.
const binary = readFileSync(
  new URL("../src/lib/develop/wasm/celinen-develop.wasm", import.meta.url),
);
let engine: DevelopWasmEngine;
beforeAll(async () => {
  engine = await instantiateDevelopWasm(binary);
});

const degree = Math.PI / 180;
/** A facade of windows seen by a camera with roll/pitch (degrees), 35mm-equivalent focal. */
function facade(width: number, height: number, roll: number, pitch: number) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const f = (35 / Math.hypot(36, 24)) * Math.hypot(width, height);
  const cr = Math.cos(-roll * degree),
    sr = Math.sin(-roll * degree),
    cp = Math.cos(-pitch * degree),
    sp = Math.sin(-pitch * degree);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let sy = 0; sy < 2; sy++)
        for (let sx = 0; sx < 2; sx++) {
          const px = (x + (sx + 0.5) / 2 - width / 2) / f,
            py = (y + (sy + 0.5) / 2 - height / 2) / f;
          const x1 = cr * px - sr * py,
            y1 = sr * px + cr * py;
          const dy = cp * y1 - sp,
            dz = sp * y1 + cp;
          let value = dy < 0 ? 0.85 : 0.4;
          if (dz > 0) {
            const t = 14 / dz,
              wx = x1 * t + 20,
              wy = dy * t + 30;
            if (wx > 0 && wx < 40 && wy > 0 && wy < 33) {
              const u = wx % 2.4,
                v = wy % 3;
              value = u > 0.6 && u < 1.8 && v > 0.8 && v < 2.4 ? 0.18 : 0.62;
            }
          }
          sum += value;
        }
      const i = (y * width + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = Math.round((sum / 4) * 255);
      rgba[i + 3] = 255;
    }
  return rgba;
}

describe("Upright in the WebAssembly engine", () => {
  const W = 720,
    H = 480;
  const pixels = facade(W, H, 3, -12);

  test("measures roll and pitch of a keystoned facade", () => {
    engine.source(W, H).set(pixels);
    const started = performance.now();
    const vertical = engine.solveUpright({ mode: "vertical", guides: [] });
    const elapsed = performance.now() - started;
    expect(vertical.applied).toBe("vertical");
    expect(vertical.fallback).toBe(false);
    expect(Math.abs(vertical.roll - 3)).toBeLessThan(0.4);
    expect(Math.abs(vertical.pitch + 12)).toBeLessThan(0.8);
    expect(vertical.confidence).toBeGreaterThan(0.5);
    expect(vertical.focalSource).toBe("default");
    expect(elapsed).toBeLessThan(1000);
    const level = engine.solveUpright({ mode: "level", guides: [] });
    expect(level.applied).toBe("level");
    expect(level.pitch).toBe(0);
    expect(Math.abs(level.roll - 3)).toBeLessThan(0.5);
  });

  test("EXIF bytes set the focal length", () => {
    engine.source(W, H).set(pixels);
    // Minimal JPEG APP1 with FocalLengthIn35mmFilm = 50 in the Exif IFD.
    const tiff = [
      0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x69, 0x87, 4, 0, 1, 0, 0, 0, 26, 0, 0, 0, 0, 0, 0, 0, 1,
      0, 0x05, 0xa4, 3, 0, 1, 0, 0, 0, 50, 0, 0, 0, 0, 0, 0, 0,
    ];
    const exif = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xe1,
      0,
      tiff.length + 8,
      0x45,
      0x78,
      0x69,
      0x66,
      0,
      0,
      ...tiff,
      0xff,
      0xd9,
    ]);
    const solution = engine.solveUpright({ mode: "vertical", guides: [] }, exif);
    expect(solution.focalSource).toBe("exif");
    expect(solution.focal).toBeCloseTo(50 / Math.hypot(36, 24), 9);
  });

  test("a flat frame gets no correction and guides solve without pixels to read", () => {
    engine.source(64, 64).set(new Uint8ClampedArray(64 * 64 * 4).fill(128));
    const flat = engine.solveUpright({ mode: "auto", guides: [] });
    expect(flat.applied).toBe("off");
    expect(flat.confidence).toBe(0);
    const guided = engine.solveUpright({
      mode: "guided",
      guides: [{ x1: 0.3, y1: 0.1, x2: 0.36, y2: 0.9 }],
    });
    expect(guided.applied).toBe("guided");
    expect(guided.pitch).toBe(0);
    expect(guided.roll).toBeLessThan(0);
    expect(guided.guides).toHaveLength(1);
  });

  test("develop renders through the solved transform, and a neutral transform matches the plain path", () => {
    engine.source(W, H).set(pixels);
    const vertical = engine.solveUpright({ mode: "vertical", guides: [] });
    const plain = engine.develop(defaultDevelopSettings());
    expect([...plain.rgba.subarray(0, 4000)]).toEqual([...pixels.subarray(0, 4000)]);
    const corrected = withGeometry({ upright: "vertical", solved: vertical });
    const out = engine.develop(corrected);
    expect([out.width, out.height]).toEqual([W, H]);
    let changed = 0;
    for (let i = 0; i < out.rgba.length; i += 4) if (out.rgba[i] !== pixels[i]) changed++;
    expect(changed).toBeGreaterThan((W * H) / 10);
    // The cached warp is reused for a tone-only change and matches a fresh render.
    const brighter = { ...corrected, exposure: 0.3 };
    const cachedRender = engine.develop(brighter);
    engine.source(W, H).set(pixels);
    const freshRender = engine.develop(brighter);
    expect(Buffer.from(cachedRender.rgba).equals(Buffer.from(freshRender.rgba))).toBe(true);
    // Constrain Crop leaves no blank white corner.
    const cropped = engine.develop({
      ...corrected,
      geometry: { ...corrected.geometry, constrainCrop: true },
    });
    const corner = (image: typeof out, x: number, y: number) => image.rgba[(y * W + x) * 4]!;
    expect(corner(out, 1, 1) === 255 || corner(out, W - 2, 1) === 255).toBe(true);
    expect([corner(cropped, 1, 1), corner(cropped, W - 2, 1)]).not.toContain(255);
  });
});
