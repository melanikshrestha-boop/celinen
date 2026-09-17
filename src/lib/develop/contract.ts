import { z } from "zod";
export const developSourceModeSchema = z.enum(["preview", "raw"]);
export type DevelopSourceMode = z.infer<typeof developSourceModeSchema>;

const signed = z.number().finite().min(-100).max(100);
const amount = z.number().finite().min(0).max(100);
const unit = z.number().finite().min(0).max(1);
const identityCurve = () => [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];
export const developCurveSchema = z
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
  });

// Parametric tone curve regions (Lightroom Classic style)
export const developParametricCurveSchema = z.object({
  highlights: z.number().finite().min(-100).max(100),
  lights: z.number().finite().min(-100).max(100),
  darks: z.number().finite().min(-100).max(100),
  shadows: z.number().finite().min(-100).max(100),
  pointCurve: developCurveSchema,
});

export type DevelopParametricCurve = z.infer<typeof developParametricCurveSchema>;

// Lens correction settings
export const developLensCorrectionSchema = z.object({
  enabled: z.boolean(),
  profile: z.enum(["none", "auto", "custom"]).default("none"),
  profileId: z.string().optional(),
  chromaticAberration: z.object({
    enabled: z.boolean(),
    amount: z.number().finite().min(0).max(100),
  }).default({ enabled: false, amount: 50 }),
  vignetteCorrection: z.object({
    enabled: z.boolean(),
    amount: z.number().finite().min(-100).max(100),
  }).default({ enabled: false, amount: 0 }),
  transform: z.object({
    upright: z.enum(["off", "auto", "level", "vertical", "full"]).default("off"),
    rotation: z.number().finite().min(-45).max(45).default(0),
    aspect: z.number().finite().min(-100).max(100).default(0),
    scale: z.number().finite().min(50).max(150).default(100),
    x: z.number().finite().min(-100).max(100).default(0),
    y: z.number().finite().min(-100).max(100).default(0),
  }).default({
    upright: "off",
    rotation: 0,
    aspect: 0,
    scale: 100,
    x: 0,
    y: 0,
  }),
});

export type DevelopLensCorrection = z.infer<typeof developLensCorrectionSchema>;
const channelCurvesSchema = z
  .object({
    red: developCurveSchema.default(identityCurve),
    green: developCurveSchema.default(identityCurve),
    blue: developCurveSchema.default(identityCurve),
  })
  .strict();
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
    curve: developCurveSchema,
    curveInterpolation: z.enum(["linear", "smooth"]).default("linear"),
    // Additive v1 fields: old on-device recipes, presets and history remain readable.
    channelCurves: channelCurvesSchema.default(() => ({
      red: identityCurve(),
      green: identityCurve(),
      blue: identityCurve(),
    })),
    parametricCurve: developParametricCurveSchema.optional().default(() => ({
      highlights: 0,
      lights: 0,
      darks: 0,
      shadows: 0,
      pointCurve: identityCurve(),
    })),
    lensCorrection: developLensCorrectionSchema.default(() => ({
      enabled: false,
      profile: "none",
      chromaticAberration: { enabled: false, amount: 50 },
      vignetteCorrection: { enabled: false, amount: 0 },
      transform: {
        upright: "off",
        rotation: 0,
        aspect: 0,
        scale: 100,
        x: 0,
        y: 0,
      },
    })),
    hsl: z
      .array(z.object({ hue: signed, saturation: signed, luminance: signed }).strict())
      .length(8),
    grading: z
      .object({
        // Missing means the original renderer: never silently change a saved grade.
        model: z.enum(["legacy", "tonal"]).default("legacy"),
        shadows: developGradeSchema,
        midtones: developGradeSchema,
        highlights: developGradeSchema,
        global: developGradeSchema.default(() => ({ hue: 0, saturation: 0, luminance: 0 })),
        balance: signed,
        blending: amount,
      })
      .strict(),
    grain: amount,
    grainSize: z.number().finite().min(0.5).max(4),
    grainLuminance: amount.default(0),
    fade: amount,
    filmFalloff: amount.default(0),
    vignette: signed,
    bloom: amount,
    halation: amount,
    sharpening: amount,
    // Additive defaults preserve the original fixed-radius sharpening behavior.
    sharpeningRadius: z.number().finite().min(0.5).max(3).default(1),
    sharpeningDetail: amount.default(100),
    sharpeningMasking: amount.default(0),
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
    curveInterpolation: "linear",
    channelCurves: { red: identityCurve(), green: identityCurve(), blue: identityCurve() },
    parametricCurve: {
      highlights: 0,
      lights: 0,
      darks: 0,
      shadows: 0,
      pointCurve: identityCurve(),
    },
    lensCorrection: {
      enabled: false,
      profile: "none",
      chromaticAberration: { enabled: false, amount: 50 },
      vignetteCorrection: { enabled: false, amount: 0 },
      transform: {
        upright: "off",
        rotation: 0,
        aspect: 0,
        scale: 100,
        x: 0,
        y: 0,
      },
    },
    hsl: Array.from({ length: 8 }, () => ({ hue: 0, saturation: 0, luminance: 0 })),
    grading: {
      model: "tonal",
      shadows: grade(),
      midtones: grade(),
      highlights: grade(),
      global: grade(),
      balance: 0,
      blending: 50,
    },
    grain: 0,
    grainSize: 1,
    grainLuminance: 0,
    fade: 0,
    filmFalloff: 0,
    vignette: 0,
    bloom: 0,
    halation: 0,
    sharpening: 0,
    sharpeningRadius: 1,
    sharpeningDetail: 100,
    sharpeningMasking: 0,
    noiseReduction: 0,
    colorNoiseReduction: 0,
    crop: { x: 0, y: 0, width: 1, height: 1, angle: 0, rotate: 0, flipX: false, flipY: false },
    masks: [],
  };
}
/** Drop additive unknown keys, then parse. A newer field must not brick the desk. */
export function readDevelopSettings(input: unknown): DevelopSettings {
  const first = developSettingsSchema.safeParse(input);
  if (first.success) return first.data;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw first.error;
  const known = Object.keys(defaultDevelopSettings());
  const trimmed: Record<string, unknown> = {};
  for (const key of known) {
    if (Object.prototype.hasOwnProperty.call(input, key))
      trimmed[key] = (input as Record<string, unknown>)[key];
  }
  const second = developSettingsSchema.safeParse(trimmed);
  if (second.success) return second.data;
  throw first.error;
}

export function cloneDevelopSettings(input: DevelopSettings): DevelopSettings {
  return readDevelopSettings(input);
}

/** Never paint Zod's JSON issue array into the Develop status banner. */
export function developUserError(error: unknown): string {
  const fallback = "Could not finish this edit. Originals are untouched.";
  if (!error || typeof error !== "object") return fallback;
  const issues = "issues" in error && Array.isArray(error.issues) ? error.issues : null;
  if (issues?.length)
    return "Could not read saved edits. Originals are untouched.";
  if (error instanceof Error) {
    const text = error.message.trim();
    if (!text || text.startsWith("[{") || text.startsWith("[")) return fallback;
    return text;
  }
  return fallback;
}
export const DEVELOP_ENGINE_LIMITS = Object.freeze({
  maxFileBytes: 128 * 1024 * 1024,
  maxEdge: 8192,
  maxOutputPixels: 36_000_000,
  defaultExportEdge: 4096,
  previewEdge: 1600,
  maxMasks: 12,
  maxRawSensorPixels: 60_000_000,
});
