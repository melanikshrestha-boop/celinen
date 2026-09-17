import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { applyDevelopRgba } from "../src/lib/develop/browser-render";
import { defaultDevelopSettings, type DevelopSettings } from "../src/lib/develop/contract";
import { instantiateDevelopWasm, type DevelopWasmEngine } from "../src/lib/develop/wasm/engine";

// Runs the committed binary: the exact bytes lenslab.dev serves.
const binary = readFileSync(
  new URL("../src/lib/develop/wasm/celinen-develop.wasm", import.meta.url),
);

function fixture(width: number, height: number) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = (x * 17 + y * 3) % 256;
      rgba[i + 1] = (x * 5 + y * 11) % 256;
      rgba[i + 2] = (x * 7 + y * 23) % 256;
      rgba[i + 3] = 255;
    }
  return rgba;
}

let engine: DevelopWasmEngine;
beforeAll(async () => {
  engine = await instantiateDevelopWasm(binary);
});

function develop(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  edit: (s: DevelopSettings) => void,
) {
  const settings = defaultDevelopSettings();
  edit(settings);
  engine.source(width, height).set(pixels);
  return engine.develop(settings);
}

describe("C++ Develop engine compiled to WebAssembly", () => {
  test("reports the native engine version and leaves a neutral recipe pixel-identical", () => {
    expect(engine.version).toBe("lenslabs-cpp-0.1");
    const pixels = fixture(32, 24);
    const out = develop(pixels, 32, 24, () => {});
    expect([out.width, out.height]).toEqual([32, 24]);
    expect([...out.rgba]).toEqual([...pixels]);
  });

  test("matches the script renderer on the basic recipe it was ported from", () => {
    const pixels = fixture(48, 32);
    const edit = (s: DevelopSettings) => {
      s.exposure = 0.65;
      s.contrast = 18;
      s.highlights = -40;
      s.shadows = 35;
      s.whites = 12;
      s.blacks = -9;
      s.temperature = 14;
      s.tint = -6;
      s.dehaze = 10;
      s.vibrance = 22;
      s.saturation = -8;
    };
    const wasm = develop(pixels, 48, 32, edit);
    const script = new Uint8ClampedArray(pixels);
    const settings = defaultDevelopSettings();
    edit(settings);
    applyDevelopRgba(script, 48, 32, settings);
    let worst = 0;
    for (let i = 0; i < script.length; i++)
      worst = Math.max(worst, Math.abs(script[i]! - wasm.rgba[i]!));
    // float (C++) against double (script) intermediates may round one code apart.
    expect(worst).toBeLessThanOrEqual(1);
  });

  test("renders every control the script renderer had to refuse", () => {
    const pixels = fixture(64, 48);
    const edits: [string, (s: DevelopSettings) => void][] = [
      [
        "tone curve",
        (s) =>
          void (s.curve = [
            { x: 0, y: 0 },
            { x: 0.5, y: 0.7 },
            { x: 1, y: 1 },
          ]),
      ],
      [
        "smooth curve",
        (s) => {
          s.curveInterpolation = "smooth";
          s.curve = [
            { x: 0, y: 0 },
            { x: 0.3, y: 0.2 },
            { x: 0.7, y: 0.85 },
            { x: 1, y: 1 },
          ];
        },
      ],
      [
        "red curve",
        (s) =>
          void (s.channelCurves.red = [
            { x: 0, y: 0.1 },
            { x: 1, y: 1 },
          ]),
      ],
      ["color mixer", (s) => void (s.hsl[0]!.saturation = 60)],
      [
        "color grading",
        (s) => {
          s.grading.shadows.hue = 220;
          s.grading.shadows.saturation = 50;
        },
      ],
      ["parametric curve", (s) => void (s.parametricCurve.lights = 40)],
      ["texture", (s) => void (s.texture = 50)],
      ["clarity", (s) => void (s.clarity = 50)],
      [
        "sharpening",
        (s) => {
          s.sharpening = 60;
          s.sharpeningRadius = 1.6;
          s.sharpeningMasking = 40;
        },
      ],
      ["noise reduction", (s) => void (s.noiseReduction = 60)],
      ["color noise", (s) => void (s.colorNoiseReduction = 60)],
      ["grain", (s) => void (s.grain = 40)],
      ["fade", (s) => void (s.fade = 30)],
      ["vignette", (s) => void (s.vignette = -40)],
      ["film falloff", (s) => void (s.filmFalloff = 60)],
      ["bloom", (s) => void (s.bloom = 40)],
      ["halation", (s) => void (s.halation = 40)],
      [
        "mask",
        (s) => {
          s.masks = [
            {
              id: "m",
              name: "Mask",
              enabled: true,
              type: "radial",
              x: 0.5,
              y: 0.5,
              radius: 0.4,
              aspect: 1,
              angle: 0,
              feather: 0.5,
              invert: false,
              exposure: 1,
              temperature: 0,
              saturation: 0,
            },
          ];
        },
      ],
    ];
    for (const [name, edit] of edits) {
      const out = develop(pixels, 64, 48, edit);
      let changed = 0;
      for (let i = 0; i < pixels.length; i++) if (out.rgba[i] !== pixels[i]) changed++;
      expect(changed, name).toBeGreaterThan(0);
      expect([out.width, out.height], name).toEqual([64, 48]);
    }
  });

  test("applies crop, rotate and straighten geometry in C++", () => {
    const pixels = fixture(80, 40);
    const rotated = develop(pixels, 80, 40, (s) => void (s.crop.rotate = 90));
    expect([rotated.width, rotated.height]).toEqual([40, 80]);
    const cropped = develop(pixels, 80, 40, (s) => {
      s.crop = { ...s.crop, x: 0.25, y: 0.25, width: 0.5, height: 0.5, angle: 3 };
    });
    expect([cropped.width, cropped.height]).toEqual([40, 20]);
  });

  test("a rejected request reports why and leaves the engine usable", () => {
    expect(() => engine.source(0, 10)).toThrow("Invalid Develop image.");
    expect(() => engine.source(9000, 10)).toThrow("Invalid Develop image.");
    // A failed load drops the retained source rather than rendering stale pixels.
    expect(() => engine.develop(defaultDevelopSettings())).toThrow("No Develop image is loaded.");
    const pixels = fixture(16, 16);
    expect([...develop(pixels, 16, 16, () => {}).rgba]).toEqual([...pixels]);
  });

  test("the retained source renders many recipes without being resent", () => {
    const pixels = fixture(40, 30);
    engine.source(40, 30).set(pixels);
    const settings = defaultDevelopSettings();
    const seen = new Set<number>();
    for (const exposure of [-1, 0, 1]) {
      settings.exposure = exposure;
      seen.add(engine.develop(settings).rgba[401]!);
    }
    expect(seen.size).toBe(3);
  });

  test("grows memory for an export-sized frame and survives views detaching", () => {
    const width = 4096,
      height = 2731;
    const view = engine.source(width, height);
    for (let i = 0; i < view.length; i += 4) {
      view[i] = view[i + 1] = view[i + 2] = (i >> 2) % 251;
      view[i + 3] = 255;
    }
    const settings = defaultDevelopSettings();
    settings.clarity = 30;
    settings.sharpening = 40;
    const out = engine.develop(settings);
    expect([out.width, out.height]).toEqual([width, height]);
    expect(out.rgba.length).toBe(width * height * 4);
    // A small render afterwards proves the instance is still healthy.
    const pixels = fixture(8, 8);
    expect([...develop(pixels, 8, 8, () => {}).rgba]).toEqual([...pixels]);
  }, 60_000);

  test("measured Auto lifts an underexposed frame inside recipe limits", () => {
    const width = 256,
      height = 64;
    const view = engine.source(width, height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        view[i] = view[i + 1] = view[i + 2] = 8 + Math.floor((112 * x) / (width - 1));
        view[i + 3] = 255;
      }
    const suggestion = engine.suggest();
    expect(suggestion.applicable).toBe(true);
    expect(suggestion.patch.exposure).toBeGreaterThan(0);
    const settings = { ...defaultDevelopSettings(), ...suggestion.patch };
    const before = view[(width / 2) * 4]!;
    expect(engine.develop(settings).rgba[(width / 2) * 4]!).toBeGreaterThan(before);
    for (const value of Object.values(suggestion.patch)) expect(Object.is(value, -0)).toBe(false);
  });

  test("Auto declines a frame with no tonal range", () => {
    engine.source(32, 32).fill(128);
    expect(engine.suggest().applicable).toBe(false);
  });
});
