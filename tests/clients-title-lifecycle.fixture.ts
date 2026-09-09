// Execute the real ClientsSheet in an isolated dependency-aware hook harness.
// No browser, storage writes, or global mocks escape this child process.
import { mock } from "bun:test";
import * as React from "react";
import { emptyClientWorkspace, type WorkspaceClient } from "../src/lib/client-workspace";

const actualReact = { ...React };
type EffectSlot = { dependencies: readonly unknown[] | undefined; cleanup?: unknown };
let slots: unknown[] = [];
let cursor = 0;
let effects: Array<() => void> = [];
let scheduled = false;
let href = "/clients";
let contextPresent = true;
let sequence = 0;
const titles: Array<[string, string]> = [];
let setter = (path: string, title: string) => {
  titles.push([path, title]);
  scheduled = true;
};
const same = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
  a !== undefined &&
  b !== undefined &&
  a.length === b.length &&
  a.every((item, index) => Object.is(item, b[index]));

mock.module("react", () => ({
  ...actualReact,
  useState<T>(initial: T | (() => T)) {
    const index = cursor++;
    if (!(index in slots))
      slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
    return [
      slots[index],
      (next: T | ((old: T) => T)) => {
        const value =
          typeof next === "function" ? (next as (old: T) => T)(slots[index] as T) : next;
        if (!Object.is(slots[index], value)) {
          slots[index] = value;
          scheduled = true;
        }
      },
    ];
  },
  useRef<T>(initial: T) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  },
  useMemo<T>(factory: () => T, dependencies: readonly unknown[]) {
    const index = cursor++;
    const old = slots[index] as { dependencies: readonly unknown[]; value: T } | undefined;
    if (!old || !same(old.dependencies, dependencies))
      slots[index] = { dependencies, value: factory() };
    return (slots[index] as { value: T }).value;
  },
  useEffect(effect: () => unknown, dependencies?: readonly unknown[]) {
    const index = cursor++;
    const previous = slots[index] as EffectSlot | undefined;
    if (previous && same(previous.dependencies, dependencies)) return;
    effects.push(() => {
      if (typeof previous?.cleanup === "function") previous.cleanup();
      slots[index] = { dependencies, cleanup: effect() };
    });
  },
}));
mock.module("@tanstack/react-router", () => ({ useRouterState: () => href }));
mock.module("../src/components/workbench/context", () => ({
  useWorkbench: () =>
    contextPresent ? { setToolTitle: setter, unrelatedRevision: sequence++ } : null,
}));
mock.module("../src/components/workbench/useToolLeaveGuard", () => ({ useToolLeaveGuard() {} }));
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { addEventListener() {}, removeEventListener() {} },
});
const { ClientsSheet } = await import("../src/components/clients/ClientsSheet");
const client: WorkspaceClient = {
  id: "lifecycle-client",
  name: "Sam Rivera",
  org: "Studio",
  email: "sam@example.test",
  phone: "",
  source: "",
  brief: "",
  followUpOn: null,
  budgetCents: null,
  stage: "new",
  bookings: [],
  galleryIds: [],
  invoiceIds: [],
  createdAt: "2026-09-08T12:00:00Z",
  updatedAt: "2026-09-08T12:00:00Z",
};
let props: Parameters<typeof ClientsSheet>[0] = {
  state: { ...emptyClientWorkspace(), clients: [client] },
  ready: true,
  error: null,
  cloud: false,
  onSave: async () => {
    throw new Error("No CRM writes are expected during title lifecycle");
  },
};
type Node = { type?: unknown; props?: Record<string, unknown> };
let tree: unknown;
function find(node: unknown, predicate: (node: Node) => boolean): Node | null {
  if (!node || typeof node !== "object") return null;
  if (!Array.isArray(node) && predicate(node as Node)) return node as Node;
  const children = Array.isArray(node) ? node : [(node as Node).props?.["children"]];
  for (const child of children) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return null;
}
function render() {
  cursor = 0;
  effects = [];
  scheduled = false;
  tree = ClientsSheet(props);
  for (const effect of effects) effect();
}
function settle() {
  for (let n = 0; n < 25; n++) {
    render();
    if (!scheduled) return n + 1;
  }
  throw new Error("Title feedback did not settle after 25 context-identity changes");
}
function equal(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(label + ": " + JSON.stringify(actual));
}
try {
  equal(settle(), 2, "Initial title must settle after one parent title update");
  equal(titles, [["/clients", "Clients"]], "One initial write");
  for (let n = 0; n < 100; n++) {
    props = { ...props, state: structuredClone(props.state) };
    equal(settle(), 1, "Unrelated context and client object changes must not rewrite title");
  }
  const people = find(
    tree,
    (node) => typeof node.type === "function" && node.type.name === "ClientPeople",
  );
  if (!people) throw new Error("Real people view missing");
  (people.props!["onOpen"] as (client: WorkspaceClient) => void)(client);
  equal(settle(), 2, "Opening actual contact updates title once");
  equal(titles.at(-1), ["/clients", "Sam Rivera"], "Contact title");
  for (let n = 0; n < 100; n++) {
    props = { ...props, state: structuredClone(props.state) };
    equal(settle(), 1, "Opened row object identity must not rewrite unchanged name");
  }
  equal(titles.length, 2, "No idle title writes");
  props = { ...props, state: { ...props.state, clients: [{ ...client, name: "Renamed client" }] } };
  equal(settle(), 2, "A real client rename still updates title");
  equal(titles.at(-1), ["/clients", "Renamed client"], "Updated name");
  href = "/clients?view=contact";
  equal(settle(), 2, "Actual route changes still update the matching tab");
  equal(titles.at(-1), [href, "Renamed client"], "Updated href");
  contextPresent = false;
  equal(settle(), 1, "Missing workbench is safe");
  contextPresent = true;
  equal(settle(), 2, "Workbench reappearance receives its title");
  setter = (path, title) => {
    titles.push([path, title]);
    scheduled = true;
  };
  equal(settle(), 2, "Replacement setter receives current title");
  const back = find(
    tree,
    (node) => node.type === "button" && node.props?.["className"] === "clients-back",
  );
  if (!back) throw new Error("Client detail navigation missing");
  (back.props!["onClick"] as () => void)();
  equal(settle(), 2, "Returning to contacts restores base title once");
  equal(titles.at(-1), [href, "Clients"], "Restored list title");
  process.stdout.write(
    JSON.stringify({ contextChurnRenders: 200, titleWrites: titles.length, settled: true }),
  );
} finally {
  for (const slot of slots)
    if (slot && typeof slot === "object" && "cleanup" in slot && typeof slot.cleanup === "function")
      slot.cleanup();
  slots = [];
}
