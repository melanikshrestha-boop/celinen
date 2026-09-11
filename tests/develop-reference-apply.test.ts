import { expect, test } from "bun:test";
import { defaultDevelopSettings } from "../src/lib/develop/contract";
import { applyReferenceLook } from "../src/lib/develop/reference-apply";

test("reference look explicitly replaces global treatment but preserves independent detail and geometry", () => {
  const current = {
    ...defaultDevelopSettings(),
    exposure: 2,
    temperature: 20,
    grain: 30,
    grainSize: 2,
    grainLuminance: 80,
    noiseReduction: 75,
    colorNoiseReduction: 22,
    sharpening: 10,
  };
  current.crop = { ...current.crop, x: 0.1, width: 0.8 };
  const fitted = { ...defaultDevelopSettings(), contrast: 17, shadows: 13 };
  const merged = applyReferenceLook(current, fitted);
  for (const key of [
    "grain",
    "grainSize",
    "grainLuminance",
    "noiseReduction",
    "colorNoiseReduction",
    "sharpening",
    "crop",
    "masks",
  ] as const)
    expect(merged[key]).toEqual(current[key]);
  expect(merged.exposure).toBe(0);
  expect(merged.temperature).toBe(0);
  expect(merged.contrast).toBe(17);
  expect(merged.shadows).toBe(13);
  merged.crop.x = 0;
  expect(current.crop.x).toBe(0.1);
  expect(fitted.grain).toBe(0);
});
