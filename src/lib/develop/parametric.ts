import {
  defaultDevelopSettings,
  type DevelopSettings,
} from "./contract";
import { createCurveInterpolator, type CurvePoint } from "./curve-interpolation";

export type ParametricRegions = {
  highlights: number;
  lights: number;
  darks: number;
  shadows: number;
};

function clamp01(value: number) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function clampSigned(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Raised cosine bump. Zero outside [left, right], one at center. */
function regionWeight(x: number, left: number, center: number, right: number) {
  if (x <= left || x >= right) return 0;
  const t = x < center ? (x - left) / (center - left || 1) : (right - x) / (right - center || 1);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

/** Lightroom-style region weights on the input axis. */
export function parametricOffset(x: number, regions: ParametricRegions) {
  const shadows = regionWeight(x, -0.05, 0, 0.35);
  const darks = regionWeight(x, 0, 0.25, 0.55);
  const lights = regionWeight(x, 0.45, 0.75, 1);
  const highlights = regionWeight(x, 0.65, 1, 1.05);
  return (
    (regions.shadows * shadows +
      regions.darks * darks +
      regions.lights * lights +
      regions.highlights * highlights) /
    100
  );
}

export function parametricIsNeutral(regions?: ParametricRegions | null) {
  if (!regions) return true;
  return (
    regions.highlights === 0 && regions.lights === 0 && regions.darks === 0 && regions.shadows === 0
  );
}

export function lensIsNeutral(lens: DevelopSettings["lensCorrection"] | undefined) {
  if (!lens || !lens.enabled) return true;
  if (lens.profile !== "none") return false;
  if (lens.chromaticAberration.enabled) return false;
  if (lens.vignetteCorrection.enabled && lens.vignetteCorrection.amount !== 0) return false;
  const t = lens.transform;
  return (
    t.upright === "off" &&
    t.rotation === 0 &&
    t.aspect === 0 &&
    t.scale === 100 &&
    t.x === 0 &&
    t.y === 0
  );
}

/** Compose parametric regions onto the canonical point curve. Zeros return the same knots. */
export function bakeParametricCurve(
  curve: readonly CurvePoint[],
  regions?: ParametricRegions | null,
  interpolation: DevelopSettings["curveInterpolation"] = "linear",
): CurvePoint[] {
  if (!regions || parametricIsNeutral(regions)) return curve.map((point) => ({ ...point }));
  const interpolator = createCurveInterpolator(curve, interpolation);
  const samples = [
    ...new Set([0, 0.12, 0.25, 0.38, 0.5, 0.62, 0.75, 0.88, 1, ...curve.map((point) => point.x)]),
  ].sort((a, b) => a - b);
  const baked = samples.map((x) => ({
    x,
    y: clamp01(interpolator.evaluate(x) + parametricOffset(x, regions)),
  }));
  const unique: CurvePoint[] = [];
  for (const point of baked) {
    const previous = unique.at(-1);
    if (previous && point.x <= previous.x) continue;
    unique.push(point);
  }
  if (unique.length < 2) return curve.map((point) => ({ ...point }));
  if (unique.length <= 16) return unique;
  const kept = [unique[0]!];
  const inner = unique.slice(1, -1);
  const budget = 14;
  for (let i = 0; i < budget && i < inner.length; i++) {
    const at = Math.round((i * (inner.length - 1)) / Math.max(1, budget - 1));
    const next = inner[at]!;
    if (kept.at(-1)!.x < next.x) kept.push(next);
  }
  const last = unique.at(-1)!;
  if (kept.at(-1)!.x < last.x) kept.push(last);
  return kept;
}

/** Values the native protocol actually understands. Neutral recipes stay byte-identical. */
export function transportDevelopSettings(settings: DevelopSettings) {
  const parametric = settings.parametricCurve ?? defaultDevelopSettings().parametricCurve;
  const curve = bakeParametricCurve(settings.curve, parametric, settings.curveInterpolation);
  let vignette = settings.vignette;
  const crop = { ...settings.crop };
  const lens = settings.lensCorrection;
  if (lens?.enabled) {
    if (lens.vignetteCorrection.enabled)
      vignette = clampSigned(vignette + lens.vignetteCorrection.amount, -100, 100);
    if (lens.transform.upright === "off" && lens.transform.rotation !== 0)
      crop.angle = clampSigned(crop.angle + lens.transform.rotation, -45, 45);
  }
  return { curve, vignette, crop };
}
