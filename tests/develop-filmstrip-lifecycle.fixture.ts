// Actual components, mocked browser primitives, isolated process; never touches persisted photos.
import { mock } from "bun:test";
import * as React from "react";
import { defaultDevelopSettings } from "../src/lib/develop/contract";
import { createDevelopDocument, type DevelopPhoto } from "../src/lib/develop/store";
type Element = { type?: unknown; props?: Record<string, unknown>; key?: string };
type Slot = {
  value?: unknown;
  deps?: unknown[];
  cleanup?: () => void;
  setup?: () => (() => void) | void;
};
let active: Runner;
class Runner {
  slots: Slot[] = [];
  cursor = 0;
  dirty = true;
  effects: (() => void)[] = [];
  tree: unknown;
  render(component: unknown, props: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Hooks run against this isolated renderer.
    active = this;
    this.cursor = 0;
    this.dirty = false;
    const fn =
      typeof component === "function"
        ? component
        : (component as { type: (p: unknown) => unknown }).type;
    this.tree = fn(props);
    return this.tree;
  }
  commit() {
    const effects = this.effects;
    this.effects = [];
    effects.forEach((effect) => effect());
  }
  unmount() {
    this.slots.forEach((slot) => slot.cleanup?.());
    this.slots = [];
    this.effects = [];
  }
  replayCleanup() {
    this.slots.forEach((slot) => {
      slot.cleanup?.();
      slot.cleanup = undefined;
    });
  }
  replaySetup() {
    this.slots.forEach((slot) => {
      if (slot.setup) slot.cleanup = slot.setup() || undefined;
    });
  }
}
const originalReact = { ...React };
const memo = (compute: () => unknown, deps: unknown[]) => {
  const index = active.cursor++,
    previous = active.slots[index];
  if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps?.[i])))
    active.slots[index] = { value: compute(), deps };
  return active.slots[index]!.value;
};
const effect = (callback: () => (() => void) | void, deps?: unknown[]) => {
  const runner = active,
    index = runner.cursor++,
    previous = runner.slots[index];
  if (!previous || !deps || deps.some((dep, i) => !Object.is(dep, previous.deps?.[i])))
    runner.effects.push(() => {
      previous?.cleanup?.();
      runner.slots[index] = { deps, setup: callback, cleanup: callback() || undefined };
    });
};
mock.module("react", () => ({
  ...originalReact,
  useState(initial: unknown) {
    const runner = active,
      index = runner.cursor++;
    if (!(index in runner.slots))
      runner.slots[index] = { value: typeof initial === "function" ? initial() : initial };
    return [
      runner.slots[index]!.value,
      (next: unknown) => {
        const value = typeof next === "function" ? next(runner.slots[index]!.value) : next;
        if (!Object.is(value, runner.slots[index]!.value)) {
          runner.slots[index]!.value = value;
          runner.dirty = true;
        }
      },
    ];
  },
  useRef(initial: unknown) {
    const index = active.cursor++;
    active.slots[index] ??= { value: { current: initial } };
    return active.slots[index]!.value;
  },
  useMemo: memo,
  useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps),
  useEffect: effect,
  useLayoutEffect: effect,
}));
let passed = 0;
function check(value: unknown, message: string) {
  if (!value) throw new Error(message);
  passed++;
}
const nodes = (value: unknown): Element[] =>
  Array.isArray(value)
    ? value.flatMap(nodes)
    : value && typeof value === "object"
      ? [value as Element, ...nodes((value as Element).props?.children)]
      : [];
let id = 0,
  scheduled = 0;
const rafs = new Map<number, FrameRequestCallback>();
globalThis.requestAnimationFrame = (callback) => {
  scheduled++;
  rafs.set(++id, callback);
  return id;
};
globalThis.cancelAnimationFrame = (frame) => {
  rafs.delete(frame);
};
const liveUrls = new Map<string, Blob>(),
  revoked: string[] = [];
URL.createObjectURL = (blob: Blob) => {
  const url = `blob:filmstrip-${++id}`;
  liveUrls.set(url, blob);
  return url;
};
URL.revokeObjectURL = (url) => {
  if (!liveUrls.delete(url)) throw new Error("URL revoked twice or not owned");
  revoked.push(url);
};
let resize: (() => void) | null = null,
  disconnected = false;
