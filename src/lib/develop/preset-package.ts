import { z } from "zod";
import { defaultDevelopSettings, developSettingsSchema, type DevelopSettings } from "./contract";
import type { DevelopPreset } from "./store";

export const PRESET_PACKAGE_MAX_BYTES = 256 * 1024;
const plainText = (limit: number, multiline = false) =>
  z
    .string()
    .trim()
    .max(limit)
    .refine(
      (value) =>
        !/[\u202a-\u202e\u2066-\u2069]/u.test(value) &&
        !Array.from(value).some(
          (character) =>
            /\p{Cc}/u.test(character) && !(multiline && ["\n", "\r", "\t"].includes(character)),
        ),
      "Preset metadata contains unsupported control characters.",
    );
export const presetPackageMetadataSchema = z
  .object({
    title: plainText(100).refine((value) => value.length > 0, "Give the preset a title."),
    creator: plainText(160).default(""),
    license: plainText(4000, true).default(""),
    description: plainText(4000, true).default(""),
  })
  .strict();
export type PresetPackageMetadata = z.infer<typeof presetPackageMetadataSchema>;
const isNeutralGeometry = (settings: DevelopSettings) =>
  settings.masks.length === 0 &&
  JSON.stringify(settings.crop) === JSON.stringify(defaultDevelopSettings().crop);
export const presetPackageSchema = z
  .object({
    format: z.literal("foto-develop-preset"),
    version: z.literal(1),
    metadata: presetPackageMetadataSchema,
    settings: developSettingsSchema.refine(
      isNeutralGeometry,
      "Portable looks cannot include a photo-specific crop or mask.",
    ),
  })
  .strict();
export type PresetPackage = z.infer<typeof presetPackageSchema>;

/** A portable look contains no photos, account IDs, local paths, crop, or local masks. */
export function createPresetPackage(
  metadata: z.input<typeof presetPackageMetadataSchema>,
  settings: DevelopSettings,
): PresetPackage {
  const recipe = developSettingsSchema.parse(settings);
  return presetPackageSchema.parse({
    format: "foto-develop-preset",
    version: 1,
    metadata,
    settings: { ...recipe, crop: defaultDevelopSettings().crop, masks: [] },
  });
}
export function parsePresetPackage(text: string): PresetPackage {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).byteLength > PRESET_PACKAGE_MAX_BYTES
  )
    throw new Error("Choose a FOTO preset JSON file smaller than 256 KB.");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid preset JSON.");
  }
  return presetPackageSchema.parse(value);
}
export function exportPresetPackage(input: PresetPackage): string {
  const text = JSON.stringify(presetPackageSchema.parse(input), null, 2);
  if (new TextEncoder().encode(text).byteLength > PRESET_PACKAGE_MAX_BYTES)
    throw new Error("This preset package exceeds the 256 KB limit.");
  return text;
}
export function presetPackageFilename(title: string): string {
  const normalized = presetPackageMetadataSchema.shape.title.parse(title);
  const stem = normalized
    .replace(/[\p{Cc}/\\<>:"|?*]/gu, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 100);
  return `FOTO-${stem || "preset"}.foto-preset.json`;
}
/** Always creates a fresh local ID; a package can never target an existing account preset. */
export function developPresetFromPackage(input: PresetPackage): DevelopPreset {
  const value = presetPackageSchema.parse(input);
  return {
    id: crypto.randomUUID(),
    name: value.metadata.title,
    settings: value.settings,
    packageMetadata: value.metadata,
    revision: 0,
    updatedAt: Date.now(),
  };
}
