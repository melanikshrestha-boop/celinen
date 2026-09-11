// Actual component handlers in an isolated hook lifecycle harness. No browser,
// clipboard, recipient app, or global React mocks escape this child process.
import { mock } from "bun:test";
import * as React from "react";

const actualReact = { ...React };
let slots: unknown[] = [];
let cursor = 0;
let effects: (() => unknown)[] = [];
mock.module("react", () => ({
  ...actualReact,
  useState<T>(initial: T | (() => T)) {
    const index = cursor++;
    if (!(index in slots))
      slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
    return [
      slots[index],
      (next: T | ((old: T) => T)) => {
        slots[index] =
          typeof next === "function" ? (next as (old: T) => T)(slots[index] as T) : next;
      },
    ];
  },
  useRef<T>(initial: T) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  },
  useEffect(effect: () => unknown) {
    const index = cursor++;
    if (!(index in slots)) {
      slots[index] = true;
      effects.push(effect);
    }
  },
}));
const { MessageComposer } = await import("../src/components/customer/MessageComposer");
type Props = Parameters<typeof MessageComposer>[0];
type Node = { type?: string; props?: Record<string, unknown> };
function children(node: unknown): unknown[] {
  if (Array.isArray(node)) return node;
  return node && typeof node === "object" ? [((node as Node).props ?? {})["children"]] : [];
}
function text(node: unknown): string {
  return typeof node === "string" ? node : children(node).map(text).join("");
}
function find(node: unknown, match: (node: Node) => boolean): Node | null {
  if (node && typeof node === "object" && !Array.isArray(node) && match(node as Node))
    return node as Node;
  for (const child of children(node)) {
    const result = find(child, match);
    if (result) return result;
  }
  return null;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let passed = 0;
async function scenario(
  kind:
    | "unchanged"
    | "recipient"
    | "reverted"
    | "same-tick"
    | "message"
    | "unmount"
    | "revoked"
    | "superseded",
) {
  slots = [];
  effects = [];
  const copied: string[] = [],
    opened: string[] = [],
    wait = deferred();
  let permitted = true;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      platform: "MacIntel",
      userAgent: "QA Apple",
      clipboard: {
        writeText(value: string) {
          copied.push(value);
          return wait.promise;
        },
      },
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        assign(value: string) {
          opened.push(value);
        },
      },
    },
  });
  let props: Props = {
    title: "Receipt",
    text: "Private QA receipt",
    beforeAction() {
      if (!permitted) throw new Error("Payment changed.");
    },
  };
  let tree: unknown;
  const render = () => {
    cursor = 0;
    tree = MessageComposer(props);
  };
  const phone = (value: string) => {
    const node = find(tree, (node) => node.type === "input" && node.props?.["type"] === "tel");
    if (!node) throw new Error("Phone input missing");
    (node.props!["onChange"] as (event: unknown) => void)({ target: { value } });
  };
  render();
  const cleanups = effects.map((effect) => effect());
  phone("+14155550100");
  render();
  const button = find(tree, (node) => node.type === "button" && text(node) === "Open Text Draft");
  if (!button) throw new Error("Text draft action missing");
  (button.props!["onClick"] as () => void)();
  if (opened.length || copied.length !== 1)
    throw new Error("SMS opened before clipboard completed");
  if (["recipient", "reverted", "same-tick"].includes(kind)) {
    phone("+14155550101");
    if (kind !== "same-tick") render();
    if (kind === "reverted") {
      phone("+14155550100");
      render();
    }
  } else if (kind === "message") {
    props = { ...props, text: "Changed receipt" };
    render();
  } else if (kind === "unmount") {
    for (const cleanup of cleanups) if (typeof cleanup === "function") cleanup();
  } else if (kind === "revoked") permitted = false;
  else if (kind === "superseded") (button.props!["onClick"] as () => void)();
  wait.resolve();
  await tick();
  if (kind === "unchanged" || kind === "superseded") {
    if (opened.length !== 1 || opened[0] !== "sms:+14155550100")
      throw new Error("Unchanged approved draft failed");
  } else if (opened.length) throw new Error(`${kind}: stale SMS recipient opened`);
  if (copied[0] !== "Private QA receipt") throw new Error("Wrong clipboard message");
  passed++;
}
for (const kind of [
  "unchanged",
  "recipient",
  "reverted",
  "same-tick",
  "message",
  "unmount",
  "revoked",
  "superseded",
] as const)
  await scenario(kind);
process.stdout.write(JSON.stringify({ passed }));
