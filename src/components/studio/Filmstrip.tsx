import { memo, useEffect, useRef, useState } from "react";
import type { Shot } from "@/lib/imaging";
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
  onDeadPreview?: (id: string) => void;
  compact?: boolean;
  numbered?: boolean;
}

/** Virtualized contact sheet, or a single-row-height rail below the image in compact mode. */
export function Filmstrip({ shots, selectedId, onSelect, onDeadPreview, compact = false, numbered = false }: FilmstripProps) {
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
                  onDeadPreview={onDeadPreview}
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
  onDeadPreview,
  index,
}: {
  shot: Shot;
  selected: boolean;
  onSelect: (id: string) => void;
  onDeadPreview?: (id: string) => void;
  index: number | null;
}) {
  const availability = frameAvailability(s);
  const status = frameAvailabilityLabel(availability);
  const showPreview = availability === "ready" && Boolean(s.previewUrl);
  return (
    <button
      onClick={() => onSelect(s.id)}
      aria-pressed={selected}
      aria-label={`${s.name} · ${status} · ${s.verdict}`}
      title={`${s.name} · ${status}`}
      data-frame-availability={availability}
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
          onError={() => onDeadPreview?.(s.id)}
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
      <span className="absolute bottom-0 left-0 bg-ink/70 px-1 font-mono text-[9px] text-paper2">
        {index != null
          ? String(index)
          : availability === "unreadable"
            ? "review"
            : s.score || "—"}
      </span>
      {s.develop && (
        <span
          className="absolute bottom-0 right-0 bg-paper2/85 px-1 font-mono text-[8px] uppercase text-ink"
          title={`develop · ${s.develop.origin}`}
        >
          {s.develop.origin === "lens os" ? "OS" : "LR"}
        </span>
      )}
      {s.verdict === "keep" && (
        <span className="absolute right-1 top-1 size-2 rounded-full bg-moss" />
      )}
      {s.verdict === "reject" && (
        <span className="absolute right-1 top-1 size-2 rounded-full bg-rust" />
      )}
      {s.flags.length > 0 && s.verdict === "undecided" && (
        <span className="absolute right-1 top-1 size-2 rounded-full bg-sun" />
      )}
    </button>
  );
});
