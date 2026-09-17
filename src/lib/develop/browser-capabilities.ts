import { readDevelopSettings, type DevelopSettings } from "./contract";
import { lensIsNeutral, parametricIsNeutral } from "./parametric";
import { geometryIsNeutral } from "./upright";

/** Active recipe edits that the hosted renderer cannot reproduce. Inspect a
 * validated copy so capability checks never rewrite saved recipes or presets.
 * Secondary controls are inactive when their parent effect has zero amount.
 */
export function unsupportedBrowserDevelopEdits(settings: DevelopSettings): string[] {
  const s = readDevelopSettings(settings);
  const unsupported: string[] = [];
  const identity = (curve: DevelopSettings["curve"]) =>
    curve.length === 2 &&
    curve[0]!.x === 0 &&
    curve[0]!.y === 0 &&
    curve[1]!.x === 1 &&
    curve[1]!.y === 1;
  if (!identity(s.curve)) unsupported.push("Tone curve");
  if (Object.values(s.channelCurves).some((curve) => !identity(curve)))
    unsupported.push("RGB curves");
  if (s.hsl.some((band) => band.hue !== 0 || band.saturation !== 0 || band.luminance !== 0))
    unsupported.push("Color mixer");
  if (
    [s.grading.shadows, s.grading.midtones, s.grading.highlights, s.grading.global].some(
      (grade) => grade.saturation !== 0 || grade.luminance !== 0,
    )
  )
    unsupported.push("Color grading");
  for (const [field, label] of [
    ["texture", "Texture"],
    ["clarity", "Clarity"],
    ["sharpening", "Sharpening"],
    ["noiseReduction", "Noise reduction"],
    ["colorNoiseReduction", "Color noise reduction"],
    ["grain", "Grain"],
    ["fade", "Fade"],
    ["filmFalloff", "Film falloff"],
    ["vignette", "Vignette"],
    ["bloom", "Bloom"],
    ["halation", "Halation"],
  ] as const) {
    if (s[field] !== 0) unsupported.push(label);
  }
  if (
    s.masks.some(
      (mask) =>
        mask.enabled && (mask.exposure !== 0 || mask.temperature !== 0 || mask.saturation !== 0),
    )
  )
    unsupported.push("Masks");
  if (s.crop.angle !== 0) unsupported.push("Straighten");
  if (!parametricIsNeutral(s.parametricCurve)) unsupported.push("Parametric curve");
  if (!lensIsNeutral(s.lensCorrection)) unsupported.push("Lens correction");
  if (!geometryIsNeutral(s.geometry)) unsupported.push("Upright");
  return unsupported;
}

export function assertBrowserDevelopSettingsSupported(settings: DevelopSettings): void {
  const unsupported = unsupportedBrowserDevelopEdits(settings);
  if (unsupported.length)
    throw new Error(`These edits need the local image engine: ${unsupported.join(", ")}.`);
}
