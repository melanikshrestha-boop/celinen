import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  onFace,
}: {
  frame: CullFrame;
  thumbnail: CullThumbnailSource;
  source: CullLoupeSource;
  /** Frames a step away, decoded ahead so the next keypress paints at once. */
  neighbors: readonly string[];
  /** Changes when better sources may have appeared (a reconnect), so the frame is asked again. */
  epoch: string;
  onKind?: ((kind: LoupeSourceKind | null) => void) | undefined;
  onFace?: ((box: PortraitFace) => void) | undefined;
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

  const foundFace = useRef<{ id: string; box: PortraitFace } | null>(null);

  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element || !shown || !("bitmap" in shown)) return;
    try {
      const bitmap = shown.bitmap;
      let box =
        shown.frameId === frame.id && foundFace.current?.id === frame.id
          ? foundFace.current.box
          : undefined;
      if (!box && shown.frameId === frame.id) {
        const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(16, Math.round(bitmap.width * scale));
        const h = Math.max(16, Math.round(bitmap.height * scale));
        const probe = document.createElement("canvas");
        probe.width = w;
        probe.height = h;
        const probeCtx = probe.getContext("2d");
        if (probeCtx) {
          probeCtx.drawImage(bitmap, 0, 0, w, h);
          const hint: FaceHint | undefined = frame.reading?.afBox
            ? frame.reading.afBox
            : frame.reading?.faceBox
              ? {
                  x: frame.reading.faceBox.x,
                  y: frame.reading.faceBox.y,
                  w: frame.reading.faceBox.width,
                  h: frame.reading.faceBox.height,
                }
              : undefined;
          const found = findPortraitFaceOriented(
            probeCtx.getImageData(0, 0, w, h).data,
            w,
            h,
            hint,
          );
          if (found) {
            foundFace.current = { id: frame.id, box: found.uprightBox };
            box = found.uprightBox;
            onFace?.(found.uprightBox);
          } else if (frame.reading?.faceBox) {
            box = frame.reading.faceBox;
          }
        }
      }
      const crop = loupeFaceCrop(box, Boolean(box), bitmap.width, bitmap.height);
      const width = crop ? Math.max(1, Math.round(crop.w)) : bitmap.width;
      const height = crop ? Math.max(1, Math.round(crop.h)) : bitmap.height;
      if (element.width !== width) element.width = width;
      if (element.height !== height) element.height = height;
      const ctx = element.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingQuality = "high";
      if (crop) ctx.drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
      else ctx.drawImage(bitmap, 0, 0);
    } catch {
      // Released from the cache before it painted: ask for the frame again.
      setShown(null);
    }
  }, [shown, frame.id, frame.reading?.faceBox, frame.reading?.afBox, onFace]);

  useEffect(() => {
    if (!shown || !("bitmap" in shown) || shown.frameId !== frame.id) return;
    const Ctor = (
      globalThis as unknown as {
        FaceDetector?: new (options: { fastMode: boolean; maxDetectedFaces: number }) => {
          detect: (source: ImageBitmap) => Promise<{ boundingBox: DOMRectReadOnly }[]>;
        };
      }
    ).FaceDetector;
    if (!Ctor) return;
    let live = true;
    try {
      const detector = new Ctor({ fastMode: true, maxDetectedFaces: 4 });
      void detector.detect(shown.bitmap).then(
        (faces) => {
          if (!live || !faces.length) return;
          const biggest = faces.reduce((a, b) =>
            a.boundingBox.width * a.boundingBox.height >= b.boundingBox.width * b.boundingBox.height
              ? a
              : b,
          );
          const box: PortraitFace = {
            x: biggest.boundingBox.x / shown.bitmap.width,
            y: biggest.boundingBox.y / shown.bitmap.height,
            width: biggest.boundingBox.width / shown.bitmap.width,
            height: biggest.boundingBox.height / shown.bitmap.height,
          };
          foundFace.current = { id: frame.id, box };
          onFace?.(box);
        },
        () => {},
      );
    } catch {
      /* Safari and Firefox have no FaceDetector. */
    }
    return () => {
      live = false;
    };
  }, [shown, frame.id, onFace]);

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
