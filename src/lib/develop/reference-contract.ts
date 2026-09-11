import { z } from "zod";
import { defaultDevelopSettings, developSettingsSchema } from "./contract";

export const REFERENCE_LIMITS = Object.freeze({
  minSide: 16,
  maxSide: 128,
  maxPacketBytes: 131080,
});
export const referencePatchSchema = developSettingsSchema
  .pick({
    contrast: true,
    highlights: true,
    shadows: true,
    whites: true,
    blacks: true,
    saturation: true,
    curve: true,
    channelCurves: true,
    grading: true,
  })
  .strict();
const unit = z.number().finite().min(0).max(1);
export const referenceDiagnosticsSchema = z
  .object({
    beforeRmse: unit,
    afterRmse: unit,
    improvement: unit,
    alignment: z.number().finite().min(-1).max(1),
    gradientAlignment: z.number().finite().min(-1).max(1),
    clippedFraction: unit,
    evaluations: z.number().int().min(1).max(1000),
    fitPixels: z.number().int().min(1).max(1024),
    validationPixels: z.number().int().min(1).max(1024),
    weakAlignment: z.boolean(),
    poorFit: z.boolean(),
  })
  .strict()
  .refine((v) => v.afterRmse <= v.beforeRmse + 1e-10, "Fit cannot worsen held-out error.");
export const referenceNativeReceiptSchema = z
  .object({
    patch: referencePatchSchema,
    diagnostics: referenceDiagnosticsSchema,
  })
  .strict();
export const referenceResultSchema = z
  .object({
    settings: developSettingsSchema,
    diagnostics: referenceDiagnosticsSchema,
    method: z.literal("bounded-srgb-reference-fit-v1"),
    warnings: z.array(z.string().max(300)).max(8),
  })
  .strict();
export type ReferenceFitResult = z.infer<typeof referenceResultSchema>;
export function referenceResult(input: unknown): ReferenceFitResult {
  const { patch, diagnostics } = referenceNativeReceiptSchema.parse(input);
  const warnings = [
    "Same frame and crop required; alignment checks are not proof. Approximate sRGB look, not recovered editing settings. Camera profiles, local masks and retouching are not inferred.",
  ];
  if (diagnostics.weakAlignment)
    warnings.push(
      "Shared detail is weak. Check that this is the same frame, crop and orientation before saving.",
    );
  if (diagnostics.poorFit)
    warnings.push(
      "Substantial differences remain. Review the preview; this preset cannot reproduce the reference closely.",
    );
  if (diagnostics.clippedFraction > 0.15)
    warnings.push(
      "The reference contains clipped colors. Lost highlight or shadow detail cannot be recovered.",
    );
  return referenceResultSchema.parse({
    settings: { ...defaultDevelopSettings(), ...patch },
    diagnostics,
    method: "bounded-srgb-reference-fit-v1",
    warnings,
  });
}
export function referencePreviewSize(width: number, height: number) {
  if (![width, height].every((v) => Number.isSafeInteger(v) && v > 0 && v <= 4096))
    throw new Error("Invalid reference preview dimensions.");
  const scale = Math.min(1, REFERENCE_LIMITS.maxSide / Math.max(width, height));
  const size = { width: Math.round(width * scale), height: Math.round(height * scale) };
  if (Math.min(size.width, size.height) < REFERENCE_LIMITS.minSide)
    throw new Error("This photo is too narrow or too small for a reliable paired fit.");
  return size;
}
export function assertReferenceAspect(
  source: { width: number; height: number },
  target: { width: number; height: number },
) {
  referencePreviewSize(source.width, source.height);
  referencePreviewSize(target.width, target.height);
  if (Math.abs(Math.log(source.width / source.height / (target.width / target.height))) > 0.015)
    throw new Error(
      "Use the same uncropped frame and orientation. The original and edited photo have different proportions.",
    );
}
export function encodeReferencePair(
  width: number,
  height: number,
  source: Uint8Array,
  edited: Uint8Array,
): Blob {
  if (
    ![width, height].every(
      (v) => Number.isInteger(v) && v >= REFERENCE_LIMITS.minSide && v <= REFERENCE_LIMITS.maxSide,
    ) ||
    source.byteLength !== width * height * 4 ||
    edited.byteLength !== source.byteLength
  )
    throw new Error("Invalid aligned reference preview.");
  for (const image of [source, edited])
    for (let p = 3; p < image.length; p += 4)
      if (image[p] !== 255) throw new Error("Use opaque photos without transparent borders.");
  const header = new Uint8Array(8),
    view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  return new Blob([header, new Uint8Array(source), new Uint8Array(edited)], {
    type: "application/x-foto-reference",
  });
}
