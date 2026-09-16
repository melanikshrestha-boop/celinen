import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { DevelopDocument, DevelopPhoto } from "@/lib/develop/store";
import {
  filmstripMountedIndices,
  filmstripScrollToIndex,
  filmstripWindow,
  type FilmstripMetrics,
} from "@/lib/develop/filmstrip-window";
import { asDevelopViewBlob } from "@/lib/develop/decode-preview";
import "./develop-filmstrip.css";

/** Blob ownership is local to a mounted thumbnail, never the whole logical library. */
export const DevelopFilmstripThumb = memo(function DevelopFilmstripThumb({
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
      const typed =
        preview ?? (photo.isRaw ? null : await asDevelopViewBlob(photo.sourceBlob));
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
  return owner && !broken ? (
    <img
      src={owner.url}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
    />
  ) : (
    <span className="develop-filmstrip-empty" aria-hidden="true" />
  );
});

type FrameProps = {
  photo: DevelopPhoto;
  index: number;
  count: number;
  left: number;
  active: boolean;
  pressed: boolean;
  tabStop: boolean;
  picked: boolean;
  onSelect: (id: string, multi: boolean) => void;
  retainFocus: (element: HTMLButtonElement | null) => void;
};
const Frame = memo(function Frame({
  photo,
  index,
  count,
  left,
  active,
  pressed,
  tabStop,
  picked,
  onSelect,
  retainFocus,
}: FrameProps) {
  const element = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => () => retainFocus(element.current), [retainFocus]);
  return (
    <button
      ref={element}
      type="button"
      data-photo-id={photo.id}
      data-photo-index={index}
      aria-label={`${index + 1}. ${photo.name}`}
      aria-description={`Photo ${index + 1} of ${count}`}
      aria-pressed={pressed}
      className={active ? "is-active" : ""}
      tabIndex={tabStop ? 0 : -1}
      style={{ left }}
      onClick={(event) => onSelect(photo.id, event.shiftKey || event.metaKey || event.ctrlKey)}
    >
      <span className="develop-frame-number">{index + 1}</span>
      <DevelopFilmstripThumb photo={photo} />
      <span className="develop-frame-name">{photo.name}</span>
      {picked && <Check className="develop-frame-flag" size={12} />}
    </button>
  );
});

type View = ReturnType<typeof filmstripWindow> &
  Pick<FilmstripMetrics, "viewportWidth" | "itemWidth" | "gap" | "padding">;
const initialView = (): View => ({
  ...filmstripWindow({
    count: 0,
    viewportWidth: 0,
    scrollLeft: 0,
    itemWidth: 110,
    gap: 2,
    padding: 8,
  }),
  viewportWidth: 0,
  itemWidth: 110,
  gap: 2,
  padding: 8,
});
export type DevelopFilmstripProps = {
  photos: readonly DevelopPhoto[];
  documents: Readonly<Record<string, Pick<DevelopDocument, "metadata">>>;
  selected: string | null;
  selectedIds: ReadonlySet<string>;
  onSelect: (id: string, multi: boolean) => void;
};

