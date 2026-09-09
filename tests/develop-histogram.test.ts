import { describe, expect, it } from "bun:test";
import { defaultDevelopSettings } from "../src/lib/develop/contract";
import {
  analyzeDevelopPixels,
  clippingPixels,
  histogramPercentile,
  srgbToLinear,
  toneZoneAt,
  adjustHistogramTone,
  suggestDevelopTone,
} from "../src/lib/develop/histogram";

const image = (...colors: number[][]) =>
  new Uint8ClampedArray(colors.flatMap((rgb) => [...rgb, 255]));
describe("Develop histogram from rendered pixels", () => {
  it("counts all 256 RGB bins without smoothing away endpoints", () => {
    const data = image([0, 0, 0], [255, 128, 1], [4, 7, 9]);
    const h = analyzeDevelopPixels(data);
    expect(h.pixels).toBe(3);
    expect(h.shadows).toBe(1);
    expect(h.highlights).toBe(1);
    expect(h.channels[0]![255]).toBe(1);
    expect(h.channels[1]![128]).toBe(1);
    for (const bins of [...h.channels, h.luminance, h.encodedLuminance, h.maximum])
      expect(bins.reduce((a, b) => a + b)).toBe(3);
  });
  it("distinguishes fully black pixels from any-channel shadow clipping", () => {
    const h = analyzeDevelopPixels(
      image([0, 0, 0], [0, 70, 90], [70, 0, 90], [70, 90, 0], [1, 2, 3]),
    );
    expect(h.shadows).toBe(1);
    expect(h.shadowClipped).toBe(4);
    expect(h.highlights).toBe(0);
    expect(analyzeDevelopPixels([0, 0, 0, 0]).shadowClipped).toBe(0);
    // Existing overlays still mark fully black only unless their caller explicitly opts into RGB.
    expect([...clippingPixels(image([0, 70, 90]), true, false)]).toEqual([0, 0, 0, 0]);
  });
  it("encodes exact luminance without changing linear Auto bins, input bytes, or channel counts", () => {
    const data = new Uint8ClampedArray(65536 * 4);
    const expected = Array<number>(256).fill(0);
    const expectedLinear = Array<number>(1024).fill(0);
    let seed = 0x17a9df;
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data[i + c] = seed >>> 24;
      }
      data[i + 3] = 255;
      const y =
        0.2126 * srgbToLinear(data[i]! / 255) +
        0.7152 * srgbToLinear(data[i + 1]! / 255) +
        0.0722 * srgbToLinear(data[i + 2]! / 255);
      const encoded = y <= 0.0031308 ? y * 12.92 : 1.055 * y ** (1 / 2.4) - 0.055;
      expected[Math.round(encoded * 255)]!++;
      expectedLinear[Math.round(y * 1023)]!++;
    }
    const before = data.slice();
    const actual = analyzeDevelopPixels(data);
    expect(actual.encodedLuminance).toEqual(expected);
    expect(actual.luminance).toEqual(expectedLinear);
    expect(actual.pixels).toBe(65536);
    expect(data).toEqual(before);
    for (const bins of actual.channels) expect(bins.reduce((a, b) => a + b)).toBe(65536);
  });
  it("ignores transparent and incomplete pixels", () => {
    expect(analyzeDevelopPixels([255, 255, 255, 0, 2, 3]).pixels).toBe(0);
    expect(analyzeDevelopPixels([]).highlights).toBe(0);
  });
  it("marks any clipped RGB highlight red and fully black shadows blue only when enabled", () => {
    const p = image([0, 0, 0], [255, 2, 2], [254, 254, 254]);
    expect([...clippingPixels(p, true, true)]).toEqual([
      0, 0, 255, 220, 255, 0, 0, 220, 0, 0, 0, 0,
    ]);
    expect([...clippingPixels(p, false, false)]).toEqual(Array(12).fill(0));
    expect([...clippingPixels([0, 0, 0, 0], true, true)]).toEqual([0, 0, 0, 0]);
  });
  it("uses linear-light luminance and percentile endpoints", () => {
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214041, 5);
    expect(srgbToLinear(0.02)).toBeCloseTo(0.02 / 12.92, 8);
    expect(histogramPercentile([0, 1, 1], 0)).toBe(0.5);
    expect(histogramPercentile([0, 1, 1], 1)).toBe(1);
    expect(histogramPercentile([0, 0], 0.5)).toBe(0);
  });
  it("maps five interactive zones and clamps adjustment bounds", () => {
    expect([-1, 0.2, 0.4, 0.6, 0.8, 2].map(toneZoneAt)).toEqual([
      "blacks",
      "shadows",
      "exposure",
      "highlights",
      "whites",
      "whites",
    ]);
    const original = defaultDevelopSettings();
    expect(adjustHistogramTone(original, "exposure", 0.1).exposure).toBe(0.4);
    expect(adjustHistogramTone(original, "highlights", 0.1).highlights).toBe(20);
    expect(adjustHistogramTone(original, "exposure", 10).exposure).toBe(5);
    expect(adjustHistogramTone(original, "blacks", -10).blacks).toBe(-100);
    expect(original.exposure).toBe(0);
  });
});
describe("Explicit adaptive exposure", () => {
  it("gives dark and bright normal-key images different bounded proposals", () => {
    const dark = suggestDevelopTone(analyzeDevelopPixels(image([60, 60, 60])));
    const bright = suggestDevelopTone(analyzeDevelopPixels(image([210, 210, 210])));
    expect(dark.exposure).toBeGreaterThan(0);
    expect(dark.exposure).toBeLessThanOrEqual(1);
    expect(bright.exposure).toBeLessThan(0);
    expect(bright.exposure).toBeGreaterThanOrEqual(-1);
  });
  it("does not brighten into saturated red despite dark luminance", () => {
    const h = analyzeDevelopPixels(image([50, 50, 50], [50, 50, 50], [255, 0, 0]));
    expect(suggestDevelopTone(h).exposure).toBe(0);
    expect(suggestDevelopTone(h).reason).toContain("source highlights");
  });
  it("leaves extreme/empty sources for human judgment", () => {
    for (const rgb of [
      [0, 0, 0],
      [255, 255, 255],
    ])
      expect(suggestDevelopTone(analyzeDevelopPixels(image(rgb))).exposure).toBe(0);
    expect(suggestDevelopTone(analyzeDevelopPixels([])).exposure).toBe(0);
    expect(suggestDevelopTone(analyzeDevelopPixels([])).applicable).toBe(false);
    expect(suggestDevelopTone(analyzeDevelopPixels(image([0, 0, 0]))).applicable).toBe(false);
    expect(suggestDevelopTone(analyzeDevelopPixels(image([255, 255, 255]))).applicable).toBe(false);
  });
  it("is repeatable and finite across 1000 varied source distributions", () => {
    for (let seed = 0; seed < 1000; seed++) {
      const colors = Array.from({ length: 32 }, (_, i) => [
        (seed * 13 + i * 7) % 256,
        (seed * 17 + i * 11) % 256,
        (seed * 19 + i * 5) % 256,
      ]);
      const h = analyzeDevelopPixels(image(...colors));
      const a = suggestDevelopTone(h);
      expect(a).toEqual(suggestDevelopTone(h));
      expect(Number.isFinite(a.exposure)).toBe(true);
      expect(Math.abs(a.exposure)).toBeLessThanOrEqual(1);
      if (a.exposure > 0)
        expect(
          srgbToLinear(histogramPercentile(h.maximum, 0.995)) * Math.pow(2, a.exposure),
        ).toBeLessThanOrEqual(0.9800001);
    }
  });
});
