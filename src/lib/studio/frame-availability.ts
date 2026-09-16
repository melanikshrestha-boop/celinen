import type { Shot } from "@/lib/imaging";

export type FrameAvailability = "ready" | "unreadable" | "source-offline" | "preview-pending";

type AvailabilityInput = Pick<Shot, "error" | "previewUrl" | "sourceAvailable">;

const MIN_VISIBLE_BYTES = 32;

/** A frame with no image bytes is a ghost — do not keep or save it. */
export function studioFrameHasVisiblePhoto(
  shot: Pick<Shot, "error" | "previewBlob" | "file">,
): boolean {
  if (shot.error) return false;
  if ((shot.previewBlob?.size ?? 0) >= MIN_VISIBLE_BYTES) return true;
  if ((shot.file?.size ?? 0) >= MIN_VISIBLE_BYTES) return true;
  return false;
}

/** Keep decode failures distinct from pending or disconnected previews; none implies a verdict. */
export function frameAvailability(frame: AvailabilityInput): FrameAvailability {
  if (frame.error !== undefined) return "unreadable";
  if (frame.previewUrl) return "ready";
  if (frame.sourceAvailable === false) return "source-offline";
  return "preview-pending";
}

export function frameAvailabilityLabel(availability: FrameAvailability): string {
  switch (availability) {
    case "ready":
      return "preview ready";
    case "unreadable":
      return "unreadable; manual review required";
    case "source-offline":
      return "source offline; reconnect the original";
    case "preview-pending":
      return "preview pending";
  }
}

/**
 * Never paint a broken <img> (browsers show a "?" glyph). Untyped blobs and
 * failed decodes stay a placeholder until a typed JPEG/PNG/WebP URL exists.
 */
export function studioThumbPaint(input: {
  availability: FrameAvailability;
  previewUrl: string | null;
  mime?: string | undefined;
  broken?: boolean | undefined;
}): "image" | "placeholder" {
  if (input.broken) return "placeholder";
  if (input.availability !== "ready" || !input.previewUrl) return "placeholder";
  if (input.mime !== undefined && !input.mime.startsWith("image/")) return "placeholder";
  return "image";
}
