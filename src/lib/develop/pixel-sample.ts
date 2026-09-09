/** An sRGB pixel in the displayed, decoded preview—not sensor RAW values. */
export type DevelopPixelSample = {
  red: number;
  green: number;
  blue: number;
  alpha: number;
  x: number;
  y: number;
};

export type DevelopPixelSampleSnapshot = Readonly<{
  url: string;
  sample: Readonly<DevelopPixelSample>;
}> | null;

export type DevelopPixelSampleChannel = {
  publish: (snapshot: DevelopPixelSampleSnapshot) => void;
  getSnapshot: () => DevelopPixelSampleSnapshot;
  subscribe: (listener: () => void) => () => void;
};

/** A component-local external store: photo hover updates only its subscribed readout. */
export function createDevelopPixelSampleChannel(): DevelopPixelSampleChannel {
  let snapshot: DevelopPixelSampleSnapshot = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(next) {
      if (
        snapshot === next ||
        (snapshot &&
          next &&
          snapshot.url === next.url &&
          snapshot.sample.red === next.sample.red &&
          snapshot.sample.green === next.sample.green &&
          snapshot.sample.blue === next.sample.blue &&
          snapshot.sample.alpha === next.sample.alpha &&
          snapshot.sample.x === next.sample.x &&
          snapshot.sample.y === next.sample.y)
      )
        return;
      // Callers cannot mutate the committed snapshot behind React's subscription boundary.
      snapshot = next
        ? Object.freeze({ url: next.url, sample: Object.freeze({ ...next.sample }) })
        : null;
      for (const listener of [...listeners]) {
        if (!listeners.has(listener)) continue;
        try {
          listener();
        } catch {
          /* A failed observer must not break the other readouts. */
        }
      }
    },
  };
}

type PixelBounds = { left: number; top: number; width: number; height: number };

/** Maps a pointer to a source pixel; centered contain letterboxes are not image pixels. */
export function developPixelCoordinate(
  clientX: number,
  clientY: number,
  bounds: PixelBounds,
  width: number,
  height: number,
  fit: "contain" | "fill" = "contain",
): { x: number; y: number } | null {
  if (
    ![clientX, clientY, bounds.left, bounds.top, bounds.width, bounds.height, width, height].every(
      Number.isFinite,
    ) ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  )
    return null;
  const scale = Math.min(bounds.width / width, bounds.height / height);
  const displayWidth = fit === "fill" ? bounds.width : width * scale;
  const displayHeight = fit === "fill" ? bounds.height : height * scale;
  const x = clientX - bounds.left - (bounds.width - displayWidth) / 2;
  const y = clientY - bounds.top - (bounds.height - displayHeight) / 2;
  if (x < 0 || y < 0 || x > displayWidth || y > displayHeight) return null;
  return {
    x: Math.min(width - 1, Math.floor((x / displayWidth) * width)),
    y: Math.min(height - 1, Math.floor((y / displayHeight) * height)),
  };
}

export function readDevelopPixelSample(
  image: HTMLImageElement,
  context: CanvasRenderingContext2D,
  point: { x: number; y: number },
): DevelopPixelSample {
  // Clearing matters for partially transparent pixels: never composite over a prior sample.
  context.clearRect(0, 0, 1, 1);
  context.imageSmoothingEnabled = false;
  context.drawImage(image, point.x, point.y, 1, 1, 0, 0, 1, 1);
  const bytes = context.getImageData(0, 0, 1, 1).data;
  return { red: bytes[0]!, green: bytes[1]!, blue: bytes[2]!, alpha: bytes[3]!, ...point };
}

export function developPixelSampleText(sample: DevelopPixelSample) {
  if (sample.alpha === 0) return "Transparent pixel";
  return `R ${sample.red} · G ${sample.green} · B ${sample.blue}${sample.alpha < 255 ? ` · A ${sample.alpha}` : ""}`;
}

export function developPixelSampleDescription(sample: DevelopPixelSample, sourceLabel: string) {
  return `${sourceLabel}, sRGB pixel at ${sample.x}, ${sample.y}: red ${sample.red}, green ${sample.green}, blue ${sample.blue}, alpha ${sample.alpha} (0–255)${sample.alpha === 0 ? ", transparent" : ""}`;
}
