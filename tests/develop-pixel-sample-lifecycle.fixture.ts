// Actual hook execution with deterministic browser primitives; no source files or persistence.
import { mock } from "bun:test";
import * as React from "react";
import type { DevelopPixelSample } from "../src/lib/develop/pixel-sample";

const originalReact = { ...React };
type EffectSlot = { deps: unknown[]; cleanup?: () => void };
const slots: unknown[] = [];
let cursor = 0;
let effects: (() => void)[] = [];
let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
let scheduled = 0;
globalThis.requestAnimationFrame = (callback) => {
  scheduled++;
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
  useCallback<T>(callback: T, deps: unknown[]) {
    const index = cursor++;
    const previous = slots[index] as { value: T; deps: unknown[] } | undefined;
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i])))
      slots[index] = { value: callback, deps };
    return (slots[index] as { value: T }).value;
  },
  useLayoutEffect(effect: () => (() => void) | void, deps: unknown[]) {
    const index = cursor++;
    const previous = slots[index] as EffectSlot | undefined;
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
      effects.push(() => {
        previous?.cleanup?.();
        const cleanup = effect();
        slots[index] = { deps, cleanup };
      });
    }
  },
}));
const { useDevelopPixelSample } = await import("../src/components/develop/useDevelopPixelSample");
type Props = Parameters<typeof useDevelopPixelSample>[0];
let passed = 0;
function check(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
  passed++;
}
let style = {
  display: "block",
  visibility: "visible",
  opacity: "1",
  objectFit: "contain",
  objectPosition: "50% 50%",
};
let rect = { left: 10, top: 20, width: 200, height: 100 };
const target = {
  currentSrc: "blob:preview-a",
  complete: true,
  isConnected: true,
  hidden: false,
  naturalWidth: 1000,
  naturalHeight: 500,
  getBoundingClientRect: () => rect,
};
globalThis.getComputedStyle = () => style as CSSStyleDeclaration;
let creates = 0,
  reads = 0,
  draws = 0,
  clears = 0;
let failRead = false;
const calls: unknown[][] = [];
const context = {
  imageSmoothingEnabled: true,
  clearRect: (...args: unknown[]) => {
    clears++;
    calls.push(["clear", ...args]);
  },
  drawImage: (...args: unknown[]) => {
    draws++;
    calls.push(["draw", ...args]);
  },
  getImageData: (...args: unknown[]) => {
    reads++;
    calls.push(["read", ...args]);
    if (failRead) throw new DOMException("Tainted canvas", "SecurityError");
    return { data: new Uint8ClampedArray([10, 25, 240, 255]) };
  },
};
let canvas: { width: number; height: number; getContext: (...args: unknown[]) => typeof context };
globalThis.document = {
  createElement(tag: string) {
    check(tag === "canvas", "Hook attempted a new image decode or other DOM allocation");
    creates++;
    canvas = {
      width: 0,
      height: 0,
      getContext(...args: unknown[]) {
        calls.push(["context", ...args]);
        return context;
      },
    };
    return canvas;
  },
} as unknown as Document;
const samples: (DevelopPixelSample | null)[] = [];
let props: Props = {
  image: { current: target as unknown as HTMLImageElement },
  sourceUrl: target.currentSrc,
  enabled: true,
  onSample: (sample) => samples.push(sample),
};
let handlers: ReturnType<typeof useDevelopPixelSample>;
function HookHarness(commitEffects = true) {
  cursor = 0;
  handlers = useDevelopPixelSample(props);
  if (commitEffects) commit();
}
function commit() {
  const pending = effects;
  effects = [];
  for (const effect of pending) effect();
}
const move = (x = 110, y = 70) => handlers.onPointerMove({ clientX: x, clientY: y });
const last = () => samples.at(-1);
HookHarness();
check(creates === 0 && last() === null, "Mounted hook allocated image work or kept an old sample");
const stableMove = handlers.onPointerMove,
  stableLeave = handlers.onPointerLeave;
