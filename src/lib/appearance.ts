import { z } from "zod";

const color = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hex color.");
export const appearanceSchema = z
  .object({
    preset: z.enum(["lenslabs", "midnight", "warm", "custom"]).default("lenslabs"),
    accent: color.default("#b4b4b4"),
    background: color.default("#10141a"),
    foreground: color.default("#e7e6e2"),
    uiFont: z.enum(["system", "sans", "serif"]).default("system"),
    codeFont: z.enum(["mono", "system-mono"]).default("mono"),
    uiSize: z.number().int().min(13).max(18).default(14),
    codeSize: z.number().int().min(12).max(20).default(13),
    density: z.enum(["compact", "comfortable"]).default("compact"),
    translucentSidebar: z.boolean().default(false),
    contrast: z.enum(["system", "standard", "more"]).default("system"),
    accentStyle: z.enum(["solid", "gradient"]).default("solid"),
    accentEnd: color.default("#b099f1"),
    grid: z.boolean().default(false),
  })
  .strict();
export type Appearance = z.infer<typeof appearanceSchema>;
export const DEFAULT_APPEARANCE = appearanceSchema.parse({});
export const ACCENT_COLORS = [
  ["Default", "#999999"],
  ["Blue", "#2867c7"],
  ["Green", "#479f46"],
  ["Yellow", "#dba52b"],
  ["Pink", "#ec75b2"],
  ["Orange", "#d35f27"],
  ["Purple", "#8049d2"],
  ["White", "#ffffff"],
] as const;
// Preserve labels for already-saved colors without rewriting anyone's preferences.
const LEGACY_ACCENT_NAMES: Record<string, string> = {
  "#b4b4b4": "Default",
  "#6b9fff": "Blue",
  "#75c588": "Green",
  "#eab74e": "Yellow",
  "#e98aba": "Pink",
  "#ed9a63": "Orange",
  "#b099f1": "Purple",
};
export function accentColorName(value: string) {
  const normalized = value.toLowerCase();
  return (
    ACCENT_COLORS.find(([, color]) => color === normalized)?.[0] ??
    LEGACY_ACCENT_NAMES[normalized] ??
    "Custom"
  );
}
export function normalizeColor(value: string) {
  const hex = value.trim().replace(/^#/, "");
  return color
    .parse(`#${hex.length === 3 ? [...hex].map((char) => char + char).join("") : hex}`)
    .toLowerCase();
}
export const THEME_PRESETS = {
  lenslabs: { accent: "#b4b4b4", background: "#10141a", foreground: "#e7e6e2" },
  midnight: { accent: "#94b5ef", background: "#111827", foreground: "#edf1f8" },
  warm: { accent: "#d7ab73", background: "#211e1a", foreground: "#eee8de" },
} as const;
export function contrastRatio(a: string, b: string) {
  const luminance = (hex: string) => {
    const rgb = [1, 3, 5]
      .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
    return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}
export function validateAppearance(value: unknown) {
  const parsed = appearanceSchema.parse(value);
  if (contrastRatio(parsed.background, parsed.foreground) < 4.5)
    throw new Error(
      "Text and background need at least 4.5:1 contrast. Choose more distinct colors.",
    );
  if (contrastRatio(parsed.background, parsed.accent) < 3)
    throw new Error("Accent and background need at least 3:1 contrast.");
  if (
    ["#171b21", "#202226", "#2a2c30"].some(
      (surface) => contrastRatio(surface, parsed.foreground) < 4.5,
    ) ||
    contrastRatio(parsed.background, "#a5a5a2") < 4.5
  )
    throw new Error(
      "Choose dark-theme colors that preserve readable text on panels and navigation.",
    );
  if (contrastRatio("#171b21", parsed.accent) < 3)
    throw new Error("The accent needs at least 3:1 contrast against controls.");
  return parsed;
}
export function exportTheme(appearance: Appearance) {
  return JSON.stringify(
    { product: "LensLabs", version: 1, appearance: validateAppearance(appearance) },
    null,
    2,
  );
}
export function importTheme(text: string) {
  if (text.length > 8192) throw new Error("Choose a theme smaller than 8 KB.");
  const parsed = z
    .object({ product: z.literal("LensLabs"), version: z.literal(1), appearance: appearanceSchema })
    .strict()
    .parse(JSON.parse(text));
  return validateAppearance(parsed.appearance);
}
/** Allowlisted values only; theme JSON is never interpreted as CSS or executable code. */
export function applyAppearance(
  prefs: { theme: "light" | "dark" | "system"; appearance: Appearance },
  systemDark: boolean,
) {
  const root = document.documentElement;
  root.classList.toggle("dark", prefs.theme === "system" ? systemDark : prefs.theme === "dark");
  const value = prefs.appearance;
  root.style.setProperty("--ll-settings-background", value.background);
  root.style.setProperty("--ll-settings-foreground", value.foreground);
  root.style.setProperty("--ll-settings-accent", value.accent);
  root.style.setProperty(
    "--ll-readable-accent",
    contrastRatio(value.accent, root.classList.contains("dark") ? "#000000" : "#ffffff") >= 3
      ? value.accent
      : "#555555",
  );
  root.style.setProperty(
    "--ll-accent-ink",
    contrastRatio(value.accent, "#111111") >= 4.5 ? "#111111" : "#ffffff",
  );
  root.style.setProperty(
    "--ll-accent-gradient",
    value.accentStyle === "gradient"
      ? `linear-gradient(115deg, ${value.accent}, ${value.accentEnd})`
      : value.accent,
  );
  root.style.setProperty(
    "--ll-ui-font",
    value.uiFont === "serif"
      ? "Georgia, serif"
      : value.uiFont === "sans"
        ? "'Helvetica Neue', Arial, sans-serif"
        : "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  );
  root.style.setProperty(
    "--ll-code-font",
    value.codeFont === "mono" ? "ui-monospace, monospace" : "Menlo, Consolas, monospace",
  );
  root.style.setProperty("--ll-ui-size", `${value.uiSize}px`);
  root.style.setProperty("--ll-code-size", `${value.codeSize}px`);
  root.dataset["settingsDensity"] = value.density;
  root.dataset["settingsTranslucency"] = String(value.translucentSidebar);
  root.dataset["contrast"] = value.contrast;
  root.dataset["workspaceGrid"] = String(value.grid);
}
