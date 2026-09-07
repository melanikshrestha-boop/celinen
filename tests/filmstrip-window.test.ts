import { describe, expect, test } from "bun:test";
import {
  filmstripSelectionScrollTop,
  getFilmstripRows,
  getFilmstripWindow,
} from "../src/lib/studio/filmstrip-window";

const setup = { count: 3000, columns: 6, width: 400, viewportHeight: 520, scrollTop: 0 };

describe("large-shoot filmstrip window", () => {
  test("3000 photos mount only the viewport plus two overscan rows", () => {
    const window = getFilmstripWindow(setup);
    expect(window.totalRows).toBe(500);
    expect(window.startRow).toBe(0);
    expect(window.endRow * window.columns).toBeLessThan(60);
    expect(window.totalHeight).toBe(500 * window.rowStride - 8);
    expect(window.rowHeight).toBe(75);
  });

  test("the final partial row remains accessible with no out-of-range rows", () => {
    const window = getFilmstripWindow({
      ...setup,
      count: 3001,
      scrollTop: Number.MAX_SAFE_INTEGER,
    });
    expect(window.endRow).toBe(501);
    expect(window.startRow).toBeGreaterThan(490);
    expect(getFilmstripRows(window, 3000).at(-1)).toBe(500);
  });

  test("keeps a distant selected frame mounted without expanding the whole range", () => {
    const window = getFilmstripWindow(setup);
    const rows = getFilmstripRows(window, 2999);
    expect(rows).toContain(499);
    expect(rows.length).toBe(window.endRow - window.startRow + 1);
    expect(getFilmstripRows(window, 0).length).toBe(window.endRow - window.startRow);
    expect(getFilmstripRows(window, -1)).not.toContain(-1);
  });

  test("empty, hidden, negative-scroll and invalid measurements stay finite and bounded", () => {
    const empty = getFilmstripWindow({ ...setup, count: 0 });
    expect(empty.totalHeight).toBe(0);
    expect(getFilmstripRows(empty, -1)).toEqual([]);
    const hidden = getFilmstripWindow({ ...setup, width: 0, viewportHeight: 0, scrollTop: -500 });
    expect(hidden.startRow).toBe(0);
    expect(hidden.endRow).toBeLessThan(5);
    expect(hidden.rowHeight).toBeGreaterThan(0);
    const invalid = getFilmstripWindow({ ...setup, width: NaN, scrollTop: Infinity, columns: NaN });
    expect(Number.isFinite(invalid.totalHeight)).toBe(true);
    expect(invalid.startRow).toBe(0);
  });

  test("matches the original four-column 4:5 mobile geometry", () => {
    const window = getFilmstripWindow({ ...setup, columns: 4, width: 320 });
    expect(window.totalRows).toBe(750);
    expect(window.rowHeight).toBe(92.5);
    expect(window.rowStride).toBe(100.5);
  });

  test("keyboard selection reveals the final frame and leaves visible frames still", () => {
    const window = getFilmstripWindow(setup);
    const base = { ...window, viewportHeight: 520, scrollTop: 0 };
    expect(filmstripSelectionScrollTop({ ...base, index: 0 })).toBe(0);
    expect(filmstripSelectionScrollTop({ ...base, index: 2999 })).toBe(window.totalHeight - 520);
    expect(filmstripSelectionScrollTop({ ...base, scrollTop: 900, index: 6 })).toBe(
      window.rowStride,
    );
    expect(filmstripSelectionScrollTop({ ...base, index: -1 })).toBe(0);
  });
});
