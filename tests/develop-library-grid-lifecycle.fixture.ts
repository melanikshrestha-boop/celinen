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
  const url = `blob:library-${++id}`;
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
  height = 500,
  group: Element,
  props: Parameters<typeof DevelopLibraryGrid>[0];
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
  scrollTop: 0,
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
Object.defineProperty(container, "clientHeight", { get: () => height });
globalThis.getComputedStyle = () =>
  ({
    getPropertyValue: (name: string) =>
      String(
        name.endsWith("min-width")
          ? 145
          : name.endsWith("card-height")
            ? 189
            : name.endsWith("gap")
              ? 9
              : 16,
      ),
  }) as CSSStyleDeclaration;
const { DevelopLibraryGrid, DevelopLibraryThumbnail } =
  await import("../src/components/develop/DevelopLibraryGrid");

const jpegBytes = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9, 0x00);
const original = new Blob([jpegBytes], { type: "image/jpeg" });
const photos = Array.from({ length: 1000 }, (_, i): DevelopPhoto => ({
  id: `qa:${i}`,
  name: `Authored ${i}.jpg`,
  width: 10,
  height: 10,
  isRaw: false,
  sourceBlob: i === 0 ? null : original,
  previewBlob: i === 0 ? null : original,
  sourceFileName: `original-${i}.jpg`,
  sourceLastModified: 0,
  sourceDigest: null,
  sourceAvailable: i !== 0,
  createdAt: 0,
}));
const selections: { id: string; multi: boolean }[] = [],
  opened: string[] = [];
