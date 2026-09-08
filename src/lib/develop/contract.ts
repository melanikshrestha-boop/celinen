import { z } from "zod";
export const developSourceModeSchema = z.enum(["preview", "raw"]);
export type DevelopSourceMode = z.infer<typeof developSourceModeSchema>;

const signed = z.number().finite().min(-100).max(100);
const amount = z.number().finite().min(0).max(100);
const unit = z.number().finite().min(0).max(1);
export const DEVELOP_HSL_CHANNELS = [
  "Red",
  "Orange",
  "Yellow",
  "Green",
  "Aqua",
  "Blue",
  "Purple",
  "Magenta",
] as const;
export const developGradeSchema = z
  .object({ hue: z.number().finite().min(0).max(360), saturation: amount, luminance: signed })
  .strict();
export const developMaskSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(80),
    enabled: z.boolean(),
    type: z.enum(["linear", "radial"]),
    x: unit,
    y: unit,
    radius: z.number().finite().min(0.01).max(2),
    aspect: z.number().finite().min(0.1).max(10),
    angle: z.number().finite().min(-180).max(180),
    feather: unit,
    invert: z.boolean(),
    exposure: z.number().finite().min(-5).max(5),
    temperature: signed,
    saturation: signed,
  })
  .strict();
export const developSettingsSchema = z
  .object({
    version: z.literal(1),
    exposure: z.number().finite().min(-5).max(5),
    contrast: signed,
    highlights: signed,
    shadows: signed,
    whites: signed,
    blacks: signed,
    temperature: signed,
    tint: signed,
    saturation: signed,
    vibrance: signed,
    texture: signed,
    clarity: signed,
    dehaze: signed,
    curve: z
      .array(z.object({ x: unit, y: unit }).strict())
      .min(2)
      .max(16)
      .superRefine((points, ctx) => {
        if (
          points[0]?.x !== 0 ||
          points.at(-1)?.x !== 1 ||
          points.some((p, i) => i > 0 && p.x <= points[i - 1]!.x)
        )
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Curve points must increase from x=0 to x=1.",
          });
      }),
    hsl: z
      .array(z.object({ hue: signed, saturation: signed, luminance: signed }).strict())
      .length(8),
    grading: z
      .object({
        shadows: developGradeSchema,
        midtones: developGradeSchema,
        highlights: developGradeSchema,
        balance: signed,
        blending: amount,
      })
      .strict(),
    grain: amount,
    grainSize: z.number().finite().min(0.5).max(4),
    fade: amount,
    vignette: signed,
    bloom: amount,
    halation: amount,
    sharpening: amount,
    noiseReduction: amount,
    colorNoiseReduction: amount,
    crop: z
      .object({
        x: unit,
        y: unit,
        width: z.number().finite().min(0.01).max(1),
        height: z.number().finite().min(0.01).max(1),
        angle: z.number().finite().min(-45).max(45),
        rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
        flipX: z.boolean(),
        flipY: z.boolean(),
      })
      .strict()
      .refine(
        (c) => c.x + c.width <= 1.000001 && c.y + c.height <= 1.000001,
        "Crop must stay within the image.",
      ),
    masks: z
      .array(developMaskSchema)
      .max(12)
      .refine((m) => new Set(m.map((v) => v.id)).size === m.length, "Mask IDs must be unique."),
  })
  .strict();
export type DevelopSettings = z.infer<typeof developSettingsSchema>;
export type DevelopMask = z.infer<typeof developMaskSchema>;
export type DevelopGrade = z.infer<typeof developGradeSchema>;
export function defaultDevelopSettings(): DevelopSettings {
  const grade = () => ({ hue: 0, saturation: 0, luminance: 0 });
  return {
    version: 1,
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    temperature: 0,
    tint: 0,
    saturation: 0,
    vibrance: 0,
    texture: 0,
    clarity: 0,
    dehaze: 0,
    curve: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    hsl: Array.from({ length: 8 }, () => ({ hue: 0, saturation: 0, luminance: 0 })),
    grading: { shadows: grade(), midtones: grade(), highlights: grade(), balance: 0, blending: 50 },
    grain: 0,
    grainSize: 1,
    fade: 0,
    vignette: 0,
    bloom: 0,
    halation: 0,
    sharpening: 0,
    noiseReduction: 0,
    colorNoiseReduction: 0,
    crop: { x: 0, y: 0, width: 1, height: 1, angle: 0, rotate: 0, flipX: false, flipY: false },
    masks: [],
  };
}
export function cloneDevelopSettings(input: DevelopSettings): DevelopSettings {
  return developSettingsSchema.parse(input);
}
export const DEVELOP_ENGINE_LIMITS = Object.freeze({
  maxFileBytes: 128 * 1024 * 1024,
  maxEdge: 4096,
  previewEdge: 1600,
  maxMasks: 12,
  maxRawSensorPixels: 60_000_000,
});
