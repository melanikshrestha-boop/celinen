import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { clientState, newDelivery } from "../src/lib/delivery/workflow";
import { galleryDesignAttributes } from "../src/lib/delivery/gallery-presentation";

// Execute the actual component with local hook state; never mount account/storage
// effects or install global module mocks that can contaminate the combined suite.
const source = readFileSync(
  new URL("../src/components/delivery/DeliveryWorkspace.tsx", import.meta.url),
  "utf8",
);
const componentSource = source.slice(source.indexOf("function AccountDeliveryWorkspace("));
const stateNames = [...componentSource.matchAll(/const \[(\w+), [^\]]+\] = useState/g)].map(
  (match) => match[1]!,
);
const refNames = [...componentSource.matchAll(/const (\w+) = useRef/g)].map((match) => match[1]!);
type Element = { type: unknown; props: Record<string, unknown> };
const jsx = (
  type: unknown,
  props: Record<string, unknown> | null,
  ...children: unknown[]
): Element => ({ type, props: { ...props, children } });
function find(node: unknown, predicate: (element: Element) => boolean): Element | undefined {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return;
  }
  const element = node as Element;
  if (element.type === "Dialog" && !element.props.open) return;
  return predicate(element) ? element : find(element.props.children, predicate);
}
function fixture(
  options: {
    states?: Record<string, unknown>;
    refs?: Record<string, unknown>;
    href?: string;
    ownerId?: string | null;
    legacyResult?: unknown;
    localMode?: boolean;
  } = {},
) {
  let stateIndex = 0,
    refIndex = 0;
  const effects: Array<() => unknown> = [],
    navigations: unknown[] = [];
  const updates: Record<string, unknown> = {},
    legacyCalls: string[] = [];
  const legacyRead = async (mode: string) => {
    legacyCalls.push(mode);
    if (options.legacyResult instanceof Error) throw options.legacyResult;
    return options.legacyResult ?? [];
  };
  const context = {
    jsx,
    Fragment: "Fragment",
    clientState,
    crypto,
    useState: (initial: unknown) => {
      const name = stateNames[stateIndex++]!;
      const value = Object.hasOwn(options.states ?? {}, name)
        ? options.states![name]
        : typeof initial === "function"
          ? initial()
          : initial;
      return [
        value,
        (next: unknown) => {
          updates[name] = next;
        },
      ];
    },
    useRef: (initial: unknown) => ({ current: options.refs?.[refNames[refIndex++]!] ?? initial }),
    useEffect: (effect: () => unknown) => {
      effects.push(effect);
    },
    useCallback: (callback: unknown) => callback,
    useWorkbench: () => null,
    useToolLeaveGuard: () => {},
    useLocation: ({ select }: { select: (location: { href: string }) => unknown }) =>
      select({ href: options.href ?? "/deliver" }),
    useNavigate: () => async (target: unknown) => {
      navigations.push(target);
    },
    isLocalSingleUserMode: options.localMode ?? false,
    listGalleries: () => legacyRead("cloud"),
    listLocalDeliveryGalleries: () => legacyRead("local"),
    messageOf: (error: Error) => error.message,
    dateValue: () => "2026-10-01",
    galleryPresentation: () => ({ studioName: "Synthetic", showLensLabsCredit: false }),
    galleryDesignAttributes,
    ...Object.fromEntries(
      [...componentSource.matchAll(/<([A-Z][A-Za-z]+)/g)].map((match) => [match[1], match[1]]),
    ),
  };
  const body = new Bun.Transpiler({
    loader: "tsx",
    tsconfig: {
      compilerOptions: { jsx: "react", jsxFactory: "jsx", jsxFragmentFactory: "Fragment" },
    },
  }).transformSync(componentSource);
  const component = new Function(
    ...Object.keys(context),
    body + "\nreturn AccountDeliveryWorkspace;",
  )(...Object.values(context));
  const tree = component({ ownerId: options.ownerId ?? null, ensureIdentity: () => {} }) as Element;
  return {
    tree,
    navigations,
    updates,
    legacyCalls,
    runLegacyCheck: async () => {
      effects.find((item) => /legacyChecked/.test(item.toString()))?.();
      await Promise.resolve();
      await Promise.resolve();
    },
    runRedirect: async () => {
      // The narrow navigation effect is isolated from real gallery/account I/O.
      const effect = effects.find((item) => /returnToChat/.test(item.toString()));
      await effect?.();
      await Promise.resolve();
    },
  };
}
const loaded = { draftsLoaded: true, summariesLoaded: true, legacyChecked: true };
const label = (node: Element, text: string) =>
  node.props.children instanceof Array && node.props.children.includes(text);

