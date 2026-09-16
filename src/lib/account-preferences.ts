import { z } from "zod";
import { workspaceStorageKey } from "./workspace-storage";
import { appearanceSchema, validateAppearance } from "./appearance";
import { shortcutsSchema } from "./shortcuts";
export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Enter your name.")
  .max(80, "Use 80 characters or fewer.")
  .refine(
    (value) =>
      !Array.from(value).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ),
    "Use a name without control characters.",
  );
export const preferencesSchema = z
  .object({
    theme: z.enum(["light", "dark", "system"]).default("dark"),
    language: z.enum(["en", "es", "auto"]).default("en"),
    fileDestination: z.enum(["studio", "adobe", "folder"]).default("studio"),
    appearance: appearanceSchema
      .refine((value) => {
        try {
          validateAppearance(value);
          return true;
        } catch {
          return false;
        }
      }, "Theme colors are not readable.")
      .default({}),
    sendKey: z.enum(["enter", "modifier-enter"]).default("enter"),
    shortcuts: shortcutsSchema.default({}),
    textSize: z.enum(["default", "large"]).default("default"),
    reduceMotion: z.boolean().default(false),
    sidebarOpen: z.boolean().default(true),
    cloudAssistant: z.boolean().default(true),
    learnFromYourWork: z.boolean().default(true),
    suggestedPrompts: z.boolean().default(true),
    keepAwake: z.boolean().default(false),
    importSidecars: z.boolean().default(true),
    processingSpeed: z.enum(["balanced", "gentle"]).default("balanced"),
    pointerCursors: z.boolean().default(true),
    showPet: z.boolean().default(false),
    pet: z.enum(["cat", "dog"]).default("cat"),
    petAnimation: z.boolean().default(false),
    petPosition: z.enum(["left", "right"]).default("right"),
    petImage: z
      .string()
      .max(12_000)
      .refine(
        (value) => !value || /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(value),
        "Use a cropped JPEG companion image.",
      )
      .default(""),
    openSources: z.enum(["new-tab", "same-tab"]).default("new-tab"),
    personality: z.enum(["none", "friendly", "concise"]).default("none"),
    chatModel: z.enum(["human", "fast"]).default("human"),
    responseDetail: z.enum(["balanced", "brief", "detailed"]).default("balanced"),
    preferredTerms: z.string().trim().max(300).default(""),
    customInstructions: z.string().trim().max(2000).default(""),
    voiceRate: z
      .number()
      .refine((value) => [0.75, 1, 1.25, 1.5, 2].includes(value))
      .default(1),
    voiceURI: z.string().max(1000).default(""),
    completionNotifications: z.enum(["always", "unfocused", "off"]).default("unfocused"),
    desktopNotifications: z.boolean().default(false),
  })
  .strict();
export type AccountPreferences = z.infer<typeof preferencesSchema>;
export const DEFAULT_PREFERENCES = preferencesSchema.parse({});
export const LOCAL_LOCK_KEY = "lenslabs.local-workspace.lock.v1";
export const LOCAL_PROFILE_KEY = "lenslabs.local-profile.v1";
export const preferenceKey = (scope: string) =>
  workspaceStorageKey("lenslabs.preferences.v1", scope);
export function readPreferences(value: string | null): AccountPreferences {
  try {
    return preferencesSchema.parse(JSON.parse(value ?? "{}"));
  } catch {
    return { ...DEFAULT_PREFERENCES, cloudAssistant: false, desktopNotifications: false };
  }
}
/** Merge unrelated edits; reject a stale edit to the same field before touching storage. */
export function mergePreferencePatch(
  baseline: AccountPreferences,
  latest: AccountPreferences,
  patch: Partial<AccountPreferences>,
) {
  for (const key of Object.keys(patch) as (keyof AccountPreferences)[]) {
    if (
      JSON.stringify(latest[key]) !== JSON.stringify(baseline[key]) &&
      JSON.stringify(latest[key]) !== JSON.stringify(patch[key])
    )
      throw new Error(
        "This preference changed in another tab. Review the current value before saving again.",
      );
  }
  return preferencesSchema.parse({ ...latest, ...patch });
}
export function accountName(metadata: Record<string, unknown> | undefined, email?: string) {
  for (const value of [metadata?.["display_name"], metadata?.["full_name"], metadata?.["name"]]) {
    const parsed = displayNameSchema.safeParse(value);
    if (parsed.success) return parsed.data;
  }
  return email?.split("@")[0]?.slice(0, 80) || "Your account";
}
export function accountInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toLocaleUpperCase();
}
export function shouldSendMessage(
  event: {
    key: string;
    shiftKey: boolean;
    metaKey: boolean;
    ctrlKey: boolean;
    isComposing: boolean;
  },
  sendKey: AccountPreferences["sendKey"],
) {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    (sendKey === "enter" || event.metaKey || event.ctrlKey)
  );
}
/** A slow restore must never resurrect a user after a newer sign-out event. */
export function observeSession<T>(
  subscribe: (receive: (value: T) => void) => () => void,
  restore: () => Promise<T>,
  receive: (value: T) => void,
  fail: (error: unknown) => void,
) {
  let alive = true,
    eventSeen = false;
  const unsubscribe = subscribe((value) => {
    eventSeen = true;
    if (alive) receive(value);
  });
  void restore()
    .then((value) => {
      if (alive && !eventSeen) receive(value);
    })
    .catch((error: unknown) => {
      if (alive && !eventSeen) fail(error);
    });
  return () => {
    alive = false;
    unsubscribe();
  };
}
