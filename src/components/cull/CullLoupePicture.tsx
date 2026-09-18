import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { bitmapDecodeSupported, decodeScaled } from "@/lib/studio/cull/decode";
import { DecodedLru } from "@/lib/studio/cull/loupe-cache";
import type { LoupeImage, LoupeSourceKind } from "@/lib/studio/cull/loupe-source";
import {
  findPortraitFaceOriented,
  loupeFaceCrop,
  type FaceHint,
  type PortraitFace,
} from "@/lib/studio/cull/portrait-face";
import type { CullFrame } from "@/lib/studio/cull/session";
import type { CullThumbnailSource } from "./CullGrid";
import { createPictureView, layoutPicture, type PictureView } from "./picture-view";

/** The loupe's picture for a frame: the best source this browser has. Must keep its identity. */
export type CullLoupeSource = (frameId: string) => Promise<LoupeImage | null>;

// Current frame, both neighbours, and the two most recently left: stepping back
// and forth through a burst never decodes twice. At a 2560 px cap that is at
// most ~90 MB of pixels.
const CACHE_FRAMES = 5;
const MAX_EDGE = 2560;
/** How often a picture smaller than its box asks whether a better source has arrived. */
const UPGRADE_POLL_MS = 2000;
/** A drag shorter than this is a click. */
const CLICK_SLOP_PX = 4;

/** Decoded size: the screen's own pixels, never more than MAX_EDGE. */
function loupeEdge(): number {
  if (typeof window === "undefined") return MAX_EDGE;
  const ratio = window.devicePixelRatio || 1;
  const screen = Math.max(window.screen?.width ?? 0, window.screen?.height ?? 0) * ratio;
  return Math.min(MAX_EDGE, Math.max(1600, Math.ceil(screen)));
}

function imageKey(frameId: string, image: LoupeImage): string {
  // A different kind, size or date is a different picture (a reconnect upgrades
  // a preview to the original; a re-exported file changes its stamp).
  const stamp = image.blob instanceof File ? image.blob.lastModified : 0;
  return JSON.stringify([frameId, image.kind, image.blob.size, stamp]);
}

type Shown =
  | { frameId: string; key: string; kind: LoupeSourceKind; bitmap: ImageBitmap }
  | { frameId: string; key: string; kind: LoupeSourceKind; url: string };

/** Where the image sits in its box, as CSS variables overlays can position against. */
function setImageRect(
  element: HTMLElement,
  rect: { x: number; y: number; width: number; height: number } | null,
) {
  const style = element.style;
  if (!rect) {
    for (const name of ["x", "y", "w", "h"]) style.removeProperty(`--cull-img-${name}`);
    return;
  }
  style.setProperty("--cull-img-x", `${rect.x}px`);
  style.setProperty("--cull-img-y", `${rect.y}px`);
  style.setProperty("--cull-img-w", `${rect.width}px`);
  style.setProperty("--cull-img-h", `${rect.height}px`);
}

