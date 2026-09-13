import { z } from "zod";
import { scoreOf, type Shot } from "../imaging";
import { PHOTO_ID_MAX_LENGTH } from "../photo-identity";

const finite = z.number().finite();
const byte = finite.min(0).max(255);
const dimension = z.number().int().min(1).max(100000);
/** Measured preview evidence, never semantic AI or a claim of full-resolution RAW analysis. */
export const developAnalysisReceiptSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("mechanical"),
    namespace: z.string().min(1).max(8192),
    photoId: z
      .string()
      .min(1)
      .max(PHOTO_ID_MAX_LENGTH + "studio:".length),
    sourceDigest: z.string().min(1).max(200).nullable(),
    engine: z
      .object({
        name: z.enum(["native-cpp", "worker", "main-thread"]),
        version: z.string().min(1).max(200),
      })
      .strict(),
    // source = decoded/downsampled source evidence, not sensor/full-resolution parity.
    representation: z.enum(["source", "embedded-preview", "rendered-preview", "unknown-preview"]),
    width: dimension,
    height: dimension,
    analysis: z
      .object({
        sharpness: finite.nonnegative(),
        brightness: byte,
        clippedHighlights: finite.min(0).max(100),
        clippedShadows: finite.min(0).max(100),
        hash: z.string().regex(/^[01]{64}$/),
        tone: z
          .object({
            black: byte,
            white: byte,
            median: byte,
            rMean: byte,
            gMean: byte,
            bMean: byte,
            satMean: finite.min(0).max(1),
          })
          .strict(),
        faces: z
          .object({
            count: z.number().int().min(0).max(100000),
            faceSharpness: finite.nonnegative(),
            eyesOpen: z.boolean().nullable(),
            center: z
              .object({ x: finite.min(0).max(1), y: finite.min(0).max(1) })
              .strict()
              .optional(),
          })
          .strict()
          .nullable()
          .optional(),
      })
      .strict(),
    captureTimeMs: finite.optional(),
    cameraKey: z.string().min(1).max(1000).optional(),
    captureTimeBasis: z.enum(["utc", "camera_clock"]).optional(),
  })
  .strict();
export type DevelopAnalysisReceipt = z.infer<typeof developAnalysisReceiptSchema>;
type Identity = { id: string; sourceDigest: string | null };

export function assertDevelopPhotoAnalysis(
  value: unknown,
  photo: Identity,
  namespace?: string,
): DevelopAnalysisReceipt {
  const receipt = developAnalysisReceiptSchema.parse(value);
  if (
    receipt.photoId !== photo.id ||
    receipt.sourceDigest !== photo.sourceDigest ||
    (namespace !== undefined && receipt.namespace !== namespace)
  )
    throw new Error("This analysis receipt belongs to another source or shoot.");
  return receipt;
}
/** Invalid/foreign evidence never makes a preview appear analyzed. Writes use the throwing guard. */
export function readDevelopPhotoAnalysis(
  photo: Identity,
  document: { photoId: string; analysis?: unknown } | undefined,
  namespace?: string,
): DevelopAnalysisReceipt | null {
  if (!document?.analysis || document.photoId !== photo.id) return null;
  try {
    return assertDevelopPhotoAnalysis(document.analysis, photo, namespace);
  } catch {
    return null;
  }
}

/** Upgrade an acknowledged pre-receipt Studio measurement without inventing engine provenance. */
export function developAnalysisFromShot(
  shot: Shot,
  photo: Identity,
  namespace: string,
  previous?: DevelopAnalysisReceipt,
): DevelopAnalysisReceipt | null {
  if (
    shot.error !== undefined ||
    !shot.analysisBackend ||
    !shot.tone ||
    !/^[01]{64}$/.test(shot.hash)
  )
    return null;
  const reference = shot.develop?.canonical;
  if (
    (shot.sourceDigest ?? null) !== photo.sourceDigest ||
    (reference && (reference.namespace !== namespace || reference.photoId !== photo.id))
  )
    throw new Error("This analysis measurement belongs to another source or shoot.");
  const result = developAnalysisReceiptSchema.parse({
    version: 1,
    kind: "mechanical",
    namespace,
    photoId: photo.id,
    sourceDigest: photo.sourceDigest,
    engine: { name: shot.analysisBackend, version: "unversioned" },
    representation: "unknown-preview",
    width: shot.width,
    height: shot.height,
    analysis: {
      sharpness: shot.sharpness,
      brightness: shot.brightness,
      clippedHighlights: shot.clippedHighlights,
      clippedShadows: shot.clippedShadows,
      hash: shot.hash,
      tone: shot.tone,
      ...(shot.faces ? { faces: shot.faces } : {}),
    },
    ...(shot.captureTimeMs !== undefined ? { captureTimeMs: shot.captureTimeMs } : {}),
    ...(shot.cameraKey !== undefined ? { cameraKey: shot.cameraKey } : {}),
    ...(shot.captureTimeBasis !== undefined ? { captureTimeBasis: shot.captureTimeBasis } : {}),
  });
  // Shot dimensions describe the displayed/source photo, not the smaller frame
  // the engine measured. A review projection cannot replace that provenance.
  if (previous) {
    const checked = assertDevelopPhotoAnalysis(previous, photo, namespace);
    const normalized = {
      ...checked,
      analysis: { ...checked.analysis, faces: checked.analysis.faces ?? undefined },
    };
    if (
      result.engine.name === checked.engine.name &&
      JSON.stringify({
        ...result,
        engine: checked.engine,
        representation: checked.representation,
        width: checked.width,
        height: checked.height,
      }) === JSON.stringify(normalized)
    )
      return checked;
  }
  return result;
}

export function projectDevelopAnalysis(shot: Shot, receipt: DevelopAnalysisReceipt): Shot {
  const { faces, ...measurements } = receipt.analysis;
  const { score, flags } = scoreOf({
    ...measurements,
    ...(faces !== undefined ? { faces } : {}),
  });
  const { error: _error, ...clean } = shot;
  return {
    ...clean,
    ...receipt.analysis,
    faces: receipt.analysis.faces ?? undefined,
    width: shot.width || receipt.width,
    height: shot.height || receipt.height,
    score,
    flags: [...(shot.flags.includes("duplicate") ? ["duplicate" as const] : []), ...flags],
    analysisBackend: receipt.engine.name,
    ...(receipt.captureTimeMs !== undefined ? { captureTimeMs: receipt.captureTimeMs } : {}),
    ...(receipt.cameraKey !== undefined ? { cameraKey: receipt.cameraKey } : {}),
    ...(receipt.captureTimeBasis !== undefined
      ? { captureTimeBasis: receipt.captureTimeBasis }
      : {}),
  };
}
