import { cloneDevelopSettings, type DevelopSettings } from "./contract";

export type TutorSet = { path: string; delta: number };
export type TutorBeat = {
  open?: string;
  point?: string;
  say: string;
  sets: TutorSet[];
  wait: boolean;
  done: boolean;
};
export type TutorCompileOptions = { advanced?: boolean };

const HSL_INDEX: Record<string, number> = {
  red: 0,
  orange: 1,
  yellow: 2,
  green: 3,
  aqua: 4,
  blue: 5,
  purple: 6,
  magenta: 7,
};

export const TUTOR_IDS = [
  "panel-basic",
  "panel-mixer",
  "panel-grading",
  "slider-temp",
  "slider-tint",
  "slider-exposure",
  "slider-contrast",
  "slider-highlights",
  "slider-shadows",
  "slider-whites",
  "slider-blacks",
  "slider-vibrance",
  "slider-saturation",
  "hsl-orange",
  "hsl-orange-sat",
  "wheel-shadows",
] as const;

function clamp(path: string, value: number) {
  if (path === "exposure") return Math.min(5, Math.max(-5, value));
  if (path.includes("hue") && path.includes("wheel")) return ((value % 360) + 360) % 360;
  return Math.min(100, Math.max(-100, value));
}

export function applySet(settings: DevelopSettings, path: string, delta: number): DevelopSettings {
  const next = cloneDevelopSettings(settings);
  const key = path === "temp" ? "temperature" : path === "tint" ? "tint" : path;
  if (
    key === "temperature" ||
    key === "tint" ||
    key === "exposure" ||
    key === "contrast" ||
    key === "highlights" ||
    key === "shadows" ||
    key === "whites" ||
    key === "blacks" ||
    key === "vibrance" ||
    key === "saturation"
  ) {
    next[key] = clamp(key, next[key] + delta) as never;
    return next;
  }
  const wheel = path.match(/^wheel\.(shadows|midtones|highlights|global)\.(hue|sat|luminance)$/);
  if (wheel) {
    const range = wheel[1] as "shadows" | "midtones" | "highlights" | "global";
    const field = wheel[2] === "sat" ? "saturation" : wheel[2];
    const current = next.grading[range][field];
    next.grading[range][field] = clamp(path, current + delta) as never;
    return next;
  }
  const hsl = path.match(/^hsl\.(red|orange|yellow|green|aqua|blue|purple|magenta)\.(hue|sat|luminance)$/);
  if (hsl) {
    const index = HSL_INDEX[hsl[1]!];
    const field = hsl[2] === "sat" ? "saturation" : hsl[2];
    if (index === undefined || !next.hsl[index]) return next;
    next.hsl[index][field] = clamp(path, next.hsl[index][field] + delta) as never;
    return next;
  }
  return next;
}

export function applyLook(settings: DevelopSettings, beats: readonly TutorBeat[], through: number) {
  let current = cloneDevelopSettings(settings);
  const last = Math.min(through, beats.length - 1);
  for (let index = 0; index <= last; index++)
    for (const set of beats[index]?.sets ?? []) current = applySet(current, set.path, set.delta);
  return current;
}