export function CullLoupePicture({
  frame,
  thumbnail,
  source,
  neighbors,
  epoch,
  onKind,
  onFace,
  view: sharedView,
  children,
  onPointerDown,
}: {
  frame: CullFrame;
  thumbnail: CullThumbnailSource;
  source: CullLoupeSource;
  /** Frames a step away, decoded ahead so the next keypress paints at once. */
  neighbors: readonly string[];
  /** Changes when better sources may have appeared (a reconnect), so the frame is asked again. */
  epoch: string;
  onKind?: ((kind: LoupeSourceKind | null) => void) | undefined;
  /** Told when a face is found on this frame, so the session can remember it. */
  onFace?: ((box: PortraitFace) => void) | undefined;
  /** Zoom and pan; shared between pictures to move them together. */
  view?: PictureView | undefined;
  /** Overlays, positioned with --cull-img-x/y/w/h. */
  children?: ReactNode;
  /** Told before a click or drag starts, e.g. to focus a compare pane. */
  onPointerDown?: (() => void) | undefined;
}) {
  const cache = useMemo(
    () => new DecodedLru<ImageBitmap>(CACHE_FRAMES, (bitmap) => bitmap.close()),
    [],
  );
  // The placeholder while the real picture decodes: the stored thumbnail.
  const thumbs = useMemo(
    () => new DecodedLru<ImageBitmap>(CACHE_FRAMES * 2, (bitmap) => bitmap.close()),
    [],
  );
  useEffect(
    () => () => {
      cache.clear();
      thumbs.clear();
    },
    [cache, thumbs],
  );
  const ownView = useMemo(() => createPictureView(), []);
  const view = sharedView ?? ownView;
  const keys = useRef(new Map<string, string>());
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [placeholder, setPlaceholder] = useState<{ frameId: string; bitmap: ImageBitmap } | null>(
    null,
  );
  const [upgrade, setUpgrade] = useState(0);
  // The face this picture is framed around, kept out of state so finding one
  // redraws the canvas instead of re-rendering the loupe.
  const foundFace = useRef<{ id: string; box: PortraitFace } | null>(null);
  const edge = useMemo(loupeEdge, []);
  const neighborKey = JSON.stringify(neighbors);
  const current = shown?.frameId === frame.id ? shown : null;
  const kind = current?.kind ?? null;

  useEffect(() => onKind?.(kind), [kind, onKind]);

  // A frame decoded ahead of time paints before the browser does: no thumbnail flash.
  useLayoutEffect(() => {
    const key = keys.current.get(frame.id);
    const bitmap = key ? cache.peek(key) : null;
    if (key && bitmap)
      setShown((previous) =>
        previous?.key === key ? previous : { frameId: frame.id, key, kind: kindOf(key), bitmap },
      );
  }, [frame.id, cache]);

  useEffect(() => {
    let live = true;
    const decode = (id: string, image: LoupeImage) => {
      const key = imageKey(id, image);
      keys.current.set(id, key);
      return {
        key,
        bitmap: bitmapDecodeSupported()
          ? cache.get(key, () => decodeScaled(image.blob, edge))
          : Promise.resolve(null),
      };
    };
    const warm = () => {
      for (const id of JSON.parse(neighborKey) as string[]) {
        void source(id).then(
          (image) => {
            if (live && image) void decode(id, image).bitmap;
          },
          () => {},
        );
      }
    };
    if (bitmapDecodeSupported() && !cache.peek(keys.current.get(frame.id) ?? ""))
      void thumbnail(frame.id).then(
        (blob) =>
          blob
            ? thumbs
                .get(frame.id, () => createImageBitmap(blob))
                .then((bitmap) => {
                  if (live && bitmap) setPlaceholder({ frameId: frame.id, bitmap });
                })
            : undefined,
        () => {},
      );
    source(frame.id).then(
      async (image) => {
        if (!live) return;
        if (!image) {
          setShown(null);
          return warm();
        }
        const { key, bitmap: pending } = decode(frame.id, image);
        const bitmap = await pending;
        if (!live) return;
        if (bitmap)
          setShown((previous) =>
            previous?.key === key ? previous : { frameId: frame.id, key, kind: image.kind, bitmap },
          );
        // No ImageBitmap in this browser, or it could not decode: the <img> decoder may.
        else
          setShown({
            frameId: frame.id,
            key,
            kind: image.kind,
            url: URL.createObjectURL(image.blob),
          });
        warm();
      },
      () => {
        if (live) setShown(null);
      },
    );
    return () => {
      live = false;
    };
  }, [frame.id, epoch, source, thumbnail, neighborKey, cache, thumbs, edge, upgrade]);

  useEffect(() => {
    if (!shown || !("url" in shown)) return;
    return () => URL.revokeObjectURL(shown.url);
  }, [shown]);

  // What is on the canvas: the real picture once decoded, the thumbnail until then.
  const bitmap =
    current && "bitmap" in current
      ? current.bitmap
      : placeholder?.frameId === frame.id
        ? placeholder.bitmap
        : null;

  const draw = useCallback(() => {
    const element = canvas.current;
    const container = box.current;
    if (!element || !container) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    const backingWidth = Math.max(1, Math.round(width * dpr));
    const backingHeight = Math.max(1, Math.round(height * dpr));
    if (element.width !== backingWidth) element.width = backingWidth;
    if (element.height !== backingHeight) element.height = backingHeight;
    const context = element.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, backingWidth, backingHeight);
    if (!bitmap || !width || !height) return setImageRect(container, null);
    const state = view.get();
    // Fitted, a portrait is shown around the face that was found; at 100% the
    // whole frame is there to inspect, because that is what zoom is for.
    const crop = state.zoomed
      ? null
      : loupeFaceCrop(
          faceBox(frame, foundFace.current),
          Boolean(faceBox(frame, foundFace.current)),
          bitmap.width,
          bitmap.height,
        );
    const source = crop ?? { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
    let layout;
    try {
      layout = layoutPicture({ width: source.w, height: source.h }, { width, height }, dpr, state);
    } catch {
      return;
    }
    setImageRect(container, layout.image);
    const { image, scale } = layout;
    // Only the part of the image inside the box is drawn, straight into device pixels.
    const left = Math.max(0, image.x);
    const top = Math.max(0, image.y);
    const right = Math.min(width, image.x + image.width);
    const bottom = Math.min(height, image.y + image.height);
    if (right <= left || bottom <= top) return;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    try {
      context.drawImage(
        bitmap,
        source.x + (left - image.x) / scale,
        source.y + (top - image.y) / scale,
        (right - left) / scale,
        (bottom - top) / scale,
        left * dpr,
        top * dpr,
        (right - left) * dpr,
        (bottom - top) * dpr,
      );
    } catch {
      // Released from the cache before it painted: ask for the frame again.
      setShown(null);
    }
  }, [bitmap, view, frame]);

  useLayoutEffect(draw, [draw]);

  // The face this frame is framed around: one found here, the one the ingest
  // engine measured, or none. Chrome's FaceDetector is tried first because it
  // is free; findPortraitFaceOriented is what Safari and Firefox have.
  useEffect(() => {
    if (!bitmap) return;
    if (foundFace.current?.id === frame.id) return;
    let live = true;
    const remember = (box: PortraitFace) => {
      if (!live) return;
      foundFace.current = { id: frame.id, box };
      onFace?.(box);
      draw();
    };
    const detector = faceDetector();
    if (detector) {
      void detector.detect(bitmap).then((faces) => {
        if (!live || !faces.length) return;
        const biggest = faces.reduce((a, b) =>
          a.boundingBox.width * a.boundingBox.height >= b.boundingBox.width * b.boundingBox.height
            ? a
            : b,
        );
        remember({
          x: biggest.boundingBox.x / bitmap.width,
          y: biggest.boundingBox.y / bitmap.height,
          width: biggest.boundingBox.width / bitmap.width,
          height: biggest.boundingBox.height / bitmap.height,
        });
      }, noFace);
      return () => {
        live = false;
      };
    }
    const found = probeFace(bitmap, frame);
    if (found) remember(found);
    return () => {
      live = false;
    };
  }, [bitmap, frame, onFace, draw]);

  useEffect(() => {
    const container = box.current;
    if (!container) return;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(draw);
    observer?.observe(container);
    const stop = view.subscribe(draw);
    // A window dragged to a screen of another density changes devicePixelRatio.
    window.addEventListener("resize", draw);
    return () => {
      observer?.disconnect();
      stop();
      window.removeEventListener("resize", draw);
    };
  }, [draw, view]);

  // A picture smaller than its box may have a better source on the way (a
  // review preview still being made): ask again now and then, and swap it in
  // place when it lands.
  const decodedEdge =
    current && "bitmap" in current ? Math.max(current.bitmap.width, current.bitmap.height) : 0;
  useEffect(() => {
    if (!current || current.kind === "original" || current.kind === "reconnected") return;
    const timer = setInterval(() => {
      const container = box.current;
      if (!container || document.visibilityState === "hidden") return;
      const needed =
        Math.max(container.clientWidth, container.clientHeight) * (window.devicePixelRatio || 1);
      if (current.kind === "thumbnail" || decodedEdge < Math.min(needed, edge) * 0.95)
        setUpgrade((value) => value + 1);
    }, UPGRADE_POLL_MS);
    return () => clearInterval(timer);
  }, [current, decodedEdge, edge]);

  // Click zooms to 100% at that point, or back to fit; a drag pans every picture on the view.
  const drag = useRef<{ x: number; y: number; moved: boolean; id: number } | null>(null);
  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerDown?.();
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, moved: false, id: event.pointerId };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    const container = box.current;
    if (!start || start.id !== event.pointerId || !container || !bitmap) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < CLICK_SLOP_PX) return;
    start.moved = true;
    const state = view.get();
    if (!state.zoomed) return;
    const layout = layoutPicture(
      { width: bitmap.width, height: bitmap.height },
      { width: container.clientWidth, height: container.clientHeight },
      window.devicePixelRatio || 1,
      state,
    );
    start.x = event.clientX;
    start.y = event.clientY;
    // Clamped by this picture, so a drag past the edge does not bank distance.
    const next = layoutPicture(
      { width: bitmap.width, height: bitmap.height },
      { width: container.clientWidth, height: container.clientHeight },
      window.devicePixelRatio || 1,
      {
        zoomed: true,
        cx: layout.cx - dx / layout.image.width,
        cy: layout.cy - dy / layout.image.height,
      },
    );
    view.set({ cx: next.cx, cy: next.cy });
  };
  const pointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    drag.current = null;
    const container = box.current;
    if (!start || start.id !== event.pointerId || start.moved || !container || !bitmap) return;
    const state = view.get();
    if (state.zoomed) return view.set({ zoomed: false });
    const layout = layoutPicture(
      { width: bitmap.width, height: bitmap.height },
      { width: container.clientWidth, height: container.clientHeight },
      window.devicePixelRatio || 1,
      state,
    );
    const bounds = container.getBoundingClientRect();
    const cx = (event.clientX - bounds.left - layout.image.x) / layout.image.width;
    const cy = (event.clientY - bounds.top - layout.image.y) / layout.image.height;
    if (cx < 0 || cx > 1 || cy < 0 || cy > 1) return;
    view.set({ zoomed: true, cx, cy });
  };

  if (current && "url" in current)
    return (
      <div className="cull-picture" ref={box}>
        <img src={current.url} alt="" decoding="async" data-loupe-source={current.kind} />
      </div>
    );
  return (
    <div
      className="cull-picture"
      ref={box}
      data-loupe-source={current?.kind ?? (bitmap ? "thumbnail" : undefined)}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={() => (drag.current = null)}
    >
      <canvas ref={canvas} aria-hidden="true" />
      {bitmap && children}
    </div>
  );
}

