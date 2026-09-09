// Isolated actual React component handler harness; no browser, account or ledger writes.
import { mock } from "bun:test";
import * as React from "react";
import type { EarningsCharts as Model } from "../src/lib/earnings-charts";
const original = { ...React };
const slots: unknown[] = [];
let cursor = 0,
  disconnected = 0;
const pending: (() => (() => void) | void)[] = [],
  cleanups: (() => void)[] = [];
let resize: ResizeObserverCallback | null = null;
mock.module("react", () => ({
  ...original,
  useId: () => "panel-fixture",
  useRef(initial: unknown) {
    const i = cursor++;
    return (slots[i] ??= { current: initial });
  },
  useState(initial: unknown) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = initial;
    return [
      slots[i],
      (next: unknown) => {
        slots[i] = next;
      },
    ];
  },
  useEffect(effect: () => (() => void) | void) {
    const i = cursor++;
    if (!(i in slots)) {
      slots[i] = true;
      pending.push(effect);
    }
  },
}));
globalThis.ResizeObserver = class {
  constructor(callback: ResizeObserverCallback) {
    resize = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {
    disconnected++;
  }
} as unknown as typeof ResizeObserver;
const dom = { activeElement: null as unknown };
Object.defineProperty(globalThis, "document", { value: dom, configurable: true });
const { EarningsCharts } = await import("../src/components/earnings/EarningsCharts");
type Node = { type?: unknown; props?: Record<string, unknown> };
function children(node: unknown): unknown[] {
  return Array.isArray(node)
    ? node
    : node && typeof node === "object"
      ? [(node as Node).props?.children]
      : [];
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
const text = (node: unknown): string =>
  typeof node === "string" || typeof node === "number"
    ? String(node)
    : children(node).map(text).join("");
let checks = 0;
function check(ok: unknown, message: string) {
  if (!ok) throw new Error(message);
  checks++;
}
const value: Model = {
  currency: "USD",
  complete: true,
  granularity: "day",
  months: [],
  points: [
    {
      date: "2026-09-01",
      collectedMinor: 10001,
      expensesMinor: 0,
      netMinor: 10001,
      refundsMinor: 0,
    },
    {
      date: "2026-09-02",
      collectedMinor: -4023,
      expensesMinor: 1000,
      netMinor: -5023,
      refundsMinor: 4023,
    },
  ],
  totals: {
    collectedMinor: 5978,
    expensesMinor: 1000,
    netMinor: 4978,
    refundsMinor: 4023,
    positiveCollectionsMinor: 10001,
    positiveExpensesMinor: 1000,
    collectionAdjustmentsMinor: 0,
    expenseAdjustmentsMinor: 0,
  },
  incomeCategories: [],
  expenseCategories: [],
  hasActivity: true,
  omittedEmptyMonths: 0,
  omittedEmptyPoints: 0,
};
const before = JSON.stringify(value);
const top = EarningsCharts({ model: value, scopeLabel: "Fixture" });
const component = find(
  top,
  (node) =>
    typeof node.type === "function" && (node.props?.series as { key?: string })?.key === "netMinor",
)!;
let props = component.props!;
let tree: unknown;
const svgDom = { getBoundingClientRect: () => ({ left: 100, width: 280 }) };
function render() {
  cursor = 0;
  tree = (component.type as (props: unknown) => unknown)(props);
  const host = find(tree, (node) => node.props?.className === "earnings-plot-wrap")!;
  (host.props!.ref as { current: unknown }).current = { querySelector: () => svgDom };
  for (const effect of pending.splice(0)) {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  }
}
function svg() {
  return find(tree, (node) => node.type === "svg")!;
}
function invoke(name: string, event?: unknown) {
  (svg().props![name] as (event?: unknown) => void)(event);
  render();
}
function readout() {
  return text(find(tree, (node) => node.props?.className === "earnings-chart-legend"));
}
let prevented = 0;
function key(key: string) {
  invoke("onKeyDown", { key, preventDefault: () => prevented++ });
}
render();
check(readout().includes("$49.78Selected period"), "Initial canonical period total changed");
key("ArrowRight");
check(readout().includes("$100.01Sep 1, 2026"), "Right did not select first exact amount");
key("End");
check(readout().includes("-$50.23Sep 2, 2026"), "End lost exact negative amount");
check(
  text(find(tree, (node) => node.props?.className === "earnings-chart-tooltip")).includes(
    "-$50.23",
  ),
  "Tooltip differs from exact selected amount",
);
key("ArrowRight");
check(readout().includes("Sep 2"), "Last point was not clamped");
key("Home");
check(readout().includes("Sep 1"), "Home failed");
key("Escape");
check(readout().includes("Selected period"), "Escape did not restore period");
const beforeTab = prevented;
key("Tab");
check(prevented === beforeTab, "Unrelated Tab key was prevented");
invoke("onPointerMove", { clientX: 126, currentTarget: svgDom });
check(readout().includes("Sep 1"), "Scaled SVG pointer mapping failed first point");
invoke("onPointerMove", { clientX: 374, currentTarget: svgDom });
check(readout().includes("Sep 2"), "Scaled SVG pointer mapping failed last point");
invoke("onPointerMove", { clientX: -1000, currentTarget: svgDom });
check(readout().includes("Sep 1"), "Left pointer not clamped");
invoke("onPointerMove", { clientX: Number.NaN, currentTarget: svgDom });
check(readout().includes("Sep 1"), "Invalid pointer changed selection");
invoke("onPointerDown", {
  clientX: 374,
  currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 0 }) },
});
check(readout().includes("Sep 1"), "Hidden zero-width graph accepted input");
dom.activeElement = svgDom;
invoke("onPointerLeave");
check(readout().includes("Sep 1"), "Pointer leave removed keyboard focus selection");
dom.activeElement = null;
invoke("onPointerLeave");
check(readout().includes("Selected period"), "Unfocused leave retained tooltip");
key("End");
invoke("onBlur");
check(readout().includes("Selected period"), "Blur retained stale tooltip");
key("End");
props = { ...props, model: { ...value, points: [value.points[0]!] } };
render();
check(
  readout().includes("Selected period"),
  "Removed date selected a different date by stale index",
);
key("Home");
key("End");
check(readout().includes("Sep 1"), "One point keyboard selection failed");
const resizeCallback = resize as unknown as ResizeObserverCallback;
resizeCallback([{ contentRect: { width: 0 } } as ResizeObserverEntry], {} as ResizeObserver);
render();
check(svg().props?.viewBox === "0 0 560 180", "Hidden measurement changed width");
resizeCallback([{ contentRect: { width: 320 } } as ResizeObserverEntry], {} as ResizeObserver);
render();
check(svg().props?.viewBox === "0 0 320 180", "Responsive width was not adopted");
for (const cleanup of cleanups) cleanup();
check(disconnected === 1, "ResizeObserver leaked");
check(JSON.stringify(value) === before, "Chart interaction mutated canonical input");
console.log(`EARNINGS_PANEL_HANDLERS_OK ${checks}`);
