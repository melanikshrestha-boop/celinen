import type { DevelopHistogramData } from "./histogram";

export type HistogramChannel = "rgb" | "luminance";
export type HistogramScale = "linear" | "log";

/** Re-bin measured linear-light luminance onto the displayed sRGB axis. Counts stay counts. */
export function histogramDisplayBins(data: DevelopHistogramData | null, channel: HistogramChannel) {
  if (!data?.pixels) return [];
  if (channel === "rgb") return data.channels;
  const bins = Array<number>(256).fill(0);
  data.luminance.forEach((count, index) => {
    const y = index / (data.luminance.length - 1);
    const encoded = y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055;
    bins[Math.min(255, Math.max(0, Math.round(encoded * 255)))]! += count;
  });
  return [bins];
}

export function histogramHeight(count: number, maximum: number, scale: HistogramScale) {
  if (!Number.isFinite(count) || !Number.isFinite(maximum) || maximum <= 0 || count <= 0) return 0;
  const value = Math.min(count, maximum);
  return scale === "log" ? Math.log1p(value) / Math.log1p(maximum) : value / maximum;
}
