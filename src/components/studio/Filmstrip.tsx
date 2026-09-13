import { memo, useEffect, useRef, useState } from "react";
import type { Shot } from "@/lib/imaging";
import { cullReview } from "@/lib/studio/cull-review";
import {
  filmstripSelectionScrollTop,
  getFilmstripRows,
  getFilmstripWindow,
} from "@/lib/studio/filmstrip-window";
import { frameAvailability, frameAvailabilityLabel } from "@/lib/studio/frame-availability";

interface FilmstripProps {
  shots: Shot[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  compact?: boolean;
  numbered?: boolean;
}

/** Virtualized contact sheet, or a single-row-height rail below the image in compact mode. */
export function Filmstrip({
  shots,
  selectedId,
  onSelect,
  compact = false,
  numbered = false,
}: FilmstripProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 520, columns: 4 });
  const [scrollTop, setScrollTop] = useState(0);
  const selectedIndex = shots.findIndex((shot) => shot.id === selectedId);
  const window = getFilmstripWindow({
    count: shots.length,
    columns: dimensions.columns,
    width: dimensions.width,
    viewportHeight: dimensions.height,
    scrollTop,
  });
  const rows = getFilmstripRows(window, selectedIndex);
  const unreadable = shots.filter((shot) => frameAvailability(shot) === "unreadable").length;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // Preserve the original viewport-based 4/6 contact sheet outside compact mode.
    const wide = globalThis.matchMedia("(min-width: 640px)");
    const measure = () => {
      const padding = Number.parseFloat(getComputedStyle(viewport).paddingRight) || 0;
      const width = Math.max(0, viewport.clientWidth - padding);
      const next = {
        width,
        height: viewport.clientHeight || 520,
        // Include the 8px grid gap in both the target pitch and available width.
        columns: compact ? Math.max(1, Math.round((width + 8) / 88)) : wide.matches ? 6 : 4,
      };
      setDimensions((previous) =>
        previous.width === next.width &&
        previous.height === next.height &&
        previous.columns === next.columns
          ? previous
          : next,
      );
      setScrollTop(viewport.scrollTop);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    wide.addEventListener("change", measure);
    measure();
    return () => {
      observer.disconnect();
      wide.removeEventListener("change", measure);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [compact]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || dimensions.width <= 0 || selectedIndex < 0) return;
    const next = filmstripSelectionScrollTop({
      index: selectedIndex,
      columns: dimensions.columns,
      rowHeight: window.rowHeight,
      rowStride: window.rowStride,
      scrollTop: viewport.scrollTop,
      viewportHeight: viewport.clientHeight,
    });
    if (next !== viewport.scrollTop) viewport.scrollTop = next;
    setScrollTop(viewport.scrollTop);
  }, [
    selectedIndex,
    dimensions.columns,
    dimensions.width,
    dimensions.height,
    window.rowHeight,
    window.rowStride,
  ]);

  return (
    <div
      ref={viewportRef}
      role="region"
      tabIndex={0}
      data-cull-filmstrip="true"
      aria-label={`Filmstrip, ${shots.length} frames${unreadable ? `, ${unreadable} unreadable for manual review` : ""}`}
      className={`relative overflow-y-auto pr-1 ${compact ? "shrink-0" : "max-h-[520px]"}`}
      style={compact ? { height: window.rowHeight, maxHeight: window.rowHeight } : undefined}
      onScroll={() => {
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          setScrollTop(viewportRef.current?.scrollTop ?? 0);
        });
      }}
    >
      <div
        role="list"
        aria-label="Shoot frames"
        className="relative"
        style={{ height: window.totalHeight }}
      >
        {rows.map((row) => (
          <div
            key={row}
            role="presentation"
            className="absolute left-0 right-0 grid gap-2"
            style={{
              top: row * window.rowStride,
              height: window.rowHeight,
              gridTemplateColumns: `repeat(${window.columns}, minmax(0, 1fr))`,
            }}
          >
            {shots.slice(row * window.columns, (row + 1) * window.columns).map((shot, column) => {
              const index = row * window.columns + column;
              return (
                <div
                  key={shot.id}
                  role="listitem"
                  aria-posinset={index + 1}
                  aria-setsize={shots.length}
                  className="min-w-0"
                >
                  <FrameButton
                    shot={shot}
                    selected={shot.id === selectedId}
                    onSelect={onSelect}
                    index={numbered ? index + 1 : null}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

const FrameButton = memo(function FrameButton({
  shot: s,
  selected,
  onSelect,
  index,
}: {
  shot: Shot;
  selected: boolean;
  onSelect: (id: string) => void;
  index: number | null;
}) {
  const availability = frameAvailability(s);
  const status = frameAvailabilityLabel(availability);
  const showPreview = availability === "ready" && Boolean(s.previewUrl);
  const review = cullReview(s);
  return (
    <button
      onClick={() => onSelect(s.id)}
      aria-pressed={selected}
      aria-label={`${s.name} · ${status} · ${review.label}`}
      title={`${s.name} · ${status} · ${review.label}`}
      data-frame-availability={availability}
      data-cull-dot={review.dot}
      className={`relative block aspect-[4/5] w-full overflow-hidden bg-mist/50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-rust ${
        selected ? "outline outline-2 -outline-offset-2 outline-rust" : ""
      }`}
    >
      {showPreview ? (
        <img
          src={s.previewUrl!}
          alt={s.name}
          loading="lazy"
          className={`size-full object-cover ${s.verdict === "reject" ? "opacity-30" : ""}`}
        />
      ) : (
        <span
          className={`grid size-full place-items-center px-1 text-center font-mono text-[8px] ${availability === "unreadable" ? "text-rust" : "text-moss"}`}
        >
          {availability === "unreadable"
            ? "unreadable\nselect to recover"
            : availability === "source-offline"
              ? "source offline"
              : "preview pending"}
        </span>
      )}
      {index != null && (
        <span className="absolute bottom-0 left-0 bg-ink/70 px-1 font-mono text-[9px] text-paper2">
          {index}
        </span>
      )}
      {review.dot !== "pending" && (
        <span
          aria-hidden="true"
          className={`absolute right-1 top-1 size-2.5 rounded-full ring-1 ring-white/70 ${
            review.dot === "keep"
              ? "bg-[#16a34a]"
              : review.dot === "reject"
                ? "bg-[#991b1b]"
                : "bg-[#ef4444]"
          }`}
        />
      )}
    </button>
  );
});
