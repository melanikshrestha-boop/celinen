import { z } from "zod";
import { preferencesSchema, type AccountPreferences } from "./account-preferences";
import { workspaceLanguage } from "./workspace-language";
import { PRODUCT_TITLE } from "./product";

const transferSchema = z
  .object({
    product: z.union([z.literal(PRODUCT_TITLE), z.literal("LensLabs")]),
    version: z.literal(1),
    preferences: preferencesSchema,
  })
  .strict();
export const SETTINGS_FILE_MAX_BYTES = 32_768;
export function exportSettings(preferences: AccountPreferences) {
  const text = JSON.stringify(
    transferSchema.parse({ product: PRODUCT_TITLE, version: 1, preferences }),
    null,
    2,
  );
  if (new TextEncoder().encode(text).byteLength > SETTINGS_FILE_MAX_BYTES)
    throw new Error("Settings exceed the 32 KB export limit.");
  return text;
}
export function importSettings(text: string): AccountPreferences {
  if (new TextEncoder().encode(text).byteLength > SETTINGS_FILE_MAX_BYTES)
    throw new Error(`Choose a ${PRODUCT_TITLE} settings file smaller than 32 KB.`);
  try {
    return transferSchema.parse(JSON.parse(text)).preferences;
  } catch {
    throw new Error(`This is not a supported ${PRODUCT_TITLE} settings file. Nothing was changed.`);
  }
}
/** Transfers may customize appearance, never expand consent or device permissions. */
export function previewSettingsImport(current: AccountPreferences, incoming: AccountPreferences) {
  const preferences = preferencesSchema.parse({
    ...incoming,
    cloudAssistant: current.cloudAssistant && incoming.cloudAssistant,
    desktopNotifications: current.desktopNotifications && incoming.desktopNotifications,
    learnFromYourWork: current.learnFromYourWork && incoming.learnFromYourWork,
  });
  const changed = (Object.keys(preferences) as (keyof AccountPreferences)[]).filter(
    (key) => JSON.stringify(preferences[key]) !== JSON.stringify(current[key]),
  );
  const blocked = (["cloudAssistant", "desktopNotifications", "learnFromYourWork"] as const).filter(
    (key) => incoming[key] && !current[key],
  );
  return { preferences, changed, blocked };
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
  const detail =
    preferences.responseDetail === "brief"
      ? "Prefer brief answers."
      : preferences.responseDetail === "detailed"
        ? "Explain decisions and relevant details."
        : "";
  const terminology = preferences.preferredTerms
    ? `Preferred terminology: ${preferences.preferredTerms}`
    : "";
  const language = workspaceLanguage(
    preferences.language,
    typeof navigator === "undefined" ? "en" : navigator.language,
  );
  return [
    language === "es"
      ? "Respond in Spanish unless the photographer explicitly asks for another language."
      : "",
    tone,
    detail,
    terminology,
    preferences.customInstructions,
  ]
    .filter(Boolean)
    .join("\n");
}
