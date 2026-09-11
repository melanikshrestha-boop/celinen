export const DEVELOP_LIBRARY_OVERSCAN_ROWS = 2;
export type LibraryGridMetrics = {
  count: number;
  viewportWidth: number;
  viewportHeight: number;
  scrollTop: number;
  minCardWidth: number;
  cardHeight: number;
  gap: number;
  padding: number;
};
const positive = (value: number, fallback = 0) =>
  Number.isFinite(value) && value >= 0 ? value : fallback;

/** The same auto-fill columns as minmax(145px, 1fr), with bounded vertical rows. */
export function libraryGridWindow(input: LibraryGridMetrics) {
  const count = Math.floor(positive(input.count));
  const padding = positive(input.padding, 16),
    gap = positive(input.gap, 9);
  const viewportWidth = positive(input.viewportWidth),
    viewportHeight = positive(input.viewportHeight);
  const innerWidth = Math.max(1, viewportWidth - padding * 2);
  const columns = Math.max(
    1,
    Math.floor((innerWidth + gap) / (Math.max(1, positive(input.minCardWidth, 145)) + gap)),
  );
  const cardWidth = Math.max(1, (innerWidth - gap * (columns - 1)) / columns);
  const cardHeight = Math.max(1, positive(input.cardHeight, 189));
  const rowStride = cardHeight + gap,
    rows = Math.ceil(count / columns);
  const contentHeight = rows ? rows * rowStride - gap : 0;
  const maxScroll = Math.max(0, contentHeight + padding * 2 - viewportHeight);
  const scrollTop = Math.min(maxScroll, positive(input.scrollTop));
  const firstVisibleRow = rows
    ? Math.min(rows - 1, Math.max(0, Math.floor((scrollTop - padding) / rowStride)))
    : 0;
  const lastVisibleRow = Math.min(
    rows,
    Math.max(firstVisibleRow + 1, Math.ceil((scrollTop + viewportHeight - padding) / rowStride)),
  );
  const start =
    count && viewportWidth && viewportHeight
      ? Math.max(0, firstVisibleRow - DEVELOP_LIBRARY_OVERSCAN_ROWS) * columns
      : 0;
  const end =
    count && viewportWidth && viewportHeight
      ? Math.min(count, (lastVisibleRow + DEVELOP_LIBRARY_OVERSCAN_ROWS) * columns)
      : 0;
  return {
    start,
    end,
    firstVisible: firstVisibleRow * columns,
    columns,
    cardWidth,
    cardHeight,
    rowStride,
    rows,
    contentHeight,
    maxScroll,
    scrollTop,
    gap,
    padding,
    viewportWidth,
    viewportHeight,
  };
}

export function libraryGridScrollToIndex(input: LibraryGridMetrics, index: number) {
  const layout = libraryGridWindow(input);
  if (!Number.isInteger(index) || index < 0 || index >= input.count || !layout.viewportHeight)
    return layout.scrollTop;
  const top = layout.padding + Math.floor(index / layout.columns) * layout.rowStride;
  let next = layout.scrollTop;
  if (top < next + layout.padding) next = top - layout.padding;
  else if (top + layout.cardHeight > next + layout.viewportHeight - layout.padding)
    next = top + layout.cardHeight + layout.padding - layout.viewportHeight;
  return Math.max(0, Math.min(layout.maxScroll, next));
}

export function libraryGridMountedIndices(
  start: number,
  end: number,
  focused: number | null,
  count: number,
) {
  const indices = Array.from(
    { length: Math.max(0, Math.min(count, end) - Math.max(0, start)) },
    (_, i) => i + Math.max(0, start),
  );
  if (
    focused !== null &&
    Number.isInteger(focused) &&
    focused >= 0 &&
    focused < count &&
    (focused < start || focused >= end)
  ) {
    if (focused < start) indices.unshift(focused);
    else indices.push(focused);
  }
  return indices;
}
