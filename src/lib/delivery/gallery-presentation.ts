import { z } from "zod";

const galleryPresentationInputSchema = z
  .object({
    studioName: z
      .string()
      .trim()
      .max(100)
      .refine(
        (value) => !Array.from(value).some((char) => char.charCodeAt(0) < 32),
        "Use a studio name without control characters.",
      ),
    showCelinenCredit: z.boolean().optional(),
    /** @deprecated Prefer showCelinenCredit; still accepted when reading saved galleries. */
    showLensLabsCredit: z.boolean().optional(),
  })
  .strict();

export const galleryPresentationSchema = galleryPresentationInputSchema.transform((data) => ({
  studioName: data.studioName,
  showCelinenCredit: data.showCelinenCredit ?? data.showLensLabsCredit ?? true,
}));

export type GalleryPresentation = z.infer<typeof galleryPresentationSchema>;

export function galleryPresentation(state: {
  presentation?: unknown;
}): GalleryPresentation {
  const parsed = galleryPresentationSchema.safeParse(state.presentation);
  return parsed.success ? parsed.data : { studioName: "", showCelinenCredit: true };
}

export const sameGalleryPresentation = (
  a: { presentation?: unknown },
  b: { presentation?: unknown },
) => JSON.stringify(galleryPresentation(a)) === JSON.stringify(galleryPresentation(b));
