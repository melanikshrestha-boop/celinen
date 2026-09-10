/**
 * Personal technique memory — photographer's own workspace only.
 * Never stores original pixels. Never trains a shared model.
 */
import { readPreferences } from "./account-preferences";
import type { DevelopSettings } from "./develop/contract";

export const PERSONAL_STYLE_KEY = "lenslabs.personal-style.v1";
const MAX_SAMPLES = 40;

export type PersonalStyleSample = {
  at: string;
  source: "snapshot" | "preset";
  exposure: number;
  contrast: number;
  temperature: number;
  saturation: number;
};

export type PersonalStyleLog = {
  samples: PersonalStyleSample[];
};

function emptyLog(): PersonalStyleLog {
  return { samples: [] };
}

function learningEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key?.startsWith("lenslabs.preferences.v1")) continue;
    try {
      if (readPreferences(localStorage.getItem(key)).learnFromYourWork === false) return false;
    } catch {
      /* ignore a bad bag */
    }
  }
  return true;
}

export function loadPersonalStyle(): PersonalStyleLog {
  try {
    const raw = JSON.parse(localStorage.getItem(PERSONAL_STYLE_KEY) || "null");
    if (!raw || !Array.isArray(raw.samples)) return emptyLog();
    return {
      samples: raw.samples
        .filter((row: PersonalStyleSample) => row && typeof row.at === "string")
        .slice(-MAX_SAMPLES),
    };
  } catch {
    return emptyLog();
  }
}

export function clearPersonalStyle(): void {
  try {
    localStorage.removeItem(PERSONAL_STYLE_KEY);
  } catch {
    /* quota */
  }
}

export function recordPersonalStyleSample(
  settings: Pick<DevelopSettings, "exposure" | "contrast" | "temperature" | "saturation">,
  source: PersonalStyleSample["source"],
): void {
  try {
    if (!learningEnabled()) return;
    const next: PersonalStyleSample = {
      at: new Date().toISOString(),
      source,
      exposure: settings.exposure,
      contrast: settings.contrast,
      temperature: settings.temperature,
      saturation: settings.saturation,
    };
    const log = loadPersonalStyle();
    log.samples = [...log.samples, next].slice(-MAX_SAMPLES);
    localStorage.setItem(PERSONAL_STYLE_KEY, JSON.stringify(log));
  } catch {
    /* never block Develop */
  }
}