export function pointId(path: string) {
  if (path === "temp" || path.startsWith("slider-temp")) return "slider-temp";
  if (path === "tint") return "slider-tint";
  if (path.startsWith("wheel.shadows") || path === "wheel-shadows") return "wheel-shadows";
  if (path.startsWith("hsl.orange")) return "hsl-orange-sat";
  if (path.startsWith("slider-")) return path.replace(/^#/, "");
  const map: Record<string, string> = {
    exposure: "slider-exposure",
    contrast: "slider-contrast",
    highlights: "slider-highlights",
    shadows: "slider-shadows",
    whites: "slider-whites",
    blacks: "slider-blacks",
    vibrance: "slider-vibrance",
    saturation: "slider-saturation",
  };
  return map[path] ?? path.replace(/^#/, "");
}

export function parseBeats(text: string): TutorBeat[] {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const beats: TutorBeat[] = [];
  let current: TutorBeat = { say: "", sets: [], wait: false, done: false };
  const push = () => {
    if (current.say || current.sets.length || current.point || current.open) beats.push(current);
    current = { say: "", sets: [], wait: false, done: false };
  };
  for (const line of lines) {
    const open = line.match(/^\[OPEN:([^\]]+)\]$/i);
    const point = line.match(/^\[POINT:#?([^\]]+)\]$/i);
    const set = line.match(/^\[SET:([^:]+):([+-]?\d+(?:\.\d+)?)\]$/i);
    if (open) {
      if (current.say || current.sets.length) push();
      current.open = open[1]!.replace(/^panel\./, "panel-");
      continue;
    }
    if (point) {
      if (current.say || current.sets.length) push();
      const id = point[1]!;
      current.point =
        id.startsWith("slider-") ||
        id.startsWith("hsl-") ||
        id.startsWith("wheel-") ||
        id.startsWith("panel-")
          ? id
          : pointId(id);
      continue;
    }
    if (set) {
      current.sets.push({ path: set[1]!, delta: Number(set[2]) });
      continue;
    }
    if (/^\[WAIT\]$/i.test(line)) {
      current.wait = true;
      push();
      continue;
    }
    if (/^\[DONE\]$/i.test(line)) {
      current.done = true;
      push();
      continue;
    }
    current.say = line.replace(/\[[^\]]+\]/g, "").trim();
  }
  if (current.say || current.sets.length) beats.push(current);
  return beats.slice(0, 6);
}

export function lookTitle(ask: string) {
  if (/sonder/i.test(ask)) return "Look · Sonder dusk";
  if (/cinematic/i.test(ask)) return "Look · Cinematic";
  const clipped = ask.trim().slice(0, 40);
  return clipped ? `Look · ${clipped}` : "Look";
}

export function compileLook(
  ask: string,
  current: DevelopSettings,
  options: TutorCompileOptions = {},
): TutorBeat[] {
  const text = ask.toLowerCase();
  const sonder = /sonder|cinematic|color theory|warm/.test(text);
  const advanced = options.advanced !== false;
  if (!sonder) {
    return parseBeats(`
[OPEN:panel.basic]
[POINT:#slider-temp]
Warm the person. Leave the street cold.
[SET:temp:+12]
[WAIT]
[DONE]
    `);
  }
  const alreadyWarm = current.temperature > 16;
  const beats: string[] = ["[OPEN:panel.basic]"];
  if (alreadyWarm) {
    beats.push(
      "[POINT:#slider-highlights]",
      "Hold the windows so warmth does not go cheap.",
      "[SET:highlights:-20]",
      "[WAIT]",
    );
  } else {
    beats.push(
      "[POINT:#slider-temp]",
      "Warm the person. Leave the street cold.",
      "[SET:temp:+18]",
      "[WAIT]",
    );
  }
  beats.push(
    "[POINT:#slider-tint]",
    "Pull green from shade so amber can read.",
    "[SET:tint:-4]",
    "[WAIT]",
  );
  if (!alreadyWarm) {
    beats.push(
      "[POINT:#slider-highlights]",
      "Hold the windows or the warmth turns cheap.",
      "[SET:highlights:-20]",
      "[WAIT]",
    );
  }
  beats.push(
    "[POINT:#slider-shadows]",
    "Lift just enough to see strangers in the back.",
    "[SET:shadows:+15]",
    "[WAIT]",
  );
  if (advanced) {
    beats.push(
      "[OPEN:panel.grading]",
      "[POINT:#wheel-shadows]",
      "Teal lives in shadows and glass only.",
      "[SET:wheel.shadows.hue:200]",
      "[SET:wheel.shadows.sat:12]",
      "[WAIT]",
      "[OPEN:panel.mixer]",
      "[POINT:#hsl-orange-sat]",
      "Don't tan the skin. We're done.",
      "[SET:hsl.orange.sat:-8]",
      "[DONE]",
    );
  } else {
    beats.push(
      "[POINT:#slider-blacks]",
      "Crush blacks a little. That's cinematic hold.",
      "[SET:blacks:-8]",
      "[DONE]",
    );
  }
  return parseBeats(beats.join("\n")).slice(0, 6);
}
