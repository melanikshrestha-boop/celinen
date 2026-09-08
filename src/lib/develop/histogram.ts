import type { DevelopSettings } from "./contract";

export type DevelopHistogramData = {
  channels: number[][];
  luminance: number[];
  maximum: number[];
  pixels: number;
  shadows: number;
  highlights: number;
};

export const toneZones = ["blacks", "shadows", "exposure", "highlights", "whites"] as const;
export type ToneZone = (typeof toneZones)[number];
export const toneLabels: Record<ToneZone, string> = {
  blacks: "Blacks",
  shadows: "Shadows",
  exposure: "Exposure",
  highlights: "Highlights",
  whites: "Whites",
};
export const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
export function srgbToLinear(value: number): number {
  const x = clamp(value, 0, 1);
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}
const linear = Array.from({ length: 256 }, (_, n) => srgbToLinear(n / 255));

/** Distribution of the actual sRGB preview, not unbounded sensor RAW data. */
export function analyzeDevelopPixels(data: ArrayLike<number>): DevelopHistogramData {
  const out: DevelopHistogramData = {
    channels: Array.from({ length: 3 }, () => Array<number>(256).fill(0)),
    luminance: Array<number>(1024).fill(0),
    maximum: Array<number>(256).fill(0),
    pixels: 0,
    shadows: 0,
    highlights: 0,
  };
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const r = data[i]!,
      g = data[i + 1]!,
      b = data[i + 2]!;
    out.channels[0]![r]!++;
    out.channels[1]![g]!++;
    out.channels[2]![b]!++;
    const max = Math.max(r, g, b);
    out.maximum[max]!++;
    const y = 0.2126 * linear[r]! + 0.7152 * linear[g]! + 0.0722 * linear[b]!;
    out.luminance[Math.round(y * 1023)]!++;
    out.pixels++;
    if (max === 0) out.shadows++;
    if (max === 255) out.highlights++;
  }
  return out;
}

export function histogramPercentile(bins: number[], fraction: number): number {
  const total = bins.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  const target = Math.max(1, Math.ceil(clamp(fraction, 0, 1) * total));
  let count = 0;
  for (let i = 0; i < bins.length; i++) {
    count += bins[i]!;
    if (count >= target) return i / Math.max(1, bins.length - 1);
  }
  return 1;
}

export function clippingPixels(
  data: ArrayLike<number>,
  shadows: boolean,
  highlights: boolean,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const max = Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
    if (highlights && max === 255) {
      out[i] = 255;
      out[i + 3] = 220;
    } else if (shadows && max === 0) {
      out[i + 2] = 255;
      out[i + 3] = 220;
    }
  }
  return out;
}

export function toneZoneAt(position: number): ToneZone {
  return toneZones[Math.min(4, Math.floor(clamp(position, 0, 1) * 5))]!;
}
export function adjustHistogramTone(
  settings: DevelopSettings,
  zone: ToneZone,
  delta: number,
): DevelopSettings {
  const exposure = zone === "exposure",
    limit = exposure ? 5 : 100;
  const value = clamp(settings[zone] + delta * (exposure ? 4 : 200), -limit, limit);
  return { ...settings, [zone]: Math.round(value * (exposure ? 100 : 1)) / (exposure ? 100 : 1) };
}

export type AdaptiveTone = { exposure: number; applicable: boolean; reason: string };
/** Conservative starting point. Never guesses the artistic intent of a low/high-key photograph. */
export function suggestDevelopTone(stats: DevelopHistogramData): AdaptiveTone {
  if (!stats.pixels)
    return { exposure: 0, applicable: false, reason: "No source pixels available" };
  const median = histogramPercentile(stats.luminance, 0.5);
  if (median < 0.003 || median > 0.9)
    return {
      exposure: 0,
      applicable: false,
      reason: "Extreme lighting: exposure left unchanged for your judgment",
    };
  const desired = clamp(Math.log2(0.18 / median) * 0.65, -1, 1);
  // Exposure clips before downstream tone controls. Protect the brightest channel,
  // allowing only the top 0.5% (e.g. specular reflections) outside the guard.
  const upper = srgbToLinear(histogramPercentile(stats.maximum, 0.995));
  const headroom = upper > 0 ? Math.max(0, Math.log2(0.98 / upper)) : 0;
  const ev = desired > 0 ? Math.min(desired, headroom) : desired;
  return {
    applicable: true,
    exposure: ev > 0 ? Math.floor(ev * 100 + 1e-9) / 100 : Math.round(ev * 100) / 100,
    reason:
      desired > headroom && desired > 0
        ? "Exposure limited by source highlights"
        : "Based on source luminance",
  };
}