const rated = createDevelopDocument("qa:1", defaultDevelopSettings());
rated.metadata.rating = 4;
props = {
  photos,
  documents: { "qa:1": rated },
  selected: "qa:0",
  selectedIds: new Set(["qa:0"]),
  onSelect(selected, multi) {
    selections.push({ id: selected, multi });
    props = { ...props, selected, selectedIds: new Set([selected]) };
    root.dirty = true;
  },
  onOpen(id) {
    opened.push(id);
  },
};
async function flush() {
  for (let pass = 0; pass < 40; pass++) {
    group = root.render(DevelopLibraryGrid, props) as Element;
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
      value.thumb.render(DevelopLibraryThumbnail, { photo });
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
  throw new Error("Library grid did not settle after bounded render passes");
}
async function frame() {
  const callbacks = [...rafs.values()];
  rafs.clear();
  callbacks.forEach((callback) => callback(0));
  await flush();
}
async function scroll(left: number) {
  container.scrollTop = left;
  (group.props!.onScroll as () => void)();
  await frame();
}
await flush();
check(group.props?.["data-photo-count"] === 1000, "Logical count replaced by mounted count");
check(
  group.props?.["data-column-count"] === 5 && group.props?.["data-row-stride"] === 198,
  "Columns/row stride do not match existing grid",
);
check(
  mounted.size === 25 && liveUrls.size === 24,
  "Initial grid mounted entire library or omitted missing-source card",
);
check(mounted.has("qa:0"), "Missing original not discoverable");
check(
  mounted.get("qa:0")?.node.props?.["aria-label"] === "1. Authored 0.jpg",
  "Global numbering or authored name changed",
);
check(
  String(mounted.get("qa:0")?.node.props?.["aria-description"]).includes("Original file needed"),
  "Missing source is not described",
);
check(
  String(mounted.get("qa:1")?.node.props?.["aria-description"]).includes("4 stars"),
  "Saved rating not exposed",
);
check(
  nodes(mounted.get("qa:1")?.node).some((n) => n.type === "small" && n.props?.children === "★★★★"),
  "Saved rating stars changed",
);
check(
  [...mounted.values()].filter((v) => v.node.props?.tabIndex === 0).length === 1,
  "Grid lacks one roving tab stop",
);
check(
  mounted.get("qa:0")?.node.props?.["aria-pressed"] === true,
  "Missing-source selection was dropped",
);
const initialUrls = [...liveUrls.keys()];
mounted.get("qa:0")!.button.focus();
await flush();
root.replayCleanup();
for (const v of mounted.values()) {
  v.frame.replayCleanup();
  v.thumb.replayCleanup();
}
check(liveUrls.size === 0, "StrictMode cleanup leaked URLs");
for (const v of mounted.values()) {
  v.frame.replaySetup();
  v.thumb.replaySetup();
}
root.replaySetup();
await flush();
check(liveUrls.size === 24, "StrictMode replay did not reacquire only mounted URLs");
check(documentState.activeElement === mounted.get("qa:0")?.button, "StrictMode replay lost focus");
const priorSchedules = scheduled;
container.scrollTop = 39123;
for (let i = 0; i < 100; i++) (group.props!.onScroll as () => void)();
check(scheduled === priorSchedules + 1 && rafs.size === 1, "Scroll is not one RAF");
await frame();
check(mounted.has("qa:999") && mounted.has("qa:0"), "End scroll lost last or focused card");
check(mounted.size <= 36 && liveUrls.size <= 35, "Scroll/focus window unbounded");
check(documentState.activeElement === mounted.get("qa:0")!.button, "Scroll stole focus");
check(selections.length === 0 && props.selected === "qa:0", "Scroll selected a photograph");
props = { ...props, photos: [...props.photos] };
await flush();
check(
  container.scrollTop === 39123 && mounted.has("qa:999"),
  "Parent rerender snapped manual scroll",
);
(group.props!.onBlurCapture as (e: unknown) => void)({
  relatedTarget: new FakeNode(),
  currentTarget: container,
});
documentState.activeElement = new FakeNode();
await flush();
check(!mounted.has("qa:0"), "Offscreen focus retained after leaving grid");
check(
  initialUrls.every((url) => revoked.includes(url)),
  "Initial thumbnail URLs did not release",
);
container.focus();
let prevented = false,
  stopped = false;
(group.props!.onKeyDown as (e: unknown) => void)({
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
check(prevented && stopped && props.selected === "qa:999", "End did not select logical last");
check(documentState.activeElement === mounted.get("qa:999")?.button, "End did not focus real card");
check(
  mounted.get("qa:999")?.node.props?.["aria-label"] === "1000. Authored 999.jpg",
  "Viewport renumbered last",
);
(mounted.get("qa:999")!.node.props!.onDoubleClick as () => void)();
check(opened.at(-1) === "qa:999", "Double-click opened wrong logical photograph");
async function verticalKey(key: string, multi = false) {
  let prevented = false;
  (group.props!.onKeyDown as (event: unknown) => void)({
    key,
    currentTarget: container,
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {},
    shiftKey: multi,
    metaKey: false,
    ctrlKey: false,
  });
  await flush();
  return prevented;
}
const bottomSelections = selections.length,
  bottomScroll = container.scrollTop;
check(
  (await verticalKey("ArrowDown")) &&
    props.selected === "qa:999" &&
    selections.length === bottomSelections &&
    container.scrollTop === bottomScroll,
  "Down at bottom row wrapped, selected again, or allowed native scrolling",
);
check((await verticalKey("ArrowUp")) && props.selected === "qa:994", "Up did not move by five columns");
props = {
  ...props,
  photos: photos.slice(0, 998),
  selected: "qa:994",
  selectedIds: new Set(["qa:994"]),
};
await flush();
check(
  (await verticalKey("ArrowDown", true)) && props.selected === "qa:997" && selections.at(-1)?.multi,
  "Down into partial final row did not clamp/add selection",
);
props = { ...props, photos, selected: "qa:2", selectedIds: new Set(["qa:2"]) };
await flush();
const topSelections = selections.length,
  topScroll = container.scrollTop;
check(
  (await verticalKey("ArrowUp")) &&
    props.selected === "qa:2" &&
    selections.length === topSelections &&
    container.scrollTop === topScroll,
  "Up at top row changed column or scrolled",
);
check(
  (await verticalKey("ArrowDown")) && props.selected === "qa:7",
  "Down did not preserve the same column",
);
props = { ...props, selected: "qa:999", selectedIds: new Set(["qa:999"]) };
await flush();
const beforeArrow = selections.length;
(group.props!.onKeyDown as (e: unknown) => void)({ key: "ArrowRight" });
check(selections.length === beforeArrow, "Grid intercepted global arrow navigation");
(group.props!.onKeyDown as (e: unknown) => void)({
  key: "Home",
  currentTarget: container,
  preventDefault() {},
  stopPropagation() {},
  shiftKey: true,
  metaKey: false,
  ctrlKey: false,
});
await flush();
check(props.selected === "qa:0" && selections.at(-1)?.multi, "Home changed modifier selection");
check(
  container.scrollTop === 0 && documentState.activeElement === mounted.get("qa:0")?.button,
  "Home did not reveal missing original",
);
props = { ...props, selected: "qa:500", selectedIds: new Set(["qa:500"]) };
await flush();
check(
  mounted.has("qa:500") && documentState.activeElement === mounted.get("qa:500")?.button,
  "External selection failed to reveal/focus",
);
check(mounted.get("qa:500")?.node.props?.className === "is-active", "Active class missing");
(mounted.get("qa:500")!.node.props!.onClick as (e: unknown) => void)({
  shiftKey: false,
  metaKey: true,
  ctrlKey: false,
});
await flush();
check(selections.at(-1)?.id === "qa:500" && selections.at(-1)?.multi, "Meta click semantics lost");
const replacement = new Blob([Uint8Array.of(0xff, 0xd8, 0xff, 0xd8, 0x00)], { type: "image/jpeg" }),
  oldUrls = new Set(liveUrls.keys());
props = {
  ...props,
  photos: props.photos.map((p) => (p.id === "qa:500" ? { ...p, previewBlob: replacement } : p)),
};
await flush();
check([...liveUrls.values()].includes(replacement), "Replaced preview not adopted");
check(
  [...oldUrls].filter((url) => !liveUrls.has(url)).length === 1,
  "Source change leaked/revoked unrelated URLs",
);
width = 390;
height = 350;
resize?.();
await frame();
check(group.props?.["data-column-count"] === 2, "Responsive auto-fill columns wrong");
check(mounted.size <= (Math.ceil(height / 198) + 5) * 2 + 1, "Mobile grid unbounded");
const selectedStyle = mounted.get("qa:500")!.node.props!.style as { width: number; left: number };
check(
  selectedStyle.width === 174.5 && selectedStyle.left + selectedStyle.width <= width - 16,
  "Mobile card overflows its column",
);
check(liveUrls.size === mounted.size, "Resize leaked preview URLs");
check(
  (await verticalKey("ArrowDown")) && props.selected === "qa:502",
  "Vertical keyboard step did not follow responsive two-column layout",
);
props = {
  ...props,
  photos: props.photos.filter((p) => p.id !== "qa:500"),
  selected: "qa:501",
  selectedIds: new Set(["qa:501"]),
};
await flush();
check(
  mounted.has("qa:501") && documentState.activeElement === mounted.get("qa:501")?.button,
  "Filter removal stranded focus",
);
check(
  mounted.get("qa:501")?.node.props?.["aria-label"] === "501. Authored 501.jpg",
  "Filtered index is not logical",
);
props = { ...props, photos: [], selected: null, selectedIds: new Set() };
await flush();
check(!mounted.size && !liveUrls.size, "Empty filter retains thumbnails");
check(
  group.props?.tabIndex === 0 && group.props?.["data-photo-count"] === 0,
  "Empty grid inaccessible",
);
props = { ...props, photos, selected: "qa:999", selectedIds: new Set(["qa:999"]) };
await flush();
check(
  mounted.has("qa:999") && container.scrollTop > 0,
  "Offscreen initial selection did not reveal",
);
check(
  [...mounted.values()].every((v) =>
    nodes(v.thumb.tree).some((n) => n.type === "img" && n.props?.loading === "lazy"),
  ),
  "Mounted previews not lazy",
);
check(
  photos[0]?.sourceBlob === null && photos[500]?.previewBlob === original,
  "Grid changed saved source records",
);
(group.props!.onScroll as () => void)();
root.unmount();
for (const v of mounted.values()) {
  v.frame.unmount();
  v.thumb.unmount();
}
mounted.clear();
check(
  disconnected && !listeners.size && !rafs.size,
  "Unmount leaked scheduled work/resize listener",
);
check(!liveUrls.size, "Unmount leaked URLs");
console.log(JSON.stringify({ passed, remainingUrls: liveUrls.size }));