globalThis.ResizeObserver = class {
  constructor(callback: ResizeObserverCallback) {
    resize = () => callback([], this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    disconnected = true;
  }
};
const listeners = new Map<string, EventListenerOrEventListenerObject>();
globalThis.window = {
  addEventListener: (type: string, fn: EventListenerOrEventListenerObject) =>
    listeners.set(type, fn),
  removeEventListener: (type: string) => listeners.delete(type),
} as unknown as Window & typeof globalThis;
class FakeNode {}
globalThis.Node = FakeNode as unknown as typeof Node;
const documentState = { activeElement: new FakeNode() };
globalThis.document = documentState as unknown as Document;
let width = 900,
  itemWidth = 110,
  group: Element,
  props: Parameters<typeof DevelopFilmstrip>[0];
const root = new Runner();
type Mounted = { frame: Runner; thumb: Runner; button: Button; node: Element };
const mounted = new Map<string, Mounted>();
class Button extends FakeNode {
  constructor(public dataset: Record<string, string>) {
    super();
  }
  focus() {
    documentState.activeElement = this;
    (group.props!.onFocusCapture as (e: unknown) => void)({
      target: this,
      currentTarget: container,
    });
  }
  closest(selector: string) {
    return selector.startsWith("button") ? this : null;
  }
}
const container = Object.assign(new FakeNode(), {
  scrollLeft: 0,
  contains(node: unknown) {
    return node === this || [...mounted.values()].some((value) => value.button === node);
  },
  querySelectorAll() {
    return [...mounted.values()].map((value) => value.button);
  },
  focus() {
    documentState.activeElement = this;
    (group.props!.onFocusCapture as (e: unknown) => void)({ target: this, currentTarget: this });
  },
  closest() {
    return null;
  },
});
Object.defineProperty(container, "clientWidth", { get: () => width });
globalThis.getComputedStyle = () =>
  ({
    getPropertyValue: (name: string) =>
      String(name.endsWith("item-width") ? itemWidth : name.endsWith("gap") ? 2 : 8),
  }) as CSSStyleDeclaration;
const { DevelopFilmstrip, DevelopFilmstripThumb } =
  await import("../src/components/develop/DevelopFilmstrip");
const jpegBytes = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9, 0x00);
const original = new Blob([jpegBytes], { type: "image/jpeg" });
const photos = Array.from({ length: 1000 }, (_, i): DevelopPhoto => ({
  id: `qa:${i}`,
  name: `Authored ${i}.jpg`,
  width: 10,
  height: 10,
  isRaw: false,
  sourceBlob: original,
  previewBlob: original,
  sourceFileName: `original-${i}.jpg`,
  sourceLastModified: 0,
  sourceDigest: null,
  sourceAvailable: true,
  createdAt: 0,
}));
const selections: { id: string; multi: boolean }[] = [];
props = {
  photos,
  documents: { "qa:0": createDevelopDocument("qa:0", defaultDevelopSettings()) },
  selected: "qa:0",
  selectedIds: new Set(["qa:0"]),
  onSelect(selected, multi) {
    selections.push({ id: selected, multi });
    props = { ...props, selected, selectedIds: new Set([selected]) };
    root.dirty = true;
  },
};
async function flush() {
  for (let pass = 0; pass < 40; pass++) {
    group = root.render(DevelopFilmstrip, props) as Element;
    (group.props!.ref as { current: unknown }).current = container;
    const rows = nodes(group).filter(
      (node) => !!node.props?.photo && typeof node.props?.index === "number",
    );
    const ids = new Set(rows.map((row) => (row.props!.photo as DevelopPhoto).id));
    for (const [key, value] of mounted)
      if (!ids.has(key)) {
        value.frame.unmount();
        value.thumb.unmount();
        mounted.delete(key);
      }
    for (const row of rows) {
      const photo = row.props!.photo as DevelopPhoto;
      let value = mounted.get(photo.id);
      if (!value) {
        value = {
          frame: new Runner(),
          thumb: new Runner(),
          button: new Button({ photoId: photo.id, photoIndex: String(row.props!.index) }),
          node: {},
        };
        mounted.set(photo.id, value);
      }
      value.node = value.frame.render(row.type, row.props) as Element;
      (value.node.props!.ref as { current: unknown }).current = value.button;
      value.thumb.render(DevelopFilmstripThumb, { photo });
      value.frame.commit();
      value.thumb.commit();
    }
    root.commit();
    for (let spin = 0; spin < 20; spin++) await Promise.resolve();
    if (
      !root.dirty &&
      [...mounted.values()].every((value) => !value.frame.dirty && !value.thumb.dirty)
    )
      return;
  }
  throw new Error("Filmstrip did not settle after bounded render passes");
}
async function frame() {
  const callbacks = [...rafs.values()];
  rafs.clear();
  callbacks.forEach((callback) => callback(0));
  await flush();
}
async function scroll(left: number) {
  container.scrollLeft = left;
  (group.props!.onScroll as () => void)();
  await frame();
}
await flush();
check(group.props?.["data-photo-count"] === 1000, "Logical count was replaced by mounted count");
check(
  mounted.size === 12 && liveUrls.size === mounted.size,
  "First render allocated the entire library",
);
check(group.props?.["data-item-stride"] === 112, "Desktop measured stride is wrong");
check(
  mounted.get("qa:0")?.node.props?.["aria-label"] === "1. Authored 0.jpg",
  "Authored title or global index changed",
);
check(
  mounted.get("qa:0")?.node.props?.["aria-description"] === "Photo 1 of 1000",
  "Logical position/count missing from accessibility text",
);
check(
  [...mounted.values()].filter((value) => value.node.props?.tabIndex === 0).length === 1,
  "Filmstrip is not one roving tab stop",
);
check(
  mounted.get("qa:0")?.node.props?.["aria-pressed"] === true,
  "Controlled multiselection was lost",
);
const initialUrl = [...liveUrls.keys()][0]!;
mounted.get("qa:0")!.button.focus();
await flush();
// React StrictMode replays mounted effects without resetting hook state or DOM refs.
// Parent cleanup precedes descendants; descendant setups precede parent layouts.
root.replayCleanup();
for (const value of mounted.values()) {
  value.frame.replayCleanup();
  value.thumb.replayCleanup();
}
check(liveUrls.size === 0, "StrictMode effect cleanup leaked thumbnail URLs");
for (const value of mounted.values()) {
  value.frame.replaySetup();
  value.thumb.replaySetup();
}
root.replaySetup();
await flush();
check(
  liveUrls.size === mounted.size,
  "StrictMode replay did not reacquire exactly its mounted URLs",
);
check(
  documentState.activeElement === mounted.get("qa:0")?.button,
  "StrictMode effect replay stranded keyboard focus",
);
const priorSchedules = scheduled;
container.scrollLeft = 111114;
for (let i = 0; i < 100; i++) (group.props!.onScroll as () => void)();
check(scheduled === priorSchedules + 1 && rafs.size === 1, "Scroll events are not RAF-coalesced");
await frame();
check(
  mounted.has("qa:999") && mounted.has("qa:0"),
  "Scrolling lost the last frame or unmounted focused row",
);
check(
  mounted.size <= 19 && liveUrls.size === mounted.size,
  "Overscan/focus exception exceeded its bounded URL count",
);
check(
  documentState.activeElement === mounted.get("qa:0")!.button,
  "Wheel scrolling stole keyboard focus",
);
check(selections.length === 0 && props.selected === "qa:0", "Scrolling selected a photograph");
props = { ...props, photos: [...props.photos] };
await flush();
check(
  container.scrollLeft === 111114 && mounted.has("qa:999"),
  "An unrelated parent array render snapped scroll back to selected",
);
(group.props!.onBlurCapture as (event: unknown) => void)({
  relatedTarget: new FakeNode(),
  currentTarget: container,
});
documentState.activeElement = new FakeNode();
await flush();
check(
  !mounted.has("qa:0") && revoked.includes(initialUrl),
  "Blur did not release the offscreen focused thumbnail URL",
);
container.focus();
let prevented = false,
  stopped = false;
