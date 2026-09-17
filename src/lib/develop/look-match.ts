/** Match a look: the page-side contract for native/src/look_match.cpp.
 * An inspiration photo becomes a fixed-length descriptor once; every target
 * photo then gets its own solved recipe from its own pixels. Pure functions
 * only, so the worker, the page and the tests share one mapping.
 */
import { cloneDevelopSettings, developSettingsSchema, type DevelopSettings } from "./contract";

/** native look_descriptor_size: [version, size, ...94 statistics]. */
export const LOOK_DESCRIPTOR_SIZE = 96;
export const LOOK_DESCRIPTOR_VERSION = 1;
/** native celinen_look_match result layout length. */
export const LOOK_RESULT_SIZE = 97;
/** Both inspirations and photos are decoded at this long edge for matching. */
export const LOOK_SOURCE_EDGE = 1024;
export const LOOK_MAX_INSPIRATIONS = 16;

/** A measured inspiration. The numbers are the engine's; the page only stores them. */
export type LookDescriptor = Float64Array<ArrayBuffer>;

export type LookMatchResult = {
  /** False when the photo has no tonal range to match. */
  applicable: boolean;
  /** Weighted descriptor distance of the solved recipe, roughly CIELAB units. */
  distance: number;
  evaluations: number;
  renders: number;
  settings: DevelopSettings;
};

export function isLookDescriptor(value: unknown): value is LookDescriptor {
  return (
    value instanceof Float64Array &&
    value.length === LOOK_DESCRIPTOR_SIZE &&
    value[0] === LOOK_DESCRIPTOR_VERSION &&
    value[1] === LOOK_DESCRIPTOR_SIZE &&
    value.every(Number.isFinite)
  );
}

/** Slider precision. toFixed removes the binary residue of `k * 0.01` so a
 * slider shows 0.35, never 0.35000000000000003; `+ 0` folds negative zero. */
const round = (value: number, step = 1) => {
  const decimals = step < 1 ? Math.ceil(-Math.log10(step)) : 0;
  return Number((Math.round(value / step) * step).toFixed(decimals)) + 0;
};

/** Apply the engine's solved controls to `current`. Everything a look never
 * touches stays exactly as it was: crop, masks, lens corrections, texture,
 * sharpening and noise reduction. Throws when the engine's numbers do not form
 * a valid recipe.
 */
