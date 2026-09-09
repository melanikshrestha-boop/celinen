export const DEVELOP_FILMSTRIP_OVERSCAN = 4;
export type FilmstripMetrics = {
  count: number;
  viewportWidth: number;
  scrollLeft: number;
  itemWidth: number;
  gap: number;
  padding: number;
};
const positive = (value: number, fallback = 0) =>
  Number.isFinite(value) && value >= 0 ? value : fallback;
export function filmstripWindow(input: FilmstripMetrics) {
  const count = Math.max(0, Math.floor(positive(input.count)));
  const itemWidth = Math.max(1, positive(input.itemWidth, 110));
  const gap = positive(input.gap, 2),
    padding = positive(input.padding, 8);
  const viewportWidth = positive(input.viewportWidth);
  const stride = itemWidth + gap;
  const contentWidth = count ? count * stride - gap : 0;
  const maxScroll = Math.max(0, contentWidth + padding * 2 - viewportWidth);
  const scrollLeft = Math.min(maxScroll, positive(input.scrollLeft));
  if (!count || !viewportWidth)
    return { start: 0, end: 0, firstVisible: 0, contentWidth, maxScroll, scrollLeft, stride };
  const firstVisible = Math.min(
    count - 1,
    Math.max(0, Math.floor((scrollLeft - padding) / stride)),
  );
  const visibleEnd = Math.min(
    count,
    Math.max(firstVisible + 1, Math.ceil((scrollLeft + viewportWidth - padding) / stride)),
  );
  return {
    start: Math.max(0, firstVisible - DEVELOP_FILMSTRIP_OVERSCAN),
    end: Math.min(count, visibleEnd + DEVELOP_FILMSTRIP_OVERSCAN),
    firstVisible,
    contentWidth,
    maxScroll,
    scrollLeft,
    stride,
  };
}

/** Nearest scroll position with the same inset as the original filmstrip. */
export function filmstripScrollToIndex(input: FilmstripMetrics, index: number): number {
  const window = filmstripWindow(input);
  if (!Number.isInteger(index) || index < 0 || index >= input.count || input.viewportWidth <= 0)
    return window.scrollLeft;
  const padding = positive(input.padding, 8),
    width = Math.max(1, positive(input.itemWidth, 110));
  const left = padding + index * window.stride,
    right = left + width;
  let next = window.scrollLeft;
  if (left < next + padding) next = left - padding;
  else if (right > next + input.viewportWidth - padding)
    next = right + padding - input.viewportWidth;
  return Math.min(window.maxScroll, Math.max(0, next));
}

/** One retained focused row avoids removing keyboard focus during wheel/touch scrolling. */
export function filmstripMountedIndices(
  start: number,
  end: number,
  focusedIndex: number | null,
  count: number,
) {
  const indices = Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i);
  if (
    focusedIndex !== null &&
    focusedIndex >= 0 &&
    focusedIndex < count &&
    (focusedIndex < start || focusedIndex >= end)
  ) {
    if (focusedIndex < start) indices.unshift(focusedIndex);
    else indices.push(focusedIndex);
  }
  return indices;
}
