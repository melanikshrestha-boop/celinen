// Actual Viewer handlers/effects in a dependency-aware, isolated hook harness.
// No browser, workers, native processing, original files, or persistent storage.
import { mock } from "bun:test";
import * as React from "react";
import { defaultDevelopSettings } from "../src/lib/develop/contract";
import { analyzeDevelopPixels, type DevelopHistogramData } from "../src/lib/develop/histogram";
import type {
  DevelopPixelAnalysis,
  DevelopPixelAnalysisOptions,
} from "../src/lib/develop/pixel-analysis";
import type { useDevelopPixelSample } from "../src/components/develop/useDevelopPixelSample";

const originalReact = { ...React };
type EffectSlot = { deps: unknown[]; cleanup?: () => void };
let slots: unknown[] = [];
let cursor = 0;
let mounted = false;
let dirty = false;
let writesAfterUnmount = 0;
const effects = new Map<number, () => (() => void) | void>();
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
      (next: T | ((previous: T) => T)) => {
        if (!mounted) writesAfterUnmount++;
        const value =
          typeof next === "function" ? (next as (old: T) => T)(slots[index] as T) : next;
        if (!Object.is(value, slots[index])) {
          slots[index] = value;
          dirty = true;
        }
      },
    ];
  },
  useEffect(effect: () => (() => void) | void, deps: unknown[]) {
    const index = cursor++;
    const previous = slots[index] as EffectSlot | undefined;
    if (
      !previous ||
      deps.length !== previous.deps.length ||
      deps.some((dep, i) => !Object.is(dep, previous.deps[i]))
    ) {
      slots[index] = { deps, cleanup: previous?.cleanup };
      effects.set(index, effect);
    }
  },
}));
type Request = {
  blob: Blob;
  options: DevelopPixelAnalysisOptions;
  resolve(value: DevelopPixelAnalysis): void;
  reject(error: Error): void;
};
const requests: Request[] = [];
mock.module("../src/lib/develop/pixel-analysis", () => ({
  analyzeDevelopBlob(blob: Blob, options: DevelopPixelAnalysisOptions) {
    // Intentionally allow late settlement after abort: the component must guard it too.
    return new Promise<DevelopPixelAnalysis>((resolve, reject) => {
      requests.push({ blob, options, resolve, reject });
    });
  },
}));
// The sampling hook has its own real lifecycle tests. Capture only Viewer's
// integration arguments here so these tests stay focused on image/analysis ownership.
type SampleOptions = Parameters<typeof useDevelopPixelSample>[0];
const samplingCalls: SampleOptions[] = [];
const samplingPointer = { onPointerMove() {}, onPointerLeave() {} };
mock.module("../src/components/develop/useDevelopPixelSample", () => ({
  useDevelopPixelSample(options: SampleOptions) {
    samplingCalls.push(options);
    return samplingPointer;
  },
}));
const { DevelopViewer } = await import("../src/components/develop/DevelopViewer");
type Props = Parameters<typeof DevelopViewer>[0];
type Node = { type?: unknown; props?: Record<string, unknown> };
let props: Props;
let tree: unknown;
let passed = 0;
const groups: string[] = [];
let observed = 0;
let disconnected = 0;
let canvasContexts = 0;
let canvasReads = 0;
let createdElements = 0;
const draws: { data: Uint8ClampedArray; width: number; height: number }[] = [];
const histograms: { value: DevelopHistogramData; url: string }[] = [];
const errors: { message: string; url: string }[] = [];
const dimensions: { width: number; height: number }[] = [];
const stage = { clientWidth: 960, clientHeight: 640 };
const previewImage = { currentSrc: "", naturalWidth: 1200, naturalHeight: 800 };
const canvas = {
  width: 0,
  height: 0,
  getContext() {
    canvasContexts++;
    return {
      putImageData(value: { data: Uint8ClampedArray; width: number; height: number }) {
        draws.push(value);
      },
      getImageData() {
        canvasReads++;
        throw new Error("Image onLoad must not synchronously read preview pixels.");
      },
    };
  },
};
Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: class {
    observe() {
      observed++;
    }
    disconnect() {
      disconnected++;
    }
  },
});
Object.defineProperty(globalThis, "ImageData", {
  configurable: true,
  value: class {
    constructor(
      public data: Uint8ClampedArray,
      public width: number,
      public height: number,
    ) {}
  },
});
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: {
    createElement() {
      createdElements++;
      throw new Error("Viewer image onLoad must not create a full-size pixel canvas.");
    },
  },
});
function check(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
  passed++;
}
function children(node: unknown): unknown[] {
  if (Array.isArray(node)) return node;
  return node && typeof node === "object" ? [(node as Node).props?.children] : [];
}
function walk(node: unknown, visit: (entry: Node) => void) {
  if (node && typeof node === "object" && !Array.isArray(node)) visit(node as Node);
  for (const child of children(node)) walk(child, visit);
}
function find(predicate: (node: Node) => boolean) {
  let found: Node | null = null;
  walk(tree, (entry) => {
    if (!found && predicate(entry)) found = entry;
  });
  if (!found) throw new Error("Expected Viewer element was absent.");
  return found as Node;
}
function run(node: Node, name: string, event: Record<string, unknown>) {
  const handler = node.props?.[name];
  if (typeof handler !== "function") throw new Error(`Missing ${name} handler.`);
  handler(event);
}
function image() {
  return find((node) => node.type === "img" && typeof node.props?.onLoad === "function");
}
function overlayDisplay() {
  return (find((node) => node.type === "canvas").props?.style as { display: string }).display;
}
let lastRefs: { current: unknown }[] = [];
function paint() {
  dirty = false;
  cursor = 0;
  tree = DevelopViewer(props);
  const currentRefs: { current: unknown }[] = [];
  walk(tree, (node) => {
    const ref = node.props?.ref as { current: unknown } | undefined;
    if (!ref) return;
    if (node.type === "img") previewImage.currentSrc = String(node.props?.src ?? "");
    ref.current = node.type === "canvas" ? canvas : node.type === "img" ? previewImage : stage;
    currentRefs.push(ref);
  });
  for (const ref of lastRefs) if (!currentRefs.includes(ref)) ref.current = null;
  lastRefs = currentRefs;
}
function flushEffects() {
  const pending = [...effects.entries()];
  effects.clear();
  // React cleans old passive effects before setting up their replacements.
  for (const [index] of pending) (slots[index] as EffectSlot).cleanup?.();
  for (const [index, effect] of pending)
    (slots[index] as EffectSlot).cleanup = effect() || undefined;
}
function render() {
  for (let remaining = 10; remaining > 0; remaining--) {
    paint();
    flushEffects();
    if (!dirty) return;
  }
  throw new Error("Viewer lifecycle harness did not settle.");
}
function unmount() {
  if (!mounted) return;
  for (const slot of slots) (slot as EffectSlot | undefined)?.cleanup?.();
  effects.clear();
  for (const ref of lastRefs) ref.current = null;
  lastRefs = [];
  mounted = false;
}
const blobA = new Blob(["synthetic preview A"]),
  blobB = new Blob(["synthetic preview B"]);