describe("Delivery without an open gallery", () => {
  test("confirmed empty unscoped delivery returns to Chat without the promotional shell", async () => {
    for (const ownerId of [null, "synthetic-owner"]) {
      const f = fixture({ states: loaded, ownerId });
      await f.runRedirect();
      expect(f.navigations).toEqual([
        { to: "/dashboard", search: { view: undefined }, replace: true },
      ]);
      expect(find(f.tree, (node) => node.props.className === "delivery-workspace")).toBeUndefined();
      expect(JSON.stringify(f.tree)).not.toContain("A thoughtful handoff");
      expect(JSON.stringify(f.tree)).not.toContain("Create your first gallery");
    }
  });

  test("loading, unavailable cloud and failed lists never redirect as if saved galleries were empty", async () => {
    for (const states of [
      {},
      { draftsLoaded: true, ready: true },
      { draftsLoaded: true, setupNote: "Private delivery is unavailable." },
      { ...loaded, error: "Synthetic gallery read failed" },
    ]) {
      const f = fixture({ states, ownerId: "synthetic-owner" });
      await f.runRedirect();
      expect(f.navigations).toEqual([]);
      expect(JSON.stringify(f.tree)).not.toContain("A thoughtful handoff");
      expect(
        find(f.tree, (node) => node.type === "Link" && node.props.to === "/dashboard"),
      ).toBeDefined();
      if ("error" in states) expect(JSON.stringify(f.tree)).toContain(states.error);
    }
  });

  test("legacy-only galleries keep their Saved galleries entry and never redirect", async () => {
    const f = fixture({ states: { ...loaded, legacyCount: 1 } });
    await f.runRedirect();
    expect(f.navigations).toEqual([]);
    expect(
      find(f.tree, (node) => node.type === "Link" && node.props.to === "/deliver")?.props.search,
    ).toEqual({ legacy: "1" });
    expect(find(f.tree, (node) => node.props.className === "delivery-workspace")).toBeUndefined();
    const unchecked = fixture({ states: { ...loaded, legacyChecked: false } });
    await unchecked.runRedirect();
    expect(unchecked.navigations).toEqual([]);
  });

  test("legacy reads are lazy, mode-correct and never acknowledge a failed check", async () => {
    for (const localMode of [false, true]) {
      const f = fixture({
        states: { ...loaded, legacyChecked: false },
        ownerId: "synthetic-owner",
        localMode,
      });
      await f.runLegacyCheck();
      expect(f.legacyCalls).toEqual([localMode ? "local" : "cloud"]);
      expect(f.updates).toEqual({ legacyCount: 0, legacyChecked: true });
    }
    for (const states of [
      {},
      {
        ...loaded,
        summaries: [{ id: "saved", title: "Saved", clientName: "Synthetic", status: "draft" }],
      },
      { ...loaded, legacyChecked: false, error: "Prior error" },
    ]) {
      const f = fixture({ states, ownerId: "synthetic-owner" });
      await f.runLegacyCheck();
      expect(f.legacyCalls).toEqual([]);
    }
    const failed = fixture({
      states: { ...loaded, legacyChecked: false },
      ownerId: "synthetic-owner",
      legacyResult: new Error("Synthetic old-gallery read failed"),
    });
    await failed.runLegacyCheck();
    expect(failed.updates.legacyChecked).toBeUndefined();
    expect(failed.updates.error).toBe("Synthetic old-gallery read failed");
  });

  test("explicit and unknown references, an opening gallery, and unsaved creation never redirect", async () => {
    for (const href of [
      "/deliver?gallery=exact",
      "/deliver?shoot=exact",
      "/deliver?frame=exact&version=v1",
      "/deliver?workspaceProject=exact",
      "/deliver?unknown=preserve",
      "/deliver#exact",
    ]) {
      const f = fixture({ states: loaded, href });
      await f.runRedirect();
      expect(f.navigations).toEqual([]);
    }
    for (const states of [
      { newOpen: true },
      { busy: true },
      { preparing: "Preparing" },
      { newFormDirty: true },
      { unsentFeedback: true },
    ]) {
      const f = fixture({ states: { ...loaded, ...states } });
      await f.runRedirect();
      expect(f.navigations).toEqual([]);
    }
    const opening = fixture({ states: loaded, refs: { activeId: "opening-gallery" } });
    await opening.runRedirect();
    expect(opening.navigations).toEqual([]);
  });

  test("saved galleries remain selectable and their exact room workflow still renders", async () => {
    const summary = {
      id: "saved-gallery",
      title: "Saved gallery",
      clientName: "Synthetic client",
      status: "draft",
    };
    const f = fixture({ states: { ...loaded, summaries: [summary] } });
    await f.runRedirect();
    expect(f.navigations).toEqual([]);
    expect(
      find(f.tree, (node) => node.type === "strong" && label(node, summary.title)),
    ).toBeDefined();
    expect(
      find(f.tree, (node) => node.props.className === "delivery-room-link")?.props.onClick,
    ).toBeFunction();
    expect(JSON.stringify(f.tree)).not.toContain("A thoughtful handoff");
    const state = newDelivery(
      {
        id: crypto.randomUUID(),
        title: "Exact gallery",
        clientName: "Synthetic",
        message: "",
        selectionLimit: 12,
        expiresAt: "2026-10-01T00:00:00Z",
      },
      "2026-09-01T00:00:00Z",
    );
    const room = { id: state.id, revision: 7, state };
    const opened = fixture({ states: { ...loaded, room, summaries: [summary] } });
    await opened.runRedirect();
    expect(opened.navigations).toEqual([]);
    const gallery = find(opened.tree, (node) => node.type === "DeliveryGallery")!;
    expect(gallery.props.room).toBe(room);
    expect(gallery.props.onStudio).toBeFunction();
    expect(gallery.props.run).toBeFunction();
  });
});

