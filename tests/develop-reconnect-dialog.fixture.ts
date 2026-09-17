// Actual component handlers with deterministic hook phases, no browser or persisted library.
import assert from "node:assert/strict";
import { mock } from "bun:test";
import * as React from "react";
import type { DevelopReconnectPlan } from "../src/lib/develop/reconnect-plan";
import type { DevelopReconnectOptions, DevelopReconnectReport } from "../src/lib/develop/reconnect";
import type { DevelopImportCommit, DevelopPhoto } from "../src/lib/develop/store";

type Slot = {
  value?: unknown;
  deps?: unknown[];
  cleanup?: () => void;
  setup?: () => (() => void) | void;
};
let runner: Runner;
class Runner {
  slots: Slot[] = [];
  cursor = 0;
  effects: (() => void)[] = [];
  tree: unknown;
  render(props: Parameters<typeof DevelopReconnectDialog>[0]) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Isolated hook dispatcher.
    runner = this;
    this.cursor = 0;
    this.tree = DevelopReconnectDialog(props);
    return this.tree;
  }
  commit() {
    const pending = this.effects;
    this.effects = [];
    pending.forEach((effect) => effect());
  }
  unmount() {
    this.slots.forEach((slot) => slot.cleanup?.());
  }
  replay() {
    this.slots.forEach((slot) => {
      if (slot.setup) {
        slot.cleanup?.();
        slot.cleanup = slot.setup() || undefined;
      }
    });
  }
}
const realReact = { ...React };
mock.module("react", () => ({
  ...realReact,
  useState(initial: unknown) {
    const owner = runner,
      index = owner.cursor++;
    owner.slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
    return [
      owner.slots[index]!.value,
      (next: unknown) => {
        owner.slots[index]!.value =
          typeof next === "function" ? next(owner.slots[index]!.value) : next;
      },
    ];
  },
  useRef(value: unknown) {
    const index = runner.cursor++;
    runner.slots[index] ??= { value: { current: value } };
    return runner.slots[index]!.value;
  },
  useMemo(factory: () => unknown, deps: unknown[]) {
    const index = runner.cursor++,
      previous = runner.slots[index];
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps?.[i])))
      runner.slots[index] = { value: factory(), deps };
    return runner.slots[index]!.value;
  },
  useId() {
    return `qa-reconnect-${runner.cursor++}`;
  },
  useLayoutEffect(setup: () => (() => void) | void, deps: unknown[]) {
    const owner = runner,
      index = owner.cursor++,
      previous = owner.slots[index];
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps?.[i])))
      owner.effects.push(() => {
        previous?.cleanup?.();
        owner.slots[index] = { deps, setup, cleanup: setup() || undefined };
      });
  },
}));
type PlanOptions = { namespace: string; signal?: AbortSignal };
let scan = async (
  _photos: readonly DevelopPhoto[],
  _files: readonly File[],
  _options: PlanOptions,
): Promise<DevelopReconnectPlan> => plan();
let execute = async (
  _plan: DevelopReconnectPlan,
  _ids: readonly string[],
  _options: DevelopReconnectOptions,
): Promise<DevelopReconnectReport> => report();
let renderNative = async (
  _file: Blob,
  _settings: unknown,
  _options: { edge?: number; sourceMode?: string; signal?: AbortSignal },
) => new Blob(["preview"]);
mock.module("../src/lib/develop/reconnect-plan", () => ({
  DEVELOP_RECONNECT_LIMITS: { maxFiles: 10000 },
  planDevelopReconnect: (...args: Parameters<typeof scan>) => scan(...args),
}));
mock.module("../src/lib/develop/reconnect", () => ({
  runDevelopReconnect: (...args: Parameters<typeof execute>) => execute(...args),
}));
mock.module("../src/lib/develop/client", () => ({
  developEngineStatus: async () => ({ ready: true, token: "test-token", rawSupported: true }),
  isHostedDevelopEngine: () => false,
  renderDevelop: (...args: Parameters<typeof renderNative>) => renderNative(...args),
}));
const { DevelopReconnectDialog } = await import("../src/components/develop/DevelopReconnectDialog");
const namespace = '["qa","reconnect"]';
const source = new File(["source"], "same.ARW");
function plan(count = 5): DevelopReconnectPlan {
  return {
    namespace,
    entries: Array.from({ length: count }, (_, index) => {
      const status =
        index === 1
          ? "unverified"
          : index === 2
            ? "ambiguous"
            : index === 3
              ? "mismatch"
              : index === 4
                ? "unmatched"
                : "verified";
      return {
        targetId: `photo-${index}`,
        targetName: `Photo ${index}`,
        sourceFileName: source.name,
        expectedSourceDigest: status === "unverified" ? null : "sha256:known",
        status,
        file: status === "verified" || status === "unverified" ? source : null,
        candidates: [
          { file: source, index, path: `folder-${index}/${source.name}`, sha256: "sha256:known" },
        ],
        reason: `Reason ${status}`,
        selectedByDefault: status === "verified",
      };
    }),
    skippedIds: ["already-attached"],
    warnings: [],
    cancelled: false,
    filesChecked: 2,
    totalFiles: 2,
  };
}
function report(partial: Partial<DevelopReconnectReport> = {}): DevelopReconnectReport {
  return {
    attached: [],
    receipt: { photos: [], documents: {} },
    failures: [],
    stopped: false,
    fatalError: null,
    selectedId: null,
    ...partial,
  };
}
type Element = { type?: unknown; props: Record<string, unknown> };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (node && typeof node === "object" && "props" in node)
    return text((node as Element).props.children);
  return "";
}
let checks = 0;
function check(value: unknown, message: string) {
  assert(value, message);
  checks++;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function mount() {
  const busy: boolean[] = [],
    receipts: DevelopImportCommit[] = [];
  let reads = 0;
  const props: Parameters<typeof DevelopReconnectDialog>[0] = {
    store: {
      namespace,
      loadLibrary: async () => {
        reads++;
        return { photos: [], documents: {}, presets: [] };
      },
    } as unknown as Parameters<typeof DevelopReconnectDialog>[0]["store"],
    onClose() {},
    onBusyChange: (value) => busy.push(value),
    onCommitted: (receipt) => receipts.push(receipt),
  };
  const ui = new Runner();
  function render() {
    ui.render(props);
    ui.commit();
    ui.render(props);
  }
  render();
  function find(predicate: (node: Element) => boolean) {
    const item = elements(ui.tree).find(predicate);
    assert(item, "Missing UI element");
    return item;
  }
  function button(label: string) {
    return find((node) => node.type === "button" && text(node) === label);
  }
  function click(label: string) {
    const item = button(label);
    assert(!item.props.disabled, `Disabled button ${label}`);
    (item.props.onClick as () => void)();
    render();
  }
  function choose(files: readonly File[]) {
    const input = find((node) => node.props["aria-label"] === "Reconnect original photos");
    (input.props.onChange as (event: unknown) => void)({
      currentTarget: { files, value: "selected" },
    });
    render();
  }
  return { ui, props, busy, receipts, readCount: () => reads, render, find, button, click, choose };
}

// First chooser event survives layout setup (including development StrictMode replay).
{
  const state = mount();
  state.ui.replay();
  state.render();
  let received: readonly File[] = [];
  scan = async (_photos, files, options) => {
    received = files;
    check(options.namespace === namespace, "Review is namespace-bound");
    const result = plan(337);
    result.entries[0]!.candidates[0]!.path = source.name;
    return result;
  };
  const duplicate = new File(["different"], source.name);
  state.choose([source, duplicate]);
  await tick();
  state.render();
  check(
    received.length === 2 && received[0] === source && received[1] === duplicate,
    "Equal filenames are not deduplicated",
  );
  check(state.busy.at(-1) === false, "First scan releases busy state");
  check(
    elements(state.ui.tree).filter((node) => node.props["data-match-status"]).length === 40,
    "337 matches render only40 rows",
  );
  const firstRow = state.find((node) => node.props["data-match-status"] === "verified");
  check(
    !elements(firstRow).some((node) => node.type === "p"),
    "Verified rows do not repeat a visible reason paragraph",
  );
  check(
    !elements(firstRow).some((node) => node.props.className === "develop-reconnect-path"),
    "Plain filenames are not repeated as folder paths",
  );
  const reason = elements(firstRow).find(
    (node) => node.props.className === "develop-reconnect-description",
  );
  check(
    reason &&
      text(reason) === "Reason verified" &&
      firstRow.props["aria-describedby"] === reason.props.id,
    "Full verified reason remains an accessible description",
  );
  check(
    elements(state.ui.tree).filter(
      (node) => node.props.className === "develop-reconnect-verification",
    ).length === 1,
    "Fingerprint and decode note is shared once",
  );
  check(
    elements(state.ui.tree).some(
      (node) =>
        node.props.className === "develop-reconnect-path" && text(node).startsWith("folder-"),
    ),
    "Actual folder paths remain visible",
  );
  const filter = state.find((node) => node.props["aria-label"] === "Reconnect match status");
  (filter.props.onChange as (event: unknown) => void)({ currentTarget: { value: "unverified" } });
  state.render();
  const checkbox = state.find((node) => node.props["aria-label"] === "Reconnect Photo 1");
  check(
    checkbox.props.checked === false && !checkbox.props.disabled,
    "Filename-only match is unchecked and selectable",
  );
  check(
    text(state.ui.tree).includes("previous identity cannot be verified"),
    "Unverified identity is explained",
  );
  (checkbox.props.onChange as (event: unknown) => void)({ currentTarget: { checked: true } });
  state.render();
  check(
    text(state.ui.tree).includes("explicitly attaching 1 filename-only"),
    "Explicit filename-only choice is disclosed before execution",
  );
  (filter.props.onChange as (event: unknown) => void)({ currentTarget: { value: "ambiguous" } });
  state.render();
  check(
    state.find((node) => node.props["aria-label"] === "Reconnect Photo 2").props.disabled,
    "Ambiguous match is nonselectable",
  );
  (filter.props.onChange as (event: unknown) => void)({ currentTarget: { value: "all" } });
  state.render();
  state.click("Next");
  check(text(state.ui.tree).includes("41–80 of 337"), "Next review page is reachable");
  state.click("Previous");
  check(text(state.ui.tree).includes("1–40 of 337"), "Previous review page is reachable");
  state.click("Select Verified");
  check(
    !text(state.ui.tree).includes("explicitly attaching"),
    "Select Verified excludes filename-only choices",
  );
  const before = state.readCount();
  state.choose(Array.from({ length: 10001 }, () => source));
  check(state.readCount() === before, "Oversized chooser rejected before library read");
  check(
    state.button("Reconnect Selected").props.disabled,
    "Oversized chooser invalidates old review",
  );
  state.ui.unmount();
}
// Cancelled scan may finish late; it cannot replace a newer review or release its busy lock.
{
  const first = deferred<DevelopReconnectPlan>(),
    second = deferred<DevelopReconnectPlan>();
  const signals: AbortSignal[] = [];
  scan = async (_photos, _files, options) => {
    signals.push(options.signal!);
    return signals.length === 1 ? first.promise : second.promise;
  };
  const state = mount();
  state.choose([source]);
  await tick();
  state.click("Cancel Scan");
  check(signals[0]!.aborted, "Cancel aborts hashing scan");
  check(
    text(state.ui.tree).includes("Nothing was changed"),
    "Cancelled scan truthfully reports no writes",
  );
  state.choose([source]);
  await tick();
  first.resolve(plan(337));
  await tick();
  state.render();
  check(
    state.busy.at(-1) === true && !text(state.ui.tree).includes("337 missing"),
    "Late result cannot replace new scan",
  );
  second.resolve(plan(1));
  await tick();
  state.render();
  check(text(state.ui.tree).includes("1 missing originals"), "Current scan adopts its own results");
  state.ui.unmount();
}
// Cancellation during an in-flight durable write still forwards the receipt before settling.
{
  scan = async () => plan(1);
  let options!: DevelopReconnectOptions;
  const pending = deferred<DevelopReconnectReport>();
  execute = async (_plan, ids, input) => {
    check(ids.length === 1 && ids[0] === "photo-0", "Only reviewed IDs submitted");
    options = input;
    return pending.promise;
  };
  const state = mount();
  state.choose([source]);
  await tick();
  state.render();
  state.click("Reconnect 1");
  check(state.busy.at(-1) === true, "Executor holds parent busy lock");
  state.click("Stop Reconnect");
  check(options.signal!.aborted, "Stop aborts sequential decode");
  check(state.button("Stopping…").props.disabled, "Stopping waits for in-flight receipt");
  let latestObserver = 0;
  state.props.onCommitted = (commit) => {
    latestObserver++;
    state.receipts.push(commit);
  };
  state.render();
  const receipt = { photos: [{ id: "photo-0" } as DevelopPhoto], documents: {} };
  await options.onCommitted!(receipt, {
    index: 1,
    total: 1,
    targetId: "photo-0",
    fileName: source.name,
  });
  state.render();
  check(
    state.receipts[0] === receipt,
    "Exact durable receipt forwarded immediately after cancellation",
  );
  check(
    latestObserver === 1,
    "Latest parent receipt callback is used without restarting execution",
  );
  check(
    text(state.ui.tree).includes("1 originals connected and saved"),
    "Partial durable count appears before completion",
  );
  check(state.busy.at(-1) === true, "Receipt does not release busy lock early");
  pending.resolve(report({ attached: receipt.photos, receipt, stopped: true }));
  await tick();
  state.render();
  check(state.busy.at(-1) === false, "Completion releases busy lock");
  check(
    text(state.ui.tree).includes("1 originals connected.") &&
      text(state.ui.tree).includes("Reconnect stopped."),
    "Stopped report retains actual durable count",
  );
  check(
    !text(state.ui.tree).includes("could not be connected"),
    "Cancellation does not invent failures",
  );
  state.ui.unmount();
}
// Store ownership and unmount protect unrelated libraries and late callback state.
{
  scan = async () => plan(1);
  let options!: DevelopReconnectOptions;
  const pending = deferred<DevelopReconnectReport>();
  execute = async (_plan, _ids, input) => {
    options = input;
    return pending.promise;
  };
  const state = mount();
  state.choose([source]);
  await tick();
  state.render();
  state.click("Reconnect 1");
  state.props.store = { ...state.props.store, namespace: '["qa","other"]' };
  state.render();
  check(options.signal!.aborted, "Store switch aborts old execution");
  await options.onCommitted!(
    { photos: [], documents: {} },
    { index: 1, total: 1, targetId: "old", fileName: "old" },
  );
  check(state.receipts.length === 0, "Old-library receipt never reaches new-library parent");
  pending.resolve(report());
  await tick();
  state.render();
  check(
    !text(state.ui.tree).includes("0 originals connected"),
    "Old completion cannot populate new dialog",
  );
  state.ui.unmount();
}
// Real decode callback uses neutral bounded preview, RAW fallback, and always releases bitmap.
{
  scan = async () => plan(1);
  let options!: DevelopReconnectOptions;
  const pending = deferred<DevelopReconnectReport>();
  execute = async (_plan, _ids, input) => {
    options = input;
    return pending.promise;
  };
  const state = mount();
  state.choose([source]);
  await tick();
  state.render();
  state.click("Reconnect 1");
  const calls: { edge?: number; sourceMode?: string; signal?: AbortSignal }[] = [];
  renderNative = async (_file, _settings, call) => {
    calls.push(call);
    if (calls.length === 1) throw new Error("Preview unavailable");
    // A real engine receipt is a JPEG; anything else is recoded through a canvas.
    return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "decoded"]);
  };
  let closed = 0;
  globalThis.createImageBitmap = (async () => ({
    width: 1600,
    height: 1000,
    close() {
      closed++;
    },
  })) as typeof createImageBitmap;
  const decoded = await options.decode(source, { isRaw: true } as DevelopPhoto, options.signal!);
  check(
    calls.length === 2 && calls.every((call) => call.edge === 1600),
    "Preview and fallback bounded at1600",
  );
  check(
    calls[0]!.sourceMode === undefined && calls[1]!.sourceMode === "raw",
    "RAW fallback only after preview fails",
  );
  check(
    decoded.previewOrigin === "raw-demosaic" && decoded.width === 1600 && closed === 1,
    "Decoded dimensions/provenance returned and bitmap closed",
  );
  const controller = new AbortController();
  renderNative = async () => new Blob(["preview"]);
  globalThis.createImageBitmap = (async () => {
    controller.abort();
    return {
      width: 1600,
      height: 1000,
      close() {
        closed++;
      },
    };
  }) as typeof createImageBitmap;
  await assert.rejects(
    options.decode(source, { isRaw: false } as DevelopPhoto, controller.signal),
    { name: "AbortError" },
  );
  checks++;
  check(closed === 2, "Bitmap released even cancellation after decode");
  state.ui.unmount();
  check(options.signal!.aborted, "Unmount aborts execution");
  pending.resolve(report({ stopped: true }));
  await tick();
  check(state.receipts.length === 0, "Unmount cannot publish late UI receipts");
}
process.stdout.write(JSON.stringify({ checks }));
