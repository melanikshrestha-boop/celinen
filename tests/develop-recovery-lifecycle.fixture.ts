// Isolated deterministic hook-phase harness. No DOM, storage or global React mocks
// escape this child process. It models an event arriving before passive effects.
import { mock } from "bun:test";
import * as React from "react";

const actualReact = { ...React };
const state: unknown[] = [];
const layout: (() => unknown)[] = [];
const passive: (() => unknown)[] = [];
mock.module("react", () => ({
  ...actualReact,
  useState<T>(initial: T | (() => T)) {
    const index = state.length;
    state.push(typeof initial === "function" ? (initial as () => T)() : initial);
    return [
      state[index],
      (next: T | ((value: T) => T)) => {
        state[index] =
          typeof next === "function" ? (next as (value: T) => T)(state[index] as T) : next;
      },
    ];
  },
  useRef<T>(value: T) {
    return { current: value };
  },
  useMemo<T>(factory: () => T) {
    return factory();
  },
  useId() {
    return "qa-recovery-id";
  },
  useEffect(effect: () => unknown) {
    passive.push(effect);
  },
  useLayoutEffect(effect: () => unknown) {
    layout.push(effect);
  },
}));
const { DevelopRecoveryDialog } = await import("../src/components/develop/DevelopRecoveryDialog");
let libraryReads = 0;
const busy: boolean[] = [];
const element = DevelopRecoveryDialog({
  scope: "qa",
  libraryId: "one",
  store: {
    namespace: '["qa","one"]',
    async loadLibrary() {
      libraryReads += 1;
      throw new Error("Unexpected library read");
    },
  } as unknown as Parameters<typeof DevelopRecoveryDialog>[0]["store"],
  onClose() {},
  onRestored() {},
  onBusyChange(value) {
    busy.push(value);
  },
});
function findFileInput(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findFileInput(child);
      if (match) return match;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (!props) return null;
  if (props["type"] === "file") return props;
  return findFileInput(props["children"]);
}
// Layout effects are guaranteed before interaction; passive effects are not.
for (const effect of layout) effect();
let completeRead: (text: string) => void = () => {};
const pendingRead = new Promise<string>((resolve) => {
  completeRead = resolve;
});
const file = new File(["pending JSON"], "wrong-project.json", { type: "application/json" });
file.text = () => pendingRead;
const input = findFileInput(element);
if (!input) throw new Error("Recovery chooser missing");
(input["onChange"] as (event: unknown) => void)({
  currentTarget: { files: [file], value: "wrong-project.json" },
});
for (const effect of passive) effect();
completeRead(JSON.stringify({ version: 1, namespace: '["qa","wrong"]', documents: {} }));
await new Promise((resolve) => setTimeout(resolve, 0));
process.stdout.write(
  JSON.stringify({
    error:
      state.find(
        (value) => typeof value === "string" && value.includes("different workspace or project"),
      ) ?? "",
    libraryReads,
    busy,
  }),
);
