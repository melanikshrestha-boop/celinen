import { z } from "zod";
import { preferencesSchema, type AccountPreferences } from "./account-preferences";

const transferSchema = z
  .object({
    product: z.literal("LensLabs"),
    version: z.literal(1),
    preferences: preferencesSchema,
  })
  .strict();
export function exportSettings(preferences: AccountPreferences) {
  return JSON.stringify(
    transferSchema.parse({ product: "LensLabs", version: 1, preferences }),
    null,
    2,
  );
}
export function importSettings(text: string): AccountPreferences {
  if (text.length > 16_384) throw new Error("Choose a LensLabs settings file smaller than 16 KB.");
  try {
    return transferSchema.parse(JSON.parse(text)).preferences;
  } catch {
    throw new Error("This is not a supported LensLabs settings file. Nothing was changed.");
  }
}
export function importLanes(
  raw: boolean,
  hardware: number,
  speed: AccountPreferences["processingSpeed"],
) {
  return speed === "gentle" ? 1 : raw ? 2 : Math.max(2, Math.min(8, hardware || 4));
}
export function assistantPersonalization(preferences: AccountPreferences) {
  const tone =
    preferences.personality === "friendly"
      ? "Use a friendly, encouraging tone."
      : preferences.personality === "concise"
        ? "Be concise and practical."
        : "";
  return [tone, preferences.customInstructions].filter(Boolean).join("\n");
}
