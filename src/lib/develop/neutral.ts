import { developSettingsSchema, type DevelopSettings } from "./contract";

const effectiveAmounts = [
  "exposure",
  "contrast",
  "highlights",
  "shadows",
  "whites",
  "blacks",
  "temperature",
  "tint",
  "saturation",
  "vibrance",
  "texture",
  "clarity",
  "dehaze",
  "grain",
  "fade",
  "vignette",
  "bloom",
  "halation",
  "filmFalloff",
  "sharpening",
  "noiseReduction",
  "colorNoiseReduction",
] as const satisfies readonly (keyof DevelopSettings)[];

/** Conservative pixel equivalence to the native neutral render, not recipe equality.
 * Validate even inactive fields and never modify the saved recipe. In particular,
 * RAW exposure/temperature/tint are effective before the post-decode pipeline.
 * Keep aligned with native is_neutral_develop: no tolerances or curve simplification.
 */
export function isNeutralDevelopRecipe(input: unknown): boolean {
  const parsed = developSettingsSchema.safeParse(input);
  if (!parsed.success) return false;
  const s = parsed.data;
  if (effectiveAmounts.some((key) => s[key] !== 0)) return false;
  const identity = (curve: DevelopSettings["curve"]) =>
    curve.length === 2 &&
    curve[0]!.x === 0 &&
    curve[0]!.y === 0 &&
    curve[1]!.x === 1 &&
    curve[1]!.y === 1;
  if (![s.curve, ...Object.values(s.channelCurves)].every(identity)) return false;
  if (s.hsl.some((band) => band.hue !== 0 || band.saturation !== 0 || band.luminance !== 0))
    return false;
  if (
    [s.grading.shadows, s.grading.midtones, s.grading.highlights, s.grading.global].some(
      (grade) => grade.saturation !== 0 || grade.luminance !== 0,
    )
  )
    return false;
  if (
    s.masks.some(
      (mask) =>
        mask.enabled && (mask.exposure !== 0 || mask.temperature !== 0 || mask.saturation !== 0),
    )
  )
    return false;
  const c = s.crop;
  return (
    c.x === 0 &&
    c.y === 0 &&
    c.width === 1 &&
    c.height === 1 &&
    c.angle === 0 &&
    c.rotate === 0 &&
    !c.flipX &&
    !c.flipY
  );
}

/** A native neutral Blob is reusable only within its exact render ownership. */
export function canReuseNeutralDevelop({
  neutralBlob,
  owner,
  id,
  source,
  renderKey,
  neutralRecipe,
}: {
  neutralBlob: Blob | null;
  owner: { id: string | null; source: Blob; renderKey: string } | null;
  id: string | null;
  source: Blob;
  renderKey: string;
  neutralRecipe: boolean;
}): boolean {
  return Boolean(
    neutralBlob &&
    neutralBlob.size > 0 &&
    id &&
    owner?.id === id &&
    owner.source === source &&
    owner.renderKey === renderKey &&
    neutralRecipe,
  );
}
