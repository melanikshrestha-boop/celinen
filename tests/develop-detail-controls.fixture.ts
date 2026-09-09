// Isolated process: exercise actual component handlers without mocking React in other suites.
import { mock } from "bun:test";
import * as React from "react";
import {
  defaultDevelopSettings,
  developSettingsSchema,
  type DevelopSettings,
} from "../src/lib/develop/contract";

const originalReact = { ...React };
mock.module("react", () => ({
  ...originalReact,
  useState: (value: unknown) => [value, () => {}],
  useRef: (value: unknown) => ({ current: value }),
}));
const { DevelopControls, DevelopSlider, Panel } =
  await import("../src/components/develop/DevelopControls");
type Node = { type?: unknown; props?: Record<string, unknown> };
const nodes = (value: unknown): Node[] => {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  return [value as Node, ...nodes((value as Node).props?.children)];
};
let passed = 0;
function check(value: unknown, message: string) {
  if (!value) throw new Error(message);
  passed++;
}
let settings = { ...defaultDevelopSettings(), exposure: 0.55 };
let changes: { value: DevelopSettings; label: string; commit: boolean }[] = [];
function control(label: string) {
  const tree = DevelopControls({
    value: settings,
    change: (next, changedLabel, commit = true) => {
      settings = developSettingsSchema.parse(next);
      changes.push({ value: settings, label: changedLabel, commit });
    },
    tool: "edit",
    maskId: null,
    onTool() {},
    onMask() {},
  });
  const panel = nodes(tree).find((node) => node.type === Panel && node.props?.title === "Detail");
  if (!panel) throw new Error("Detail panel is missing");
  const sliders = nodes(panel).filter((node) => node.type === DevelopSlider);
  check(
    sliders
      .slice(0, 4)
      .map((slider) => slider.props?.label)
      .join(",") === "Sharpening,Sharpening radius,Sharpening fine detail,Sharpening edge masking",
    "Detail controls are not together after sharpening",
  );
  const slider = sliders.find((node) => node.props?.label === label);
  if (!slider) throw new Error(`Missing ${label}`);
  const rendered = DevelopSlider(slider.props as Parameters<typeof DevelopSlider>[0]);
  const children = nodes(rendered);
  const range = children.find((node) => node.type === "input" && node.props?.type === "range")!;
  const numeric = children.find((node) => node.type === "input" && node.props?.type === "number")!;
  const caption = children.find((node) => node.type === "label")!;
  return { range, numeric, caption, slider };
}
function run(node: Node, handler: string, event: unknown = {}) {
  const callback = node.props?.[handler];
  if (typeof callback !== "function") throw new Error(`Missing handler ${handler}`);
  callback(event);
}
for (const [key, label, caption, value, minimum, maximum, step, reset] of [
  ["sharpeningRadius", "Sharpening radius", "Radius", 2.3, 0.5, 3, 0.1, 1],
  ["sharpeningDetail", "Sharpening fine detail", "Fine detail", 27, 0, 100, 1, 100],
  ["sharpeningMasking", "Sharpening edge masking", "Edge masking", 72, 0, 100, 1, 0],
] as const) {
  settings = { ...defaultDevelopSettings(), exposure: 0.55 };
  changes = [];
  let rendered = control(label);
  check(rendered.caption.props?.children === caption, `${label} display label changed`);
  check(
    rendered.range.props?.["aria-label"] === label &&
      rendered.numeric.props?.["aria-label"] === `${label} value`,
    "Inputs need distinct accessible names",
  );
  check(
    rendered.range.props?.min === minimum &&
      rendered.range.props?.max === maximum &&
      rendered.range.props?.step === step,
    `${label} bounds changed`,
  );
  check(
    typeof rendered.range.props?.title === "string" &&
      (rendered.range.props.title as string).length > 20,
    `${label} mathematical help missing`,
  );
  check(changes.length === 0, "Rendering a control wrote a recipe");
  run(rendered.range, "onChange", { target: { value: String(value) } });
  check(
    settings[key] === value && changes.length === 1 && !changes[0]?.commit,
    "Range must publish an unsaved preview",
  );
  run(rendered.range, "onPointerUp");
  check(
    changes.length === 2 && changes[1]?.commit && changes[1].value[key] === value,
    "Range release must commit its exact final value",
  );
  check(
    settings.exposure === 0.55 && settings.sharpening === 0,
    "Shape controls changed independent settings or forced an amount",
  );
  rendered = control(label);
  run(rendered.numeric, "onChange", { target: { value: "999" } });
  run(rendered.numeric, "onBlur");
  check(
    settings[key] === maximum && changes.at(-1)?.commit,
    "Numeric entry exceeded its upper bound or did not commit",
  );
  run(rendered.numeric, "onChange", { target: { value: "-999" } });
  run(rendered.numeric, "onBlur");
  check(
    settings[key] === minimum && changes.at(-1)?.commit,
    "Numeric entry exceeded its lower bound",
  );
  const prior = changes.length;
  run(rendered.numeric, "onChange", { target: { value: "NaN" } });
  check(changes.length === prior, "Nonfinite input changed the recipe");
  let blurred = false;
  run(rendered.numeric, "onKeyDown", {
    key: "Enter",
    currentTarget: {
      blur() {
        blurred = true;
      },
    },
  });
  check(blurred, "Enter must finish numeric editing via blur");
  run(rendered.caption, "onDoubleClick");
  check(
    settings[key] === reset && changes.at(-1)?.commit,
    "Double-click reset changed the compatibility default",
  );
  check(
    changes.every((change) => change.label === label),
    "History labels do not identify the actual adjustment",
  );
}
console.log(JSON.stringify({ passed }));
