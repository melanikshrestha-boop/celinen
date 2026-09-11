import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  filmstripMountedIndices,
  filmstripScrollToIndex,
  filmstripWindow,
  type FilmstripMetrics,
} from "../src/lib/develop/filmstrip-window";

const metrics = (patch: Partial<FilmstripMetrics> = {}): FilmstripMetrics => ({
  count: 1000,
  viewportWidth: 900,
  scrollLeft: 0,
  itemWidth: 110,
  gap: 2,
  padding: 8,
  ...patch,
});
describe("Bounded logical filmstrip window", () => {
  test("empty, hidden, first and final windows stay within logical photo bounds", () => {
    expect(filmstripWindow(metrics({ count: 0 }))).toMatchObject({
      start: 0,
      end: 0,
      contentWidth: 0,
    });
    expect(filmstripWindow(metrics({ viewportWidth: 0 }))).toMatchObject({ start: 0, end: 0 });
    const first = filmstripWindow(metrics());
    expect(first).toMatchObject({
      start: 0,
      end: 12,
      firstVisible: 0,
      stride: 112,
      contentWidth: 111998,
    });
    const last = filmstripWindow(metrics({ scrollLeft: 999999 }));
    expect(last.end).toBe(1000);
    expect(last.scrollLeft).toBe(last.maxScroll);
    expect(last.start).toBeGreaterThan(980);
    expect(filmstripWindow(metrics({ count: 2 }))).toMatchObject({
      start: 0,
      end: 2,
      contentWidth: 222,
      maxScroll: 0,
    });
    expect(filmstripWindow(metrics({ scrollLeft: -500 }))).toEqual(first);
  });
  test("resizing and mobile sizes retain four neighbors and never mount a whole large library", () => {
    for (const itemWidth of [95, 110])
      for (const viewportWidth of [1, 390, 850, 1440]) {
        for (const scrollLeft of [0, 12, 1000, 25000, 999999]) {
          const input = metrics({ itemWidth, viewportWidth, scrollLeft }),
            window = filmstripWindow(input);
          expect(window.start).toBeGreaterThanOrEqual(0);
          expect(window.end).toBeLessThanOrEqual(input.count);
          expect(window.end - window.start).toBeLessThanOrEqual(
            Math.ceil(viewportWidth / window.stride) + 9,
          );
          expect(window.firstVisible - window.start).toBe(Math.min(4, window.firstVisible));
        }
      }
  });
  test("nearest reveal covers first, middle, last, overscroll and changed widths without upscaling indices", () => {
    for (const itemWidth of [95, 110])
      for (const viewportWidth of [390, 900])
        for (const index of [0, 1, 500, 999]) {
          const input = metrics({ itemWidth, viewportWidth, scrollLeft: 999999 });
          const scroll = filmstripScrollToIndex(input, index),
            window = filmstripWindow({ ...input, scrollLeft: scroll });
          expect(index).toBeGreaterThanOrEqual(window.start);
          expect(index).toBeLessThan(window.end);
          const left = input.padding + index * window.stride;
          expect(left).toBeGreaterThanOrEqual(scroll);
          expect(left + itemWidth).toBeLessThanOrEqual(scroll + viewportWidth);
          expect(filmstripScrollToIndex({ ...input, scrollLeft: scroll }, index)).toBe(scroll);
        }
    for (const index of [-1, 1000, 1.2, NaN])
      expect(filmstripScrollToIndex(metrics({ scrollLeft: 200 }), index)).toBe(200);
  });
  test("a single focused row may remain mounted outside the viewport without expanding the whole range", () => {
    expect(filmstripMountedIndices(500, 512, 2, 1000)).toEqual([
      2,
      ...Array.from({ length: 12 }, (_, i) => i + 500),
    ]);
    expect(filmstripMountedIndices(0, 12, 999, 1000)).toHaveLength(13);
    expect(filmstripMountedIndices(0, 12, 3, 1000)).toHaveLength(12);
    expect(filmstripMountedIndices(0, 12, null, 1000)).toHaveLength(12);
    expect(filmstripMountedIndices(0, 12, 1000, 1000)).toHaveLength(12);
  });
  test("nonfinite measurements never make an unbounded window or invalid layout", () => {
    for (const field of [
      "count",
      "viewportWidth",
      "scrollLeft",
      "itemWidth",
      "gap",
      "padding",
    ] as const) {
      const result = filmstripWindow(metrics({ [field]: NaN }));
      expect(Object.values(result).every(Number.isFinite)).toBe(true);
      expect(result.end - result.start).toBeLessThanOrEqual(1000);
    }
  });
  test("actual component lifecycle bounds URLs, keeps focus and handles controlled selection", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        fileURLToPath(new URL("./develop-filmstrip-lifecycle.fixture.ts", import.meta.url)),
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
    expect(JSON.parse(output).passed).toBeGreaterThanOrEqual(30);
  });
});
