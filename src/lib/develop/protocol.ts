/** Text recipe protocol shared by every C++ Develop build: the local executable
 * reads it from a file, the WebAssembly engine from memory. One serializer keeps
 * hosted and local renders on the same validated recipe semantics.
 */
import { developSettingsSchema, type DevelopSettings } from "./contract";
import { transportDevelopSettings } from "./parametric";

export function developProtocol(input: DevelopSettings): string {
  const s = developSettingsSchema.parse(input),
    transported = transportDevelopSettings(s),
    c = transported.crop;
  const extendedDetail =
    s.sharpeningRadius !== 1 || s.sharpeningDetail !== 100 || s.sharpeningMasking !== 0;
  const smoothCurve = s.curveInterpolation === "smooth";
  const lines: Array<string | number[]> = [
    smoothCurve ? "FOTO_DEVELOP_5" : extendedDetail ? "FOTO_DEVELOP_4" : "FOTO_DEVELOP_3",
    [
      s.exposure,
      s.contrast,
      s.highlights,
      s.shadows,
      s.whites,
      s.blacks,
      s.temperature,
      s.tint,
      s.saturation,
      s.vibrance,
      s.texture,
      s.clarity,
      s.dehaze,
    ],
    [transported.curve.length],
    ...transported.curve.map((p) => [p.x, p.y]),
    ...s.hsl.map((h) => [h.hue, h.saturation, h.luminance]),
    ...[s.grading.shadows, s.grading.midtones, s.grading.highlights].map((g) => [
      g.hue,
      g.saturation,
      g.luminance,
    ]),
    [
      s.grading.balance,
      s.grading.blending,
      s.grain,
      s.grainSize,
      s.fade,
      transported.vignette,
      s.bloom,
      s.halation,
      s.sharpening,
      s.noiseReduction,
      s.colorNoiseReduction,
    ],
    [c.x, c.y, c.width, c.height, c.angle, c.rotate, Number(c.flipX), Number(c.flipY)],
    [s.masks.length],
    ...s.masks.map((m) => [
      Number(m.type === "radial"),
      Number(m.enabled),
      m.x,
      m.y,
      m.radius,
      m.aspect,
      m.angle,
      m.feather,
      Number(m.invert),
      m.exposure,
      m.temperature,
      m.saturation,
    ]),
    ...[s.channelCurves.red, s.channelCurves.green, s.channelCurves.blue].flatMap((curve) => [
      [curve.length],
      ...curve.map((point) => [point.x, point.y]),
    ]),
    [s.filmFalloff],
    [
      Number(s.grading.model === "tonal"),
      s.grading.global.hue,
      s.grading.global.saturation,
      s.grading.global.luminance,
      s.grainLuminance,
    ],
  ];
  if (extendedDetail || smoothCurve)
    lines.push([s.sharpeningRadius, s.sharpeningDetail, s.sharpeningMasking]);
  if (smoothCurve) lines.push([1]);
  return lines.map((l) => (typeof l === "string" ? l : l.join(" "))).join("\n") + "\n";
}
