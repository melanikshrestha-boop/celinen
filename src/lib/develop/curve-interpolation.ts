export type CurveInterpolation = "linear" | "smooth";
export type CurvePoint = { readonly x: number; readonly y: number };
type Segment = { h: number; a: number; b: number; c: number };
const sameSign = (a: number, b: number) => (a > 0 && b > 0) || (a < 0 && b < 0);
const sign = (value: number) => Number(value > 0) - Number(value < 0);

/** Celinen's PCHIP graph mirror; native rendering uses the same double-precision arithmetic.
 * https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.PchipInterpolator.html
 * No coefficient threshold silently changes tightly spaced, valid control points.
 */
export function createCurveInterpolator(
  input: readonly CurvePoint[],
  requested: CurveInterpolation,
) {
  const points = input.map((point) => ({ ...point }));
  if (
    points.length < 2 ||
    points.length > 16 ||
    points.some(
      (p, i) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < 0 ||
        p.x > 1 ||
        p.y < 0 ||
        p.y > 1 ||
        (i > 0 && p.x <= points[i - 1]!.x),
    )
  )
    throw new RangeError("Curve points must be finite, bounded and ordered.");
  const linear = (v: number) => {
    if (v <= points[0]!.x) return points[0]!.y;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!,
        b = points[i]!;
      if (v <= b.x) return a.y + ((b.y - a.y) * (v - a.x)) / (b.x - a.x);
    }
    return points.at(-1)!.y;
  };
  const fallback = () => ({ mode: "linear" as const, evaluate: linear });
  if (requested !== "smooth" || points.length === 2) return fallback();
  const h: number[] = [],
    d: number[] = [],
    m: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const gap = points[i + 1]!.x - points[i]!.x,
      dy = points[i + 1]!.y - points[i]!.y;
    const slope = dy / gap;
    if (!(gap > 0) || !Number.isFinite(gap) || !Number.isFinite(slope) || (dy !== 0 && slope === 0))
      return fallback();
    h.push(gap);
    d.push(slope);
  }
  for (let i = 1; i < points.length - 1; i++) {
    const before = d[i - 1]!,
      after = d[i]!;
    if (!sameSign(before, after)) {
      m[i] = 0;
      continue;
    }
    const w1 = 2 * h[i]! + h[i - 1]!,
      w2 = h[i]! + 2 * h[i - 1]!;
    const denominator = w1 / before + w2 / after;
    if (!Number.isFinite(denominator) || denominator === 0) return fallback();
    m[i] = (w1 + w2) / denominator;
    if (!Number.isFinite(m[i]) || m[i] === 0) return fallback();
  }
  const endpoint = (h0: number, h1: number, d0: number, d1: number): number | null => {
    const numerator = (2 * h0 + h1) * d0 - h0 * d1;
    let slope = numerator / (h0 + h1);
    if (!Number.isFinite(numerator) || !Number.isFinite(slope)) return null;
    if (sign(slope) !== sign(d0)) slope = 0;
    else if (sign(d0) !== sign(d1) && Math.abs(slope) > 3 * Math.abs(d0)) slope = 3 * d0;
    return Number.isFinite(slope) ? slope : null;
  };
  const first = endpoint(h[0]!, h[1]!, d[0]!, d[1]!);
  const last = endpoint(h.at(-1)!, h.at(-2)!, d.at(-1)!, d.at(-2)!);
  if (first === null || last === null) return fallback();
  m[0] = first;
  m[points.length - 1] = last;
  const segments: Segment[] = [];
  for (let i = 0; i < h.length; i++) {
    const y0 = points[i]!.y,
      y1 = points[i + 1]!.y,
      gap = h[i]!;
    const left = gap * m[i]!,
      right = gap * m[i + 1]!;
    const a = 2 * y0 - 2 * y1 + left + right;
    const b = -3 * y0 + 3 * y1 - 2 * left - right;
    const c = left;
    if (![a, b, c].every(Number.isFinite)) return fallback();
    segments.push({ h: gap, a, b, c });
  }
  return {
    mode: "smooth" as const,
    evaluate(v: number) {
      if (v <= points[0]!.x) return points[0]!.y;
      for (let i = 1; i < points.length; i++) {
        const left = points[i - 1]!,
          right = points[i]!;
        if (v === right.x) return right.y;
        if (v < right.x) {
          const { h: gap, a, b, c } = segments[i - 1]!,
            t = (v - left.x) / gap;
          const y = ((a * t + b) * t + c) * t + left.y;
          return Math.min(Math.max(left.y, right.y), Math.max(Math.min(left.y, right.y), y));
        }
      }
      return points.at(-1)!.y;
    },
  };
}

/** 256 display intervals plus exact knots: even linear corners never cut across a control point. */
export function curveDisplayPath(points: readonly CurvePoint[], mode: CurveInterpolation) {
  const interpolator = createCurveInterpolator(points, mode);
  const samples = [
    ...new Set([...Array.from({ length: 257 }, (_, i) => i / 256), ...points.map((p) => p.x)]),
  ].sort((a, b) => a - b);
  return samples
    .map((x, i) => `${i ? "L" : "M"}${x * 200} ${(1 - interpolator.evaluate(x)) * 200}`)
    .join(" ");
}
