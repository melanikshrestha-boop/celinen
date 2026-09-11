import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import {
  developPixelCoordinate,
  readDevelopPixelSample,
  type DevelopPixelSample,
} from "@/lib/develop/pixel-sample";

export type { DevelopPixelSample } from "@/lib/develop/pixel-sample";

/** Reads only one pixel from the existing image, at most once per animation frame. */
export function useDevelopPixelSample({
  image,
  sourceUrl,
  enabled,
  onSample,
}: {
  image: RefObject<HTMLImageElement | null>;
  sourceUrl: string | null;
  enabled: boolean;
  onSample: (sample: DevelopPixelSample | null) => void;
}) {
  const live = useRef({ image, sourceUrl, enabled, onSample });
  live.current = { image, sourceUrl, enabled, onSample };
  const frame = useRef<number | null>(null);
  const pointer = useRef({
    x: 0,
    y: 0,
    image: null as HTMLImageElement | null,
    url: null as string | null,
  });
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const context = useRef<CanvasRenderingContext2D | null>(null);
  const published = useRef<DevelopPixelSample | null>(null);
  const failed = useRef(false);
  const mounted = useRef(false);

  const publish = useCallback((next: DevelopPixelSample | null, force = false) => {
    const previous = published.current;
    if (
      !force &&
      (previous === next ||
        (previous &&
          next &&
          previous.x === next.x &&
          previous.y === next.y &&
          previous.red === next.red &&
          previous.green === next.green &&
          previous.blue === next.blue &&
          previous.alpha === next.alpha))
    )
      return;
    published.current = next;
    live.current.onSample(next);
  }, []);
  const clear = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    pointer.current.image = null;
    pointer.current.url = null;
    publish(null);
  }, [publish]);
  const sampleFrame = useCallback(() => {
    frame.current = null;
    const current = live.current;
    const target = current.image.current;
    if (
      !mounted.current ||
      !current.enabled ||
      !current.sourceUrl ||
      !target ||
      target !== pointer.current.image ||
      current.sourceUrl !== pointer.current.url ||
      target.currentSrc !== current.sourceUrl ||
      !target.complete ||
      !target.isConnected ||
      target.hidden ||
      failed.current
    ) {
      publish(null);
      return;
    }
    const style = getComputedStyle(target);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0" ||
      // The Develop image uses centered contain. Do not invent a mapping for another layout.
      (style.objectFit !== "contain" && style.objectFit !== "fill") ||
      (style.objectFit === "contain" && style.objectPosition !== "50% 50%")
    ) {
      publish(null);
      return;
    }
    const point = developPixelCoordinate(
      pointer.current.x,
      pointer.current.y,
      target.getBoundingClientRect(),
      target.naturalWidth,
      target.naturalHeight,
      style.objectFit,
    );
    if (!point) {
      publish(null);
      return;
    }
    try {
      if (!canvas.current) {
        canvas.current = document.createElement("canvas");
        canvas.current.width = canvas.current.height = 1;
        context.current = canvas.current.getContext("2d", {
          colorSpace: "srgb",
          willReadFrequently: true,
        });
      }
      if (!context.current) {
        failed.current = true;
        publish(null);
        return;
      }
      publish(readDevelopPixelSample(target, context.current, point));
    } catch {
      // A tainted or unreadable image has no honest RGB readout; retry only after ownership changes.
      failed.current = true;
      publish(null);
    }
  }, [publish]);
  const onPointerMove = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const current = live.current;
      if (!mounted.current || !current.enabled || !current.sourceUrl) return;
      pointer.current.x = event.clientX;
      pointer.current.y = event.clientY;
      pointer.current.image = current.image.current;
      pointer.current.url = current.sourceUrl;
      if (frame.current === null) frame.current = requestAnimationFrame(sampleFrame);
    },
    [sampleFrame],
  );
  useLayoutEffect(() => {
    mounted.current = true;
    failed.current = false;
    clear();
    publish(null, true);
    // Reset the backing store so a previous source's taint cannot carry over.
    if (canvas.current) canvas.current.width = canvas.current.height = 1;
    return () => {
      mounted.current = false;
      clear();
      if (canvas.current) canvas.current.width = canvas.current.height = 0;
    };
  }, [image, sourceUrl, enabled, clear, publish]);

  return { onPointerMove, onPointerLeave: clear };
}
