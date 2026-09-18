import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Check, ImageOff, Layers, X } from "lucide-react";
import type { CullFrame } from "@/lib/studio/cull/session";
import { CULL_REASON_LABELS, effectiveVerdict } from "@/lib/studio/cull/session";
import {
  libraryGridMountedIndices,
  libraryGridScrollToIndex,
  libraryGridWindow,
  type LibraryGridMetrics,
} from "@/lib/develop/library-window";
import { decisionSource, type CullCell } from "./cull-review";

// Layout effects measure before paint in the browser; the server has no layout.
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Fallbacks for the sizes cull.css sets on `.cull-grid`; the stylesheet wins. */
const GRID_SIZES = { minCardWidth: 176, cardHeight: 164, gap: 8, padding: 16 } as const;

export type CullViewport = { width: number; height: number };

/** Reads one frame's stored thumbnail. Must keep its identity across renders. */
export type CullThumbnailSource = (frameId: string) => Promise<Blob | null>;

/**
 * The object URL for a frame's thumbnail, held only while the component that
 * asked for it is mounted. The grid mounts only the cards in view, so a
 * 10,000-frame card holds a few dozen URLs, never ten thousand.
 */
function useThumbnailUrl(frame: CullFrame, thumbnail: CullThumbnailSource): string | null {
  const [loaded, setLoaded] = useState<{ id: string; url: string } | null>(null);
  const current = loaded?.id === frame.id ? loaded.url : null;
  // While a card reads, a thumbnail can be asked for before it is saved. The
  // frame object is replaced whenever the controller changes it, so a missing
  // thumbnail is asked for again on the next change, and never once it is here.
  const attempt = current ? null : frame;

  useEffect(() => {
    if (!loaded) return;
    return () => URL.revokeObjectURL(loaded.url);
  }, [loaded]);

  useEffect(() => {
    if (!attempt) return;
    let live = true;
    thumbnail(attempt.id).then(
      (blob) => {
        if (live && blob) setLoaded({ id: attempt.id, url: URL.createObjectURL(blob) });
      },
      // An unreadable thumbnail leaves the placeholder; the frame stays reviewable.
      () => {},
    );
    return () => {
      live = false;
    };
  }, [attempt, thumbnail]);

  return current;
}

export function CullThumb({
  frame,
  thumbnail,
}: {
  frame: CullFrame;
  thumbnail: CullThumbnailSource;
}) {
  const url = useThumbnailUrl(frame, thumbnail);
  const [broken, setBroken] = useState<string | null>(null);
  return url && broken !== url ? (
    <img src={url} alt="" decoding="async" onError={() => setBroken(url)} />
  ) : (
    <ImageOff size={18} aria-hidden="true" />
  );
}

/** The photographer's verdict filled, the engine's suggestion dashed, nothing
 * while a frame is undecided. */
export function CullMark({ frame, size = 12 }: { frame: CullFrame; size?: number }) {
  const verdict = effectiveVerdict(frame);
  if (verdict === "undecided") return null;
  const source = decisionSource(frame);
  const label =
    source === "photographer"
      ? verdict === "keep"
        ? "Kept"
        : "Rejected"
      : verdict === "keep"
        ? "Suggested keep"
        : "Suggested reject";
  return (
    <span
      className="cull-mark"
      data-source={source}
      data-verdict={verdict}
      role="img"
      aria-label={label}
      title={label}
    >
      {verdict === "keep" ? (
        <Check size={size} strokeWidth={3} aria-hidden="true" />
      ) : (
        <X size={size} strokeWidth={3} aria-hidden="true" />
      )}
    </span>
  );
}


/** iOS Safari rarely fires dblclick; two taps within 320ms open loupe. */
function useDoubleTapOpen(onOpen: (id: string) => void, id: string) {
  const lastTap = useRef(0);
  return useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === "mouse") return;
      const now = performance.now();
      if (now - lastTap.current < 320) {
        lastTap.current = 0;
        event.preventDefault();
        onOpen(id);
      } else {
        lastTap.current = now;
      }
    },
    [id, onOpen],
  );
}