export const DevelopFilmstrip = memo(function DevelopFilmstrip({
  photos,
  documents,
  selected,
  selectedIds,
  onSelect,
}: DevelopFilmstripProps) {
  const container = useRef<HTMLDivElement>(null);
  const current = useRef({ photos, selected, onSelect });
  current.current = { photos, selected, onSelect };
  const [view, setView] = useState(initialView);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusWithin = useRef(false),
    pendingFocus = useRef<string | null>(null);
  const frame = useRef<number | null>(null),
    alive = useRef(false);
  const indexById = useMemo(
    () => new Map(photos.map((photo, index) => [photo.id, index])),
    [photos],
  );
  const selectedIndex = selected === null ? undefined : indexById.get(selected);
  const readMetrics = useCallback((): FilmstripMetrics | null => {
    const element = container.current;
    if (!element) return null;
    const style = getComputedStyle(element);
    const value = (name: string, fallback: number) => {
      const parsed = Number.parseFloat(style.getPropertyValue(name));
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    };
    return {
      count: current.current.photos.length,
      viewportWidth: element.clientWidth,
      scrollLeft: element.scrollLeft,
      itemWidth: value("--develop-filmstrip-item-width", 110),
      gap: value("--develop-filmstrip-gap", 2),
      padding: value("--develop-filmstrip-padding", 8),
    };
  }, []);
  const measure = useCallback(() => {
    if (!alive.current) return;
    const metrics = readMetrics();
    if (!metrics) return;
    const next = {
      ...filmstripWindow(metrics),
      viewportWidth: metrics.viewportWidth,
      itemWidth: metrics.itemWidth,
      gap: metrics.gap,
      padding: metrics.padding,
    };
    setView((previous) =>
      Object.keys(next).every((key) => next[key as keyof View] === previous[key as keyof View])
        ? previous
        : next,
    );
  }, [readMetrics]);
  const scheduleMeasure = useCallback(() => {
    if (!alive.current || frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      measure();
    });
  }, [measure]);
  const reveal = useCallback(
    (index: number, focus: boolean) => {
      const metrics = readMetrics(),
        element = container.current;
      const photo = current.current.photos[index];
      if (!metrics || !element || !photo) return;
      if (focus) pendingFocus.current = photo.id;
      element.scrollLeft = filmstripScrollToIndex(metrics, index);
      measure();
      if (focus) {
        const target = Array.from(
          element.querySelectorAll<HTMLButtonElement>("button[data-photo-id]"),
        ).find((button) => button.dataset["photoId"] === photo.id);
        if (target) {
          target.focus({ preventScroll: true });
          pendingFocus.current = null;
        }
      }
    },
    [measure, readMetrics],
  );
  const retainFocus = useCallback((element: HTMLButtonElement | null) => {
    // Filtering can remove a focused logical photo. Keep focus in the surviving group,
    // not on body; normal scroll retains that one row and does not call this path.
    if (alive.current && element && document.activeElement === element)
      container.current?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    alive.current = true;
    const element = container.current;
    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    if (element) observer?.observe(element);
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      alive.current = false;
      observer?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [measure, scheduleMeasure]);

  useLayoutEffect(() => {
    if (selectedIndex !== undefined) reveal(selectedIndex, focusWithin.current);
    else measure();
  }, [selectedIndex, selected, reveal, measure]);
  useLayoutEffect(measure, [photos.length, measure]);
  useLayoutEffect(() => {
    const element = container.current,
      id = pendingFocus.current;
    if (!element || !id || !focusWithin.current) return;
    const target = Array.from(
      element.querySelectorAll<HTMLButtonElement>("button[data-photo-id]"),
    ).find((button) => button.dataset["photoId"] === id);
    if (target) {
      target.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  });

  const focusedIndex = focusedId === null ? null : (indexById.get(focusedId) ?? null);
  const indices = filmstripMountedIndices(
    Math.min(view.start, photos.length),
    Math.min(view.end, photos.length),
    focusedIndex,
    photos.length,
  );
  const tabIndex =
    focusedIndex ??
    (selectedIndex !== undefined && selectedIndex >= view.start && selectedIndex < view.end
      ? selectedIndex
      : view.firstVisible);
  return (
    <div
      ref={container}
      className="develop-filmstrip-items develop-filmstrip-virtual"
      role="group"
      aria-label="Filmstrip"
      aria-description={`${photos.length} photos. Use arrow keys to select photographs; Home and End select the first and last.`}
      tabIndex={photos.length ? -1 : 0}
      data-photo-count={photos.length}
      data-item-stride={view.stride}
      data-window-start={view.start}
      data-window-end={view.end}
      onScroll={scheduleMeasure}
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
        if (event.key !== "Home" && event.key !== "End") return;
        if (!photos.length || event.currentTarget.closest("[inert]")) return;
        event.preventDefault();
        event.stopPropagation();
        const index = event.key === "Home" ? 0 : photos.length - 1;
        reveal(index, true);
        onSelect(photos[index]!.id, event.shiftKey || event.metaKey || event.ctrlKey);
      }}
    >
      <div
        className="develop-filmstrip-spacer"
        aria-hidden="true"
        style={{ width: photos.length ? photos.length * view.stride - view.gap : 0 }}
      />
      {indices.map((index) => {
        const photo = photos[index]!;
        return (
          <Frame
            key={photo.id}
            photo={photo}
            index={index}
            count={photos.length}
            left={view.padding + index * view.stride}
            active={selected === photo.id}
            pressed={selectedIds.has(photo.id)}
            tabStop={index === tabIndex}
            picked={documents[photo.id]?.metadata.flag === "pick"}
            onSelect={onSelect}
            retainFocus={retainFocus}
          />
        );
      })}
    </div>
  );
});
