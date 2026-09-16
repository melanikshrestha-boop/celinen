import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_PREFERENCES,
  preferencesSchema,
  readPreferences,
} from "../src/lib/account-preferences";
import { SETTINGS_SECTIONS, searchSettings, settingsSection } from "../src/lib/settings-catalog";
import {
  assistantPersonalization,
  exportSettings,
  importSettings,
  importLanes,
} from "../src/lib/settings-transfer";

describe("expanded settings", () => {
  test("old preferences gain defaults without losing user choices", () => {
    const preferences = readPreferences(
      JSON.stringify({
        theme: "light",
        sendKey: "modifier-enter",
        textSize: "large",
        reduceMotion: true,
        sidebarOpen: false,
      }),
    );
    expect(preferences.theme).toBe("light");
    expect(preferences.sendKey).toBe("modifier-enter");
    expect(preferences.sidebarOpen).toBe(false);
    expect(preferences.importSidecars).toBe(true);
    expect(preferences.keepAwake).toBe(false);
    expect(preferences.showPet).toBe(false);
  });
  test("exports roundtrip only preferences, never credentials or identity", () => {
    const preferences = preferencesSchema.parse({
      customInstructions: "Natural colors. 保留细节。",
      cloudAssistant: false,
      processingSpeed: "gentle",
      importSidecars: false,
      voiceRate: 1.25,
      pet: "dog",
    });
    const exported = exportSettings(preferences);
    expect(importSettings(exported)).toEqual(preferences);
    expect(Object.keys(JSON.parse(exported))).toEqual(["product", "version", "preferences"]);
    expect(exported).not.toMatch(/email|token|password|\bCeline\b/);
  });
  test("invalid imports reject atomically instead of resetting preferences", () => {
    for (const text of [
      "",
      "[]",
      "null",
      "not-json",
      JSON.stringify({ product: "Other", version: 1, preferences: {} }),
      JSON.stringify({ product: "LensLabs", version: 2, preferences: {} }),
      JSON.stringify({ product: "LensLabs", version: 1, preferences: { admin: true } }),
      JSON.stringify({ product: "LensLabs", version: 1, preferences: { voiceRate: 8 } }),
      "x".repeat(16_385),
    ])
      expect(() => importSettings(text)).toThrow();
  });
  test("bounded instructions, options and wake-lock defaults", () => {
    expect(preferencesSchema.safeParse({ customInstructions: "a".repeat(2001) }).success).toBe(
      false,
    );
    for (const patch of [
      { personality: "admin" },
      { processingSpeed: "unlimited" },
      { pet: "unknown" },
      { openSources: "javascript:" },
      { keepAwake: "true" },
    ])
      expect(preferencesSchema.safeParse(patch).success).toBe(false);
    expect(assistantPersonalization(DEFAULT_PREFERENCES)).toBe("");
    expect(
      assistantPersonalization({
        ...DEFAULT_PREFERENCES,
        personality: "concise",
        customInstructions: "Keep skin tones natural.",
      }),
    ).toContain("Keep skin tones natural.");
  });
  test("processing selection bounds RAW memory and actual worker count", () => {
    for (const cores of [0, 1, 2, 4, 8, 16, 128]) {
      expect(importLanes(true, cores, "balanced")).toBe(2);
      expect(importLanes(true, cores, "gentle")).toBe(1);
      expect(importLanes(false, cores, "gentle")).toBe(1);
      expect(importLanes(false, cores, "balanced")).toBeGreaterThanOrEqual(2);
      expect(importLanes(false, cores, "balanced")).toBeLessThanOrEqual(8);
    }
  });
  test("all categories are addressable and search is case-insensitive", () => {
    expect(new Set(SETTINGS_SECTIONS.map((s) => s.id)).size).toBe(23);
    for (const section of SETTINGS_SECTIONS) {
      expect(settingsSection(section.id)).toBe(section.id);
      expect(searchSettings(section.label).map((s) => s.id)).toContain(section.id);
    }
    expect(searchSettings("  ADOBE SIDECARS ").map((s) => s.id)).toEqual(["import"]);
    expect(searchSettings("nonexistent-setting")).toEqual([]);
    expect(settingsSection("privacy")).toBe("account");
    expect(settingsSection("connections")).toBe("connections");
    expect(settingsSection("invalid")).toBe("general");
    expect(searchSettings("completion").map((s) => s.id)).toContain("general");
    expect(searchSettings("unarchive").map((s) => s.id)).toEqual(["archived"]);
  });
  test("settings navigation retains shoot search and search keeps drafts mounted", () => {
    const source = readFileSync(
      new URL("../src/components/account/SettingsWorkspace.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("search: true");
    expect(source).toContain("<div hidden={Boolean(query.trim())}>{page()}</div>");
    const guard = readFileSync(
      new URL("../src/components/workbench/useToolLeaveGuard.ts", import.meta.url),
      "utf8",
    );
    expect(guard).toContain("!risk &&");
  });
  test("Celine is a dev persona and never hard-coded as a real account", () => {
    const dev = readFileSync(new URL("../src/dev/account.tsx", import.meta.url), "utf8");
    const real = readFileSync(
      new URL("../src/components/account/AccountProvider.tsx", import.meta.url),
      "utf8",
    );
    expect(dev).toContain('name: "Celine Nova"');
    expect(dev).toContain("user: null");
    expect(real).not.toContain("Celine");
  });
  test("dedicated archive view overrides retained history state", () => {
    const source = readFileSync(
      new URL("../src/components/workbench/ChatRecents.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("row.archived === (archivedOnly || archived)");
    expect(source).toMatch(/history\.archive\(row.id,\s*!row.archived\)/);
  });
});