(group.props!.onKeyDown as (event: unknown) => void)({
  key: "End",
  currentTarget: container,
  preventDefault() {
    prevented = true;
  },
  stopPropagation() {
    stopped = true;
  },
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
});
await flush();
check(
  prevented && stopped && props.selected === "qa:999",
  "End did not perform real last-photo selection",
);
check(
  documentState.activeElement === mounted.get("qa:999")?.button,
  "Last navigation did not focus the mounted row",
);
check(
  mounted.get("qa:999")?.node.props?.["aria-label"] === "1000. Authored 999.jpg",
  "Last row was renumbered relative to the viewport",
);
(group.props!.onKeyDown as (event: unknown) => void)({
  key: "Home",
  currentTarget: container,
  preventDefault() {},
  stopPropagation() {},
  shiftKey: true,
  metaKey: false,
  ctrlKey: false,
});
await flush();
check(
  props.selected === "qa:0" && selections.at(-1)?.multi,
  "Home lost multi-select modifier behavior",
);
check(
  documentState.activeElement === mounted.get("qa:0")?.button && container.scrollLeft === 0,
  "Home did not reveal/focus first row",
);
const beforeArrow = selections.length;
(group.props!.onKeyDown as (event: unknown) => void)({ key: "ArrowRight" });
check(selections.length === beforeArrow, "Filmstrip intercepted the existing global arrow handler");
props = { ...props, selected: "qa:500", selectedIds: new Set(["qa:500"]) };
await flush();
check(
  mounted.has("qa:500") && documentState.activeElement === mounted.get("qa:500")?.button,
  "Controlled global navigation did not reveal/focus selected row",
);
check(
  mounted.get("qa:500")?.node.props?.className === "is-active",
  "Selected visual state was lost",
);
const chosen = mounted.get("qa:500")!;
(chosen.node.props!.onClick as (event: unknown) => void)({
  shiftKey: false,
  metaKey: true,
  ctrlKey: false,
});
await flush();
check(
  selections.at(-1)?.id === "qa:500" && selections.at(-1)?.multi,
  "Meta click changed selection semantics",
);
const oldUrls = new Set(liveUrls.keys()),
  replacement = new Blob([Uint8Array.of(0xff, 0xd8, 0xff, 0xd8, 0x00)], { type: "image/jpeg" });
