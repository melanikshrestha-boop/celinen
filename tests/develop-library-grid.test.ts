import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  libraryGridWindow,
  libraryGridScrollToIndex,
  libraryGridMountedIndices,
  type LibraryGridMetrics,
} from "../src/lib/develop/library-window";
const metrics = (patch: Partial<LibraryGridMetrics> = {}): LibraryGridMetrics => ({
  count: 1000,
  viewportWidth: 900,
  viewportHeight: 500,
  scrollTop: 0,
  minCardWidth: 145,
  cardHeight: 189,
  gap: 9,
  padding: 16,
  ...patch,
});
describe("Virtual Develop Library grid", () => {
  test("empty/hidden/first/last ranges preserve full logical rows and responsive columns", () => {
    expect(libraryGridWindow(metrics({ count: 0 }))).toMatchObject({
      start: 0,
      end: 0,
      rows: 0,
      contentHeight: 0,
    });
    expect(libraryGridWindow(metrics({ viewportHeight: 0 }))).toMatchObject({ start: 0, end: 0 });
    expect(libraryGridWindow(metrics({ viewportWidth: 0 }))).toMatchObject({ start: 0, end: 0 });
    expect(libraryGridWindow(metrics())).toMatchObject({
      columns: 5,
      cardWidth: 166.4,
      rowStride: 198,
      rows: 200,
      start: 0,
      end: 25,
    });
    expect(libraryGridWindow(metrics({ viewportWidth: 330 })).columns).toBe(1);
    expect(libraryGridWindow(metrics({ viewportWidth: 331 })).columns).toBe(2);
    const last = libraryGridWindow(metrics({ count: 1003, scrollTop: 1e9 }));
    expect(last.end).toBe(1003);
    expect(last.start % 5).toBe(0);
    expect(last.scrollTop).toBe(last.maxScroll);
    expect(libraryGridWindow(metrics({ scrollTop: -500 }))).toEqual(libraryGridWindow(metrics()));
  });
  test("every viewport mounts bounded rows plus exactly two neighbors per side", () => {
    for (const viewportWidth of [1, 145, 330, 390, 850, 1440, 2200])
      for (const viewportHeight of [1, 189, 350, 500, 1100])
        for (const scrollTop of [0, 10, 198, 20000, 1e9]) {
          const input = metrics({ viewportWidth, viewportHeight, scrollTop }),
            view = libraryGridWindow(input);
          expect(view.start).toBeGreaterThanOrEqual(0);
          expect(view.end).toBeLessThanOrEqual(1000);
          expect(view.end - view.start).toBeLessThanOrEqual(
            (Math.ceil(viewportHeight / view.rowStride) + 5) * view.columns,
          );
          expect((view.firstVisible - view.start) / view.columns).toBe(
            Math.min(2, view.firstVisible / view.columns),
          );
          expect(view.cardWidth).toBeGreaterThan(0);
        }
  });
  test("nearest reveal handles reflow, last partial row and already-visible selection", () => {
    for (const viewportWidth of [390, 900, 1440])
      for (const index of [0, 1, 4, 500, 1002]) {
        const input = metrics({ count: 1003, viewportWidth, scrollTop: 1e9 }),
          top = libraryGridScrollToIndex(input, index),
          view = libraryGridWindow({ ...input, scrollTop: top });
        expect(index).toBeGreaterThanOrEqual(view.start);
        expect(index).toBeLessThan(view.end);
        const y = view.padding + Math.floor(index / view.columns) * view.rowStride;
        expect(y).toBeGreaterThanOrEqual(top);
        expect(y + view.cardHeight).toBeLessThanOrEqual(top + input.viewportHeight);
        expect(libraryGridScrollToIndex({ ...input, scrollTop: top }, index)).toBe(top);
      }
    for (const index of [-1, 1000, 1.2, NaN])
      expect(libraryGridScrollToIndex(metrics({ scrollTop: 200 }), index)).toBe(200);
  });
  test("one focused item survives outside rows without mounting its whole intervening range", () => {
    expect(libraryGridMountedIndices(500, 525, 0, 1000)).toEqual([
      0,
      ...Array.from({ length: 25 }, (_, i) => 500 + i),
    ]);
    expect(libraryGridMountedIndices(0, 25, 999, 1000)).toHaveLength(26);
    expect(libraryGridMountedIndices(0, 25, 3, 1000)).toHaveLength(25);
    expect(libraryGridMountedIndices(0, 25, 1000, 1000)).toHaveLength(25);
  });
  test("malformed dimensions cannot allocate unbounded or nonfinite ranges", () => {
    for (const field of [
      "count",
      "viewportWidth",
      "viewportHeight",
      "scrollTop",
      "minCardWidth",
      "cardHeight",
      "gap",
      "padding",
    ] as const) {
      const result = libraryGridWindow(metrics({ [field]: NaN }));
      expect(Object.values(result).every(Number.isFinite)).toBe(true);
      expect(result.end - result.start).toBeLessThanOrEqual(1000);
    }
  });
  test("actual cards preserve source ownership, focus, double click and bounded URLs", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        fileURLToPath(new URL("./develop-library-grid-lifecycle.fixture.ts", import.meta.url)),
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
    expect(JSON.parse(output).passed).toBeGreaterThanOrEqual(40);
  });
});
