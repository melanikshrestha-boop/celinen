import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { defaultDevelopSettings } from "../src/lib/develop/contract";
import { analyzeDevelopPixels } from "../src/lib/develop/histogram";
import { adaptPresetToLight } from "../src/lib/develop/adaptive-preset";
import { reviewLightroomPreset } from "../src/lib/develop/preset-package";

function gray(value: number) {
  return analyzeDevelopPixels(Array.from({ length: 200 }, () => [value, value, value, 255]).flat());
}
test("lighting adapts each source while retaining the authored look and input", () => {
  const preset = { ...defaultDevelopSettings(), exposure: 0.3, temperature: 12, contrast: -8, grain: 18 };
  const before = structuredClone(preset);
  const dark = adaptPresetToLight(preset, gray(60));
  const bright = adaptPresetToLight(preset, gray(210));
  expect(dark.settings.exposure).toBeGreaterThan(preset.exposure);
  expect(bright.settings.exposure).toBeLessThan(preset.exposure);
  for (const value of [dark, bright]) {
    expect({ ...value.settings, exposure: preset.exposure }).toEqual(preset);
    expect(Math.abs(value.adjustment)).toBeLessThanOrEqual(1.001);
  }
  expect(preset).toEqual(before);
  expect(adaptPresetToLight(preset, gray(60))).toEqual(dark);
});
test("extreme or missing pixels do not invent a correction", () => {
  const preset = { ...defaultDevelopSettings(), exposure: -0.7 };
  for (const stats of [gray(0), gray(255), analyzeDevelopPixels([])])
    expect(adaptPresetToLight(preset, stats).settings).toEqual(preset);
});
test("positive correction accounts for preset exposure and cannot exceed source headroom", () => {
  const preset = { ...defaultDevelopSettings(), exposure: 5 };
  expect(adaptPresetToLight(preset, gray(60)).adjustment).toBe(0);
  expect(adaptPresetToLight({ ...preset, exposure: -5 }, gray(210)).settings.exposure).toBe(-5);
});
test("preset UI does not report selection when change rejects the edit", () => {
  const source = readFileSync(new URL("../src/components/develop/DevelopPage.tsx", import.meta.url), "utf8");
  const apply = source.slice(source.indexOf("function applyPreset("), source.indexOf("const sourceStatsReady"));
  expect(apply).toContain("if (accepted)");
  expect(apply).toContain("unsupportedBrowserDevelopEdits(settings)");
  expect(apply).toContain("adaptPresetToLight(preset.settings, sourceHistogram)");
  expect(source).toContain("Adapt presets to light");
});

test("Lightroom XMP review translates only the declared subset and reports losses", () => {
  const xml = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:Exposure2012="0.75" crs:Contrast2012="-12" crs:CameraProfile="Adobe Color" crs:Temperature="5500" /></rdf:RDF></x:xmpmeta>';
  const review = reviewLightroomPreset(xml, "Portrait.xmp");
  expect(review.package.settings.exposure).toBe(0.75);
  expect(review.package.settings.contrast).toBe(-12);
  expect(review.package.settings.temperature).toBe(0);
  expect(review.package.metadata.title).toContain("tone translation");
  expect(review.warnings.join(" ")).toContain("CameraProfile");
  expect(review.warnings.join(" ")).toContain("Temperature");
  expect(() => reviewLightroomPreset("not XML", "bad.xmp")).toThrow();
  expect(() => reviewLightroomPreset(xml.replace('"0.75"', '"NaN"'), "bad.xmp")).toThrow();
});
