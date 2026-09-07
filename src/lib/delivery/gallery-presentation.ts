import { z } from "zod";

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
