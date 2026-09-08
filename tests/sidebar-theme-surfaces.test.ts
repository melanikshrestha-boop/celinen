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
  test("new workspaces default to dark with translucent navigation, not System or blue", () => {
    expect(DEFAULT_PREFERENCES.theme).toBe("dark");
    expect(DEFAULT_APPEARANCE.translucentSidebar).toBe(true);
    const tokens = sidebarSurfaceTokens(DEFAULT_APPEARANCE, true);
    expect(tokens["--foto-sidebar-material"]).toBe("#24242499");
    expect(tokens["--foto-sidebar-solid"]).toBe("#242424");
    expect(tokens["--foto-sidebar-text"]).toBe("#f5f5f5");
    expect(tokens["--foto-sidebar-muted"]).toBe("#a3a3a3");
    expect(tokens["--foto-settings-surface"]).toBe("#181818");
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
        expect(result.appearance.background).toBe(expectedDark ? "#000000" : "#ffffff");
        const tokens = sidebarSurfaceTokens(result.appearance, result.dark);
        expect(tokens["--foto-sidebar-material"]).toBe(expectedDark ? "#24242499" : "#f9f9f9e6");
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
      const resolved = resolvedAppearance(value, false);
      expect(resolved.appearance).toEqual(value.appearance);
      const tokens = sidebarSurfaceTokens(resolved.appearance, resolved.dark);
      expect(tokens["--foto-sidebar-material"]).toBe("#261e20");
      expect(tokens["--foto-sidebar-text"]).toBe("#fff1e6");
      expect(tokens["--foto-sidebar-filter"]).toBe("none");
      expect(importTheme(exportTheme(value.appearance))).toEqual(value.appearance);
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
  test("1,000 custom backgrounds retain their chosen hues and readable secondary labels", () => {
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
      const tokens = sidebarSurfaceTokens(appearance, index % 2 === 0);
      expect(tokens["--foto-sidebar-solid"]).toBe(background);
      expect(tokens["--foto-sidebar-text"]).toBe(foreground);
      expect(contrastRatio(tokens["--foto-sidebar-muted"], background)).toBeGreaterThanOrEqual(4.5);
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
  test("an explicitly chosen custom gradient is preserved only as the user's content fill", () => {
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
    expect(settings).toContain("--settings-rail: var(--foto-sidebar-material, #f9f9f9e6)");
    expect(settings).toContain("-webkit-backdrop-filter: var(--foto-sidebar-filter, blur(30px))");
    expect(settings).toContain('html[data-settings-translucency="false"] .settings-rail');
    expect(settings).toContain("prefers-reduced-transparency: reduce");
    expect(settings).toContain("prefers-contrast: more");
    expect(settings).not.toContain("var(--settings-rail) 84%, var(--settings-bg)");
  });
  test("CSS fallbacks share the hydrated light/dark token values without touching editor tokens", () => {
    const styles = css("styles.css");
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
  test("readable accent uses the actual custom canvas, not an assumed dark-mode black", () => {
    const appearance = withDefaultAccent(
      {
        theme: "dark",
        appearance: {
          ...DEFAULT_APPEARANCE,
          preset: "custom",
          background: "#636363",
          foreground: "#ffffff",
        },
      },
      false,
    );
    const result = apply("dark", appearance);
    expect(appearance.accent).toBe("#000000");
    expect(result.properties.get("--ll-readable-accent")).toBe("#000000");
    expect(
      contrastRatio(result.properties.get("--ll-readable-accent")!, appearance.background),
    ).toBeGreaterThanOrEqual(3);
  });
});
