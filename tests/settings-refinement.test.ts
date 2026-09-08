import { describe, expect, test } from "bun:test";
import {
  DEFAULT_APPEARANCE,
  THEME_PRESETS,
  contrastRatio,
  validateAppearance,
  importTheme,
  exportTheme,
} from "../src/lib/appearance";
import {
  DEFAULT_PREFERENCES,
  preferencesSchema,
  readPreferences,
  mergePreferencePatch,
} from "../src/lib/account-preferences";
import {
  previewSettingsImport,
  exportSettings,
  importSettings,
  SETTINGS_FILE_MAX_BYTES,
} from "../src/lib/settings-transfer";
import { applicationOrigin, applicationUrl } from "../src/lib/application-origin";
import { DEFAULT_SHORTCUTS, shortcutsSchema, recordedShortcut } from "../src/lib/shortcuts";
import {
  SETTINGS_SECTIONS,
  settingsPath,
  settingsSection,
  isSettingsPath,
} from "../src/lib/settings-catalog";
import { SETTINGS_CONTROLS, searchSettingControls } from "../src/lib/settings-inventory";
import {
  AVATAR_METADATA_LIMIT,
  profileInputSchema,
  profileMetadata,
  readAccountProfile,
} from "../src/lib/account-profile";

describe("Settings refinement: real routes and safe preferences", () => {
  test("companion images reject executable assets and portable settings use byte bounds", () => {
    for (const petImage of [
      "https://example.com/tracker.png",
      "data:image/svg+xml,<svg/>",
      "x".repeat(12001),
    ])
      expect(preferencesSchema.safeParse({ petImage }).success).toBe(false);
    const preferences = preferencesSchema.parse({
      petImage: "data:image/jpeg;base64,/9j/" + "A".repeat(11950),
      customInstructions: "字".repeat(2000),
      preferredTerms: "字".repeat(300),
      voiceURI: "字".repeat(1000),
      petPosition: "left",
      petAnimation: true,
    });
    expect(importSettings(exportSettings(preferences))).toEqual(preferences);
    expect(() => importSettings(" ".repeat(SETTINGS_FILE_MAX_BYTES + 1))).toThrow();
    expect(() => importSettings("字".repeat(SETTINGS_FILE_MAX_BYTES / 2))).toThrow();
    expect(DEFAULT_PREFERENCES.showPet).toBe(false);
  });
  test("preserves exactly the specified 23 labels, canonical routes and order", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.label)).toEqual([
      "General",
      "Import",
      "Profile",
      "Appearance",
      "Voice",
      "Configuration",
      "Personalization",
      "Pets",
      "Keyboard shortcuts",
      "Usage & billing",
      "Analytics",
      "Account",
      "Computer use",
      "Computer history",
      "Appshots",
      "Plugins",
      "Browser",
      "Hooks",
      "Connections",
      "Git",
      "Environments",
      "Worktrees",
      "Archived",
    ]);
    expect(new Set(SETTINGS_SECTIONS.map((section) => settingsPath(section.id))).size).toBe(23);
    for (const section of SETTINGS_SECTIONS) {
      const path = settingsPath(section.id);
      expect(isSettingsPath(path)).toBe(true);
      expect(settingsSection(path.split("/")[2])).toBe(section.id);
    }
    for (const bad of [
      "/settings/unknown",
      "/settings/../auth",
      "//settings/general",
      "https://example.com/settings/general",
    ])
      expect(isSettingsPath(bad)).toBe(false);
  });
  test("inventory and row-level search use stable unique scoped IDs", () => {
    expect(new Set(SETTINGS_CONTROLS.map((control) => `${control.page}/${control.id}`)).size).toBe(
      SETTINGS_CONTROLS.length,
    );
    expect(searchSettingControls("pointer").map((control) => control.id)).toContain(
      "setting-use-pointer-cursors",
    );
    expect(searchSettingControls("something-missing")).toEqual([]);
    for (const control of SETTINGS_CONTROLS)
      for (const field of [
        "id",
        "page",
        "type",
        "scope",
        "validation",
        "permissions",
        "backend",
        "status",
      ] as const)
        expect(control[field]).toBeTruthy();
  });
  test("all presets are readable and export/import roundtrip data only", () => {
    for (const [preset, colors] of Object.entries(THEME_PRESETS)) {
      const theme = validateAppearance({ ...DEFAULT_APPEARANCE, ...colors, preset });
      expect(contrastRatio(theme.background, theme.foreground)).toBeGreaterThanOrEqual(4.5);
      expect(importTheme(exportTheme(theme))).toEqual(theme);
    }
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
  });
  test("rejects low contrast, arbitrary fonts, CSS, invalid ranges and executable theme fields", () => {
    for (const patch of [
      { foreground: "#10141a" },
      { background: "#eeeeee", foreground: "#111111" },
      { accent: "#151515" },
      { accent: "url(https://example.com)" },
      { uiSize: 1 },
      { codeSize: 90 },
      { uiFont: "secret-font" },
      { codeFont: "javascript:alert(1)" },
      { css: "body{}" },
    ])
      expect(() => validateAppearance({ ...DEFAULT_APPEARANCE, ...patch })).toThrow();
    for (const text of [
      "null",
      "not JSON",
      "x".repeat(8193),
      JSON.stringify({ product: "LensLabs", version: 2, appearance: {} }),
      JSON.stringify({ product: "LensLabs", version: 1, appearance: {}, script: "alert(1)" }),
    ])
      expect(() => importTheme(text)).toThrow();
  });
  test("System persists and old preferences gain new defaults", () => {
    const next = readPreferences(
      JSON.stringify({
        theme: "system",
        sendKey: "modifier-enter",
        customInstructions: "Keep natural color.",
      }),
    );
    expect(next.theme).toBe("system");
    expect(next.appearance).toEqual(DEFAULT_APPEARANCE);
    expect(next.shortcuts).toEqual(DEFAULT_SHORTCUTS);
    expect(next.customInstructions).toBe("Keep natural color.");
    expect(readPreferences("corrupt").cloudAssistant).toBe(false);
  });
  test("bulk import and reset never expand cloud or notification consent", () => {
    const current = { ...DEFAULT_PREFERENCES, cloudAssistant: false, desktopNotifications: false };
    const preview = previewSettingsImport(current, {
      ...DEFAULT_PREFERENCES,
      desktopNotifications: true,
      theme: "light",
    });
    expect(preview.preferences.cloudAssistant).toBe(false);
    expect(preview.preferences.desktopNotifications).toBe(false);
    expect(preview.blocked).toEqual(["cloudAssistant", "desktopNotifications"]);
    expect(preview.changed).toEqual(["theme"]);
    expect(previewSettingsImport(DEFAULT_PREFERENCES, current).preferences.cloudAssistant).toBe(
      false,
    );
  });
  test("concurrent edits merge unrelated fields and reject conflicting stale changes", () => {
    const base = DEFAULT_PREFERENCES;
    const latest = { ...base, theme: "light" as const };
    expect(mergePreferencePatch(base, latest, { sendKey: "modifier-enter" })).toMatchObject({
      theme: "light",
      sendKey: "modifier-enter",
    });
    expect(() => mergePreferencePatch(base, latest, { theme: "system" })).toThrow("another tab");
    expect(mergePreferencePatch(base, latest, { theme: "light" })).toEqual(latest);
    expect(() =>
      mergePreferencePatch(base, base, { appearance: { ...DEFAULT_APPEARANCE, uiSize: 99 } }),
    ).toThrow();
  });
  test("shortcut assignments detect conflicts and reject browser-reserved chords", () => {
    expect(shortcutsSchema.parse({})).toEqual(DEFAULT_SHORTCUTS);
    expect(() => shortcutsSchema.parse({ ...DEFAULT_SHORTCUTS, settings: "Mod+k" })).toThrow(
      "Already assigned",
    );
    expect(() => shortcutsSchema.parse({ ...DEFAULT_SHORTCUTS, keep: "x" })).toThrow(
      "Already assigned",
    );
    for (const key of ["Mod+w", "Mod+r", "Mod+t", "Mod+q", "F5", "Alt+F4", "javascript:"])
      expect(() => shortcutsSchema.parse({ ...DEFAULT_SHORTCUTS, settings: key })).toThrow();
    expect(shortcutsSchema.parse({ ...DEFAULT_SHORTCUTS, settings: "Alt+Shift+s" }).settings).toBe(
      "Alt+Shift+s",
    );
    expect(
      recordedShortcut({
        key: "K",
        code: "KeyK",
        ctrlKey: false,
        metaKey: false,
        altKey: true,
        shiftKey: true,
      }),
    ).toBe("Alt+Shift+k");
  });
  test("profile biography and cropped avatar use bounded metadata, never role or external URLs", () => {
    const profile = profileInputSchema.parse({
      name: "Celine",
      workspaceName: "Studio",
      biography: "Editorial portraits.",
      avatar: "",
    });
    expect(readAccountProfile(profileMetadata(profile))).toMatchObject({
      biography: "Editorial portraits.",
      avatar: "",
    });
    const jpegPrefix = "data:image/jpeg;base64,/9j/";
    expect(
      profileInputSchema.safeParse({
        ...profile,
        avatar: jpegPrefix + "A".repeat(AVATAR_METADATA_LIMIT - jpegPrefix.length),
      }).success,
    ).toBe(true);
    expect(
      profileInputSchema.safeParse({
        ...profile,
        avatar: jpegPrefix + "A".repeat(AVATAR_METADATA_LIMIT - jpegPrefix.length + 1),
      }).success,
    ).toBe(false);
    for (const patch of [
      { biography: "a".repeat(501) },
      { avatar: "https://example.com/tracker.png" },
      { avatar: "data:image/svg+xml,<svg/>" },
      { avatar: "data:image/jpeg;base64," + "A".repeat(40000) },
      { role: "admin" },
    ])
      expect(profileInputSchema.safeParse({ ...profile, ...patch }).success).toBe(false);
  });
  test("first-party URLs centralize production while preserving local and staging", () => {
    expect(applicationOrigin()).toBe("https://lenslab.dev");
    expect(applicationUrl("/settings/general", "http://127.0.0.1:8085")).toBe(
      "http://127.0.0.1:8085/settings/general",
    );
    expect(applicationUrl("/auth?next=%2Fworkspace", "https://preview.example.test")).toBe(
      "https://preview.example.test/auth?next=%2Fworkspace",
    );
    for (const origin of [
      "http://example.com",
      "https://user:secret@example.com",
      "https://example.com/path",
      "https://example.com/?token=a",
      "javascript:alert(1)",
      "https://bad'host.example",
    ])
      expect(() => applicationOrigin(origin)).toThrow();
    for (const path of ["https://evil.test", "//evil.test", "/\\evil.test", "/ auth", "/\nauth"])
      expect(() => applicationUrl(path)).toThrow();
  });
  test("personalization additions are bounded and do not grant privileges", () => {
    expect(preferencesSchema.safeParse({ preferredTerms: "a".repeat(301) }).success).toBe(false);
    expect(preferencesSchema.safeParse({ responseDetail: "unlimited" }).success).toBe(false);
  });
});
