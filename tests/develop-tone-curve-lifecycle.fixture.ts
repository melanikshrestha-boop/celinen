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
const original = curve();
run(graph(), "onPointerDown", pointer());
run(graph(), "onPointerMove", pointer(120, 70));
render();
check(
  value.curve[1]?.x === 0.6 && value.curve[1]?.y === 0.65,
  "Normal curve draft changed coordinate math",
);
run(graph(), "onPointerCancel", pointer(120, 70));
render();
check(
  curve() === original && updates.every((update) => !update.commit),
  "Canceled curve drag persisted instead of rolling back",
);
check(captures.size === 0, "Canceled drag retained pointer capture");
setup();
run(graph(), "onPointerDown", pointer());
run(graph(), "onPointerMove", pointer(120, 70));
render();
run(graph(), "onLostPointerCapture", pointer(120, 70));
render();
check(
  curve() === original && updates.every((update) => !update.commit),
  "Unexpected lost capture saved a draft",
);
setup();
run(graph(), "onPointerDown", pointer());
run(graph(), "onPointerMove", pointer(120, 70));
render();
run(graph(), "onPointerUp", pointer(140, 60));
render();
check(
  value.curve[1]?.x === 0.7 && value.curve[1]?.y === 0.7,
  "Release lost the final unsampled pointer position",
);
check(
  updates.filter((update) => update.commit).length === 1 && captures.size === 0,
  "Release did not commit exactly once and release capture",
);
const released = curve(),
  afterRelease = updates.length;
