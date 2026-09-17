import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { bitmapDecodeSupported, decodeScaled } from "@/lib/studio/cull/decode";
import { DecodedLru } from "@/lib/studio/cull/loupe-cache";
import type { LoupeImage, LoupeSourceKind } from "@/lib/studio/cull/loupe-source";
import type { CullFrame } from "@/lib/studio/cull/session";
import { CullThumb, type CullThumbnailSource } from "./CullGrid";

/** The loupe's picture for a frame: the best source this browser has. Must keep its identity. */
export type CullLoupeSource = (frameId: string) => Promise<LoupeImage | null>;

// Current frame, both neighbours, and the two most recently left: stepping back
// and forth through a burst never decodes twice. At a 2560 px cap that is at
// most ~90 MB of pixels.
const CACHE_FRAMES = 5;
const MAX_EDGE = 2560;

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

export function CullLoupePicture({
  frame,
  thumbnail,
  source,
  neighbors,
  epoch,
  onKind,
}: {
  frame: CullFrame;
  thumbnail: CullThumbnailSource;
  source: CullLoupeSource;
  /** Frames a step away, decoded ahead so the next keypress paints at once. */
  neighbors: readonly string[];
  /** Changes when better sources may have appeared (a reconnect), so the frame is asked again. */
  epoch: string;
  onKind?: ((kind: LoupeSourceKind | null) => void) | undefined;
}) {
  const cache = useMemo(
    () => new DecodedLru<ImageBitmap>(CACHE_FRAMES, (bitmap) => bitmap.close()),
    [],
  );
  useEffect(() => () => cache.clear(), [cache]);
  const keys = useRef(new Map<string, string>());
  const canvas = useRef<HTMLCanvasElement>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const edge = useMemo(loupeEdge, []);
  const neighborKey = JSON.stringify(neighbors);
  const kind = shown?.frameId === frame.id ? shown.kind : null;

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
  }, [frame.id, epoch, source, neighborKey, cache, edge]);

  useEffect(() => {
    if (!shown || !("url" in shown)) return;
    return () => URL.revokeObjectURL(shown.url);
  }, [shown]);

  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element || !shown || !("bitmap" in shown)) return;
    try {
      if (element.width !== shown.bitmap.width) element.width = shown.bitmap.width;
      if (element.height !== shown.bitmap.height) element.height = shown.bitmap.height;
      element.getContext("2d")?.drawImage(shown.bitmap, 0, 0);
    } catch {
      // Released from the cache before it painted: ask for the frame again.
      setShown(null);
    }
  }, [shown]);

  if (!shown || shown.frameId !== frame.id)
    return <CullThumb frame={frame} thumbnail={thumbnail} />;
  if ("bitmap" in shown)
    return (
      <canvas
        ref={canvas}
        data-loupe-source={shown.kind}
        width={shown.bitmap.width}
        height={shown.bitmap.height}
        aria-hidden="true"
      />
    );
  return <img src={shown.url} alt="" decoding="async" data-loupe-source={shown.kind} />;
}

function kindOf(key: string): LoupeSourceKind {
  return (JSON.parse(key) as [string, LoupeSourceKind])[1];
}