function kindOf(key: string): LoupeSourceKind {
  return (JSON.parse(key) as [string, LoupeSourceKind])[1];
}

function noFace() {
  /* no face is an answer, not a failure */
}

/** The face the loupe frames this photo around: one found in the loupe itself,
 * else the one the ingest engine measured. */
function faceBox(
  frame: CullFrame,
  found: { id: string; box: PortraitFace } | null,
): PortraitFace | undefined {
  if (found?.id === frame.id) return found.box;
  return frame.reading?.faceBox;
}

type Detector = { detect: (source: ImageBitmap) => Promise<{ boundingBox: DOMRectReadOnly }[]> };

/** Chrome's own face finder, when this browser has it. */
function faceDetector(): Detector | null {
  const Ctor = (
    globalThis as unknown as {
      FaceDetector?: new (options: { fastMode: boolean; maxDetectedFaces: number }) => Detector;
    }
  ).FaceDetector;
  if (!Ctor) return null;
  try {
    return new Ctor({ fastMode: true, maxDetectedFaces: 4 });
  } catch {
    return null;
  }
}

/** Safari and Firefox: the portrait finder, over a small copy of the picture. */
function probeFace(bitmap: ImageBitmap, frame: CullFrame): PortraitFace | null {
  if (typeof document === "undefined") return null;
  try {
    const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(16, Math.round(bitmap.width * scale));
    const h = Math.max(16, Math.round(bitmap.height * scale));
    const probe = document.createElement("canvas");
    probe.width = w;
    probe.height = h;
    const context = probe.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, w, h);
    const box = frame.reading?.faceBox;
    const hint: FaceHint | undefined =
      frame.reading?.afBox ??
      (box ? { x: box.x, y: box.y, w: box.width, h: box.height } : undefined);
    return (
      findPortraitFaceOriented(context.getImageData(0, 0, w, h).data, w, h, hint)?.uprightBox ??
      null
    );
  } catch {
    return null;
  }
}
