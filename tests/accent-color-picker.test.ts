import { describe, expect, test } from "bun:test";
import {
  ACCENT_COLORS,
  accentColorName,
  DEFAULT_APPEARANCE,
  THEME_PRESETS,
  validateAppearance,
} from "../src/lib/appearance";
import { preferencesSchema, readPreferences } from "../src/lib/account-preferences";

describe("screenshot-matched accent picker", () => {
  test("keeps the reference's eight named options in order", () => {
    expect(ACCENT_COLORS.map(([name]) => name)).toEqual([
      "Default",
      "Blue",
      "Green",
      "Yellow",
      "Pink",
      "Orange",
      "Purple",
      "White",
    ]);
    for (const [name, color] of ACCENT_COLORS) {
      expect(accentColorName(color)).toBe(name);
      expect(accentColorName(color.toUpperCase())).toBe(name);
    }
  });
  test("every option preserves the contrast guard for each existing preset", () => {
    for (const [, accent] of ACCENT_COLORS)
      for (const colors of Object.values(THEME_PRESETS))
        expect(validateAppearance({ ...DEFAULT_APPEARANCE, ...colors, accent }).accent).toBe(
          accent,
        );
  });
  test("existing saved colors retain both their value and recognizable name", () => {
    for (const [accent, name] of [
      ["#b4b4b4", "Default"],
      ["#6b9fff", "Blue"],
      ["#75c588", "Green"],
      ["#eab74e", "Yellow"],
      ["#e98aba", "Pink"],
      ["#ed9a63", "Orange"],
      ["#b099f1", "Purple"],
    ]) {
      const prefs = preferencesSchema.parse({ appearance: { accent } });
      expect(readPreferences(JSON.stringify(prefs)).appearance.accent).toBe(accent);
      expect(accentColorName(accent!)).toBe(name);
    }
  });
  test("custom colors remain custom without being coerced into a preset", () => {
    const prefs = preferencesSchema.parse({
      appearance: { accent: "#bada55", accentStyle: "gradient", accentEnd: "#aabbcc" },
    });
    const restored = readPreferences(JSON.stringify(prefs));
    expect(accentColorName(restored.appearance.accent)).toBe("Custom");
    expect(restored.appearance).toEqual(prefs.appearance);
  });
});
