import { cloneDevelopSettings, type DevelopSettings } from "./contract";

export type TutorSet = { path: string; delta: number };
export type TutorDraw = "subject" | "world" | "windows" | "skin";
export type TutorBeat = {
  open?: string;
  point?: string;
  draw?: TutorDraw;
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
  "panel-curve",
  "panel-effects",
  "panel-detail",
  "panel-crop",
  "panel-lens",
  "panel-masks",
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
  "slider-parametric-highlights",
  "slider-parametric-lights",
  "slider-parametric-darks",
  "slider-parametric-shadows",
  "slider-straighten",
  "hsl-orange",
  "hsl-orange-sat",
  "wheel-shadows",
  "wheel-midtones",
  "wheel-highlights",
  "tone-curve",
] as const;

const SCALAR_PATHS = new Set([
  "temperature",
  "tint",
  "exposure",
  "contrast",
  "highlights",
  "shadows",
  "whites",
  "blacks",
  "vibrance",
  "saturation",
  "texture",
  "clarity",
  "dehaze",
  "grain",
  "grainSize",
  "grainLuminance",
  "fade",
  "filmFalloff",
  "vignette",
  "bloom",
  "halation",
  "sharpening",
  "sharpeningRadius",
  "sharpeningDetail",
  "sharpeningMasking",
  "noiseReduction",
  "colorNoiseReduction",
]);

function clamp(path: string, value: number) {
  if (path === "exposure") return Math.min(5, Math.max(-5, value));
  if (path === "crop.angle" || path.endsWith("rotation")) return Math.min(45, Math.max(-45, value));
  if (path.includes("hue") && path.includes("wheel")) return ((value % 360) + 360) % 360;
  return Math.min(100, Math.max(-100, value));
}

