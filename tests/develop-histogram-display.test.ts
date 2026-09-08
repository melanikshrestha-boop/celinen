import { describe, expect, test } from "bun:test";
import { analyzeDevelopPixels } from "../src/lib/develop/histogram";
import { histogramDisplayBins, histogramHeight } from "../src/lib/develop/histogram-display";

describe("Measured histogram display", () => {
  test("luminance re-binning preserves all measured pixels and does not alter RGB counts", () => {
    const pixels = new Uint8Array(1000 * 4);
    for (let i = 0; i < 1000; i++) pixels.set([i % 256, (i * 31) % 256, (i * 7) % 256, 255], i * 4);
    const data = analyzeDevelopPixels(pixels),
      before = JSON.stringify(data);
    expect(histogramDisplayBins(data, "luminance")[0]!.reduce((a, b) => a + b)).toBe(1000);
    expect(histogramDisplayBins(data, "rgb")).toEqual(data.channels);
    expect(JSON.stringify(data)).toBe(before);
  });
  test("linear is proportional, log is explicit, and empty data never creates peaks", () => {
    expect(histogramHeight(25, 100, "linear")).toBe(0.25);
    expect(histogramHeight(25, 100, "log")).toBeGreaterThan(0.25);
    for (const scale of ["linear", "log"] as const) {
      expect(histogramHeight(0, 0, scale)).toBe(0);
      expect(histogramHeight(100, 100, scale)).toBe(1);
      expect(histogramHeight(NaN, 100, scale)).toBe(0);
    }
    expect(histogramDisplayBins(null, "rgb")).toEqual([]);
  });
});
