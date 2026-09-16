import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import type { DevelopDocument, DevelopPhoto } from "@/lib/develop/store";
import { asDevelopViewBlob } from "@/lib/develop/decode-preview";
import {
  libraryGridWindow,
  libraryGridScrollToIndex,
  libraryGridMountedIndices,
  type LibraryGridMetrics,
} from "@/lib/develop/library-window";
import "./develop-library-grid.css";

export const DevelopLibraryThumbnail = memo(function DevelopLibraryThumbnail({
  photo,
}: {
  photo: DevelopPhoto;
}) {
  const [owner, setOwner] = useState<{ url: string } | null>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
    let cancelled = false;
    let url: string | null = null;
    void (async () => {
      const preview = await asDevelopViewBlob(photo.previewBlob);
      const typed = preview ?? (photo.isRaw ? null : await asDevelopViewBlob(photo.sourceBlob));
      if (cancelled) return;
      if (!typed) {
        setOwner(null);
        return;
      }
      url = URL.createObjectURL(typed);
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      setOwner({ url });
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo, photo.previewBlob, photo.sourceBlob, photo.isRaw]);
  return (
    <div className="develop-library-thumbnail">
      {owner && !broken ? (
        <img
          src={owner.url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      ) : (
        <ImagePlus size={18} />
      )}
    </div>
  );
});

type CardProps = {
  photo: DevelopPhoto;
  index: number;
  count: number;
  rating: number;
  left: number;
  top: number;
  width: number;
  active: boolean;
  pressed: boolean;
  tabStop: boolean;
  onSelect: (id: string, multi: boolean) => void;
  onOpen: (id: string) => void;
  retainFocus: (element: HTMLButtonElement | null) => void;
};
const Card = memo(function Card({
  photo,
  index,
  count,
  rating,
  left,
  top,
  width,
  active,
  pressed,
  tabStop,
  onSelect,
  onOpen,
  retainFocus,
}: CardProps) {
  const element = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => () => retainFocus(element.current), [retainFocus]);
  const missing = !photo.sourceBlob?.size && !photo.previewBlob?.size;
  return (
    <button
      ref={element}
      type="button"
      data-photo-id={photo.id}
      data-photo-index={index}
      aria-label={`${index + 1}. ${photo.name}`}
      aria-description={`Photo ${index + 1} of ${count}. ${rating} stars.${missing ? " Original file needed." : ""}`}
      aria-pressed={pressed}
      className={active ? "is-active" : ""}
      tabIndex={tabStop ? 0 : -1}
      style={{ left, top, width }}
      onClick={(event) => onSelect(photo.id, event.shiftKey || event.metaKey || event.ctrlKey)}
      onDoubleClick={() => onOpen(photo.id)}
    >
      <DevelopLibraryThumbnail photo={photo} />
      <span>{photo.name}</span>
      <small>{"★".repeat(rating)}</small>
    </button>
  );
});

export type DevelopLibraryGridProps = {
  photos: readonly DevelopPhoto[];
  documents: Readonly<Record<string, Pick<DevelopDocument, "metadata">>>;
  selected: string | null;
  selectedIds: ReadonlySet<string>;
  onSelect: (id: string, multi: boolean) => void;
  onOpen: (id: string) => void;
};
const emptyMetrics = (): LibraryGridMetrics => ({
  count: 0,
  viewportWidth: 0,
  viewportHeight: 0,
  scrollTop: 0,
  minCardWidth: 145,
  cardHeight: 189,
  gap: 9,
  padding: 16,
});

