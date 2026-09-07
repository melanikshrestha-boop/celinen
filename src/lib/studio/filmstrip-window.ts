export interface FilmstripWindow {
  startRow: number;
  endRow: number;
  totalRows: number;
  totalHeight: number;
  rowHeight: number;
  rowStride: number;
  columns: number;
}

const finiteOr = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);

/** A bounded row window; a hidden/unmeasured container uses a safe provisional width. */
export function getFilmstripWindow({
  count,
  columns,
  width,
  viewportHeight,
  scrollTop,
  gap = 8,
  overscan = 2,
}: {
  count: number;
  columns: number;
  width: number;
  viewportHeight: number;
  scrollTop: number;
  gap?: number;
  overscan?: number;
}): FilmstripWindow {
  const safeCount = Math.max(0, Math.floor(finiteOr(count, 0)));
  const safeColumns = Math.max(1, Math.floor(finiteOr(columns, 4)));
  const safeGap = Math.max(0, finiteOr(gap, 8));
  const safeWidth = width > safeGap * (safeColumns - 1) && Number.isFinite(width) ? width : 320;
  const rowHeight = Math.max(1, (safeWidth - safeGap * (safeColumns - 1)) / safeColumns) * 1.25;
  const rowStride = rowHeight + safeGap;
  const totalRows = Math.ceil(safeCount / safeColumns);
  const totalHeight = Math.max(0, totalRows * rowStride - safeGap);
  const safeViewport = Math.max(1, finiteOr(viewportHeight, 520));
  const safeScroll = Math.min(
    Math.max(0, finiteOr(scrollTop, 0)),
    Math.max(0, totalHeight - safeViewport),
  );
  const safeOverscan = Math.max(0, Math.floor(finiteOr(overscan, 2)));
  const startRow = Math.max(0, Math.floor(safeScroll / rowStride) - safeOverscan);
  const endRow = Math.min(
    totalRows,
    Math.ceil((safeScroll + safeViewport) / rowStride) + safeOverscan,
  );
  return { startRow, endRow, totalRows, totalHeight, rowHeight, rowStride, columns: safeColumns };
}

/** Keep the current frame in the DOM even when the photographer scrolls elsewhere. */
export function getFilmstripRows(window: FilmstripWindow, selectedIndex: number): number[] {
  const rows = Array.from(
    { length: window.endRow - window.startRow },
    (_, i) => window.startRow + i,
  );
  const selectedRow = Math.floor(selectedIndex / window.columns);
  if (
    selectedIndex >= 0 &&
    selectedRow < window.totalRows &&
    (selectedRow < window.startRow || selectedRow >= window.endRow)
  ) {
    rows.push(selectedRow);
    rows.sort((a, b) => a - b);
  }
  return rows;
}

/** Minimal scroll adjustment, so next/previous review never moves the page itself. */
export function filmstripSelectionScrollTop({
  index,
  columns,
  rowHeight,
  rowStride,
  scrollTop,
  viewportHeight,
}: {
  index: number;
  columns: number;
  rowHeight: number;
  rowStride: number;
  scrollTop: number;
  viewportHeight: number;
}): number {
  if (index < 0 || viewportHeight <= 0) return scrollTop;
  const top = Math.floor(index / columns) * rowStride;
  const bottom = top + rowHeight;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewportHeight) return Math.max(0, bottom - viewportHeight);
  return scrollTop;
}
