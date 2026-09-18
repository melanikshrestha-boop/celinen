/** How a loupe or compare picture is framed: fitted, or at 100% around a point.
 *
 * One view can drive several pictures at once (compare's synced zoom and pan).
 * It lives outside React on purpose: a pan is sixty updates a second, and each
 * one redraws canvases directly instead of re-rendering a component tree.
 */

export type PictureViewState = {
  /** false fits the picture to its box; true shows one image pixel per device pixel. */
  zoomed: boolean;
  /** The image point at the centre of the box, 0..1 of the image. */
  cx: number;
  cy: number;
};

export type PictureView = {
  get(): PictureViewState;
  set(next: Partial<PictureViewState>): void;
  subscribe(listener: () => void): () => void;
};

export function createPictureView(initial?: Partial<PictureViewState>): PictureView {
  let state: PictureViewState = { zoomed: false, cx: 0.5, cy: 0.5, ...initial };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      const merged = { ...state, ...next };
      if (merged.zoomed === state.zoomed && merged.cx === state.cx && merged.cy === state.cy)
        return;
      state = merged;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

/** Where an image sits in its box, in CSS pixels, and which part of it shows. */
export type PictureLayout = {
  /** The whole image's rectangle relative to the box (may extend past it when zoomed). */
  image: Rect;
  /** CSS pixels per image pixel. */
  scale: number;
  /** The view centre after clamping, so the image never pans off its box. */
  cx: number;
  cy: number;
};

/**
 * Lays out an image of `image` pixels in a `box` of CSS pixels at device pixel
 * ratio `dpr`. A picture is never drawn larger than one image pixel per device
 * pixel: a small source stays small and sharp rather than being silently
 * upscaled. Zoomed is exactly that 1:1 scale, centred on the view point.
 */
export function layoutPicture(
  image: Size,
  box: Size,
  dpr: number,
  view: PictureViewState,
): PictureLayout {
  const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const native = 1 / ratio;
  const fit =
    image.width > 0 && image.height > 0
      ? Math.min(box.width / image.width, box.height / image.height, native)
      : native;
  const scale = view.zoomed ? native : fit;
  const width = image.width * scale;
  const height = image.height * scale;
  const axis = (shown: number, room: number, centre: number) => {
    // Smaller than the box on this axis: centred, and nothing to pan.
    if (shown <= room) return { offset: (room - shown) / 2, centre: 0.5 };
    const half = room / shown / 2;
    const clamped = Math.min(1 - half, Math.max(half, centre));
    return { offset: room / 2 - clamped * shown, centre: clamped };
  };
  const x = axis(width, box.width, view.cx);
  const y = axis(height, box.height, view.cy);
  return { image: { x: x.offset, y: y.offset, width, height }, scale, cx: x.centre, cy: y.centre };
}