const event = { clientX: 10, clientY: 20 };
for (let i = 0; i < 100; i++) {
  event.clientX = 10 + i;
  handlers.onPointerMove(event);
}
check(
  frames.size === 1 && scheduled === 1 && creates === 0 && reads === 0,
  "Pointer moves performed unbounded/per-event work",
);
flushFrame();
check(
  reads === 1 && draws === 1 && clears === 1 && creates === 1,
  "A frame did not read exactly one cleared pixel",
);
check(
  last()?.x === 495 && last()?.y === 0,
  "Frame lost latest pointer position or flipped source axes",
);
check(canvas!.width === 1 && canvas!.height === 1, "Sampler allocated a full-frame canvas");
check(
  JSON.stringify(calls[0]) ===
    JSON.stringify(["context", "2d", { colorSpace: "srgb", willReadFrequently: true }]),
  "Pixel context is not explicit sRGB",
);
check(
  calls.some((call) => JSON.stringify(call) === JSON.stringify(["read", 0, 0, 1, 1])),
  "Sampler read a larger source frame",
);
check(context.imageSmoothingEnabled === false, "Source-pixel sampling was interpolated");
HookHarness();
check(
  handlers.onPointerMove === stableMove && handlers.onPointerLeave === stableLeave,
  "Hook replaced event handlers on render",
);
const publishedCount = samples.length;
move(109, 20);
flushFrame();
check(
  samples.length === publishedCount && creates === 1,
  "Same pixel republished state or allocated another canvas",
);
move();
const canceled = [...frames.values()][0]!;
handlers.onPointerLeave();
flushFrame();
canceled(0);
check(
  frames.size === 0 && last() === null && reads === 2,
  "Pointer leave allowed a queued sample to reappear",
);
move();
flushFrame();
check(last()?.x === 500 && reads === 3, "Re-enter did not resume sampling");
move(50, 40);
props = { ...props, sourceUrl: "blob:preview-b" };
HookHarness();
flushFrame();
check(last() === null && reads === 3, "A source URL change kept a stale sample");
move();
flushFrame();
check(last() === null && reads === 3, "A pending new URL read the previous loaded image");
target.currentSrc = "blob:preview-b";
move();
flushFrame();
check(
  last()?.red === 10 && reads === 4 && creates === 1,
  "New decoded owner did not reuse the one-pixel canvas",
);
move();
props = { ...props, enabled: false };
HookHarness();
flushFrame();
move();
check(last() === null && frames.size === 0 && reads === 4, "Disabled sampling leaked pending work");
props = { ...props, enabled: true };
HookHarness();
for (const patch of [
  { complete: false },
  { isConnected: false },
  { hidden: true },
  { naturalWidth: 0 },
  { naturalHeight: 0 },
]) {
  Object.assign(target, patch);
  move();
  flushFrame();
  check(last() === null && reads === 4, `Invalid image sampled: ${JSON.stringify(patch)}`);
  Object.assign(target, {
    complete: true,
    isConnected: true,
    hidden: false,
    naturalWidth: 1000,
    naturalHeight: 500,
  });
}
for (const patch of [
  { visibility: "hidden" },
  { display: "none" },
  { opacity: "0" },
  { objectFit: "cover" },
  { objectPosition: "0% 0%" },
]) {
  const previous = style;
  style = { ...style, ...patch };
  move();
  flushFrame();
  check(
    last() === null && reads === 4,
    `Hidden/unsupported image mapping sampled: ${JSON.stringify(patch)}`,
  );
  style = previous;
}
rect = { ...rect, width: 0 };
move();
flushFrame();
check(last() === null && reads === 4, "A zero-width image read invented pixels");
rect = { ...rect, width: 200 };
move(500, 500);
flushFrame();
check(last() === null && reads === 4, "Pointer outside the image sampled the nearest edge");
move();
const replacement = { ...target } as unknown as HTMLImageElement;
props.image.current = replacement;
flushFrame();
check(
  last() === null && reads === 4,
  "A replaced DOM image consumed another image's queued pointer",
);
props.image.current = target as unknown as HTMLImageElement;
failRead = true;
move();
flushFrame();
move();
flushFrame();
check(last() === null && reads === 5, "An unreadable image was fabricated or repeatedly read");
failRead = false;
target.currentSrc = "blob:preview-c";
props = { ...props, sourceUrl: target.currentSrc };
HookHarness();
move();
flushFrame();
check(
  last()?.blue === 240 && reads === 6 && creates === 1,
  "Read error contaminated the next source owner",
);
move();
props = { ...props, sourceUrl: "blob:preview-d" };
HookHarness(false);
flushFrame();
check(last() === null && reads === 6, "A render-time source switch leaked before effect cleanup");
commit();
target.currentSrc = "blob:preview-d";
let latestCallback = 0;
props = {
  ...props,
  onSample: (sample) => {
    samples.push(sample);
    latestCallback++;
  },
};
HookHarness();
move();
flushFrame();
check(
  latestCallback === 1 && last()?.green === 25,
  "Stable handlers retained an obsolete onSample callback",
);
move();
for (const slot of slots) (slot as EffectSlot)?.cleanup?.();
flushFrame();
check(
  last() === null && frames.size === 0 && canvas!.width === 0 && canvas!.height === 0,
  "Unmount kept a readout, work or canvas backing store",
);
move();
check(frames.size === 0, "A retained handler scheduled work after unmount");
console.log(JSON.stringify({ passed }));
