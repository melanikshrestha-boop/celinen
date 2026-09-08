import type { DevelopGrade, DevelopSettings } from "@/lib/develop/contract";

export type GradeRange = "shadows" | "midtones" | "highlights" | "global";
export type WheelPoint = { x: number; y: number };
export type WheelModifiers = { shift?: boolean; hueOnly?: boolean; fine?: boolean };
type Gesture = {
  pointer: number;
  initial: DevelopGrade;
  value: DevelopGrade;
  point: WheelPoint;
  modifiers: WheelModifiers;
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const round = (value: number) => Math.round(value * 10) / 10;
export const wrapHue = (value: number) => ((value % 360) + 360) % 360;
export const sameGrade = (a: DevelopGrade, b: DevelopGrade) =>
  a.hue === b.hue && a.saturation === b.saturation && a.luminance === b.luminance;

/** All four wheels and numeric controls share one recipe transaction. */
export class ColorGradingOwnership {
  private owner: string | null = null;
  constructor(private readonly changed: (owner: string | null) => void = () => {}) {}
  get current() {
    return this.owner;
  }
  claim(owner: string) {
    if (this.owner !== null) return this.owner === owner;
    this.owner = owner;
    this.changed(owner);
    return true;
  }
  release(owner: string) {
    if (this.owner !== owner) return;
    this.owner = null;
    this.changed(null);
  }
}

/** Coordinates use the wheel radius, red at the right, hue increasing clockwise. */
export function wheelPosition(grade: DevelopGrade): WheelPoint {
  const angle = (grade.hue * Math.PI) / 180;
  return {
    x: (Math.cos(angle) * grade.saturation) / 100,
    y: (Math.sin(angle) * grade.saturation) / 100,
  };
}
export function wheelGrade(point: WheelPoint, previous: DevelopGrade): DevelopGrade {
  const radius = Math.hypot(point.x, point.y);
  return {
    ...previous,
    // A neutral wheel retains its chosen hue for later saturation adjustments.
    hue:
      radius < 0.0001
        ? previous.hue
        : round(wrapHue((Math.atan2(point.y, point.x) * 180) / Math.PI)),
    saturation: round(clamp(radius * 100, 0, 100)),
  };
}
const modeKey = (mode: WheelModifiers) => `${!!mode.shift}:${!!mode.hueOnly}:${!!mode.fine}`;

function moveValue(
  value: DevelopGrade,
  from: WheelPoint,
  to: WheelPoint,
  mode: WheelModifiers,
): DevelopGrade {
  const next = wheelGrade(to, value);
  const previous = wheelGrade(from, value);
  const hueDelta = ((next.hue - previous.hue + 540) % 360) - 180;
  return {
    ...value,
    hue: mode.shift ? value.hue : mode.fine ? wrapHue(value.hue + hueDelta * 0.1) : next.hue,
    saturation: mode.hueOnly
      ? value.saturation
      : mode.fine
        ? clamp(value.saturation + (next.saturation - previous.saturation) * 0.1, 0, 100)
        : next.saturation,
  };
}

/** One pointer owns a gesture. Preview moves never append history. */
export class ColorWheelGesture {
  private gesture: Gesture | null = null;
  constructor(private readonly publish: (grade: DevelopGrade, commit: boolean) => void) {}

  get value() {
    return this.gesture?.value ?? null;
  }

  begin(pointer: number, grade: DevelopGrade, point: WheelPoint, modifiers: WheelModifiers) {
    if (this.gesture) return false;
    const value = modifiers.fine ? { ...grade } : moveValue(grade, point, point, modifiers);
    this.gesture = { pointer, initial: { ...grade }, value, point, modifiers };
    if (!sameGrade(value, grade)) this.publish(value, false);
    return true;
  }

  move(pointer: number, point: WheelPoint, modifiers: WheelModifiers) {
    const gesture = this.gesture;
    if (!gesture || gesture.pointer !== pointer) return;
    // Rebase when a modifier changes so adding/removing Fine does not jump.
    if (modeKey(modifiers) !== modeKey(gesture.modifiers)) {
      gesture.point = point;
      gesture.modifiers = modifiers;
      return;
    }
    const next = moveValue(gesture.value, gesture.point, point, modifiers);
    gesture.point = point;
    if (!sameGrade(next, gesture.value)) {
      gesture.value = next;
      this.publish(next, false);
    }
  }

  finish(pointer: number, cancel = false) {
    const gesture = this.gesture;
    if (!gesture || gesture.pointer !== pointer) return;
    this.gesture = null;
    if (!sameGrade(gesture.value, gesture.initial))
      this.publish(cancel ? gesture.initial : gesture.value, !cancel);
  }

  /** Unmount/changed photo must never publish the previous photo's recipe. */
  discard() {
    this.gesture = null;
  }
}

/** Focused arrows work without modifiers; Alt arrows match Adobe's documented direction. */
export function keyboardGrade(
  grade: DevelopGrade,
  key: string,
  modifiers: { shift?: boolean; alt?: boolean } = {},
): DevelopGrade | null {
  const step = modifiers.shift ? 10 : 1;
  if (key === "ArrowUp" || key === "ArrowDown")
    return {
      ...grade,
      saturation: clamp(grade.saturation + (key === "ArrowUp" ? step : -step), 0, 100),
    };
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const direction = key === "ArrowRight" ? 1 : -1;
    return { ...grade, hue: wrapHue(grade.hue + direction * step * (modifiers.alt ? -1 : 1)) };
  }
  return null;
}

export function neutralGrading(grading: DevelopSettings["grading"]) {
  return (["shadows", "midtones", "highlights", "global"] as const).every((range) => {
    const grade = grading[range];
    return !grade || (grade.saturation === 0 && grade.luminance === 0);
  });
}