const urlA = "blob:qa-preview-A",
  urlB = "blob:qa-preview-B";
function setup(overrides: Partial<Props> = {}) {
  unmount();
  slots = [];
  requests.length =
    histograms.length =
    errors.length =
    dimensions.length =
    draws.length =
    samplingCalls.length =
      0;
  canvasContexts = canvasReads = createdElements = writesAfterUnmount = 0;
  observed = disconnected = 0;
  canvas.width = canvas.height = 0;
  mounted = true;
  props = {
    url: urlA,
    blob: blobA,
    beforeUrl: urlB,
    beforeBlob: blobB,
    before: false,
    compare: false,
    zoom: "fit",
    grid: false,
    tool: "edit",
    settings: defaultDevelopSettings(),
    maskId: null,
    clipping: { shadows: false, highlights: false },
    knownHistogram: null,
    change() {
      throw new Error("Pixel lifecycle unexpectedly edited a recipe.");
    },
    onDimensions(width, height) {
      dimensions.push({ width, height });
    },
    onHistogram(value, url) {
      histograms.push({ value, url });
    },
    onHistogramError(message, url) {
      errors.push({ message, url });
    },
    ...overrides,
  };
  render();
}
function result(value: number, clipping = false): DevelopPixelAnalysis {
  const pixels = new Uint8Array([value, value, value, 255]);
  return {
    histogram: analyzeDevelopPixels(pixels),
    width: 1,
    height: 1,
    ...(clipping ? { clipping: new Uint8ClampedArray([value, 0, 0, 80]) } : {}),
  };
}
async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
function load(currentSrc = props.before ? props.beforeUrl : props.url) {
  run(image(), "onLoad", { currentTarget: { currentSrc, naturalWidth: 1200, naturalHeight: 800 } });
  render();
}

