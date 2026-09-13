import { expect, test } from "bun:test";
import { translateLightroomPreset } from "../src/lib/develop/lightroom-preset";
import {
  createPresetPackage,
  exportPresetPackage,
  parsePresetPackage,
} from "../src/lib/develop/preset-package";

const xmp = (attributes: string, children = "") =>
  `<x:xmpmeta xmlns:x="adobe:ns:meta/"><r:RDF xmlns:r="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><r:Description xmlns:a="http://ns.adobe.com/camera-raw-settings/1.0/" ${attributes}>${children}</r:Description></r:RDF></x:xmpmeta>`;
test("native Lightroom import translates supported tone, presence, detail and eight HSL channels", () => {
  const result = translateLightroomPreset(
    xmp(
      'a:Exposure2012="+1.25" a:Whites2012="12" a:Blacks2012="-23" a:Texture="8" a:Clarity2012="9" a:Dehaze="5" a:Vibrance="15" a:Sharpness="60" a:SharpenRadius="1.2" a:SharpenDetail="20" a:SharpenEdgeMasking="50" a:LuminanceSmoothing="18" a:ColorNoiseReduction="25" a:HueAdjustmentOrange="-7" a:SaturationAdjustmentBlue="-16" a:LuminanceAdjustmentMagenta="9"',
    ),
  );
  expect(result.settings).toMatchObject({
    exposure: 1.25,
    whites: 12,
    blacks: -23,
    texture: 8,
    clarity: 9,
    dehaze: 5,
    vibrance: 15,
    sharpening: 60,
    sharpeningRadius: 1.2,
    sharpeningDetail: 20,
    sharpeningMasking: 50,
    noiseReduction: 18,
    colorNoiseReduction: 25,
  });
  expect(result.settings.hsl[1]!.hue).toBe(-7);
  expect(result.settings.hsl[5]!.saturation).toBe(-16);
  expect(result.settings.hsl[7]!.luminance).toBe(9);
  expect(result.mapped).toHaveLength(16);
  expect(result.unsupported).toEqual([]);
});
test("point curves preserve lifted blacks and RGB channel points across package save/reopen", () => {
  const result = translateLightroomPreset(
    xmp(
      "",
      "<a:ToneCurvePV2012><r:Seq><r:li>0, 12</r:li><r:li>100, 90</r:li><r:li>255, 247</r:li></r:Seq></a:ToneCurvePV2012><a:ToneCurvePV2012Red><r:Seq><r:li>0, 0</r:li><r:li>128, 140</r:li><r:li>255, 255</r:li></r:Seq></a:ToneCurvePV2012Red>",
    ),
  );
  expect(result.settings.curve[0]).toEqual({ x: 0, y: 12 / 255 });
  expect(result.settings.channelCurves.red[1]).toEqual({ x: 128 / 255, y: 140 / 255 });
  expect(result.settings.curveInterpolation).toBe("smooth");
  const saved = createPresetPackage({ title: "Imported look" }, result.settings);
  expect(parsePresetPackage(exportPresetPackage(saved)).settings).toEqual(result.settings);
});
test("unreproduced profiles, Kelvin, masks and geometry remain explicit, never silently applied", () => {
  const result = translateLightroomPreset(
    xmp(
      'a:Exposure2012="0" a:Temperature="6200" a:Tint="8" a:CameraProfile="Adobe Color" a:HasCrop="True" a:CropTop="0.2" a:CameraModelRestriction="Model A"',
      "<a:MaskGroupBasedCorrections><r:Seq><r:li>private mask</r:li></r:Seq></a:MaskGroupBasedCorrections>",
    ),
  );
  for (const field of [
    "Temperature",
    "Tint",
    "CameraProfile",
    "HasCrop",
    "CropTop",
    "MaskGroupBasedCorrections",
    "CameraModelRestriction",
  ])
    expect(result.unsupported).toContain(field);
  expect(result.settings.temperature).toBe(0);
  expect(result.settings.tint).toBe(0);
  expect(result.settings.crop.y).toBe(0);
  expect(result.settings.masks).toEqual([]);
  expect(result.warnings[0]).toContain("not a complete Lightroom");
});
test("preset names with escaped ampersands are data, external entities and repeated settings are rejected", () => {
  expect(
    translateLightroomPreset(xmp('a:Exposure2012="0" a:Name="Black &amp; White"')).mapped,
  ).toEqual(["Exposure2012"]);
  for (const input of [
    '<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]>' + xmp('a:Exposure2012="0"'),
    xmp('a:Exposure2012="&external;"'),
    xmp('a:Exposure2012="0"', "<a:Exposure2012>1</a:Exposure2012>"),
    xmp('a:Exposure2012="Infinity"'),
    xmp('a:Texture="101"'),
    xmp('a:Sharpness="150"'),
    xmp(
      'a:Exposure2012="1"',
      "<a:ToneCurvePV2012><r:Seq><r:li>0, 0</r:li><r:li>0, 100</r:li><r:li>255, 255</r:li></r:Seq></a:ToneCurvePV2012>",
    ),
    xmp(
      'a:Exposure2012="1"',
      "<a:ToneCurvePV2012><r:Seq><r:li>0, 0</r:li><r:li>128, NaN</r:li><r:li>255, 255</r:li></r:Seq></a:ToneCurvePV2012>",
    ),
  ])
    expect(() => translateLightroomPreset(input)).toThrow();
});
test("a named Adobe curve without explicit points is disclosed, never replaced silently", () => {
  const result = translateLightroomPreset(
    xmp('a:Exposure2012="0" a:ToneCurveName2012="Strong Contrast"'),
  );
  expect(result.unsupported).toContain("ToneCurveName2012");
  expect(
    result.warnings.some((warning) => warning.includes("ToneCurveName2012 is not imported")),
  ).toBe(true);
});
