import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
  test("default, display and legacy UI-label utilities share the sans-serif interface token", () => {
    const css = read("styles.css");
    expect(css).toMatch(/--foto-font-sans:\s*"OpenAI Sans",[\s\S]*?sans-serif;/);
    for (const utility of ["sans", "display", "mono"])
      expect(css).toContain(`--font-${utility}: var(--ll-ui-font, var(--foto-font-sans));`);
    expect(css).toContain("--font-code: var(--ll-code-font, var(--foto-font-mono));");
    expect(css).not.toMatch(/--font-(?:sans|display|mono):[^;]*(?:Georgia|Palatino|Times)/);
  });

  test("default and Sans use the shared face without changing stored preferences", () => {
    for (const choice of ["system", "sans"] as const) {
      const { properties, appearance } = applyFont(choice);
      expect(properties.get("--ll-ui-font")).toBe("var(--foto-font-sans)");
      expect(appearance.uiFont).toBe(choice);
      expect(importTheme(exportTheme(appearance))).toEqual(appearance);
    }
  });

  test("legacy serif settings remain portable but render the single FOTO face", () => {
    const { properties, appearance } = applyFont("serif", "system-mono");
    expect(properties.get("--ll-ui-font")).toBe("var(--foto-font-sans)");
    expect(appearance.uiFont).toBe("serif");
    expect(properties.get("--ll-code-font")).toBe('Menlo, Consolas, "Liberation Mono", monospace');
    expect(importTheme(exportTheme(appearance))).toEqual(appearance);
    expect(applyFont("sans").properties.get("--ll-code-font")).toBe("var(--foto-font-mono)");
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
