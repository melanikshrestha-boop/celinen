import { describe, expect, test } from "bun:test";
import { defaultDevelopSettings } from "../src/lib/develop/contract";
import {
  bakeParametricCurve,
  lensIsNeutral,
  parametricIsNeutral,
  parametricOffset,
  transportDevelopSettings,
} from "../src/lib/develop/parametric";
import { developProtocol } from "../src/server/native-develop";
import { isNeutralDevelopRecipe } from "../src/lib/develop/neutral";
import { unsupportedBrowserDevelopEdits } from "../src/lib/develop/browser-capabilities";

const identity = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

describe("Parametric curve and lens stay on the canonical recipe", () => {
  test("zero regions keep the same knots so v3 protocol stays byte-identical", () => {
    const settings = defaultDevelopSettings();
    const baked = bakeParametricCurve(settings.curve, settings.parametricCurve);
    expect(baked).toEqual(identity);
    expect(developProtocol(settings)).toBe(developProtocol(defaultDevelopSettings()));
    expect(developProtocol(settings).startsWith("FOTO_DEVELOP_3\n")).toBe(true);
    expect(parametricIsNeutral(settings.parametricCurve)).toBe(true);
    expect(lensIsNeutral(settings.lensCorrection)).toBe(true);
    expect(isNeutralDevelopRecipe(settings)).toBe(true);
  });

  test("shadows lift the toe and highlights hold the shoulder", () => {
    expect(parametricOffset(0, { highlights: 0, lights: 0, darks: 0, shadows: 40 })).toBeGreaterThan(0.2);
    expect(parametricOffset(1, { highlights: -40, lights: 0, darks: 0, shadows: 0 })).toBeLessThan(-0.2);
    const lifted = bakeParametricCurve(identity, {
      highlights: 0,
      lights: 0,
      darks: 0,
      shadows: 40,
    });
    expect(lifted.length).toBeGreaterThan(2);
    expect(lifted[0]!.y).toBeGreaterThan(0);
    expect(lifted.at(-1)!.y).toBeCloseTo(1, 5);
    const held = bakeParametricCurve(identity, {
      highlights: -30,
      lights: 0,
      darks: 0,
      shadows: 0,
    });
    expect(held.at(-1)!.y).toBeLessThan(1);
  });

  test("transport bakes parametric into the curve the engine already understands", () => {
    const settings = defaultDevelopSettings();
    settings.parametricCurve = {
      ...settings.parametricCurve,
      darks: 25,
      shadows: 15,
    };
    const transported = transportDevelopSettings(settings);
    expect(settings.curve).toEqual(identity);
    expect(transported.curve.some((point) => point.y !== point.x)).toBe(true);
    const protocol = developProtocol(settings);
    expect(protocol.startsWith("FOTO_DEVELOP_3\n")).toBe(true);
    expect(protocol).not.toBe(developProtocol(defaultDevelopSettings()));
    expect(isNeutralDevelopRecipe(settings)).toBe(false);
    expect(unsupportedBrowserDevelopEdits(settings)).toContain("Parametric curve");
  });

  test("lens vignette and rotation ride existing vignette and crop fields", () => {
    const settings = defaultDevelopSettings();
    settings.lensCorrection = {
      ...settings.lensCorrection,
      enabled: true,
      vignetteCorrection: { enabled: true, amount: -20 },
      transform: { ...settings.lensCorrection.transform, rotation: 4 },
    };
    const transported = transportDevelopSettings(settings);
    expect(settings.vignette).toBe(0);
    expect(settings.crop.angle).toBe(0);
    expect(transported.vignette).toBe(-20);
    expect(transported.crop.angle).toBe(4);
    expect(isNeutralDevelopRecipe(settings)).toBe(false);
    expect(unsupportedBrowserDevelopEdits(settings)).toContain("Lens correction");
    expect(lensIsNeutral(defaultDevelopSettings().lensCorrection)).toBe(true);
  });
});