// Every prop is a primitive or an object the controller replaces only when it
// changes, so a new snapshot re-renders only the cards that actually changed.
type CardProps = {
  frame: CullFrame;
  stackId: string | null;
  stackCount: number;
  lead: boolean;
  expanded: boolean;
  index: number;
  left: number;
  top: number;
  width: number;
  selected: boolean;
  thumbnail: CullThumbnailSource;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onToggleStack: (stackId: string) => void;
};

const Card = memo(function Card({
  frame,
  stackId,
  stackCount,
  lead,
  expanded,
  index,
  left,
  top,
  width,
  selected,
  thumbnail,
  onSelect,
  onOpen,
  onToggleStack,
}: CardProps) {
  const onDoubleTap = useDoubleTapOpen(onOpen, frame.id);
  const reason = frame.suggestion?.reason ?? "none";
  const classes = ["cull-card"];
  if (selected) classes.push("is-selected");
  if (stackId) classes.push("is-stacked");
  if (expanded) classes.push("is-open");
  if (expanded && !lead) classes.push("is-stack-member");
  return (
    <div
      className={classes.join(" ")}
      data-frame-id={frame.id}
      data-verdict={effectiveVerdict(frame)}
      data-source={decisionSource(frame)}
      style={{ left, top, width }}
    >
      <button
        type="button"
        className="cull-card-hit"
        aria-label={`${index + 1}. ${frame.name}`}
        aria-current={selected ? "true" : undefined}
        tabIndex={selected ? 0 : -1}
        onClick={() => onSelect(frame.id)}
        onDoubleClick={() => onOpen(frame.id)}
        onPointerUp={onDoubleTap}
      >
        <span className="cull-thumb">
          {frame.error ? (
            <ImageOff size={18} aria-hidden="true" />
          ) : (
            <CullThumb frame={frame} thumbnail={thumbnail} />
          )}
          <CullMark frame={frame} />
          {reason !== "none" && (
            <span className="cull-reason font-mono text-[10px]">{CULL_REASON_LABELS[reason]}</span>
          )}
        </span>
        <span className="cull-card-meta font-mono text-[10px]">
          <span>{frame.name}</span>
          {frame.error ? (
            <span className="text-rust">Unreadable</span>
          ) : frame.suggestion ? (
            <span className="text-ink">{frame.suggestion.score}</span>
          ) : null}
        </span>
      </button>
      {stackId && lead && (
        <button
          type="button"
          className="cull-stack-count flex items-center gap-1 font-mono text-[10px]"
          aria-expanded={expanded}
          aria-label={`Burst of ${stackCount}`}
          tabIndex={-1}
          onClick={() => onToggleStack(stackId)}
        >
          <Layers size={10} aria-hidden="true" />
          {stackCount}
        </button>
      )}
    </div>
  );
});

export type CullGridProps = {
  cells: readonly CullCell[];
  thumbnail: CullThumbnailSource;
  /** Index into `cells` of the frame in hand. */
  selectedIndex: number | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onToggleStack: (stackId: string) => void;
  /** Told whenever the column count changes, so ↑ ↓ can move a whole row. */
  onColumns: (columns: number) => void;
  /** The window to lay out before the grid has measured itself. The screen
   * leaves it out; the grid measures on mount. */
  viewport?: CullViewport | undefined;
};

/**
 * Only the rows in view (plus two above and below) are ever mounted, so the
 * DOM holds the same few dozen cards at ten frames or ten thousand. Positions
 * are arithmetic, not layout: the browser never measures a card.
 */
