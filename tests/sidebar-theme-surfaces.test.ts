import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  applyAppearance,
  withDefaultAccent,
  appearanceSchema,
  contrastRatio,
  DEFAULT_APPEARANCE,
  exportTheme,
  importTheme,
  resolvedAppearance,
  sidebarSurfaceTokens,
  THEME_PRESETS,
  type Appearance,
} from "../src/lib/appearance";
import { DEFAULT_PREFERENCES, readPreferences } from "../src/lib/account-preferences";

const originalDocument = globalThis.document;
afterEach(() => {
  globalThis.document = originalDocument;
});
const css = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
function apply(
  theme: "light" | "dark" | "system",
  appearance = DEFAULT_APPEARANCE,
  systemDark = false,
) {
  const properties = new Map<string, string>();
  const dataset: Record<string, string> = {};
  let dark = false;
  globalThis.document = {
    documentElement: {
      style: { setProperty: (key: string, value: string) => properties.set(key, value) },
      classList: {
        toggle: (_key: string, active: boolean) => {
          dark = active;
        },
        contains: () => dark,
      },
      dataset,
    },
  } as unknown as Document;
  applyAppearance({ theme, appearance }, systemDark);
  return { properties, dataset, dark };
}

describe("Neutral sidebar theme surfaces", () => {
  test("every mode renders the Wonder interface even with a saved legacy sans preference", () => {
    const appearance = appearanceSchema.parse({ uiFont: "sans" });
    const saved = JSON.stringify(appearance);
    for (const theme of ["light", "dark", "system"] as const) {
      expect(apply(theme, appearance).properties.get("--ll-ui-font")).toBe("var(--foto-font-ui)");
      expect(JSON.stringify(appearance)).toBe(saved);
    }
  });
  test("opacity remains adjustable over a pitch-black dark rail without changing saved colors", () => {
    expect(DEFAULT_APPEARANCE.sidebarOpacity).toBe(80);
    for (let opacity = 20; opacity <= 100; opacity += 5) {
      const appearance = appearanceSchema.parse({ ...DEFAULT_APPEARANCE, sidebarOpacity: opacity });
      const expected = Math.round((opacity * 255) / 100)
        .toString(16)
        .padStart(2, "0");
      expect(sidebarSurfaceTokens(appearance, true)["--foto-sidebar-material"]).toBe(
        `#000000${expected}`,
      );
      expect(appearance.background).toBe(DEFAULT_APPEARANCE.background);
    }
    expect(appearanceSchema.safeParse({ sidebarOpacity: 101 }).success).toBe(false);
    expect(appearanceSchema.safeParse({ sidebarOpacity: -1 }).success).toBe(false);
  });
  test("header chrome cannot inherit an old blue-gray custom canvas", () => {
    const sheet = css("components/workbench/workbench.css");
    const header = sheet.match(/html\.dark \.workbench-header\s*\{([^}]+)\}/)?.[1];
    expect(header).toContain("--wb-bg: #000000;");
    expect(header).toContain("--wb-text: #f5f5f5;");
  });
  test("new workspaces default to light with translucent navigation, not System or blue", () => {
    expect(DEFAULT_PREFERENCES.theme).toBe("light");
    expect(DEFAULT_APPEARANCE.translucentSidebar).toBe(true);
    const tokens = sidebarSurfaceTokens(DEFAULT_APPEARANCE, true);
    expect(tokens["--foto-sidebar-material"]).toBe("#000000cc");
    expect(tokens["--foto-sidebar-solid"]).toBe("#000000");
    expect(tokens["--foto-sidebar-text"]).toBe("#f5f5f5");
    expect(tokens["--foto-sidebar-muted"]).toBe("#a3a3a3");
    expect(tokens["--foto-settings-surface"]).toBe("#000000");
    expect(tokens["--foto-sidebar-filter"]).toBe("blur(30px)");
  });
  test("Light and System resolve coherently without changing saved preference objects", () => {
    for (const theme of ["light", "dark", "system"] as const) {
      for (const systemDark of [false, true]) {
        const prefs = { theme, appearance: { ...DEFAULT_APPEARANCE } };
        const before = JSON.stringify(prefs);
        const result = resolvedAppearance(prefs, systemDark);
        const expectedDark = theme === "dark" || (theme === "system" && systemDark);
        expect(result.dark).toBe(expectedDark);
        expect(result.appearance.background).toBe(expectedDark ? "#000000" : "#f7f7fa");
        const tokens = sidebarSurfaceTokens(result.appearance, result.dark);
        expect(tokens["--foto-sidebar-material"]).toBe(expectedDark ? "#000000cc" : "#f7f7facc");
        expect(JSON.stringify(prefs)).toBe(before);
      }
    }
  });
  test("the paper preset follows System-dark without overwriting its stored colors", () => {
    const appearance = appearanceSchema.parse({ preset: "paper", ...THEME_PRESETS.paper });
    const resolved = resolvedAppearance({ theme: "system", appearance }, true);
    expect(resolved.appearance.background).toBe("#000000");
    expect(appearance.background).toBe("#ffffff");
    expect(appearance.preset).toBe("paper");
  });
  test("built-in paper renders Wonder's light surface without rewriting old exports", () => {
    const appearance = appearanceSchema.parse({ preset: "paper", ...THEME_PRESETS.paper });
    const before = JSON.stringify(appearance);
    const result = resolvedAppearance({ theme: "light", appearance }, false);
    expect(result.appearance.background).toBe("#f7f7fa");
    expect(result.appearance.foreground).toBe("#1a1c22");
    expect(sidebarSurfaceTokens(result.appearance, false)["--foto-sidebar-solid"]).toBe("#f7f7fa");
    expect(JSON.stringify(appearance)).toBe(before);
    expect(importTheme(exportTheme(appearance))).toEqual(appearance);
  });
  test("explicit saved opacity, mode, palette and typography remain intact", () => {
    for (const theme of ["light", "dark", "system"] as const) {
      const value = {
        ...DEFAULT_PREFERENCES,
        theme,
        appearance: {
          ...DEFAULT_APPEARANCE,
          translucentSidebar: false,
          uiFont: "serif" as const,
          preset: "custom" as const,
          background: "#261e20",
          foreground: "#fff1e6",
          accent: "#e99cb5",
        },
      };
      expect(readPreferences(JSON.stringify(value))).toEqual(value);
      const before = JSON.stringify(value);
      const resolved = resolvedAppearance(value, false);
      expect(resolved.appearance).toEqual(
        theme === "dark"
          ? {
              ...value.appearance,
              background: "#000000",
              backgroundEnd: "#000000",
              backgroundStyle: "solid",
            }
          : value.appearance,
      );
      const tokens = sidebarSurfaceTokens(resolved.appearance, resolved.dark);
      expect(tokens["--foto-sidebar-material"]).toBe(theme === "dark" ? "#000000" : "#261e20");
      expect(tokens["--foto-sidebar-text"]).toBe(theme === "dark" ? "#f5f5f5" : "#fff1e6");
      expect(tokens["--foto-sidebar-filter"]).toBe("none");
      expect(importTheme(exportTheme(value.appearance))).toEqual(value.appearance);
      expect(JSON.stringify(value)).toBe(before);
    }
  });
  test("explicit high contrast uses solid surfaces without rewriting the translucency choice", () => {
    const appearance = { ...DEFAULT_APPEARANCE, contrast: "more" as const };
    const tokens = sidebarSurfaceTokens(appearance, true);
    expect(tokens["--foto-sidebar-material"]).toBe(tokens["--foto-sidebar-solid"]);
    expect(tokens["--foto-sidebar-filter"]).toBe("none");
    expect(appearance.translucentSidebar).toBe(true);
  });
  test("default primary and secondary labels meet normal-text contrast on both solid fallbacks", () => {
    for (const dark of [false, true]) {
      const tokens = sidebarSurfaceTokens(DEFAULT_APPEARANCE, dark);
      for (const text of ["--foto-sidebar-text", "--foto-sidebar-muted"] as const)
        expect(contrastRatio(tokens[text], tokens["--foto-sidebar-solid"])).toBeGreaterThanOrEqual(
          4.5,
        );
    }
  });
  test("1,000 custom palettes remain exact in light mode and become readable neutral black only for dark display", () => {
    for (let index = 0; index < 1000; index++) {
      const background = `#${((index * 7919) % 0xffffff).toString(16).padStart(6, "0")}`;
      const foreground =
        contrastRatio(background, "#000000") > contrastRatio(background, "#ffffff")
          ? "#000000"
          : "#ffffff";
      const appearance: Appearance = {
        ...DEFAULT_APPEARANCE,
        preset: "custom",
        background,
        foreground,
        accent: foreground,
      };
      const before = JSON.stringify(appearance);
      for (const dark of [false, true]) {
        const tokens = sidebarSurfaceTokens(appearance, dark);
        expect(tokens["--foto-sidebar-solid"]).toBe(dark ? "#000000" : background);
        expect(tokens["--foto-sidebar-text"]).toBe(dark ? "#f5f5f5" : foreground);
        expect(
          contrastRatio(tokens["--foto-sidebar-muted"], tokens["--foto-sidebar-solid"]),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(tokens["--foto-sidebar-text"], tokens["--foto-sidebar-solid"]),
        ).toBeGreaterThanOrEqual(4.5);
      }
      expect(JSON.stringify(appearance)).toBe(before);
    }
  });
  test("applying display tokens does not persist preferences or substitute an unrequested gradient", () => {
    const before = JSON.stringify(DEFAULT_APPEARANCE);
    const result = apply("dark");
    const tokens = sidebarSurfaceTokens(DEFAULT_APPEARANCE, true);
    for (const [key, value] of Object.entries(tokens))
      expect(result.properties.get(key)).toBe(value);
    expect(result.properties.get("--wb-bg-fill")).toBe("#000000");
    expect(result.dark).toBe(true);
    expect(result.dataset.settingsTranslucency).toBe("true");
    expect(JSON.stringify(DEFAULT_APPEARANCE)).toBe(before);
  });
  test("an explicitly chosen custom gradient remains unchanged in light mode", () => {
    const appearance = {
      ...DEFAULT_APPEARANCE,
      preset: "custom" as const,
      background: "#211e1a",
      foreground: "#eee8de",
      backgroundEnd: "#161310",
      backgroundStyle: "gradient" as const,
      translucentSidebar: false,
    };
    const result = apply("light", appearance);
    expect(result.properties.get("--wb-bg-fill")).toBe("linear-gradient(165deg, #211e1a, #161310)");
    expect(result.properties.get("--foto-sidebar-material")).toBe("#211e1a");
    expect(result.properties.get("--foto-sidebar-text")).toBe("#eee8de");
  });
  test("Settings consumes shared surfaces and has real transparency plus accessibility fallbacks", () => {
    const settings = css("components/account/settings-workspace.css");
    for (const stale of ["#10141a", "#202226", "#171b21", "#2a2c30"])
      expect(settings).not.toContain(stale);
    expect(settings).toContain("--settings-surface: var(--foto-settings-surface, #fafafa)");
    expect(settings).toContain("--settings-rail: var(--foto-sidebar-material, #f9f9f9cc)");
    expect(settings).toContain("-webkit-backdrop-filter: var(--foto-sidebar-filter, blur(30px))");
    expect(settings).toContain('html[data-settings-translucency="false"] .settings-rail');
    expect(settings).toContain("prefers-reduced-transparency: reduce");
    expect(settings).toContain("prefers-contrast: more");
    expect(settings).not.toContain("var(--settings-rail) 84%, var(--settings-bg)");
  });
  test("CSS fallbacks share the hydrated light/dark token values without touching editor tokens", () => {
    const styles = css("styles.css");
    const dark = styles.match(/\n\.dark\s*\{([^}]+)\}/)?.[1];
    expect(dark).toContain("--paper: #000000;");
    for (const dark of [false, true]) {
      const tokens = sidebarSurfaceTokens(DEFAULT_APPEARANCE, dark);
      for (const [key, value] of Object.entries(tokens))
        expect(styles).toContain(`${key}: ${value};`);
    }
    expect(styles).not.toContain("--dv-");
  });
  test("light workbench cascade preserves the resolved custom fill and foreground", () => {
    const workbench = css("components/workbench/workbench.css");
    const light = workbench.match(/html:not\(\.dark\) \.photo-workbench\s*\{([^}]+)\}/)?.[1];
    expect(light).toContain("--wb-bg: var(--wb-user-bg, #fff)");
    expect(light).toContain("--wb-text: var(--wb-user-fg, #171717)");
    expect(light).not.toContain("--wb-bg-fill:");
  });
  test("black canvas retains separate neutral hover, selected, composer and menu controls", () => {
    const workbench = css("components/workbench/workbench.css");
    const shared = workbench.match(
      /html:has\(\.photo-workbench, \.workbench-lock\)\s*\{([^}]+)\}/,
    )?.[1];
    for (const declaration of [
      "--surface-hover: #141414;",
      "--surface-selected: #1a1a1a;",
      "--surface-composer: #212121;",
      "--surface-menu: #242424;",
    ])
      expect(shared).toContain(declaration);
  });
  test("late collapsed and mobile rules retain 44px targets and unsupported blur has a rail fallback", () => {
    const workbench = css("components/workbench/workbench.css");
    const collapsed = workbench.match(
      /\[data-collapsible="icon"\] \.workbench-nav-item\s*\{([^}]+)\}/,
    )?.[1];
    expect(collapsed).toContain("width: 44px");
    expect(collapsed).toContain("height: 44px");
    expect(workbench).toMatch(
      /\.workbench-mobile-sidebar \.workbench-nav-item\s*\{\s*min-height: 44px;/,
    );
    expect(workbench).toMatch(
      /@supports not \(\(backdrop-filter:[\s\S]*?\.foto-mobile-rail\s*\{\s*background: var\(--wb-sidebar-solid\)/,
    );
  });
  test("higher contrast respects validated custom colors rather than forcing black text on a dark custom canvas", () => {
    const personalization = css("components/account/workspace-personalization.css");
    for (const selector of [
      'html[data-contrast="more"] .settings-shell',
      'html.dark[data-contrast="more"] .settings-shell',
      'html[data-contrast="system"] .settings-shell',
      'html.dark[data-contrast="system"] .settings-shell',
    ]) {
      const block = personalization.slice(personalization.indexOf(selector)).split("}")[0];
      expect(block).toContain("--settings-text: var(--ll-settings-foreground,");
      expect(block).toContain("--settings-muted: var(--ll-settings-foreground,");
    }
    const appearance = {
      ...DEFAULT_APPEARANCE,
      preset: "custom" as const,
      background: "#261e20",
      foreground: "#fff1e6",
      contrast: "more" as const,
    };
    const result = apply("light", appearance);
    expect(result.properties.get("--ll-settings-background")).toBe(appearance.background);
    expect(result.properties.get("--ll-settings-foreground")).toBe(appearance.foreground);
    expect(contrastRatio(appearance.foreground, appearance.background)).toBeGreaterThanOrEqual(4.5);
  });
  test("light-mode Default accent still uses the actual custom canvas", () => {
    const appearance = withDefaultAccent(
      {
        theme: "light",
        appearance: {
          ...DEFAULT_APPEARANCE,
          preset: "custom",
          background: "#636363",
          foreground: "#ffffff",
        },
      },
      false,
    );
    const result = apply("light", appearance);
    expect(appearance.accent).toBe("#000000");
    expect(result.properties.get("--ll-readable-accent")).toBe("#000000");
    expect(
      contrastRatio(result.properties.get("--ll-readable-accent")!, appearance.background),
    ).toBeGreaterThanOrEqual(3);
  });
  test("old Midnight and custom gradients cannot tint dark or System-dark canvas, settings, or navigation", () => {
    const palettes: Appearance[] = [
      appearanceSchema.parse({
        preset: "midnight",
        ...THEME_PRESETS.midnight,
        backgroundStyle: "gradient",
      }),
      appearanceSchema.parse({
        preset: "warm",
        ...THEME_PRESETS.warm,
        backgroundStyle: "gradient",
      }),
      appearanceSchema.parse({
        preset: "custom",
        background: "#151f38",
        foreground: "#f2e8ff",
        backgroundEnd: "#204568",
        backgroundStyle: "gradient",
        uiFont: "serif",
        sidebarOpacity: 55,
      }),
    ];
    for (const appearance of palettes) {
      const original = JSON.stringify(appearance);
      Object.freeze(appearance);
      for (const theme of ["dark", "system"] as const) {
        const result = apply(theme, appearance, true);
        expect(result.dark).toBe(true);
        for (const token of [
          "--wb-user-bg",
          "--wb-bg-fill",
          "--ll-settings-background",
          "--foto-sidebar-solid",
          "--foto-settings-surface",
        ])
          expect(result.properties.get(token)).toBe("#000000");
        const alpha = Math.round((appearance.sidebarOpacity * 255) / 100)
          .toString(16)
          .padStart(2, "0");
        expect(result.properties.get("--foto-sidebar-material")).toBe(`#000000${alpha}`);
        expect(result.properties.get("--wb-user-fg")).toBe(appearance.foreground);
        expect(result.properties.get("--foto-sidebar-text")).toBe("#f5f5f5");
        expect(JSON.stringify(appearance)).toBe(original);
      }
      const light = apply("system", appearance, false);
      expect(light.dark).toBe(false);
      expect(light.properties.get("--wb-bg-fill")).toBe(
        `linear-gradient(165deg, ${appearance.background}, ${appearance.backgroundEnd})`,
      );
      expect(light.properties.get("--wb-user-fg")).toBe(appearance.foreground);
      expect(JSON.stringify(appearance)).toBe(original);
    }
  });
  test("dark foreground is preserved only when it reads on black, without mutating stored colors", () => {
    for (const foreground of ["#000000", "#171717", "#747474", "#777777", "#fff1e6", "#ffffff"]) {
      const appearance = appearanceSchema.parse({
        preset: "custom",
        background: "#ffffff",
        foreground,
      });
      const original = JSON.stringify(appearance);
      const result = resolvedAppearance({ theme: "dark", appearance }, false);
      expect(result.appearance.foreground).toBe(
        contrastRatio(foreground, "#000000") >= 4.5 ? foreground : DEFAULT_APPEARANCE.foreground,
      );
      expect(result.appearance.background).toBe("#000000");
      expect(result.appearance.backgroundEnd).toBe("#000000");
      expect(result.appearance.backgroundStyle).toBe("solid");
      expect(contrastRatio(result.appearance.foreground, "#000000")).toBeGreaterThanOrEqual(4.5);
      expect(JSON.stringify(appearance)).toBe(original);
    }
  });
  test("dark high contrast and disabled translucency use solid black while preserving those preferences", () => {
    for (const contrast of ["system", "standard", "more"] as const) {
      for (const translucentSidebar of [false, true]) {
        const appearance = appearanceSchema.parse({
          preset: "midnight",
          ...THEME_PRESETS.midnight,
          contrast,
          translucentSidebar,
          sidebarOpacity: 20,
        });
        const original = JSON.stringify(appearance);
        const result = apply("dark", appearance);
        const translucent = translucentSidebar && contrast !== "more";
        expect(result.properties.get("--foto-sidebar-material")).toBe(
          translucent ? "#00000033" : "#000000",
        );
        expect(result.properties.get("--foto-sidebar-filter")).toBe(
          translucent ? "blur(30px)" : "none",
        );
        expect(result.properties.get("--foto-settings-surface")).toBe("#000000");
        expect(result.dataset.contrast).toBe(contrast);
        expect(result.dataset.settingsTranslucency).toBe(String(translucentSidebar));
        expect(JSON.stringify(appearance)).toBe(original);
      }
    }
  });
  test("Default accent on a dark display does not overwrite a saved custom palette or gradient", () => {
    const appearance = appearanceSchema.parse({
      preset: "custom",
      background: "#636363",
      foreground: "#ffffff",
      accent: "#ffffff",
      backgroundEnd: "#211e1a",
      backgroundStyle: "gradient",
    });
    const before = JSON.stringify(appearance);
    const updated = withDefaultAccent({ theme: "dark", appearance }, false);
    const { accent: _accent, ...updatedFields } = updated;
    const { accent: _originalAccent, ...savedFields } = appearance;
    expect(updatedFields).toEqual(savedFields);
    const result = apply("dark", updated);
    expect(result.properties.get("--wb-bg-fill")).toBe("#000000");
    expect(
      contrastRatio(result.properties.get("--ll-readable-accent")!, "#000000"),
    ).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(appearance)).toBe(before);
  });
});
