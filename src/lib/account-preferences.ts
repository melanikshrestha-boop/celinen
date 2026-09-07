import { z } from "zod";
import { workspaceStorageKey } from "./workspace-storage";
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
    // Read old System preferences as Black without resetting unrelated preferences.
    theme: z.preprocess(
      (value) => (value === "system" ? "dark" : value),
      z.enum(["light", "dark"]).default("dark"),
    ),
    sendKey: z.enum(["enter", "modifier-enter"]).default("enter"),
    textSize: z.enum(["default", "large"]).default("default"),
    reduceMotion: z.boolean().default(false),
    sidebarOpen: z.boolean().default(true),
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
    return { ...DEFAULT_PREFERENCES };
  }
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
