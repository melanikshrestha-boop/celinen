import { z } from "zod";
import type { DeliveryState, DeliveryVersion } from "./workflow";

// Closed choices, never arbitrary CSS, tracking URLs, or third-party fonts.
export const galleryDesignSchema = z
  .object({
    font: z.enum(["inherit", "sans", "editorial"]).default("inherit"),
    theme: z.enum(["inherit", "light", "dark"]).default("inherit"),
    layout: z.enum(["grid", "natural"]).default("grid"),
    spacing: z.enum(["comfortable", "compact"]).default("comfortable"),
    coverVersionIds: z
      .array(z.string().uuid())
      .max(3)
      .refine((ids) => new Set(ids).size === ids.length, "Choose each cover photo once.")
      .default([]),
  })
  .strict();
export type GalleryDesign = z.infer<typeof galleryDesignSchema>;

export const galleryPresentationSchema = z
  .object({
    studioName: z
      .string()
      .trim()
      .max(100)
      .refine(
        (value) => !Array.from(value).some((char) => char.charCodeAt(0) < 32),
        "Use a studio name without control characters.",
      ),
    showLensLabsCredit: z.boolean(),
    design: galleryDesignSchema.optional(),
  })
  .strict();
export type GalleryPresentation = z.infer<typeof galleryPresentationSchema>;

export function galleryPresentation(state: {
  presentation?: GalleryPresentation;
}): GalleryPresentation {
  const parsed = galleryPresentationSchema.safeParse(state.presentation);
  return parsed.success ? parsed.data : { studioName: "", showLensLabsCredit: true };
}

export const sameGalleryPresentation = (
  a: { presentation?: GalleryPresentation },
  b: { presentation?: GalleryPresentation },
) => JSON.stringify(galleryPresentation(a)) === JSON.stringify(galleryPresentation(b));

export function galleryDesign(state: { presentation?: GalleryPresentation }): GalleryDesign {
  return galleryDesignSchema.parse(galleryPresentation(state).design ?? {});
}

export function galleryDesignAttributes(state: { presentation?: GalleryPresentation }) {
  const design = galleryDesign(state);
  return {
    "data-gallery-font": design.font,
    "data-gallery-theme": design.theme,
    "data-gallery-layout": design.layout,
    "data-gallery-spacing": design.spacing,
  };
}

/** Cover IDs name immutable versions, never "whatever is latest". */
export function galleryCovers(state: DeliveryState, actor: "owner" | "client"): DeliveryVersion[] {
  return galleryDesign(state).coverVersionIds.flatMap((id) => {
    const photo = state.photos.find((p) => p.versions.some((v) => v.id === id));
    const version = photo?.versions.find((v) => v.id === id && v.ready);
    return version && (actor === "owner" || photo?.published === id) ? [version] : [];
  });
}

export function validateGalleryCovers(state: DeliveryState, presentation: GalleryPresentation) {
  const ids = galleryDesign({ presentation }).coverVersionIds;
  if (galleryCovers({ ...state, presentation }, "owner").length !== ids.length)
    throw new Error("Choose verified cover photos from this gallery. Refresh and try again.");
}