export const CullGrid = memo(function CullGrid({
  cells,
  thumbnail,
  selectedIndex,
  onSelect,
  onOpen,
  onToggleStack,
  onColumns,
  viewport,
}: CullGridProps) {
  const container = useRef<HTMLDivElement>(null);
  const count = useRef(cells.length);
  count.current = cells.length;
  const alive = useRef(false);
  const frame = useRef<number | null>(null);
  const [layout, setLayout] = useState(() =>
    libraryGridWindow({
      ...GRID_SIZES,
      count: cells.length,
      viewportWidth: viewport?.width ?? 0,
      viewportHeight: viewport?.height ?? 0,
      scrollTop: 0,
    }),
  );

  const metrics = useCallback((): LibraryGridMetrics | null => {
    const element = container.current;
    if (!element) return null;
    const style = getComputedStyle(element);
    const size = (property: string, fallback: number) => {
      const parsed = Number.parseFloat(style.getPropertyValue(property));
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    };
    return {
      count: count.current,
      viewportWidth: element.clientWidth,
      viewportHeight: element.clientHeight,
      scrollTop: element.scrollTop,
      minCardWidth: size("--cull-min-width", GRID_SIZES.minCardWidth),
      cardHeight: size("--cull-card-height", GRID_SIZES.cardHeight),
      gap: size("--cull-gap", GRID_SIZES.gap),
      padding: size("--cull-padding", GRID_SIZES.padding),
    };
  }, []);

  const measure = useCallback(() => {
    if (!alive.current) return;
    const input = metrics();
    if (!input) return;
    const next = libraryGridWindow(input);
    // Scrolling within a row changes nothing on screen: the raw scroll offset is
    // left out of the comparison, so React only renders when the window of
    // mounted rows actually moves.
    setLayout((previous) =>
      (Object.keys(next) as (keyof typeof next)[]).every(
        (key) => key === "scrollTop" || next[key] === previous[key],
      )
        ? previous
        : next,
    );
  }, [metrics]);

  const schedule = useCallback(() => {
    if (!alive.current || frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      measure();
    });
  }, [measure]);

  useBrowserLayoutEffect(() => {
    alive.current = true;
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    if (container.current) observer?.observe(container.current);
    window.addEventListener("resize", schedule);
    return () => {
      alive.current = false;
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [measure, schedule]);

  useBrowserLayoutEffect(measure, [cells.length, measure]);

  // Keep the frame in hand on screen as the keyboard walks the card.
  useBrowserLayoutEffect(() => {
    const element = container.current;
    const input = metrics();
    if (selectedIndex === null || !element || !input) return;
    const target = libraryGridScrollToIndex(input, selectedIndex);
    if (target !== element.scrollTop) {
      element.scrollTop = target;
      measure();
    }
  }, [selectedIndex, layout.columns, metrics, measure]);

  useEffect(() => onColumns(layout.columns), [layout.columns, onColumns]);

  const mounted = libraryGridMountedIndices(layout.start, layout.end, selectedIndex, cells.length);
  const rows = Math.ceil(cells.length / layout.columns);

  return (
    <div
      ref={container}
      className="cull-grid"
      role="group"
      aria-label="Frames"
      data-cell-count={cells.length}
      data-column-count={layout.columns}
      data-window-start={layout.start}
      data-window-end={layout.end}
      onScroll={schedule}
    >
      <div
        className="cull-spacer"
        aria-hidden="true"
        style={{ height: rows ? rows * layout.rowStride - layout.gap + layout.padding * 2 : 0 }}
      />
      {mounted.map((index) => {
        const cell = cells[index]!;
        return (
          <Card
            key={cell.frame.id}
            frame={cell.frame}
            stackId={cell.stackId}
            stackCount={cell.stackCount}
            lead={cell.lead}
            expanded={cell.expanded}
            index={index}
            left={layout.padding + (index % layout.columns) * (layout.cardWidth + layout.gap)}
            top={layout.padding + Math.floor(index / layout.columns) * layout.rowStride}
            width={layout.cardWidth}
            selected={index === selectedIndex}
            thumbnail={thumbnail}
            onSelect={onSelect}
            onOpen={onOpen}
            onToggleStack={onToggleStack}
          />
        );
      })}
    </div>
  );
});
