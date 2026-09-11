import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { analyzeDevelopPixels } from "../src/lib/develop/histogram";
import {
  histogramDisplayBins,
  histogramDisplayPaths,
  histogramHeight,
} from "../src/lib/develop/histogram-display";

describe("Measured histogram display", () => {
  test("an exact grayscale ramp has one measured pixel in every luminance bin", () => {
    const pixels = new Uint8Array(256 * 4);
    for (let value = 0; value < 256; value++) pixels.set([value, value, value, 255], value * 4);
    const data = analyzeDevelopPixels(pixels);
    expect(histogramDisplayBins(data, "luminance")[0]).toEqual(Array(256).fill(1));
  });
  test("luminance display preserves all measured pixels and does not alter RGB counts", () => {
    const pixels = new Uint8Array(1000 * 4);
    for (let i = 0; i < 1000; i++) pixels.set([i % 256, (i * 31) % 256, (i * 7) % 256, 255], i * 4);
    const data = analyzeDevelopPixels(pixels),
      before = JSON.stringify(data);
    expect(histogramDisplayBins(data, "luminance")[0]!.reduce((a, b) => a + b)).toBe(1000);
    expect(histogramDisplayBins(data, "rgb")).toEqual(data.channels);
    expect(histogramDisplayBins(data, "red")[0]).toBe(data.channels[0]);
    expect(histogramDisplayBins(data, "green")[0]).toBe(data.channels[1]);
    expect(histogramDisplayBins(data, "blue")[0]).toBe(data.channels[2]);
    expect(histogramDisplayBins(data, "luminance")[0]).toBe(data.encodedLuminance);
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
    expect(histogramDisplayPaths(null, "rgb", "linear")).toEqual([]);
    const data = analyzeDevelopPixels(new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]));
    for (const scale of ["linear", "log"] as const) {
      const paths = histogramDisplayPaths(data, "rgb", scale);
      expect(paths).toHaveLength(3);
      expect(paths[0]).toStartWith("M0 74 L0 4 ");
      expect(paths[0]).toEndWith("L256 4 L256 74Z");
      expect(paths.join("")).not.toMatch(/NaN|Infinity/);
    }
  });
});

test("actual histogram handlers preserve history, provenance and cached geometry", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(new URL("./develop-histogram-lifecycle.fixture.ts", import.meta.url)),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [output, errors, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(errors).toBe("");
  expect(code).toBe(0);
  expect(JSON.parse(output).passed).toBeGreaterThanOrEqual(18);
});