test("legacy gallery read failure is not an authoritative empty list", async () => {
  const source = readFileSync(new URL("../src/lib/delivery.functions.ts", import.meta.url), "utf8");
  const handlerSource = source
    .slice(
      source.indexOf("export const listGalleries"),
      source.indexOf("export const createGallery"),
    )
    .replace("export const", "const");
  const middleware = {};
  const list = new Function(
    "createServerFn",
    "requireSupabaseAuth",
    new Bun.Transpiler({ loader: "ts" }).transformSync(handlerSource) + "\nreturn listGalleries;",
  )(
    () => ({
      middleware: (value: unknown[]) => {
        expect(value).toEqual([middleware]);
        return { handler: (callback: unknown) => callback };
      },
    }),
    middleware,
  );
  for (const failure of ["Synthetic database unavailable", "Synthetic account read denied"]) {
    const calls: string[] = [];
    const result = list({
      context: {
        supabase: {
          from: (table: string) => {
            calls.push(table);
            return {
              select: (columns: string) => {
                expect(columns).toBe("*");
                return { order: async () => ({ data: null, error: { message: failure } }) };
              },
            };
          },
        },
      },
    });
    await expect(result).rejects.toThrow(failure);
    expect(calls).toEqual(["galleries"]);
  }
  await expect(
    list({
      context: {
        supabase: {
          from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }),
        },
      },
    }),
  ).resolves.toEqual([]);
});
