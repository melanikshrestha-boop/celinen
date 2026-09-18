/** Lightroom Classic Basic-panel reverse-engineering (Process Version 2012+).
 * Adobe Color is identity in this JPEG/sRGB working space — the file is already
 * rendered. Other profiles are relative looks. B&W is a channel mix, not Saturation -100.
 */
import type { DevelopSettings } from "./contract";

export const DEVELOP_PROFILES = [
  { id: "adobe-color", label: "Adobe Color" },
  { id: "adobe-landscape", label: "Adobe Landscape" },
  { id: "adobe-portrait", label: "Adobe Portrait" },
  { id: "adobe-neutral", label: "Adobe Neutral" },
  { id: "adobe-vivid", label: "Adobe Vivid" },
  { id: "adobe-monochrome", label: "Adobe Monochrome" },
] as const;
export type DevelopProfile = (typeof DEVELOP_PROFILES)[number]["id"];

export const DEVELOP_WHITE_BALANCE = [
  { id: "as-shot", label: "As Shot" },
  { id: "auto", label: "Auto" },
  { id: "daylight", label: "Daylight" },
  { id: "cloudy", label: "Cloudy" },
  { id: "shade", label: "Shade" },
  { id: "tungsten", label: "Tungsten" },
  { id: "fluorescent", label: "Fluorescent" },
  { id: "flash", label: "Flash" },
  { id: "custom", label: "Custom" },
] as const;
export type DevelopWhiteBalance = (typeof DEVELOP_WHITE_BALANCE)[number]["id"];

export const DEVELOP_PROFILE_IDS = DEVELOP_PROFILES.map((p) => p.id);
export const DEVELOP_WHITE_BALANCE_IDS = DEVELOP_WHITE_BALANCE.map((p) => p.id);

/** Relative Temp/Tint written when a named WB preset is chosen. Auto is measured. */
export const DEVELOP_WHITE_BALANCE_PRESETS: Record<
  Exclude<DevelopWhiteBalance, "auto" | "custom">,
  { temperature: number; tint: number }
> = {
  "as-shot": { temperature: 0, tint: 0 },
  daylight: { temperature: 0, tint: 10 },
  cloudy: { temperature: 18, tint: 10 },
  shade: { temperature: 32, tint: 10 },
  tungsten: { temperature: -72, tint: 0 },
  fluorescent: { temperature: -42, tint: 21 },
  flash: { temperature: 0, tint: 0 },
};

const PROFILE_INDEX: Record<DevelopProfile, number> = {
  "adobe-color": 0,
  "adobe-landscape": 1,
  "adobe-portrait": 2,
  "adobe-neutral": 3,
  "adobe-vivid": 4,
  "adobe-monochrome": 5,
};
const WHITE_BALANCE_INDEX: Record<DevelopWhiteBalance, number> = {
  "as-shot": 0,
  auto: 1,
  daylight: 2,
  cloudy: 3,
  shade: 4,
  tungsten: 5,
  fluorescent: 6,
  flash: 7,
  custom: 8,
};

export function developProfileIndex(id: DevelopProfile) {
  return PROFILE_INDEX[id];
}
export function developWhiteBalanceIndex(id: DevelopWhiteBalance) {
  return WHITE_BALANCE_INDEX[id];
}
export function developProfileFromIndex(index: number): DevelopProfile {
  return DEVELOP_PROFILES[index]?.id ?? "adobe-color";
}
export function developWhiteBalanceFromIndex(index: number): DevelopWhiteBalance {
  return DEVELOP_WHITE_BALANCE[index]?.id ?? "as-shot";
}

export function isBlackAndWhiteDevelop(settings: Pick<DevelopSettings, "treatment" | "profile">) {
  return settings.treatment === "black-and-white" || settings.profile === "adobe-monochrome";
}

export function isIdentityDevelopProfile(profile: DevelopProfile) {
  return profile === "adobe-color";
}

/** JPEG/as-shot 0 maps to 5500 K, matching Classic's daylight marker. */
export function temperatureToKelvin(temperature: number) {
  return Math.round(5500 * 2 ** (temperature * 0.012));
}
export function kelvinToTemperature(kelvin: number) {
  if (!(kelvin > 0)) return 0;
  return Math.log2(kelvin / 5500) / 0.012;
}

/** Inverse of native `temperature()` so an eyedropper click lands on the same grey. */
export function whiteBalanceFromSample(red: number, green: number, blue: number) {
  const r = Math.max(red, 1) / 255,
    g = Math.max(green, 1) / 255,
    b = Math.max(blue, 1) / 255;
  const lr = Math.log2(r),
    lg = Math.log2(g),
    lb = Math.log2(b);
  return {
    temperature: Math.max(-100, Math.min(100, Math.round((lb - lr) / 0.007))),
    tint: Math.max(-100, Math.min(100, Math.round((2 * lg - lr - lb) / 0.006))),
  };
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function rgbHsl(r: number, g: number, b: number) {
  const high = Math.max(r, g, b),
    low = Math.min(r, g, b);
  const d = high - low,
    light = (high + low) / 2;
  if (d < 1e-9) return { h: 0, s: 0, l: light };
  let h = high === r ? (g - b) / d : high === g ? 2 + (b - r) / d : 4 + (r - g) / d;
  if (h < 0) h += 6;
  return { h: h / 6, s: d / Math.max(1e-9, 1 - Math.abs(2 * light - 1)), l: light };
}
function hslRgb(h: number, s: number, l: number): [number, number, number] {
  h -= Math.floor(h);
  s = clamp01(s);
  l = clamp01(l);
  const c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs(((h * 6) % 2) - 1)),
    m = l - c / 2;
  const sector = Math.min(5, Math.floor(h * 6));
  const colors: Array<[number, number, number]> = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const out = colors[sector]!;
  return [out[0] + m, out[1] + m, out[2] + m];
}