export function applySet(settings: DevelopSettings, path: string, delta: number): DevelopSettings {
  const next = cloneDevelopSettings(settings);
  const key = path === "temp" ? "temperature" : path === "tint" ? "tint" : path;
  if (SCALAR_PATHS.has(key)) {
    const current = next[key as keyof DevelopSettings];
    if (typeof current === "number") {
      (next as Record<string, unknown>)[key] = clamp(key, current + delta);
      return next;
    }
  }
  const wheel = path.match(/^wheel\.(shadows|midtones|highlights|global)\.(hue|sat|luminance)$/);
  if (wheel) {
    const range = wheel[1] as "shadows" | "midtones" | "highlights" | "global";
    const channel = wheel[2] === "sat" ? "saturation" : (wheel[2] as "hue" | "luminance");
    const current = next.grading[range][channel];
    next.grading[range][channel] = clamp(path, current + delta) as never;
    return next;
  }
  if (path === "curve.mid" || path.startsWith("curve.")) {
    const curve = next.curve.map((point) => ({ ...point }));
    let index = curve.findIndex((point) => point.x > 0.35 && point.x < 0.82);
    if (index <= 0 || index >= curve.length - 1) {
      const insert = { x: 0.62, y: 0.62 };
      const at = Math.max(1, curve.length - 1);
      curve.splice(at, 0, insert);
      index = at;
    }
    const point = curve[index]!;
    curve[index] = { x: point.x, y: Math.min(1, Math.max(0, point.y + delta / 100)) };
    next.curve = curve;
    return next;
  }
  const hsl = path.match(/^hsl\.(red|orange|yellow|green|aqua|blue|purple|magenta)\.(hue|sat|luminance)$/);
  if (hsl) {
    const index = HSL_INDEX[hsl[1]!];
    const channel = hsl[2] === "sat" ? "saturation" : (hsl[2] as "hue" | "luminance");
    if (index === undefined || !next.hsl[index]) return next;
    next.hsl[index][channel] = clamp(path, next.hsl[index][channel] + delta) as never;
    return next;
  }
  const parametric = path.match(/^parametric\.(highlights|lights|darks|shadows)$/);
  if (parametric) {
    const field = parametric[1] as "highlights" | "lights" | "darks" | "shadows";
    const current = next.parametricCurve ?? {
      highlights: 0,
      lights: 0,
      darks: 0,
      shadows: 0,
      pointCurve: next.curve,
    };
    next.parametricCurve = {
      ...current,
      [field]: clamp(path, current[field] + delta),
    };
    return next;
  }
  if (path === "crop.angle" || path === "straighten") {
    next.crop = { ...next.crop, angle: clamp("crop.angle", next.crop.angle + delta) };
    return next;
  }
  const lens = path.match(/^lens\.(chromaticAberration|vignetteCorrection|transform)\.(\w+)$/);
  if (lens) {
    const section = lens[1] as "chromaticAberration" | "vignetteCorrection" | "transform";
    const field = lens[2]!;
    const block = next.lensCorrection[section] as Record<string, unknown>;
    const current = block[field];
    if (typeof current === "number") {
      next.lensCorrection = {
        ...next.lensCorrection,
        [section]: { ...block, [field]: clamp(path, current + delta) },
      };
    }
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
  if (path.startsWith("wheel.midtones") || path === "wheel-midtones") return "wheel-midtones";
  if (path.startsWith("wheel.highlights") || path === "wheel-highlights") return "wheel-highlights";
  if (path.startsWith("hsl.orange")) return "hsl-orange-sat";
  if (path.startsWith("curve") || path === "tone-curve") return "tone-curve";
  if (path.startsWith("parametric.")) return `slider-parametric-${path.slice("parametric.".length)}`;
  if (path === "crop.angle" || path === "straighten") return "slider-straighten";
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
    texture: "slider-texture",
    clarity: "slider-clarity",
    dehaze: "slider-dehaze",
    grain: "slider-grain",
    vignette: "slider-vignette",
  };
  return map[path] ?? path.replace(/^#/, "");
}

export function parseBeats(text: string): TutorBeat[] {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const beats: TutorBeat[] = [];
  let current: TutorBeat = { say: "", sets: [], wait: false, done: false };
  const push = () => {
    if (current.say || current.sets.length || current.point || current.open || current.draw)
      beats.push(current);
    current = { say: "", sets: [], wait: false, done: false };
  };
  for (const line of lines) {
    const open = line.match(/^\[OPEN:([^\]]+)\]$/i);
    const point = line.match(/^\[POINT:#?([^\]]+)\]$/i);
    const draw = line.match(/^\[DRAW:photo\.(subject|world|windows|skin)\]$/i);
    const set = line.match(/^\[SET:([^:]+):([+-]?\d+(?:\.\d+)?)\]$/i);
    if (open) {
      if (current.say || current.sets.length) push();
      current.open = open[1]!.replace(/^panel\./, "panel-");
      continue;
    }
    if (draw) {
      if (current.say || current.sets.length) push();
      current.draw = draw[1]!.toLowerCase() as TutorDraw;
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
      "[DRAW:photo.windows]",
      "[POINT:#slider-highlights]",
      "Hold the windows so warmth does not go cheap.",
      "[SET:highlights:-20]",
      "[WAIT]",
    );
  } else {
    beats.push(
      "[DRAW:photo.subject]",
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
      "[DRAW:photo.windows]",
      "[POINT:#slider-highlights]",
      "Hold the windows or the warmth turns cheap.",
      "[SET:highlights:-20]",
      "[WAIT]",
    );
  }
  beats.push(
    "[DRAW:photo.world]",
    "[POINT:#slider-shadows]",
    "Lift just enough to see strangers in the back.",
    "[SET:shadows:+15]",
    "[WAIT]",
  );
  if (advanced) {
    beats.push(
      "[OPEN:panel.curve]",
      "[POINT:#tone-curve]",
      "Hold the top of the curve so the windows stay.",
      "[SET:curve.mid:-12]",
      "[WAIT]",
      "[OPEN:panel.mixer]",
      "[DRAW:photo.skin]",
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

export function pointerLabel(id?: string) {
  if (!id) return "right here";
  if (id.includes("temp")) return "temp";
  if (id.includes("tint")) return "tint";
  if (id.includes("parametric-lights")) return "lights";
  if (id.includes("parametric-darks")) return "darks";
  if (id.includes("parametric")) return "parametric";
  if (id.includes("highlights") && id.includes("wheel")) return "amber";
  if (id.includes("highlights")) return "highlights";
  if (id.includes("shadows") && id.includes("wheel")) return "teal";
  if (id.includes("shadows")) return "shadows";
  if (id.includes("blacks")) return "blacks";
  if (id.includes("orange")) return "skin lock";
  if (id.includes("curve")) return "curve";
  if (id.includes("straighten")) return "straighten";
  if (id.includes("wheel-midtones")) return "midtones";
  return id.replace(/^slider-|^hsl-|^wheel-|^panel-/, "").replace(/-/g, " ");
}

/** Clicky speaks the tag, not the lesson sentence. */
export function spokenLabel(beat: Pick<TutorBeat, "point" | "say">) {
  const tag = pointerLabel(beat.point);
  if (tag && tag !== "right here") return tag;
  const clipped = beat.say.split(/\s+/).filter(Boolean).slice(0, 3).join(" ");
  return clipped || "look";
}

/** Clicky flight: quadratic arc, smoothstep, scale pulse, rotate to travel. */
export function bezierArc(
  start: { x: number; y: number },
  end: { x: number; y: number },
  linear: number,
) {
  const t = linear * linear * (3 - 2 * linear);
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const arc = Math.min(distance * 0.2, 80);
  const cx = midX;
  const cy = midY - arc;
  const u = 1 - t;
  const x = u * u * start.x + 2 * u * t * cx + t * t * end.x;
  const y = u * u * start.y + 2 * u * t * cy + t * t * end.y;
  const tangentX = 2 * u * (cx - start.x) + 2 * t * (end.x - cx);
  const tangentY = 2 * u * (cy - start.y) + 2 * t * (end.y - cy);
  return {
    x,
    y,
    rotation: (Math.atan2(tangentY, tangentX) * 180) / Math.PI + 90,
    scale: 1 + Math.sin(linear * Math.PI) * 0.3,
  };
}

export function rangeThumbClient(input: HTMLInputElement) {
  const min = Number(input.min);
  const max = Number(input.max);
  const val = Number(input.value);
  const box = input.getBoundingClientRect();
  const t = (val - min) / ((max - min) || 1);
  return { x: box.left + box.width * t, y: box.top + box.height / 2, box, t };
}

export function nativeSetRange(input: HTMLInputElement, value: number, commit = false) {
  const min = Number(input.min);
  const max = Number(input.max);
  const next =
    Number.isFinite(min) && Number.isFinite(max) ? Math.min(max, Math.max(min, value)) : value;
  try {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, String(next));
    else input.value = String(next);
  } catch {
    input.value = String(next);
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  if (commit) input.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
  return next;
}

export function dispatchPointer(
  node: EventTarget,
  type: string,
  clientX: number,
  clientY: number,
) {
  const init: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX,
    clientY,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
    button: 0,
  };
  if (typeof window !== "undefined") init.view = window;
  const event = new PointerEvent(type, init);
  node.dispatchEvent(event);
  return event;
}

export function clientOnNorm(
  box: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
) {
  return { x: box.left + x * box.width, y: box.top + (1 - y) * box.height };
}

export function midCurveHandle(root?: ParentNode | null) {
  const scope = root ?? (typeof document === "undefined" ? null : document);
  if (!scope) return null;
  const svg = scope.querySelector("#tone-curve");
  if (!svg) return null;
  for (const node of svg.querySelectorAll("[id^='curve-point-']")) {
    const cx = Number(node.getAttribute("cx"));
    if (cx > 70 && cx < 164) return node;
  }
  return null;
}

/** Click the real panel row. Accordion the rest of the right rail. */
export function openPanel(id: string) {
  if (typeof document === "undefined") return false;
  const panel = document.getElementById(id);
  if (!(panel instanceof HTMLDetailsElement)) return false;
  const summary = panel.querySelector("summary");
  if (summary instanceof HTMLElement && !panel.open) summary.click();
  else panel.open = true;
  for (const node of document.querySelectorAll(".develop-right details.develop-panel")) {
    if (node instanceof HTMLDetailsElement && node.id && node.id !== id) node.open = false;
  }
  if (id === "panel-mixer") document.getElementById("hsl-orange")?.click();
  panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return panel.open;
}

export function findRange(id?: string) {
  if (!id || typeof document === "undefined") return null;
  const wrap = document.getElementById(id);
  if (!wrap) return null;
  if (wrap instanceof HTMLInputElement && wrap.type === "range") return wrap;
  const input = wrap.querySelector("input[type=range]");
  return input instanceof HTMLInputElement ? input : null;
}

export function driveSlider(id: string | undefined, delta: number, commit = false) {
  const input = findRange(id);
  if (!input) return false;
  nativeSetRange(input, Number(input.value) + delta, commit);
  return true;
}

export function driveCurve(delta: number, commit = true) {
  if (typeof document === "undefined") return false;
  const svg = document.getElementById("tone-curve");
  if (!svg) return false;
  const box = svg.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return false;
  const handle = midCurveHandle(svg);
  const start = handle
    ? (() => {
        const at = handle.getBoundingClientRect();
        return { x: at.left + at.width / 2, y: at.top + at.height / 2 };
      })()
    : clientOnNorm(box, 0.62, 0.62);
  const startY = 1 - (start.y - box.top) / box.height;
  const end = { x: start.x, y: box.top + (1 - Math.min(1, Math.max(0, startY + delta / 100))) * box.height };
  dispatchPointer(svg, "pointerdown", start.x, start.y);
  dispatchPointer(svg, "pointermove", end.x, end.y);
  if (commit) dispatchPointer(svg, "pointerup", end.x, end.y);
  return true;
}

export function driveWheel(id: string | undefined, hueDelta: number, satDelta: number, commit = true) {
  if (!id || typeof document === "undefined") return false;
  const wheel = document.getElementById(id);
  if (!wheel) return false;
  const box = wheel.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return false;
  const handle = wheel.querySelector(".develop-grade-handle");
  const start = handle
    ? (() => {
        const at = handle.getBoundingClientRect();
        return { x: at.left + at.width / 2, y: at.top + at.height / 2 };
      })()
    : { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  const radius = Math.min(box.width, box.height) / 2;
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const dx = start.x - cx;
  const dy = start.y - cy;
  const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  const sat = Math.min(100, (Math.hypot(dx, dy) / (radius || 1)) * 100);
  const nextHue = ((hue + hueDelta) % 360 + 360) % 360;
  const nextSat = Math.min(100, Math.max(0, sat + satDelta));
  const angle = (nextHue * Math.PI) / 180;
  const end = {
    x: cx + Math.cos(angle) * (nextSat / 100) * radius,
    y: cy + Math.sin(angle) * (nextSat / 100) * radius,
  };
  dispatchPointer(wheel, "pointerdown", start.x, start.y);
  dispatchPointer(wheel, "pointermove", end.x, end.y);
  if (commit) dispatchPointer(wheel, "pointerup", end.x, end.y);
  return true;
}

/** Drive the live control for one SET. False means the caller should write the recipe. */
export function driveSet(point: string | undefined, set: TutorSet, commit = false) {
  if (typeof document === "undefined") return false;
  if (point === "tone-curve" || set.path.startsWith("curve.")) return driveCurve(set.delta, commit);
  if (point?.startsWith("wheel-") || set.path.startsWith("wheel.")) {
    const hue = set.path.endsWith(".hue") ? set.delta : 0;
    const sat = set.path.endsWith(".sat") || set.path.endsWith(".saturation") ? set.delta : 0;
    return driveWheel(point ?? pointId(set.path), hue, sat, commit);
  }
  return driveSlider(point ?? pointId(set.path), set.delta, commit);
}