export function lookMatchResult(
  current: DevelopSettings,
  values: ArrayLike<number>,
): LookMatchResult {
  if (values.length !== LOOK_RESULT_SIZE) throw new Error("Invalid look match result.");
  const v = Array.from(values, (value) => value + 0);
  if (!v.every(Number.isFinite)) throw new Error("Invalid look match result.");
  const base = cloneDevelopSettings(current);
  const applicable = v[0] === 1;
  const summary = { applicable, distance: v[1]!, evaluations: v[2]!, renders: v[3]! };
  if (!applicable) return { ...summary, settings: base };

  let at = 4;
  const next = () => v[at++]!;
  const [exposure, contrast, highlights, shadows, whites, blacks, temperature, tint] = [
    next(),
    next(),
    next(),
    next(),
    next(),
    next(),
    next(),
    next(),
  ];
  const [saturation, vibrance, clarity, dehaze] = [next(), next(), next(), next()];
  const count = next();
  const curve = Array.from({ length: 16 }, () => ({ x: next(), y: next() })).slice(0, count);
  const hsl = Array.from({ length: 8 }, () => ({
    hue: next(),
    saturation: next(),
    luminance: next(),
  }));
  const grade = () => ({ hue: next(), saturation: next(), luminance: next() });
  const [shadowGrade, midtoneGrade, highlightGrade, globalGrade] = [
    grade(),
    grade(),
    grade(),
    grade(),
  ];
  const [balance, blending, tonal] = [next(), next(), next()];
  const [grain, grainSize, grainLuminance, fade, vignette, bloom, halation, filmFalloff, smooth] = [
    next(),
    next(),
    next(),
    next(),
    next(),
    next(),
    next(),
    next(),
    next(),
  ];

  // The engine solved against the transported recipe, where an enabled lens
  // vignette correction is already folded into Vignette. Keep that correction
  // and store only the remainder in the look's own slider.
  const lens = base.lensCorrection;
  const lensVignette =
    lens.enabled && lens.vignetteCorrection.enabled ? lens.vignetteCorrection.amount : 0;

  const settings = developSettingsSchema.parse({
    ...base,
    exposure: round(exposure, 0.01),
    contrast: round(contrast),
    highlights: round(highlights),
    shadows: round(shadows),
    whites: round(whites),
    blacks: round(blacks),
    temperature: round(temperature),
    tint: round(tint),
    saturation: round(saturation),
    vibrance: round(vibrance),
    clarity: round(clarity),
    dehaze: round(dehaze),
    // Nine solved knots; their precision is the solve's, not a slider's.
    curve: curve.map((point) => ({ x: point.x, y: Math.min(1, Math.max(0, point.y)) })),
    curveInterpolation: smooth === 1 ? "smooth" : "linear",
    channelCurves: {
      red: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      green: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      blue: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    },
    // The parametric regions are baked into the point curve before rendering;
    // the solved curve already is the whole tone curve.
    parametricCurve: { ...base.parametricCurve, highlights: 0, lights: 0, darks: 0, shadows: 0 },
    hsl: hsl.map((band) => ({
      hue: round(band.hue),
      saturation: round(band.saturation),
      luminance: round(band.luminance),
    })),
    grading: {
      model: tonal === 1 ? "tonal" : "legacy",
      shadows: roundGrade(shadowGrade),
      midtones: roundGrade(midtoneGrade),
      highlights: roundGrade(highlightGrade),
      global: roundGrade(globalGrade),
      balance: round(balance),
      blending: round(blending),
    },
    grain: round(grain),
    grainSize: round(grainSize, 0.1),
    grainLuminance: round(grainLuminance),
    fade: round(fade),
    filmFalloff: round(filmFalloff),
    vignette: Math.min(100, Math.max(-100, round(vignette - lensVignette))),
    bloom: round(bloom),
    halation: round(halation),
  });
  return { ...summary, settings };
}

function roundGrade(grade: { hue: number; saturation: number; luminance: number }) {
  return {
    hue: Math.min(360, Math.max(0, round(grade.hue))),
    saturation: Math.min(100, Math.max(0, round(grade.saturation))),
    luminance: round(grade.luminance),
  };
}

/** Tutor paths whose value a look changed, in the order the panels read, so
 * Clicky can visit each control the match moved.
 */
export function lookChangedControls(before: DevelopSettings, after: DevelopSettings): string[] {
  const paths: string[] = [];
  const scalar = [
    "temperature",
    "tint",
    "exposure",
    "contrast",
    "highlights",
    "shadows",
    "whites",
    "blacks",
    "clarity",
    "dehaze",
    "vibrance",
    "saturation",
  ] as const;
  for (const key of scalar)
    if (before[key] !== after[key]) paths.push(key === "temperature" ? "temp" : key);
  if (JSON.stringify(before.curve) !== JSON.stringify(after.curve)) paths.push("curve.mid");
  const bands = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"] as const;
  bands.forEach((name, index) => {
    const a = before.hsl[index]!,
      b = after.hsl[index]!;
    if (a.saturation !== b.saturation) paths.push(`hsl.${name}.sat`);
    else if (a.hue !== b.hue) paths.push(`hsl.${name}.hue`);
    else if (a.luminance !== b.luminance) paths.push(`hsl.${name}.luminance`);
  });
  for (const range of ["shadows", "midtones", "highlights"] as const) {
    const a = before.grading[range],
      b = after.grading[range];
    if (a.hue !== b.hue || a.saturation !== b.saturation) paths.push(`wheel.${range}.sat`);
  }
  for (const key of ["grain", "fade", "vignette"] as const)
    if (before[key] !== after[key]) paths.push(key);
  return paths;
}
