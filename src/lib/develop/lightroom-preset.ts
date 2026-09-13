import { readAdobeXmpPresetFields } from "../studio/adobe-paste";
import {
  defaultDevelopSettings,
  developCurveSchema,
  developSettingsSchema,
  DEVELOP_HSL_CHANNELS,
} from "./contract";

/** Explicit semantic translations. Adobe's math/profiles are proprietary and
 * these controls never promise Adobe pixels. Unmapped settings remain visible.
 */
export function translateLightroomPreset(text: string) {
  const fields = readAdobeXmpPresetFields(text);
  const settings = defaultDevelopSettings();
  const mapped = new Set<string>();
  const numeric = (key: string, low: number, high: number) => {
    const value = fields.get(key);
    if (
      value === null ||
      value === undefined ||
      !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())
    )
      throw new Error(`${key} needs one finite decimal value.`);
    const number = Number(value);
    if (!Number.isFinite(number) || number < low || number > high)
      throw new Error(`${key} is outside Celinen's supported range (${low} to ${high}).`);
    mapped.add(key);
    return number;
  };
  const scalar = [
    ["Exposure2012", "exposure", -5, 5],
    ["Contrast2012", "contrast", -100, 100],
    ["Highlights2012", "highlights", -100, 100],
    ["Shadows2012", "shadows", -100, 100],
    ["Whites2012", "whites", -100, 100],
    ["Blacks2012", "blacks", -100, 100],
    ["Saturation", "saturation", -100, 100],
    ["Vibrance", "vibrance", -100, 100],
    ["Texture", "texture", -100, 100],
    ["Clarity2012", "clarity", -100, 100],
    ["Dehaze", "dehaze", -100, 100],
    ["Sharpness", "sharpening", 0, 100],
    ["SharpenRadius", "sharpeningRadius", 0.5, 3],
    ["SharpenDetail", "sharpeningDetail", 0, 100],
    ["SharpenEdgeMasking", "sharpeningMasking", 0, 100],
    ["LuminanceSmoothing", "noiseReduction", 0, 100],
    ["ColorNoiseReduction", "colorNoiseReduction", 0, 100],
  ] as const;
  for (const [key, target, low, high] of scalar)
    if (fields.has(key)) settings[target] = numeric(key, low, high);
  for (const [index, channel] of DEVELOP_HSL_CHANNELS.entries())
    for (const [prefix, target] of [
      ["HueAdjustment", "hue"],
      ["SaturationAdjustment", "saturation"],
      ["LuminanceAdjustment", "luminance"],
    ] as const) {
      const key = prefix + channel;
      if (fields.has(key)) settings.hsl[index]![target] = numeric(key, -100, 100);
    }
  for (const [suffix, channel] of [
    ["", null],
    ["Red", "red"],
    ["Green", "green"],
    ["Blue", "blue"],
  ] as const) {
    const key = `ToneCurvePV2012${suffix}`;
    if (!fields.has(key)) continue;
    const value = fields.get(key);
    if (!value) throw new Error(`${key} needs an RDF point sequence.`);
    const curve = value.split(";").map((point) => {
      const pair = /^\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*$/.exec(point);
      if (!pair) throw new Error(`${key} has an invalid point.`);
      return { x: Number(pair[1]) / 255, y: Number(pair[2]) / 255 };
    });
    const checked = developCurveSchema.parse(curve);
    if (channel) settings.channelCurves[channel] = checked;
    else settings.curve = checked;
    settings.curveInterpolation = "smooth";
    mapped.add(key);
  }
  if (!mapped.size)
    throw new Error("No supported global controls or point curves found in this XMP preset.");
  const descriptive = new Set([
    "Version",
    "ProcessVersion",
    "PresetType",
    "UUID",
    "Name",
    "Group",
    "Description",
    "SupportsAmount",
    "HasSettings",
    "AlreadyApplied",
    "SupportsColor",
    "SupportsMonochrome",
    "SupportsHighDynamicRange",
    "SupportsNormalDynamicRange",
    "SupportsSceneReferred",
    "SupportsOutputReferred",
  ]);
  if (mapped.has("ToneCurvePV2012")) descriptive.add("ToneCurveName2012");
  const unsupported = [...fields.keys()].filter((key) => !mapped.has(key) && !descriptive.has(key));
  const warnings = [
    "Approximate native translation, not a complete Lightroom look or Adobe pixel match.",
    ...(mapped.size
      ? [
          `Translated ${mapped.size} global controls and point curves. Current crop and local masks stay unchanged.`,
        ]
      : []),
    ...unsupported
      .slice(0, 30)
      .map(
        (key) =>
          `${key} is not imported${/Temperature|Tint|WhiteBalance/.test(key) ? ": Adobe Kelvin/white balance is not a relative warmth adjustment" : /Profile|Look|Calibration/.test(key) ? ": Adobe profiles and calibration are not reproduced" : /Mask|Correction|Retouch|Local/.test(key) ? ": local/AI adjustments are not reproduced" : ""}.`,
      ),
    ...(unsupported.length > 30
      ? [`${unsupported.length - 30} additional unsupported fields are not imported.`]
      : []),
  ];
  return {
    settings: developSettingsSchema.parse(settings),
    warnings,
    mapped: [...mapped],
    unsupported,
  };
}