export const DevelopLibraryGrid = memo(function DevelopLibraryGrid({
  photos,
  documents,
  selected,
  selectedIds,
  onSelect,
  onOpen,
}: DevelopLibraryGridProps) {
  const container = useRef<HTMLDivElement>(null),
    current = useRef(photos);
  current.current = photos;
  const [layout, setLayout] = useState(() => libraryGridWindow(emptyMetrics()));
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const alive = useRef(false),
    frame = useRef<number | null>(null);
  const focusWithin = useRef(false),
    pendingFocus = useRef<string | null>(null);
  const indexes = useMemo(() => new Map(photos.map((photo, index) => [photo.id, index])), [photos]);
  const selectedIndex = selected === null ? undefined : indexes.get(selected);
  const metrics = useCallback((): LibraryGridMetrics | null => {
    const element = container.current;
    if (!element) return null;
    const style = getComputedStyle(element);
    const value = (key: string, fallback: number) => {
      const parsed = Number.parseFloat(style.getPropertyValue(key));
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    };
    return {
      count: current.current.length,
      viewportWidth: element.clientWidth,
      viewportHeight: element.clientHeight,
      scrollTop: element.scrollTop,
      minCardWidth: value("--develop-library-min-width", 145),
      cardHeight: value("--develop-library-card-height", 189),
      gap: value("--develop-library-gap", 9),
      padding: value("--develop-library-padding", 16),
    };
  }, []);
  const measure = useCallback(() => {
    if (!alive.current) return;
    const input = metrics();
    if (!input) return;
    const next = libraryGridWindow(input);
    setLayout((previous) =>
      Object.keys(next).every(
        (key) => next[key as keyof typeof next] === previous[key as keyof typeof next],
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
  const focusPhoto = useCallback((id: string) => {
    const target = Array.from(
      container.current?.querySelectorAll<HTMLButtonElement>("button[data-photo-id]") ?? [],
    ).find((button) => button.dataset["photoId"] === id);
    if (target) {
      target.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  }, []);
  const reveal = useCallback(
    (index: number, focus: boolean) => {
      const input = metrics(),
        element = container.current,
        photo = current.current[index];
      if (!input || !element || !photo) return;
      if (focus) pendingFocus.current = photo.id;
      element.scrollTop = libraryGridScrollToIndex(input, index);
      measure();
      if (focus) focusPhoto(photo.id);
    },
    [metrics, measure, focusPhoto],
  );
  const retainFocus = useCallback((element: HTMLButtonElement | null) => {
    if (alive.current && element && document.activeElement === element)
      container.current?.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
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
  useLayoutEffect(() => {
    if (selectedIndex !== undefined) reveal(selectedIndex, focusWithin.current);
    else measure();
  }, [selected, selectedIndex, reveal, measure]);
  useLayoutEffect(measure, [photos.length, measure]);
  useLayoutEffect(() => {
    if (pendingFocus.current && focusWithin.current) focusPhoto(pendingFocus.current);
  });
  const focusedIndex = focusedId === null ? null : (indexes.get(focusedId) ?? null);
  const mounted = libraryGridMountedIndices(layout.start, layout.end, focusedIndex, photos.length);
  const tabStop =
    focusedIndex ??
    (selectedIndex !== undefined && selectedIndex >= layout.start && selectedIndex < layout.end
      ? selectedIndex
      : layout.firstVisible);
  const rows = Math.ceil(photos.length / layout.columns);
  return (
    <div
      ref={container}
      className="develop-library-grid develop-library-virtual"
      role="group"
      aria-label="Library photos"
      aria-description={`${photos.length} photos. Select with arrow keys; Home and End select the first and last. Double-click to open Develop.`}
      tabIndex={photos.length ? -1 : 0}
      data-photo-count={photos.length}
      data-row-stride={layout.rowStride}
      data-column-count={layout.columns}
      data-window-start={layout.start}
      data-window-end={layout.end}
      onScroll={schedule}
      onFocusCapture={(event) => {
        focusWithin.current = true;
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
          "button[data-photo-id]",
        );
        if (button && event.currentTarget.contains(button))
          setFocusedId(button.dataset["photoId"] ?? null);
      }}
      onBlurCapture={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
          return;
        focusWithin.current = false;
        pendingFocus.current = null;
        setFocusedId(null);
      }}
      onKeyDown={(event) => {
        const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
        if (
          (!vertical && event.key !== "Home" && event.key !== "End") ||
          (vertical && !focusWithin.current) ||
          !photos.length ||
          event.currentTarget.closest("[inert]")
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const currentIndex = focusedIndex ?? selectedIndex ?? 0;
        let index = event.key === "Home" ? 0 : photos.length - 1;
        if (vertical) {
          const row = Math.floor(currentIndex / layout.columns);
          if (
            (event.key === "ArrowUp" && row === 0) ||
            (event.key === "ArrowDown" && row === rows - 1)
          )
            return;
          index = Math.max(
            0,
            Math.min(
              photos.length - 1,
              currentIndex + (event.key === "ArrowUp" ? -layout.columns : layout.columns),
            ),
          );
        }
        reveal(index, true);
        onSelect(photos[index]!.id, event.shiftKey || event.metaKey || event.ctrlKey);
      }}
    >
      <div
        className="develop-library-spacer"
        aria-hidden="true"
        style={{ height: rows ? rows * layout.rowStride - layout.gap : 0 }}
      />
      {mounted.map((index) => {
        const photo = photos[index]!;
        return (
          <Card
            key={photo.id}
            photo={photo}
            index={index}
            count={photos.length}
            rating={documents[photo.id]?.metadata.rating ?? 0}
            left={layout.padding + (index % layout.columns) * (layout.cardWidth + layout.gap)}
            top={layout.padding + Math.floor(index / layout.columns) * layout.rowStride}
            width={layout.cardWidth}
            active={selected === photo.id}
            pressed={selectedIds.has(photo.id)}
            tabStop={index === tabStop}
            onSelect={onSelect}
            onOpen={onOpen}
            retainFocus={retainFocus}
          />
        );
      })}
    </div>
  );
});