/** Same look as native apply_profile. Adobe Color is a no-op. */
export function applyDevelopProfileRgb(
  r: number,
  g: number,
  b: number,
  profile: DevelopProfile,
): [number, number, number] {
  if (profile === "adobe-color" || profile === "adobe-monochrome") return [r, g, b];
  const color = rgbHsl(r, g, b);
  let { h, s, l } = color;
  const hue = h * 360;
  if (profile === "adobe-landscape") {
    if (hue >= 60 && hue <= 180) s = clamp01(s * 1.14);
    else if (hue > 180 && hue < 270) s = clamp01(s * 1.12);
    l = 0.5 + (l - 0.5) * 1.1;
  } else if (profile === "adobe-portrait") {
    l = 0.5 + (l - 0.5) * 0.92;
    if (hue < 50 || hue > 330) s = clamp01(s * 0.92);
    else if (hue >= 20 && hue <= 55) s = clamp01(s * 0.88);
  } else if (profile === "adobe-neutral") {
    s = clamp01(s * 0.9);
    l = 0.5 + (l - 0.5) * 0.86;
  } else if (profile === "adobe-vivid") {
    s = clamp01(s * 1.18);
    l = 0.5 + (l - 0.5) * 1.14;
  }
  return hslRgb(h, s, clamp01(l));
}

const MIX_CENTERS = [0, 30, 60, 120, 180, 240, 275, 315];

/** Film-weighted mix (not Rec.709 desaturate). HSL luminance acts as Classic's B&W mixers. */
export function applyBlackAndWhiteRgb(
  r: number,
  g: number,
  b: number,
  hsl: DevelopSettings["hsl"],
  monochromeProfile: boolean,
): [number, number, number] {
  const color = rgbHsl(r, g, b);
  const hue = color.h * 360;
  let gain = 1;
  for (let c = 0; c < MIX_CENTERS.length; c++) {
    let distance = Math.abs(hue - MIX_CENTERS[c]!);
    distance = Math.min(distance, 360 - distance);
    const weight = Math.max(0, 1 - distance / 60);
    gain += (weight * (hsl[c]?.luminance ?? 0)) / 100;
  }
  let y = clamp01((0.22 * r + 0.72 * g + 0.06 * b) * gain);
  if (monochromeProfile) y = clamp01(0.5 + (y - 0.5) * 1.12);
  return [y, y, y];
}

export function applyLightroomBasicRgb(
  r: number,
  g: number,
  b: number,
  settings: Pick<DevelopSettings, "treatment" | "profile" | "hsl">,
): [number, number, number] {
  let rgb = applyDevelopProfileRgb(r, g, b, settings.profile);
  if (isBlackAndWhiteDevelop(settings))
    rgb = applyBlackAndWhiteRgb(rgb[0], rgb[1], rgb[2], settings.hsl, settings.profile === "adobe-monochrome");
  return rgb;
}

/** Hosted wasm still speaks protocol ≤5. Expand looks into sliders it already has. */
export function expandLightroomBasicForLegacyEngine(settings: DevelopSettings): DevelopSettings {
  const next = {
    ...settings,
    hsl: settings.hsl.map((band) => ({ ...band })),
  };
  if (settings.profile === "adobe-landscape") {
    next.contrast = clampSigned(next.contrast + 10);
    bumpHslSaturation(next, [2, 3, 4], 18);
    bumpHslSaturation(next, [5], 14);
  } else if (settings.profile === "adobe-portrait") {
    next.contrast = clampSigned(next.contrast - 8);
    bumpHslSaturation(next, [0, 1], -12);
  } else if (settings.profile === "adobe-neutral") {
    next.contrast = clampSigned(next.contrast - 14);
    next.saturation = clampSigned(next.saturation - 10);
  } else if (settings.profile === "adobe-vivid") {
    next.contrast = clampSigned(next.contrast + 14);
    next.saturation = clampSigned(next.saturation + 18);
  } else if (settings.profile === "adobe-monochrome") {
    next.contrast = clampSigned(next.contrast + 12);
  }
  if (isBlackAndWhiteDevelop(settings)) next.saturation = -100;
  return next;
}

function clampSigned(value: number) {
  return Math.max(-100, Math.min(100, value));
}
function bumpHslSaturation(settings: DevelopSettings, channels: number[], delta: number) {
  for (const i of channels) {
    const band = settings.hsl[i];
    if (band) band.saturation = clampSigned(band.saturation + delta);
  }
}

export function applyLightroomBasicRgba(
  rgba: Uint8ClampedArray,
  settings: Pick<DevelopSettings, "treatment" | "profile" | "hsl">,
) {
  if (!isBlackAndWhiteDevelop(settings) && isIdentityDevelopProfile(settings.profile)) return;
  for (let i = 0; i < rgba.length; i += 4) {
    const [r, g, b] = applyLightroomBasicRgb(
      rgba[i]! / 255,
      rgba[i + 1]! / 255,
      rgba[i + 2]! / 255,
      settings,
    );
    rgba[i] = Math.round(r * 255);
    rgba[i + 1] = Math.round(g * 255);
    rgba[i + 2] = Math.round(b * 255);
  }
}
