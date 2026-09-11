// Actual component handlers in an isolated hook harness. No browser or persistent photo data.
import { mock } from "bun:test";
import * as React from "react";
import { defaultDevelopSettings } from "../src/lib/develop/contract";
import { analyzeDevelopPixels } from "../src/lib/develop/histogram";
import { createDevelopPixelSampleChannel } from "../src/lib/develop/pixel-sample";

const originalReact = { ...React };
let slots: unknown[] = [];
let cursor = 0;
let cleanups: (() => void)[] = [];
let frameId = 0;
let subscriptionUpdates = 0;
const frames = new Map<number, FrameRequestCallback>();
globalThis.requestAnimationFrame = (callback) => {
  frames.set(++frameId, callback);
  return frameId;
};
globalThis.cancelAnimationFrame = (id) => {
  frames.delete(id);
};
function flushFrame() {
  const callbacks = [...frames.values()];
  frames.clear();
  for (const callback of callbacks) callback(0);
}
mock.module("react", () => ({
  ...originalReact,
  useRef<T>(initial: T) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  },
  useState<T>(initial: T) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [
      slots[index],
      (next: T) => {
        slots[index] = next;
      },
    ];
  },
  useMemo<T>(compute: () => T, deps: unknown[]) {
    const index = cursor++;
    const previous = slots[index] as { value: T; deps: unknown[] } | undefined;
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i])))
      slots[index] = { value: compute(), deps };
    return (slots[index] as { value: T }).value;
  },
  useEffect(effect: () => (() => void) | void) {
    const index = cursor++;
    if (!(index in slots)) {
      slots[index] = true;
      const cleanup = effect();
      if (cleanup) cleanups.push(cleanup);
    }
  },
  useSyncExternalStore(
    subscribe: (listener: () => void) => () => void,
    getSnapshot: () => unknown,
    getServerSnapshot: () => unknown,
  ) {
    const index = cursor++;
    const previous = slots[index] as
      { subscribe: typeof subscribe; cleanup: () => void } | undefined;
    if (!previous || previous.subscribe !== subscribe) {
      previous?.cleanup();
      const cleanup = subscribe(() => {
        subscriptionUpdates++;
      });
      slots[index] = { subscribe, cleanup };
      cleanups.push(cleanup);
    }
    check(getServerSnapshot() === null, "Server render retained a client-only pixel sample");
    return getSnapshot();
  },
}));
const { DevelopHistogram } = await import("../src/components/develop/DevelopHistogram");
type Props = Parameters<typeof DevelopHistogram>[0];
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
function text(node: unknown): string {
  return typeof node === "string" || typeof node === "number"
    ? String(node)
    : children(node).map(text).join("");
}
const histogram = analyzeDevelopPixels(new Uint8Array([0, 0, 0, 255, 255, 50, 7, 255]));
let pathsRead = 0;
histogram.channels[0] = new Proxy(histogram.channels[0]!, {
  get(target, key, receiver) {
    if (key === "map") pathsRead++;
    return Reflect.get(target, key, receiver);
  },
});
let props: Props;
let tree: unknown;
let updates: { exposure: number; commit: boolean }[] = [];
function setup() {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
  frames.clear();
  slots = [];
  updates = [];
  props = {
    histogram,
    value: defaultDevelopSettings(),
    disabled: false,
    clipping: { shadows: false, highlights: false },
    onClipping(next) {
      props = { ...props, clipping: next };
    },
    change(next, _label, commit = true) {
      updates.push({ exposure: next.exposure, commit });
      props = { ...props, value: next };
    },
  };
  render();
}
function render() {
  cursor = 0;
  tree = DevelopHistogram(props);
}
function node(label: string) {
  const result = find(tree, (entry) => entry.props?.["aria-label"] === label);
  if (!result) throw new Error(`Missing ${label}`);
  return result;
}
function graph() {
  const result = find(tree, (entry) =>
    String(entry.props?.className).split(" ").includes("develop-histogram"),
  );
  if (!result) throw new Error("Missing histogram");
  return result;
}
function run(target: Node, handler: string, event: Record<string, unknown> = {}) {
  const callback = target.props?.[handler];
  if (typeof callback !== "function") throw new Error(`Missing ${handler}`);
  callback({ preventDefault() {}, stopPropagation() {}, ...event });
}
const pointerTarget = {
  getBoundingClientRect: () => ({ left: 0, width: 200 }),
  setPointerCapture() {},
  releasePointerCapture() {},
};
const pointer = (clientX: number, pointerId = 1) => ({
  clientX,
  pointerId,
  button: 0,
  currentTarget: pointerTarget,
});
setup();
const firstPathsRead = pathsRead;
run(graph(), "onPointerMove", pointer(95));
render();
check(pathsRead === firstPathsRead, "Hover rebuilt measured histogram paths");
run(node("Histogram Exposure"), "onKeyDown", { key: "ArrowRight" });
render();
check(pathsRead === firstPathsRead, "Recipe preview rebuilt unchanged histogram paths");
check(props.value.exposure === 0.1, "Exposure keyboard step did not apply");
run(node("Histogram Exposure"), "onKeyDown", { key: "ArrowRight" });
render();
run(node("Histogram Exposure"), "onKeyUp", { key: "ArrowRight" });
check(
  updates.filter((update) => update.commit).length === 1,
  "Keyboard repeat did not coalesce one history commit",
);
check(updates.at(-1)?.exposure === 0.2, "Keyboard commit lost latest value");
setup();
run(graph(), "onPointerDown", pointer(100));
run(graph(), "onPointerMove", pointer(125));
flushFrame();
render();
check(props.value.exposure === 0.5, "Pointer tone preview did not apply");
run(graph(), "onPointerMove", pointer(190, 2));
check(props.value.exposure === 0.5, "Second pointer changed active gesture");
run(graph(), "onPointerCancel", pointer(125));
check(
  props.value.exposure === 0 && updates.every((update) => !update.commit),
  "Canceled pointer adjustment persisted",
);
setup();
run(graph(), "onPointerDown", pointer(100));
run(graph(), "onPointerMove", pointer(125));
flushFrame();
render();
props = { ...props, value: { ...props.value, exposure: -1 } };
render();
const externalCount = updates.length;
run(graph(), "onPointerUp", pointer(125));
check(
  updates.length === externalCount && props.value.exposure === -1,
  "Gesture overwrote external recipe update",
);
setup();
run(graph(), "onPointerDown", pointer(100));
for (let i = 0; i < 100; i++) run(graph(), "onPointerMove", pointer(100 + i / 2));
check(
  updates.length === 0 && frames.size === 1,
  "Pointer events were not coalesced into one frame",
);
flushFrame();
render();
check(
  updates.length === 1 && props.value.exposure === 0.99,
  "Animation frame did not publish the latest exact pointer position",
);
run(graph(), "onPointerUp", pointer(160));
check(
  updates.at(-1)?.exposure === 1.2 && updates.at(-1)?.commit,
  "Pointerup lost final position before frame flush",
);
check(
  updates.filter((update) => update.commit).length === 1 && frames.size === 0,
  "Pointerup duplicated history or left a queued preview",
);
setup();
run(graph(), "onPointerDown", pointer(100));
run(graph(), "onPointerMove", pointer(150));
run(graph(), "onPointerCancel", pointer(150));
flushFrame();
check(
  updates.length === 0 && props.value.exposure === 0,
  "Canceled queued pointer sample changed the recipe",
);
setup();
run(graph(), "onPointerDown", pointer(100));
run(graph(), "onPointerMove", pointer(150));
props = { ...props, value: { ...props.value, exposure: -2 } };
render();
flushFrame();
check(
  updates.length === 0 && props.value.exposure === -2,
  "Queued pointer sample overwrote an external recipe",
);
setup();
run(graph(), "onPointerDown", pointer(100));
run(graph(), "onPointerMove", pointer(150));
props = { ...props, disabled: true };
render();
flushFrame();
check(updates.length === 0, "Queued pointer sample bypassed a disabled safety gate");
setup();
run(graph(), "onPointerDown", pointer(100));
run(graph(), "onPointerMove", pointer(150));
for (const cleanup of cleanups) cleanup();
flushFrame();
check(updates.length === 0 && frames.size === 0, "Unmount retained a queued pointer edit");
setup();
run(graph(), "onPointerDown", pointer(100));
run(graph(), "onPointerUp", pointer(100));
check(updates.length === 0, "Click without a tone change emitted a recipe save");
setup();
run(node("Histogram Exposure"), "onKeyDown", { key: "End" });
render();
check(props.value.exposure === 5, "Keyboard maximum is incorrect");
run(node("Histogram Exposure"), "onKeyDown", { key: "Escape" });
check(
  props.value.exposure === 0 && updates.every((update) => !update.commit),
  "Escape did not revert keyboard draft",
);
setup();
props = { ...props, histogram: null };
render();
check(
  text(tree).includes("No preview pixels"),
  "Empty histogram incorrectly presents measured zeros",
);
check(!text(tree).includes("0.00%"), "Empty histogram invents clipping percentages");
check(node("Histogram Exposure").props?.tabIndex === -1, "Empty histogram remains editable");
props = { ...props, histogram, pending: true, sourceLabel: "Before preview" };
render();
check(text(tree).includes("Updating preview"), "Pending histogram is not labeled");
check(
  !!find(
    tree,
    (entry) =>
      entry.type === "svg" && String(entry.props?.["aria-label"]).startsWith("Before preview"),
  ),
  "Histogram lost pixel provenance label",
);
check(
  !!find(tree, (entry) => entry.type === "path"),
  "Pending histogram hid previously measured pixels",
);
run(node("Histogram channel"), "onChange", { target: { value: "red" } });
render();
check(
  !!find(
    tree,
    (entry) => entry.type === "svg" && String(entry.props?.["aria-label"]).includes("Red"),
  ),
  "Individual RGB channel does not render",
);
setup();
props = {
  ...props,
  sourceLabel: "Before preview",
  sample: { red: 120, green: 72, blue: 6, alpha: 255, x: 24, y: 80 },
};
render();
check(
  text(tree).includes("R 120 · G 72 · B 6") && !text(tree).includes("Drag to adjust tone"),
  "Image sample did not replace the idle caption",
);
check(
  !!find(tree, (entry) =>
    String(entry.props?.["aria-label"]).startsWith("Before preview, sRGB pixel at 24, 80"),
  ),
  "RGB readout omitted source provenance or accessible channel names",
);
run(graph(), "onPointerMove", pointer(100));
render();
check(
  text(tree).includes("Exposure 0 EV") && !text(tree).includes("R 120"),
  "Tone interaction lost caption priority",
);
run(graph(), "onPointerLeave");
props = { ...props, pending: true };
render();
check(
  text(tree).includes("Updating preview") && !text(tree).includes("R 120"),
  "Pending preview presented a sample as current",
);
props = { ...props, pending: false, sample: { ...props.sample!, alpha: 0 } };
render();
check(
  text(tree).includes("Transparent pixel") && !text(tree).includes("R 120"),
  "Transparent pixels were presented as opaque colors",
);
props = { ...props, sample: null };
render();
check(
  text(tree).includes("Drag to adjust tone") && updates.length === 0,
  "Pixel readout failed to clear or changed the recipe",
);
setup();
const sampleChannel = createDevelopPixelSampleChannel();
props = {
  ...props,
  sampleChannel,
  sampleUrl: "blob:current",
  sample: { red: 255, green: 255, blue: 255, alpha: 255, x: 0, y: 0 },
};
render();
const beforeChannelPaths = pathsRead;
const beforeChannelUpdates = subscriptionUpdates;
check(text(tree).includes("Drag to adjust tone"), "Empty channel leaked the legacy sample prop");
sampleChannel.publish({
  url: "blob:previous",
  sample: { red: 90, green: 60, blue: 30, alpha: 255, x: 100, y: 20 },
});
render();
check(
  text(tree).includes("Drag to adjust tone") && !text(tree).includes("R 90"),
  "External sample bypassed exact URL ownership",
);
sampleChannel.publish({
  url: "blob:current",
  sample: { red: 1, green: 2, blue: 3, alpha: 255, x: 7, y: 8 },
});
render();
check(
  text(tree).includes("R 1 · G 2 · B 3"),
  "Subscribed histogram did not display the current URL sample",
);
check(
  subscriptionUpdates === beforeChannelUpdates + 2,
  "Channel did not notify its sole histogram subscriber",
);
check(
  pathsRead === beforeChannelPaths && updates.length === 0,
  "Pixel-only subscription rebuilt histogram paths or changed the recipe",
);
props = { ...props, sampleUrl: "blob:next" };
render();
check(
  text(tree).includes("Drag to adjust tone"),
  "Preview URL change retained the previous source sample",
);
sampleChannel.publish(null);
render();
check(
  text(tree).includes("Drag to adjust tone"),
  "Null channel snapshot failed to restore the idle caption",
);
for (const cleanup of cleanups) cleanup();
const beforeUnmountUpdates = subscriptionUpdates;
sampleChannel.publish({
  url: "blob:next",
  sample: { red: 4, green: 5, blue: 6, alpha: 255, x: 1, y: 2 },
});
check(subscriptionUpdates === beforeUnmountUpdates, "Unmount retained a histogram subscriber");
process.stdout.write(JSON.stringify({ passed }));
