import type { DevelopHistogramData } from "./histogram";

export type HistogramChannel = "rgb" | "luminance" | "red" | "green" | "blue";
export type HistogramScale = "linear" | "log";

export const histogramChannelLabels: Record<HistogramChannel, string> = {
  rgb: "RGB",
  luminance: "Luminance",
  red: "Red",
  green: "Green",
  blue: "Blue",
};

/** Use measured bins directly. Re-binning rounded linear luminance creates false shadow peaks. */
export function histogramDisplayBins(data: DevelopHistogramData | null, channel: HistogramChannel) {
  if (!data?.pixels) return [];
  if (channel === "rgb") return data.channels;
  if (channel === "luminance") return [data.encodedLuminance];
  return [data.channels[{ red: 0, green: 1, blue: 2 }[channel]]!];
}

export function histogramHeight(count: number, maximum: number, scale: HistogramScale) {
  if (!Number.isFinite(count) || !Number.isFinite(maximum) || maximum <= 0 || count <= 0) return 0;
  const value = Math.min(count, maximum);
  return scale === "log" ? Math.log1p(value) / Math.log1p(maximum) : value / maximum;
}

/** Geometry only changes when measured pixels, channel or explicit scale changes. */
export function histogramDisplayPaths(
  data: DevelopHistogramData | null,
  channel: HistogramChannel,
  scale: HistogramScale,
): string[] {
  const bins = histogramDisplayBins(data, channel);
  let maximum = 1;
  for (const bin of bins) for (const count of bin) if (count > maximum) maximum = count;
  return bins.map(
    (bin) =>
      `M0 74 ${bin.map((count, index) => `L${(index * 256) / 255} ${74 - histogramHeight(count, maximum, scale) * 70}`).join(" ")} L256 74Z`,
  );
}
