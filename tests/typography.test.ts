import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  applyAppearance,
  DEFAULT_APPEARANCE,
  exportTheme,
  importTheme,
} from "../src/lib/appearance";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const originalDocument = globalThis.document;
afterEach(() => {
  globalThis.document = originalDocument;
});

function applyFont(uiFont: "system" | "sans" | "serif", codeFont: "mono" | "system-mono" = "mono") {
  const properties = new Map<string, string>();
  globalThis.document = {
    documentElement: {
      style: { setProperty: (key: string, value: string) => properties.set(key, value) },
      classList: { toggle() {}, contains: () => true },
      dataset: {},
    },
  } as unknown as Document;
  const appearance = { ...DEFAULT_APPEARANCE, uiFont, codeFont };
  applyAppearance({ theme: "dark", appearance }, false);
  return { properties, appearance };
}

describe("FOTO shared typography", () => {
  test("default, display and legacy UI-label utilities share Wonder's Source Serif interface token", () => {
    const css = read("styles.css");
    expect(css).toContain(
      '--foto-font-ui: "Source Serif 4", Georgia, "Times New Roman", ui-serif, serif;',
    );
    // Compatibility assets remain available, but no UI utility selects them.
    expect(css).toMatch(/--foto-font-sans:\s*"OpenAI Sans",[\s\S]*?sans-serif;/);
    for (const utility of ["sans", "display", "mono"])
      expect(css).toContain(`--font-${utility}: var(--ll-ui-font, var(--foto-font-ui));`);
    expect(css).toContain('--foto-font-mono: "SF Mono", Menlo, Consolas, ui-monospace, monospace;');
    expect(css).toContain("--font-code: var(--ll-code-font, var(--foto-font-mono));");
    expect(css).not.toMatch(/--font-(?:sans|display|mono):[^;]*foto-font-sans/);
    expect(read("components/develop/develop.css")).toContain("font-family: var(--foto-font-ui);");
  });

  test("default and legacy Sans choices render Wonder's shared face without changing stored preferences", () => {
    for (const choice of ["system", "sans"] as const) {
      const { properties, appearance } = applyFont(choice);
      expect(properties.get("--ll-ui-font")).toBe("var(--foto-font-ui)");
      expect(appearance.uiFont).toBe(choice);
      expect(importTheme(exportTheme(appearance))).toEqual(appearance);
    }
  });

  test("legacy serif settings remain portable but render the single FOTO face", () => {
    const { properties, appearance } = applyFont("serif", "system-mono");
    expect(properties.get("--ll-ui-font")).toBe("var(--foto-font-ui)");
    expect(appearance.uiFont).toBe("serif");
    expect(properties.get("--ll-code-font")).toBe('Menlo, Consolas, "Liberation Mono", monospace');
    expect(importTheme(exportTheme(appearance))).toEqual(appearance);
    expect(applyFont("sans").properties.get("--ll-code-font")).toBe("var(--foto-font-mono)");
  });

  test("licensed variable fonts are bundled intact and the primary face is preloaded from this origin", () => {
    const assets = [
      [
        "SourceSerif4Variable-Roman.woff2",
        "940a76eda1388de39d38c8e7a79bf6ea058a387faee0a9f33c8d25c6ba05e1be",
      ],
      [
        "SourceSerif4Variable-Italic.woff2",
        "9d28b5749a1ad096a295cb607c521bd1af4cd9979b6f37332daf70143149fb44",
      ],
    ];
    const css = read("styles.css");
    for (const [filename, hash] of assets) {
      const bytes = readFileSync(
        new URL(`../public/fonts/source-serif-4/${filename}`, import.meta.url),
      );
      expect(bytes.subarray(0, 4).toString()).toBe("wOF2");
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
      expect(css).toContain(`/fonts/source-serif-4/${filename}`);
    }
    expect(css.match(/font-family: "Source Serif 4";[\s\S]*?font-weight: 200 900;/g)).toHaveLength(
      2,
    );
    const license = readFileSync(
      new URL("../public/fonts/source-serif-4/OFL.md", import.meta.url),
      "utf8",
    );
    expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(license).toContain("Copyright 2014 - 2023 Adobe");
    const root = read("routes/__root.tsx");
    expect(root).toContain('href: "/fonts/source-serif-4/SourceSerif4Variable-Roman.woff2"');
    expect(root).toContain('rel: "preload"');
    expect(root).toContain('crossOrigin: "anonymous"');
    expect(read("components/account/AppearanceSettings.tsx")).toContain(
      "<span>Source Serif 4</span>",
    );
  });

  test("business and portaled controls no longer hard-code an unrelated typeface", () => {
    for (const path of [
      "components/clients/clients-sheet.css",
      "components/earnings/earnings-finances.css",
      "components/outbound/outbound.css",
      "components/account/accent-color-picker.css",
      "components/workbench/workbench.css",
    ]) {
      const css = read(path);
      expect(css).not.toMatch(/(?:Times New Roman|Iowan Old Style|Palatino|Georgia)/);
      expect(css).not.toMatch(/font(?:-family)?:[^;]*(?:ui-sans-serif|BlinkMacSystemFont)/);
      expect(css).toMatch(/var\(--(?:font-sans|workspace-ui-font)\)/);
    }
  });

  test("portfolio defaults share the interface font without removing imported fonts", () => {
    const source = read("routes/portfolio.tsx");
    expect(source).toContain('"var(--font-sans)"');
    expect(source).toContain("\"Georgia, 'Times New Roman', serif\"");
    expect(source).toContain('name ? `"${name}", `');
  });
});
