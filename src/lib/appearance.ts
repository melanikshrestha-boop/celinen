import { z } from "zod";

const color = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hex color.");
export const appearanceSchema = z
  .object({
    preset: z.enum(["lenslabs", "paper", "midnight", "warm", "custom"]).default("lenslabs"),
    accent: color.default("#b4b4b4"),
    background: color.default("#000000"),
    foreground: color.default("#f3f3f3"),
    backgroundStyle: z.enum(["solid", "gradient"]).default("solid"),
    backgroundEnd: color.default("#1a1a1a"),
    uiFont: z.enum(["system", "sans", "serif"]).default("system"),
    codeFont: z.enum(["mono", "system-mono"]).default("mono"),
    uiSize: z.number().int().min(13).max(18).default(14),
    codeSize: z.number().int().min(12).max(20).default(13),
    density: z.enum(["compact", "comfortable"]).default("compact"),
    translucentSidebar: z.boolean().default(true),
    sidebarOpacity: z.number().int().min(20).max(100).default(80),
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
  "#171717": "Default", // Built-in Paper / Light accent; not a custom palette.
  "#000000": "Default", // Readable neutral fallback for middle-gray custom backgrounds.
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
  lenslabs: {
    accent: "#b4b4b4",
    background: "#000000",
    foreground: "#f3f3f3",
    backgroundEnd: "#1a1a1a",
  },
  paper: {
    accent: "#171717",
    background: "#ffffff",
    foreground: "#171717",
    backgroundEnd: "#f4f4f4",
  },
  midnight: {
    accent: "#94b5ef",
    background: "#111827",
    foreground: "#edf1f8",
    backgroundEnd: "#0b1220",
  },
  warm: {
    accent: "#d7ab73",
    background: "#211e1a",
    foreground: "#eee8de",
    backgroundEnd: "#161310",
  },
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
  if (
    parsed.backgroundStyle === "gradient" &&
    contrastRatio(parsed.backgroundEnd, parsed.foreground) < 4.5
  )
    throw new Error("Text still has to read on the gradient’s other end.");
  if (contrastRatio(parsed.background, parsed.accent) < 3)
    throw new Error("Accent and background need at least 3:1 contrast.");
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
type ThemePreference = { theme: "light" | "dark" | "system"; appearance: Appearance };

/** Resolve mode for display only. Never rewrite the user's saved theme or colors. */
export function resolvedAppearance(prefs: ThemePreference, systemDark: boolean) {
  const dark = prefs.theme === "system" ? systemDark : prefs.theme === "dark";
  let appearance = prefs.appearance;
  if (!dark && appearance.preset === "lenslabs")
    appearance = { ...appearance, preset: "paper", ...THEME_PRESETS.paper };
  else if (dark && appearance.preset === "paper")
    appearance = { ...appearance, preset: "lenslabs", ...THEME_PRESETS.lenslabs };
  return { dark, appearance };
}

/** Default is a neutral that reads on this canvas, not a fixed gray swatch. */
export function defaultAccentForBackground(background: string) {
  const checked = color.parse(background);
  return [THEME_PRESETS.lenslabs.accent, THEME_PRESETS.paper.accent, "#000000"].find(
    (accent) => contrastRatio(accent, checked) >= 3,
  )!;
}

/** An explicit Default action follows the visible mode without replacing custom palettes. */
export function withDefaultAccent(prefs: ThemePreference, systemDark: boolean) {
  const { appearance } = resolvedAppearance(prefs, systemDark);
  return validateAppearance({
    ...appearance,
    accent: defaultAccentForBackground(appearance.background),
  });
}

function mixHex(foreground: string, background: string, foregroundWeight: number) {
  return `#${[1, 3, 5]
    .map((offset) =>
      Math.round(
        parseInt(foreground.slice(offset, offset + 2), 16) * foregroundWeight +
          parseInt(background.slice(offset, offset + 2), 16) * (1 - foregroundWeight),
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
function readableMuted(foreground: string, background: string) {
  for (let step = 0; step <= 6; step++) {
    const mixed = mixHex(foreground, background, 0.7 + step * 0.05);
    if (contrastRatio(mixed, background) >= 4.5) return mixed;
  }
  return foreground;
}

/** Shared neutral surfaces for both navigation rails. No wallpaper or tinted underlay. */
export function sidebarSurfaceTokens(appearance: Appearance, dark: boolean) {
  const neutral = appearance.preset === "lenslabs" || appearance.preset === "paper";
  const solid = neutral ? (dark ? "#242424" : "#f9f9f9") : appearance.background;
  const text = neutral ? (dark ? "#f5f5f5" : "#202020") : appearance.foreground;
  const muted = neutral ? (dark ? "#a3a3a3" : "#626262") : readableMuted(text, solid);
  const translucent = appearance.translucentSidebar && appearance.contrast !== "more";
  const alpha = Math.round((appearance.sidebarOpacity * 255) / 100)
    .toString(16)
    .padStart(2, "0");
  return {
    "--foto-sidebar-material": translucent ? `${solid}${alpha}` : solid,
    "--foto-sidebar-solid": solid,
    "--foto-sidebar-hover": `${text}0d`,
    "--foto-sidebar-selected": `${text}18`,
    "--foto-sidebar-text": text,
    "--foto-sidebar-muted": muted,
    "--foto-sidebar-filter": translucent ? "blur(30px)" : "none",
    "--foto-settings-surface": neutral
      ? dark
        ? "#181818"
        : "#fafafa"
      : mixHex(text, appearance.background, 0.04),
    "--foto-settings-border": `${text}14`,
  };
}
/** Allowlisted values only; theme JSON is never interpreted as CSS or executable code. */
export function applyAppearance(prefs: ThemePreference, systemDark: boolean) {
  const root = document.documentElement;
  const { dark, appearance: value } = resolvedAppearance(prefs, systemDark);
  root.classList.toggle("dark", dark);
  for (const [key, surface] of Object.entries(sidebarSurfaceTokens(value, dark)))
    root.style.setProperty(key, surface);
  root.style.setProperty("--ll-settings-background", value.background);
  root.style.setProperty("--ll-settings-foreground", value.foreground);
  root.style.setProperty("--ll-settings-accent", value.accent);
  root.style.setProperty("--wb-user-bg", value.background);
  root.style.setProperty("--wb-user-fg", value.foreground);
  root.style.setProperty(
    "--wb-bg-fill",
    value.backgroundStyle === "gradient"
      ? `linear-gradient(165deg, ${value.background}, ${value.backgroundEnd})`
      : value.background,
  );
  root.style.setProperty(
    "--ll-readable-accent",
    contrastRatio(value.accent, value.background) >= 3
      ? value.accent
      : defaultAccentForBackground(value.background),
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
    value.uiFont === "serif" ? "Georgia, serif" : "var(--foto-font-sans)",
  );
  root.style.setProperty(
    "--ll-code-font",
    value.codeFont === "system-mono"
      ? 'Menlo, Consolas, "Liberation Mono", monospace'
      : "var(--foto-font-mono)",
  );
  root.style.setProperty("--ll-ui-size", `${value.uiSize}px`);
  root.style.setProperty("--ll-code-size", `${value.codeSize}px`);
  root.dataset["settingsDensity"] = value.density;
  root.dataset["settingsTranslucency"] = String(value.translucentSidebar);
  root.dataset["contrast"] = value.contrast;
  root.dataset["workspaceGrid"] = String(value.grid);
}