run(graph(), "onLostPointerCapture", pointer(140, 60));
run(graph(), "onPointerCancel", pointer(140, 60));
check(
  curve() === released && updates.length === afterRelease,
  "Late capture events reverted or duplicated a committed curve",
);
setup();
run(graph(), "onPointerDown", pointer(98, 99));
run(graph(), "onPointerUp", pointer(98, 99));
check(
  curve() === original && updates.length === 0,
  "Click near a point altered it without dragging",
);
setup();
run(graph(), "onPointerDown", pointer());
run(graph(), "onPointerDown", pointer(190, 10, 2));
run(graph(), "onPointerMove", pointer(160, 30, 2));
run(graph(), "onPointerUp", pointer(160, 30, 2));
run(graph(), "onPointerCancel", pointer(160, 30, 2));
check(
  updates.length === 0 && captures.has(1) && !captures.has(2),
  "Another pointer replaced or ended the owning gesture",
);
run(graph(), "onPointerMove", pointer(110, 80));
render();
run(graph(), "onPointerUp", pointer(110, 80));
render();
check(
  value.curve[1]?.x === 0.55 &&
    value.curve[1]?.y === 0.6 &&
    updates.filter((u) => u.commit).length === 1,
  "Owning pointer could not finish after unrelated pointer events",
);
setup();
run(graph(), "onPointerDown", pointer(50, 130));
render();
check(value.curve.length === 4, "Pointer could not add a curve point");
run(graph(), "onPointerCancel", pointer(50, 130));
render();
check(
  curve() === original && updates.every((u) => !u.commit),
  "Canceled added point remained in the curve",
);
setup();
run(graph(), "onPointerDown", pointer(50, 130));
render();
run(graph(), "onPointerUp", pointer(50, 130));
render();
check(
  value.curve.length === 4 && updates.filter((u) => u.commit).length === 1,
  "Added point was not committed exactly once",
);
setup();
value = {
  ...value,
  curve: [
    { x: 0, y: 0 },
    { x: 0.25, y: 0.3 },
    { x: 0.5, y: 0.5 },
    { x: 1, y: 1 },
  ],
};
render();
run(graph(), "onPointerDown", pointer(50, 140));
run(graph(), "onPointerMove", pointer(180, 80));
render();
check(
  value.curve[1]?.x === 0.495 && value.curve[1]?.y === 0.6,
  "Drag no longer preserves the existing neighbor spacing constraint",
);
run(graph(), "onPointerUp", pointer(180, 80));
render();
run(graph(), "onPointerDown", pointer(200, 0));
run(graph(), "onPointerUp", pointer(170, 30));
render();
check(
  value.curve.at(-1)?.x === 1 && value.curve.at(-1)?.y === 0.85,
  "Endpoint drag moved its fixed input coordinate",
);
setup();
run(graph(), "onPointerDown", pointer(200, 0));
run(graph(), "onPointerMove", pointer(200, 30));
render();
value = { ...value, curve: defaultDevelopSettings().curve };
render();
const afterExternalReset = updates.length;
run(graph(), "onPointerMove", pointer(130, 60));
run(graph(), "onPointerUp", pointer(130, 60));
check(
  value.curve.length === 2 && updates.length === afterExternalReset && captures.size === 0,
  "Shorter external reset was overwritten or caused an invalid point access",
);
setup();
run(graph(), "onPointerDown", pointer());
run(graph(), "onPointerMove", pointer(120, 70));
render();
value = { ...defaultDevelopSettings(), exposure: -1 };
render(false);
const beforePendingEffect = updates.length;
run(graph(), "onPointerCancel", pointer(120, 70));
check(
  value.exposure === -1 && value.curve.length === 2 && updates.length === beforePendingEffect,
  "Cancel overwrote external Undo before layout-effect cleanup",
);
setup();
run(graph(), "onPointerDown", pointer());
run(graph(), "onPointerMove", pointer(120, 70));
render();
run(node("Reset master curve to linear"), "onClick");
render();
const resetCount = updates.length;
run(graph(), "onPointerMove", pointer(150, 20));
run(graph(), "onPointerUp", pointer(150, 20));
check(
  value.curve.length === 2 &&
    updates.length === resetCount &&
    updates.at(-1)?.label === "Reset curve",
  "Explicit Linear reset left an active gesture behind",
);
setup();
run(graph(), "onPointerDown", pointer());
run(graph(), "onPointerMove", pointer(120, 70));
render();
run(node("Curve point 2 output"), "onChange", { target: { value: "42" } });
render();
const numericCount = updates.length;
run(graph(), "onPointerUp", pointer(150, 30));
check(
  value.curve[1]?.y === 0.42 && updates.length === numericCount && !updates.at(-1)?.commit,
  "Numeric point editing failed to supersede the pointer draft",
);
let blurred = false;
run(node("Curve point 2 output"), "onKeyDown", {
  key: "Enter",
  currentTarget: {
    blur() {
      blurred = true;
      run(node("Curve point 2 output"), "onBlur");
    },
  },
});
check(
  blurred &&
    updates.filter((u) => u.commit).length === 1 &&
    updates.at(-1)?.value.curve[1]?.y === 0.42,
  "Numeric Enter/blur failed to commit the current curve exactly once",
);
setup();
run(graph(), "onPointerDown", pointer());
run(graph(), "onPointerMove", pointer(120, 70));
render();
run(node("Red tone curve"), "onClick");
render();
check(
  updates.filter((u) => u.commit).length === 1 && captures.size === 0,
  "Changing channels lost or duplicated a finished curve",
);
const master = curve();
run(graph(), "onPointerDown", pointer(100, 140));
render();
run(graph(), "onPointerMove", pointer(130, 110));
render();
run(graph(), "onPointerCancel", pointer(130, 110));
render();
check(
  curve() === master && value.channelCurves.red.length === 2,
  "Channel cancel affected master or retained a new red point",
);
setup();
run(graph(), "onPointerDown", pointer());
run(graph(), "onPointerMove", pointer(120, 70));
render();
const obsoleteGraph = graph(),
  obsoleteInput = node("Curve point 2 output"),
  beforeUnmount = updates.length;
for (const slot of slots) (slot as Slot)?.cleanup?.();
run(obsoleteGraph, "onPointerUp", pointer(180, 20));
run(obsoleteGraph, "onPointerDown", pointer());
run(obsoleteInput, "onBlur");
check(
  updates.length === beforeUnmount && captures.size === 0,
  "Unmounted curve published its old photo or reacquired capture",
);
setup();
disabled = true;
run(graph(), "onPointerDown", pointer(50, 130));
check(updates.length === 0 && captures.size === 0, "Disabled curve started a draft");
disabled = false;
rect.width = 0;
run(graph(), "onPointerDown", pointer(50, 130));
check(updates.length === 0 && captures.size === 0, "Zero-size curve created invalid coordinates");
rect.width = 200;
run(graph(), "onPointerDown", pointer(NaN, 130));
check(updates.length === 0 && captures.size === 0, "Nonfinite pointer created an invalid curve");
setup();
run(graph(), "onPointerDown", pointer());
disabled = true;
run(graph(), "onPointerMove", pointer(120, 70));
run(graph(), "onPointerUp", pointer(120, 70));
check(
  updates.length === 0 && captures.size === 0,
  "Mid-gesture disabled state allowed another curve edit",
);
console.log(JSON.stringify({ passed }));