props = {
  ...props,
  photos: props.photos.map((photo) =>
    photo.id === "qa:500" ? { ...photo, previewBlob: replacement } : photo,
  ),
};
await flush();
check(
  [...liveUrls.values()].includes(replacement),
  "Changed source did not get its own thumbnail URL",
);
check(
  [...oldUrls].filter((url) => !liveUrls.has(url)).length === 1,
  "Source change revoked unrelated thumbnails or leaked its old URL",
);
width = 390;
itemWidth = 95;
resize?.();
await frame();
check(group.props?.["data-item-stride"] === 97, "Responsive item width was not measured");
check(
  mounted.size <= Math.ceil(390 / 97) + 10,
  `Mobile window allocation is not bounded: ${mounted.size} rows, ${group.props?.["data-window-start"]}..${group.props?.["data-window-end"]}`,
);
check(liveUrls.size === mounted.size, "Resize leaked thumbnail resources");
props = {
  ...props,
  photos: props.photos.filter((photo) => photo.id !== "qa:500"),
  selected: "qa:501",
  selectedIds: new Set(["qa:501"]),
};
await flush();
check(
  mounted.has("qa:501") && documentState.activeElement === mounted.get("qa:501")?.button,
  "Filtering a focused row stranded focus on body",
);
check(
  mounted.get("qa:501")?.node.props?.["aria-label"] === "501. Authored 501.jpg",
  "Filtered global index is not logical-list based",
);
props = { ...props, photos: [], selected: null, selectedIds: new Set() };
await flush();
check(mounted.size === 0 && liveUrls.size === 0, "Empty filter retained every photo URL");
check(
  group.props?.tabIndex === 0 && group.props?.["data-photo-count"] === 0,
  "Empty group is not accessible",
);
props = { ...props, photos, selected: "qa:999", selectedIds: new Set(["qa:999"]) };
await flush();
check(
  mounted.has("qa:999") && container.scrollLeft > 0,
  "Initial/offscreen selected photo did not become visible",
);
check(
  [...mounted.values()].every((value) =>
    nodes(value.thumb.tree).some((node) => node.type === "img" && node.props?.loading === "lazy"),
  ),
  "Mounted thumbnails are not lazy images",
);
(group.props!.onScroll as () => void)();
root.unmount();
for (const value of mounted.values()) {
  value.frame.unmount();
  value.thumb.unmount();
}
mounted.clear();
check(
  disconnected && !listeners.size && !rafs.size,
  "Unmount leaked resize or scheduled scroll work",
);
check(liveUrls.size === 0, "Unmount leaked object URLs");
console.log(JSON.stringify({ passed, remainingUrls: liveUrls.size }));
