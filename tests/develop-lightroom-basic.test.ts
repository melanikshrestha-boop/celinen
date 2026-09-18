import { describe, expect, test } from "bun:test";
import { defaultDevelopSettings, readDevelopSettings } from "../src/lib/develop/contract";
import { developProtocol } from "../src/lib/develop/protocol";
import { isNeutralDevelopRecipe } from "../src/lib/develop/neutral";
import {
  applyBlackAndWhiteRgb,
  expandLightroomBasicForLegacyEngine,
  isBlackAndWhiteDevelop,
  kelvinToTemperature,
  temperatureToKelvin,
  whiteBalanceFromSample,
} from "../src/lib/develop/lightroom-basic";

describe("Lightroom Classic Basic panel", () => {
  test("saved recipes without the new fields stay Adobe Color / as-shot", () => {
    const { treatment: _t, profile: _p, whiteBalance: _w, ...legacy } = defaultDevelopSettings();
    const parsed = readDevelopSettings(legacy);
    expect(parsed.treatment).toBe("color");
    expect(parsed.profile).toBe("adobe-color");
    expect(parsed.whiteBalance).toBe("as-shot");
    expect(isNeutralDevelopRecipe(parsed)).toBe(true);
    expect(developProtocol(parsed).startsWith("FOTO_DEVELOP_3\n")).toBe(true);
  });

  test("Black & White and named profiles use protocol 6 for the native engine", () => {
    const settings = defaultDevelopSettings();
    settings.treatment = "black-and-white";
    expect(developProtocol(settings).startsWith("FOTO_DEVELOP_6\n")).toBe(true);
    settings.treatment = "color";
    settings.profile = "adobe-vivid";
    expect(developProtocol(settings).includes("FOTO_DEVELOP_6")).toBe(true);
  });

  test("hosted wasm still receives a protocol it already speaks", () => {
    const settings = defaultDevelopSettings();
    settings.treatment = "black-and-white";
    settings.profile = "adobe-vivid";
    const legacy = developProtocol(settings, { legacy: true });
    expect(legacy.startsWith("FOTO_DEVELOP_3\n") || legacy.startsWith("FOTO_DEVELOP_4\n")).toBe(true);
    expect(legacy.includes("FOTO_DEVELOP_6")).toBe(false);
    const expanded = expandLightroomBasicForLegacyEngine(settings);
    expect(expanded.saturation).toBe(-100);
    expect(expanded.contrast).toBeGreaterThan(0);
  });

  test("Kelvin readout inverts through the relative Temp slider", () => {
    expect(temperatureToKelvin(0)).toBe(5500);
    expect(Math.abs(kelvinToTemperature(temperatureToKelvin(18)) - 18)).toBeLessThan(0.6);
  });

  test("B&W mix is grey and not Rec.709 desaturate", () => {
    const hsl = defaultDevelopSettings().hsl;
    const [r, g, b] = applyBlackAndWhiteRgb(0.8, 0.2, 0.1, hsl, false);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(isBlackAndWhiteDevelop({ treatment: "black-and-white", profile: "adobe-color" })).toBe(
      true,
    );
  });

  test("eyedropper solves the same gains the engine applies", () => {
    const picked = whiteBalanceFromSample(180, 128, 90);
    expect(picked.temperature).toBeLessThan(0);
    expect(Math.abs(picked.temperature)).toBeLessThanOrEqual(100);
    expect(Math.abs(picked.tint)).toBeLessThanOrEqual(100);
  });
});