setup();
check(
  requests.length === 1 && requests[0]!.blob === blobA,
  "Mount analyzed the wrong preview blob.",
);
const oldAnalysis = requests[0]!;
props = { ...props, url: urlB, blob: blobB };
render();
check(oldAnalysis.options.signal?.aborted, "Source switch did not abort old analysis.");
check(
  requests.length === 2 && requests[1]!.blob === blobB,
  "Source switch did not analyze new pixels.",
);
oldAnalysis.resolve(result(10));
await settle();
check(histograms.length === 0, "Old analysis published into the new photo.");
const currentResult = result(20);
requests[1]!.resolve(currentResult);
await settle();
check(
  histograms.length === 1 &&
    histograms[0]!.value === currentResult.histogram &&
    histograms[0]!.url === urlB,
  "Current histogram lost exact blob/URL provenance.",
);
groups.push("late source result");

setup();
const oldUrlRequest = requests[0]!;
props = { ...props, url: "blob:qa-recreated-A" };
render();
check(
  oldUrlRequest.options.signal?.aborted && requests.length === 2,
  "URL replacement reused an obsolete request.",
);
oldUrlRequest.reject(new Error("Obsolete decode failure"));
await settle();
check(errors.length === 0, "Obsolete URL failure reached current error UI.");
requests[1]!.reject(new Error("Current decode failure"));
await settle();
check(
  errors.length === 1 &&
    errors[0]!.url === props.url &&
    errors[0]!.message === "Current decode failure",
  "Current failure lost its source URL.",
);
groups.push("URL and error ownership");

setup();
const oldBlobRequest = requests[0]!;
props = { ...props, blob: blobB };
render();
check(
  oldBlobRequest.options.signal?.aborted && requests[1]!.blob === blobB,
  "Blob replacement without URL change did not restart analysis.",
);
oldBlobRequest.resolve(result(30));
await settle();
check(histograms.length === 0, "Replaced blob published an obsolete histogram.");
groups.push("blob identity");

const measuredA = result(40).histogram,
  measuredB = result(50).histogram;
setup({ knownHistogram: measuredA });
check(
  requests.length === 0 && histograms[0]!.value === measuredA && histograms[0]!.url === urlA,
  "Known current histogram did not bypass duplicate analysis.",
);
props = { ...props, grid: true };
render();
check(
  requests.length === 0 && histograms.length === 1,
  "Unrelated render repeated the known histogram callback.",
);
// Parent owns matching cached measurements to blobs. Remove A's cache when selecting B.
props = { ...props, url: urlB, blob: blobB, knownHistogram: null };
render();
check(
  requests.length === 1 && histograms.length === 1,
  "New source inherited a previous prop's cached histogram.",
);
const supersededByKnown = requests[0]!;
props = { ...props, knownHistogram: measuredB };
render();
check(
  supersededByKnown.options.signal?.aborted &&
    histograms.at(-1)!.value === measuredB &&
    histograms.at(-1)!.url === urlB,
  "Current known measurement did not cancel its duplicate request.",
);
supersededByKnown.resolve(result(60));
await settle();
check(histograms.length === 2, "Superseded request overwrote a known current measurement.");
groups.push("current known histogram props");

setup();
const requestsBeforeLoad = requests.length;
load("blob:obsolete-image-load");
check(dimensions.length === 0, "Wrong currentSrc changed the selected photo geometry.");
load(urlA);
check(
  dimensions.length === 1 && dimensions[0]!.width === 1200 && dimensions[0]!.height === 800,
  "Current image dimensions were not adopted.",
);
check(
  requests.length === requestsBeforeLoad && histograms.length === 0,
  "Image onLoad synchronously analyzed pixels or duplicated analysis.",
);
check(
  createdElements === 0 && canvasContexts === 0 && canvasReads === 0,
  "Image onLoad synchronously created/read a pixel canvas.",
);
groups.push("lightweight image onLoad");

