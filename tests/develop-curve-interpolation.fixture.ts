// Executes the real curve component's handlers without a browser or persisted photo data.
import { mock } from "bun:test";
import * as React from "react";
import {
  defaultDevelopSettings,
  developSettingsSchema,
  type DevelopSettings,
} from "../src/lib/develop/contract";

const originalReact = { ...React };
type Slot = { deps?: unknown[]; value?: unknown; cleanup?: () => void };
let slots: unknown[] = [],
  cursor = 0;
let effects: (() => void)[] = [];
const memo = (compute: () => unknown, deps: unknown[]) => {
  const index = cursor++,
    previous = slots[index] as Slot | undefined;
  if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps?.[i])))
    slots[index] = { deps, value: compute() };
  return (slots[index] as Slot).value;
};
mock.module("react", () => ({
  ...originalReact,
  useRef(initial: unknown) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  },
  useState(initial: unknown) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [
      slots[index],
      (value: unknown) => {
        slots[index] = value;
      },
    ];
  },
  useMemo: memo,
  useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps),
  useLayoutEffect(effect: () => (() => void) | void, deps: unknown[]) {
    const index = cursor++,
      previous = slots[index] as Slot | undefined;
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps?.[i])))
      effects.push(() => {
        previous?.cleanup?.();
        slots[index] = { deps, cleanup: effect() };
      });
  },
  useEffect(effect: () => (() => void) | void, deps: unknown[]) {
    const index = cursor++,
      previous = slots[index] as Slot | undefined;
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps?.[i])))
      effects.push(() => {
        previous?.cleanup?.();
        slots[index] = { deps, cleanup: effect() };
      });
  },
}));
const { ToneCurve } = await import("../src/components/develop/DevelopControls");
type Node = { type?: unknown; props?: Record<string, unknown> };
let passed = 0;
function check(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
  passed++;
}
function children(node: unknown): unknown[] {
  if (Array.isArray(node)) return node;
  return node && typeof node === "object" ? [(node as Node).props?.children] : [];
}
function find(node: unknown, predicate: (node: Node) => boolean): Node | null {
  if (node && typeof node === "object" && !Array.isArray(node) && predicate(node as Node))
    return node as Node;
  for (const child of children(node)) {
    const result = find(child, predicate);
    if (result) return result;
  }
  return null;
}
let value: DevelopSettings;
let updates: { value: DevelopSettings; label: string; commit: boolean }[] = [];
let tree: unknown;
let disabled = false;
let rect = { left: 0, top: 0, width: 200, height: 200 };
const captures = new Set<number>();
const target = {
  closest: () => (disabled ? {} : null),
  getBoundingClientRect: () => rect,
  setPointerCapture: (id: number) => {
    captures.add(id);
  },
  hasPointerCapture: (id: number) => captures.has(id),
  releasePointerCapture: (id: number) => {
    captures.delete(id);
  },
};
function render(commitEffects = true) {
  cursor = 0;
  tree = ToneCurve({
    value,
    change(next, label, commit = true) {
      developSettingsSchema.parse(next);
      value = next;
      updates.push({ value: structuredClone(next), label, commit });
    },
  });
  if (commitEffects) {
    const pending = effects;
    effects = [];
    for (const effect of pending) effect();
  }
}
function setup() {
  for (const slot of slots) (slot as Slot)?.cleanup?.();
  slots = [];
  effects = [];
  updates = [];
  captures.clear();
  disabled = false;
  rect = { left: 0, top: 0, width: 200, height: 200 };
  value = defaultDevelopSettings();
  value.curve = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.5 },
    { x: 1, y: 1 },
  ];
  render();
}
function graph() {
  const result = find(tree, (node) => node.props?.className === "develop-curve");
  if (!result) throw new Error("Curve SVG missing");
  return result;
}
function node(label: string) {
  const result = find(tree, (entry) => entry.props?.["aria-label"] === label);
  if (!result) throw new Error(`Missing ${label}`);
  return result;
}
function run(node: Node, handler: string, event: Record<string, unknown> = {}) {
  const callback = node.props?.[handler];
  if (typeof callback !== "function") throw new Error(`Missing ${handler}`);
  callback({ preventDefault() {}, stopPropagation() {}, currentTarget: target, ...event });
}
const pointer = (x = 100, y = 100, pointerId = 1) => ({
  clientX: x,
  clientY: y,
  pointerId,
  button: 0,
});
const curve = () => JSON.stringify(value.curve);
setup();
check(
  value.curveInterpolation === "linear" && node("Curve interpolation").props?.value === "linear",
  "Default mode changed legacy appearance",
);
const initial = curve();
run(node("Curve interpolation"), "onChange", { target: { value: "smooth" } });
render();
check(
  value.curveInterpolation === "smooth" && updates.length === 1 && updates[0]?.commit,
  "Selector did not commit Smooth exactly once",
);
check(curve() === initial, "Mode selector moved control points");
check(graph().props?.["data-interpolation"] === "smooth", "SVG mode did not reflect recipe");
check(
  String(find(tree, (n) => n.props?.className === "curve-function")?.props?.d).match(/[ML]/g)!
    .length >= 257,
  "Graph does not render dense evaluated curve",
);
run(node("Red tone curve"), "onClick");
render();
check(
  node("Curve interpolation").props?.value === "smooth" &&
    graph().props?.["data-channel"] === "red",
  "Mode not shared by RGB curves",
);
const count = updates.length;
run(node("Curve interpolation"), "onChange", { target: { value: "smooth" } });
run(node("Curve interpolation"), "onChange", { target: { value: "unknown" } });
check(updates.length === count, "Same/invalid selector mode created history");
setup();
const base = curve();
run(graph(), "onPointerDown", pointer());
run(graph(), "onPointerMove", pointer(120, 70));
render();
run(node("Curve interpolation"), "onChange", { target: { value: "smooth" } });
render();
check(
  curve() === base && value.curveInterpolation === "smooth",
  "Mode switch persisted canceled pointer draft",
);
check(
  updates.filter((u) => u.commit).length === 1 &&
    updates.at(-1)?.label === "Curve interpolation · Smooth",
  "Mode switch created duplicate history",
);
check(captures.size === 0, "Mode switch retained pointer capture");
const after = updates.length;
run(graph(), "onPointerUp", pointer(170, 20));
run(graph(), "onPointerCancel", pointer(170, 20));
check(updates.length === after && curve() === base, "Late pointer event changed switched mode");
setup();
run(graph(), "onPointerDown", pointer());
run(graph(), "onPointerMove", pointer(120, 70));
render();
value = { ...defaultDevelopSettings(), curveInterpolation: "smooth", exposure: -1 };
render(false);
const external = updates.length;
run(graph(), "onPointerCancel", pointer(150, 30));
check(
  value.curveInterpolation === "smooth" && value.exposure === -1 && updates.length === external,
  "Canceled obsolete drag overwrote external mode/Undo",
);
setup();
disabled = true;
run(node("Curve interpolation"), "onChange", { target: { value: "smooth" } });
check(
  updates.length === 0 && value.curveInterpolation === "linear",
  "Disabled selector modified recipe",
);
disabled = false;
const obsolete = node("Curve interpolation");
for (const slot of slots) (slot as Slot)?.cleanup?.();
run(obsolete, "onChange", { target: { value: "smooth" } });
check(updates.length === 0, "Unmounted selector modified old photo");
setup();
run(node("Curve interpolation"), "onChange", { target: { value: "smooth" } });
render();
run(node("Curve interpolation"), "onChange", { target: { value: "linear" } });
render();
check(
  value.curveInterpolation === "linear" &&
    curve() === initial &&
    updates.filter((u) => u.commit).length === 2,
  "Linear restoration failed",
);
console.log(JSON.stringify({ passed }));
