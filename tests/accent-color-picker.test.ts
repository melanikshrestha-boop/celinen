import { describe, expect, test } from "bun:test";
import {
  ACCENT_COLORS,
  accentColorName,
  DEFAULT_APPEARANCE,
  THEME_PRESETS,
  contrastRatio,
  validateAppearance,
  resolvedAppearance,
  defaultAccentForBackground,
  withDefaultAccent,
} from "../src/lib/appearance";
import { preferencesSchema, readPreferences } from "../src/lib/account-preferences";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccentColorPicker } from "../src/components/account/AccentColorPicker";

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
    let accepted = 0;
    let rejected = 0;
    for (const [name, swatch] of ACCENT_COLORS) {
      for (const colors of Object.values(THEME_PRESETS)) {
        const accent = name === "Default" ? defaultAccentForBackground(colors.background) : swatch;
        const candidate = { ...DEFAULT_APPEARANCE, ...colors, accent };
        if (contrastRatio(colors.background, accent) < 3) {
          expect(() => validateAppearance(candidate)).toThrow(
            "Accent and background need at least 3:1 contrast.",
          );
          rejected++;
        } else {
          expect(validateAppearance(candidate).accent).toBe(accent);
          accepted++;
        }
      }
    }
    expect(accepted).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
    // Named swatches do not bypass validation: white is usable on dark, not paper.
    expect(validateAppearance({ ...DEFAULT_APPEARANCE, accent: "#ffffff" }).accent).toBe("#ffffff");
    expect(() =>
      validateAppearance({ ...DEFAULT_APPEARANCE, ...THEME_PRESETS.paper, accent: "#ffffff" }),
    ).toThrow("Accent and background need at least 3:1 contrast.");
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
  test("both built-in light and dark accents are labeled Default without rewriting their colors", () => {
    for (const theme of ["light", "dark"] as const) {
      const resolved = resolvedAppearance({ theme, appearance: DEFAULT_APPEARANCE }, false);
      const original = JSON.stringify(resolved.appearance);
      const prefs = preferencesSchema.parse({ theme, appearance: resolved.appearance });
      expect(accentColorName(resolved.appearance.accent)).toBe("Default");
      expect(JSON.stringify(resolved.appearance)).toBe(original);
      expect(readPreferences(JSON.stringify(prefs))).toEqual(prefs);
      expect(resolved.appearance.accent).toBe(theme === "light" ? "#171717" : "#b4b4b4");
    }
    expect(accentColorName("#161616")).toBe("Custom");
  });
  test("Default selects the built-in readable neutral on both dark and light canvases", () => {
    expect(defaultAccentForBackground("#000000")).toBe(THEME_PRESETS.lenslabs.accent);
    expect(defaultAccentForBackground("#ffffff")).toBe(THEME_PRESETS.paper.accent);
    for (const theme of ["dark", "light"] as const) {
      const prefs = preferencesSchema.parse({
        theme,
        appearance: {
          ...THEME_PRESETS[theme === "light" ? "paper" : "lenslabs"],
          preset: theme === "light" ? "paper" : "lenslabs",
          accent: "#2867c7",
        },
      });
      const before = JSON.stringify(prefs);
      const appearance = withDefaultAccent(prefs, false);
      expect(appearance.accent).toBe(theme === "light" ? "#171717" : "#b4b4b4");
      expect(validateAppearance(appearance)).toEqual(appearance);
      expect(JSON.stringify(prefs)).toBe(before);
      expect(readPreferences(JSON.stringify({ ...prefs, appearance })).appearance).toEqual(
        appearance,
      );
    }
  });
  test("System uses the visible palette for an explicit Default action, never stale opposite-mode validation", () => {
    for (const systemDark of [false, true]) {
      const prefs = preferencesSchema.parse({
        theme: "system",
        appearance: {
          ...THEME_PRESETS[systemDark ? "paper" : "lenslabs"],
          preset: systemDark ? "paper" : "lenslabs",
          accent: "#2867c7",
          translucentSidebar: false,
          uiFont: "serif",
        },
      });
      const before = JSON.stringify(prefs);
      const result = withDefaultAccent(prefs, systemDark);
      expect(result.background).toBe(systemDark ? "#000000" : "#f7f7fa");
      expect(result.accent).toBe(systemDark ? "#b4b4b4" : "#171717");
      expect(result.uiFont).toBe("serif");
      expect(result.translucentSidebar).toBe(false);
      expect(prefs.theme).toBe("system");
      expect(JSON.stringify(prefs)).toBe(before);
    }
  });
  test("1,000 custom canvas defaults pass contrast and preserve the palette outside its explicitly changed accent", () => {
    for (let index = 0; index < 1000; index++) {
      const background = `#${((index * 7919) % 0xffffff).toString(16).padStart(6, "0")}`;
      const foreground =
        contrastRatio(background, "#000000") > contrastRatio(background, "#ffffff")
          ? "#000000"
          : "#ffffff";
      const prefs = preferencesSchema.parse({
        theme: "system",
        appearance: {
          preset: "custom",
          background,
          foreground,
          accent: foreground,
          translucentSidebar: false,
        },
      });
      const expected = { ...prefs.appearance, accent: defaultAccentForBackground(background) };
      const result = withDefaultAccent(prefs, index % 2 === 0);
      expect(result).toEqual(expected);
      expect(contrastRatio(result.accent, background)).toBeGreaterThanOrEqual(3);
      expect(accentColorName(result.accent)).toBe("Default");
    }
    // A narrow middle-gray range needs black, not an insufficiently contrasting fixed gray.
    expect(defaultAccentForBackground("#636363")).toBe("#000000");
  });
  test("Default never bypasses arbitrary custom text or color validation", () => {
    expect(() => defaultAccentForBackground("url(https://example.com)")).toThrow();
    expect(() =>
      withDefaultAccent(
        {
          theme: "light",
          appearance: {
            ...DEFAULT_APPEARANCE,
            preset: "custom",
            background: "#ffffff",
            foreground: "#eeeeee",
          },
        },
        false,
      ),
    ).toThrow("Text and background need at least 4.5:1 contrast.");
    expect(() =>
      validateAppearance({ ...DEFAULT_APPEARANCE, ...THEME_PRESETS.paper, accent: "#ffffff" }),
    ).toThrow("Accent and background need at least 3:1 contrast.");
  });
  test("actual picker renders Default for adaptive values and caller wires selection to the resolved appearance", () => {
    for (const background of ["#000000", "#ffffff", "#636363"]) {
      let changes = 0;
      const html = renderToStaticMarkup(
        createElement(AccentColorPicker, {
          background,
          value: defaultAccentForBackground(background),
          change() {
            changes += 1;
          },
        }),
      );
      expect(html).toContain('aria-label="Accent color"');
      expect(html).toContain("Default");
      expect(html).not.toContain(">Custom<");
      expect(changes).toBe(0);
    }
    const caller = readFileSync(
      new URL("../src/components/account/AppearanceBasics.tsx", import.meta.url),
      "utf8",
    );
    expect(caller).toContain("background={resolved.background}");
    expect(caller).toContain('option !== "Default"');
    expect(caller).toContain("appearance: withDefaultAccent(prefs, systemDark)");
  });
});