setup({ before: true });
check(
  requests.length === 1 && requests[0]!.blob === blobB && image().props?.src === urlB,
  "Before mode analyzed a different image from the visible preview.",
);
requests[0]!.resolve(result(70));
await settle();
check(histograms[0]!.url === urlB, "Before histogram was attributed to edited preview.");
props = { ...props, before: false };
render();
check(
  requests.length === 2 && requests[1]!.blob === blobA && image().props?.src === urlA,
  "Returning from Before did not restore edited source analysis.",
);
groups.push("before preview provenance");

setup({ clipping: { shadows: true, highlights: false } });
requests[1]!.resolve(result(75, true));
await settle();
render();
check(
  draws.length === 1 && overlayDisplay() === "none",
  "Measured clipping appeared before any matching image geometry loaded.",
);
load("blob:qa-wrong-loaded-image");
check(
  dimensions.length === 0 && overlayDisplay() === "none",
  "Wrong currentSrc unlocked the clipping overlay.",
);
load(urlA);
check(
  overlayDisplay() === "block",
  "Matching image geometry did not unlock its measured clipping overlay.",
);
groups.push("clipping requires matching loaded geometry");

setup({ clipping: { shadows: true, highlights: false } });
load(urlA);
check(
  requests.length === 2 && requests[1]!.options.clipping?.shadows,
  "Clipping did not request its own explicit mask.",
);
const staleClip = requests[1]!;
props = { ...props, clipping: { shadows: false, highlights: true } };
render();
check(
  staleClip.options.signal?.aborted && requests.length === 3,
  "Clipping flags did not abort and replace the old request.",
);
staleClip.resolve(result(80, true));
await settle();
render();
check(
  draws.length === 0 && overlayDisplay() === "none" && canvas.width === 0 && canvas.height === 0,
  "Aborted clipping drew an obsolete overlay.",
);
const firstVisibleClip = result(90, true);
requests[2]!.resolve(firstVisibleClip);
await settle();
render();
check(
  draws.length === 1 &&
    draws[0]!.data === firstVisibleClip.clipping &&
    canvas.width === 1 &&
    canvas.height === 1 &&
    overlayDisplay() === "block",
  "Current clipping pixels were not drawn with their exact dimensions.",
);
props = { ...props, clipping: { shadows: true, highlights: false } };
paint();
check(
  overlayDisplay() === "none",
  "Previous flag overlay remained visible before replacement effects ran.",
);
flushEffects();
render();
check(
  canvas.width === 0 && canvas.height === 0,
  "Changing clipping flags retained the previous canvas backing store.",
);
requests.at(-1)!.resolve(result(100, true));
await settle();
render();
check(overlayDisplay() === "block", "New clipping flag owner did not become visible.");
props = { ...props, url: urlB, blob: blobB };
paint();
check(
  overlayDisplay() === "none",
  "Old source clipping remained visible before new source effects ran.",
);
flushEffects();
render();
check(
  canvas.width === 0 && canvas.height === 0,
  "Changing the source retained the previous clipping canvas backing store.",
);
const sourceBClip = requests.at(-1)!;
check(
  sourceBClip.blob === blobB && !!sourceBClip.options.clipping,
  "New clipping source used previous photo bytes.",
);
sourceBClip.resolve(result(110, true));
await settle();
render();
check(overlayDisplay() === "none", "New clipping appeared before matching image geometry loaded.");
load(urlB);
check(
  overlayDisplay() === "block",
  "New source clipping did not appear after its own image loaded.",
);
props = { ...props, clipping: { shadows: false, highlights: false } };
paint();
check(overlayDisplay() === "none", "Disabling clipping did not immediately hide previous pixels.");
flushEffects();
render();
check(
  canvas.width === 0 && canvas.height === 0,
  "Disabling clipping hid but did not release its canvas backing store.",
);
groups.push("clipping cancellation and URL/flag ownership");

