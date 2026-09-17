// Isolated process: keeps one slider instance alive across renders, the way React does, so
// commit gating is exercised against undo, presets and the shared Color Grading transaction.
import { mock } from "bun:test";
import * as React from "react";
import { defaultDevelopSettings, type DevelopSettings } from "../src/lib/develop/contract";

const originalReact = { ...React };
type Slot = { deps?: unknown[]; value?: unknown; cleanup?: (() => void) | void };
type Instance = { slots: unknown[]; effects: (() => void)[] };
let active: Instance = { slots: [], effects: [] },
  cursor = 0;
const changed = (deps: unknown[] | undefined, previous: Slot | undefined) =>
  !previous || !deps || deps.some((dep, i) => !Object.is(dep, previous.deps?.[i]));
const memo = (compute: () => unknown, deps: unknown[]) => {
  const index = cursor++;
  if (changed(deps, active.slots[index] as Slot | undefined))
    active.slots[index] = { deps, value: compute() };
  return (active.slots[index] as Slot).value;
};
const effect = (run: () => (() => void) | void, deps?: unknown[]) => {
  const index = cursor++,
    { slots } = active,
    previous = slots[index] as Slot | undefined;
  if (changed(deps, previous))
    active.effects.push(() => {
      previous?.cleanup?.();
      slots[index] = { deps, cleanup: run() };
    });
};
mock.module("react", () => ({
  ...originalReact,
  useId: () => "grading",
  useRef(initial: unknown) {
    const index = cursor++;
    if (!(index in active.slots)) active.slots[index] = { current: initial };
    return active.slots[index];
  },
  useState(initial: unknown) {
    const index = cursor++,
      { slots } = active;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [
      slots[index],
      (value: unknown) => {
        slots[index] = value;
      },
    ];
  },
  useMemo: memo,
  useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps),
  useEffect: effect,
  useLayoutEffect: effect,
}));
const { DevelopSlider } = await import("../src/components/develop/DevelopControls");
const { ColorGrading } = await import("../src/components/develop/ColorGrading");

type Node = { type?: unknown; props?: Record<string, unknown> };
const nodes = (value: unknown): Node[] => {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  return [value as Node, ...nodes((value as Node).props?.children)];
};
let passed = 0;
function check(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
  passed++;
}
/** One mounted component: hook slots persist between renders like a real fiber. */
function mount<P>(component: (props: P) => unknown) {
  const instance: Instance = { slots: [], effects: [] };
  return (props: P) => {
    active = instance;
    cursor = 0;
    const tree = component(props);
    for (const run of instance.effects.splice(0)) run();
    return tree;
  };
}
function run(node: Node | undefined, handler: string, event: unknown = {}) {
  const callback = node?.props?.[handler];
  if (typeof callback !== "function") throw new Error(`Missing handler ${handler}`);
  callback(event);
}
const input = (tree: unknown, type: "range" | "number") =>
  nodes(tree).find((node) => node.type === "input" && node.props?.type === type);

// A standalone slider whose parent behaves like DevelopPage: every change re-renders it.
function slider(initial: number) {
  const render = mount(DevelopSlider);
  const events: { value: number; commit: boolean }[] = [];
  const state = { value: initial, tree: null as unknown };
  const paint = () => {
    state.tree = render({
      label: "Exposure",
      value: state.value,
      reset: 0,
      onChange(value, commit) {
        events.push({ value, commit });
        state.value = value;
        paint();
      },
    });
  };
  paint();
  return {
    events,
    commits: () => events.filter((event) => event.commit).map((event) => event.value),
    /** Undo, a preset or another photo/channel/mask replaces the value from outside. */
    external(value: number) {
      state.value = value;
      paint();
    },
    drag: (value: number) =>
      run(input(state.tree, "range"), "onChange", { target: { value: String(value) } }),
    type: (value: number) =>
      run(input(state.tree, "number"), "onChange", { target: { value: String(value) } }),
    release: () => run(input(state.tree, "range"), "onPointerUp"),
    keyUp: () => run(input(state.tree, "range"), "onKeyUp"),
    blur: (type: "range" | "number" = "range") => run(input(state.tree, type), "onBlur"),
    reset: () =>
      run(
        nodes(state.tree).find((node) => node.type === "label"),
        "onDoubleClick",
        { currentTarget: { closest: () => null } },
      ),
  };
}

let control = slider(0);
control.drag(50);
control.release();
check(control.commits().join() === "50", "Release did not commit the dragged value");
control.blur();
control.keyUp();
check(control.events.length === 2, "One gesture committed more than once");
control.external(0); // Undo
control.drag(50);
control.release();
check(
  control.commits().join() === "50,50",
  "Redoing the same value by hand after Undo was never committed",
);

control = slider(0);
control.external(30); // Preset
control.drag(0);
control.release();
check(
  control.commits().join() === "0",
  "Dragging a preset value back to the mount value was dropped",
);

control = slider(0);
control.drag(30);
control.drag(0);
control.release();
check(
  control.commits().join() === "0",
  "Away-and-back gesture never sent the commit that closes its transaction",
);

control = slider(12);
control.release();
control.keyUp();
control.blur();
control.blur("number");
check(control.events.length === 0, "Focus, Tab or a plain click wrote the recipe");

control = slider(0);
control.type(40);
control.external(0); // Undo while the number field still has focus
control.blur("number");
check(
  control.events.every((event) => event.value === 0 || !event.commit),
  "Blur committed a value that Undo had already replaced",
);

control = slider(40);
control.drag(60);
control.reset();
control.blur();
check(control.commits().join() === "0", "Double-click reset did not commit exactly once");

// The real slider inside the real Color Grading transaction.
{
  const renderGrading = mount(ColorGrading);
  const renderSlider = mount(DevelopSlider);
  let value: DevelopSettings = defaultDevelopSettings();
  const changes: { commit: boolean }[] = [];
  let grading: unknown, numeric: unknown;
  const paint = () => {
    grading = renderGrading({
      value,
      Slider: DevelopSlider,
      change(next, _label, commit = true) {
        value = next;
        changes.push({ commit });
      },
    });
    const luminance = nodes(grading).find(
      (node) => node.type === DevelopSlider && node.props?.label === "Shadows luminance",
    );
    if (!luminance) throw new Error("Shadows luminance slider missing");
    numeric = renderSlider(luminance.props as Parameters<typeof DevelopSlider>[0]);
  };
  const locked = () =>
    nodes(grading).filter((node) => node.type === "fieldset" && node.props?.disabled).length;
  const drag = (next: number) => {
    run(input(numeric, "range"), "onChange", { target: { value: String(next) } });
    paint();
  };
  paint();
  check(locked() === 0, "Color Grading started locked");
  drag(30);
  check(locked() > 0, "A numeric preview did not take the shared grading transaction");
  drag(0);
  run(input(numeric, "range"), "onPointerUp");
  paint();
  check(
    locked() === 0 && changes.at(-1)?.commit === true && value.grading.shadows.luminance === 0,
    "Away-and-back numeric drag left every other grading control disabled",
  );
}
console.log(JSON.stringify({ passed }));