setup();
check(
  samplingCalls.at(-1)!.sourceUrl === urlA && !samplingCalls.at(-1)!.enabled,
  "Pixel sampling was enabled before current image geometry loaded.",
);
load(urlA);
check(
  samplingCalls.at(-1)!.enabled && samplingCalls.at(-1)!.image.current === previewImage,
  "Pixel sampling is not connected to the actual loaded image ref.",
);
check(
  find((node) => node.type === "div" && node.props?.onPointerMove === samplingPointer.onPointerMove)
    .props?.onPointerLeave === samplingPointer.onPointerLeave,
  "Sampling handlers were not attached to the current image frame.",
);
props = { ...props, compare: true };
render();
check(!samplingCalls.at(-1)!.enabled, "Comparison mode left pixel sampling enabled.");
props = { ...props, compare: false, tool: "crop" };
render();
check(!samplingCalls.at(-1)!.enabled, "Crop mode left pixel sampling enabled.");
props = { ...props, tool: "edit", url: "blob:qa-sampling-new", blob: blobB };
render();
check(
  samplingCalls.at(-1)!.sourceUrl === props.url && !samplingCalls.at(-1)!.enabled,
  "Pixel sampling inherited readiness from the previous source.",
);
load(props.url);
check(samplingCalls.at(-1)!.enabled, "Matching new image load did not enable pixel sampling.");
props = { ...props, before: true };
render();
check(
  samplingCalls.at(-1)!.sourceUrl === urlB && !samplingCalls.at(-1)!.enabled,
  "Before source did not reset pixel sampling ownership.",
);
load(urlB);
check(
  samplingCalls.at(-1)!.enabled && samplingCalls.at(-1)!.image.current?.currentSrc === urlB,
  "Before pixel sampling did not follow the actual loaded Before image.",
);
groups.push("pixel sampling gates use current image");

setup({ clipping: { shadows: true, highlights: true } });
requests[1]!.resolve(result(115, true));
await settle();
render();
check(canvas.width === 1 && canvas.height === 1, "Clipping did not allocate its measured canvas.");
unmount();
check(
  canvas.width === 0 && canvas.height === 0,
  "Unmounting retained a completed clipping canvas backing store.",
);

setup({ clipping: { shadows: true, highlights: true } });
const pendingOnUnmount = [...requests];
unmount();
check(
  pendingOnUnmount.every((request) => request.options.signal?.aborted),
  "Unmount did not abort both histogram and clipping work.",
);
check(observed === 1 && disconnected === 1, "Unmount did not release its resize observer.");
pendingOnUnmount[0]!.resolve(result(120));
pendingOnUnmount[1]!.resolve(result(130, true));
await settle();
check(
  histograms.length === 0 &&
    errors.length === 0 &&
    draws.length === 0 &&
    writesAfterUnmount === 0 &&
    canvas.width === 0 &&
    canvas.height === 0,
  "Late unmounted work emitted callbacks, pixels, or state updates.",
);
setup({ clipping: { shadows: true, highlights: true } });
const rejectedOnUnmount = [...requests];
unmount();
for (const request of rejectedOnUnmount) request.reject(new Error("Late unmounted failure"));
await settle();
check(errors.length === 0 && writesAfterUnmount === 0, "Late unmounted failures reached the UI.");
groups.push("unmount cleanup");

setup({ url: null, blob: null, beforeUrl: null, beforeBlob: null, knownHistogram: measuredA });
check(
  requests.length === 0 && histograms.length === 0,
  "Empty viewer emitted measured pixels from an old cached prop.",
);
props = { ...props, url: urlA, blob: blobA, knownHistogram: null };
render();
check(
  requests.length === 1 && requests[0]!.blob === blobA,
  "First imported preview was not analyzed after an empty mount.",
);
props = { ...props, url: null, blob: null };
render();
check(requests[0]!.options.signal?.aborted, "Clearing the preview left old analysis active.");
requests[0]!.resolve(result(140));
await settle();
check(histograms.length === 0, "Cleared viewer accepted an old histogram.");
unmount();
groups.push("empty and cleared preview");

process.stdout.write(JSON.stringify({ passed, groups }));
