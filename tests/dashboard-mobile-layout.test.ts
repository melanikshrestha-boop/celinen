import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse, type Rule } from "postcss";

// Execute the real shell with instance-local hooks and synthetic preferences.
// No global module mocks, browser, account storage, or dashboard chat effects.
const source = readFileSync(
  new URL("../src/components/dashboard/AppDashboard.tsx", import.meta.url),
  "utf8",
);
const css = parse(
  readFileSync(new URL("../src/components/dashboard/dashboard.css", import.meta.url), "utf8"),
);
type Element = { type: unknown; props: Record<string, unknown> };
const jsx = (type: unknown, props: Element["props"] | null, ...children: unknown[]): Element => ({
  type,
  props: { ...props, children },
});
function find(node: unknown, predicate: (element: Element) => boolean): Element | undefined {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) {
      const result = find(child, predicate);
      if (result) return result;
    }
    return;
  }
  const element = node as Element;
  return predicate(element) ? element : find(element.props?.children, predicate);
}

function shell(mode: "open" | "mini" | null, width = 248) {
  const storage = new Map([
    ["celinen.dashboard.rail.width.v1", String(width)],
    ...(mode ? [["celinen.dashboard.rail.v1", mode] as [string, string]] : []),
  ]);
  const writes: Array<[string, string]> = [];
  const states: unknown[] = [];
  const listeners = new Map<string, (event: unknown) => void>();
  let effects: Array<() => void> = [];
  let cursor = 0;
  let mobile = false;
  const navigations: unknown[] = [];
  const imports: Array<{ options: unknown; input: unknown; kind: string }> = [];
  const context = {
    jsx,
    Fragment: "Fragment",
    useAccount: () => ({ status: "in", scope: "synthetic-owner", preferences: { theme: "light" } }),
    useIsMobile: () => mobile,
    useNavigate: () => (target: unknown) => {
      navigations.push(target);
    },
    getDevelopImportSession: (options: unknown) => ({
      startFiles: (input: unknown) => {
        imports.push({ options, input, kind: "files" });
        return Promise.resolve();
      },
      startDrop: (input: unknown) => {
        imports.push({ options, input, kind: "drop" });
        return Promise.resolve();
      },
    }),
    supportedPhoto: (file: File) => /\.(jpg|arw)$/i.test(file.name),
    isPostIntent: () => false,
    destinationPathFor: () => "/deliver",
    crypto,
    dashboardGreetingFor: () => "Hello",
    DropdownMenu: "DropdownMenu",
    DropdownMenuTrigger: "DropdownMenuTrigger",
    DropdownMenuContent: "DropdownMenuContent",
    DropdownMenuItem: "DropdownMenuItem",
    VoiceMic: "VoiceMic",
    Plus: "Plus",
    ArrowUp: "ArrowUp",
    useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
      select({ location: { searchStr: "", pathname: "/earnings" } }),
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], (value: unknown) => (states[index] = value)];
    },
    useRef: (initial: unknown) => {
      const index = cursor++;
      if (!(index in states)) states[index] = { current: initial };
      return states[index];
    },
    useEffect: (effect: () => unknown, dependencies: unknown[]) => {
      const index = cursor++;
      const previous = states[index] as { dependencies: unknown[]; cleanup: unknown } | undefined;
      if (previous && dependencies.every((item, i) => Object.is(item, previous.dependencies[i])))
        return;
      effects.push(() => {
        if (typeof previous?.cleanup === "function") previous.cleanup();
        states[index] = { dependencies, cleanup: effect() };
      });
    },
    window: {
      setTimeout: (callback: () => void) => callback(),
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        writes.push([key, value]);
        storage.set(key, value);
      },
    },
    DashboardContext: { Provider: "DashboardContext" },
    Link: "Link",
    LogoMark: "LogoMark",
    AccountMenu: "AccountMenu",
    SocialDock: "SocialDock",
    PRODUCT_NAME: "Synthetic dashboard",
    onHapticPress: () => {},
    ...Object.fromEntries(
      [
        "Aperture",
        "Images",
        "CalendarDays",
        "Share2",
        "House",
        "SlidersHorizontal",
        "ChartNoAxesColumn",
        "Wrench",
        "Sparkles",
        "PanelLeft",
        "Sun",
        "Moon",
      ].map((name) => [name, name]),
    ),
  };
  const transpiler = new Bun.Transpiler({
    loader: "tsx",
    tsconfig: {
      compilerOptions: { jsx: "react", jsxFactory: "jsx", jsxFragmentFactory: "Fragment" },
    },
  });
  const code = source.slice(source.indexOf("const HOME_ACTIONS")).replace(/^export /gm, "");
  const component = new Function(
    ...Object.keys(context),
    transpiler.transformSync(`${code}\nreturn AppDashboard;`),
  )(...Object.values(context)) as (props: { children: Element }) => Element;
  return {
    writes,
    listeners,
    imports,
    navigations,
    render(narrow: boolean, home = false) {
      cursor = 0;
      effects = [];
      mobile = narrow;
      const tree = component({
        children: home ? undefined : jsx("SyntheticEarnings", {}),
      } as never);
      effects.forEach((effect) => effect());
      return tree;
    },
  };
}
test("dashboard plus opens attachment choices, never restores the old shoot", () => {
  const app = shell("open");
  const tree = app.render(false, true);
  const plus = find(tree, (node) => node.props["aria-label"] === "Add photos or folder")!;
  expect(plus).toBeTruthy();
  expect(plus.props.onClick).toBeUndefined();
  expect(
    find(tree, (node) => node.props["aria-label"] === "Choose photo folder")?.props.webkitdirectory,
  ).toBe("");
  expect(app.navigations).toEqual([]);
  expect(app.imports).toEqual([]);
});

test("Send a gallery opens the Chat folder picker synchronously without leaving Chat", () => {
  const app = shell("open");
  const tree = app.render(false, true);
  const action = find(
    tree,
    (node) =>
      node.props.className === "social-post__action" &&
      JSON.stringify(node.props.children).includes("Send a gallery"),
  )!;
  expect(action.type).toBe("button");
  expect(action.props.type).toBe("button");
  const picker = find(tree, (node) => node.props["aria-label"] === "Choose photo folder")!;
  let opened = 0;
  (picker.props.ref as { current: unknown }).current = { click: () => opened++ };
  (action.props.onClick as () => void)();
  expect(opened).toBe(1);
  expect(app.navigations).toEqual([]);
  expect(app.imports).toEqual([]);
  (picker.props.onChange as (event: unknown) => void)({ currentTarget: { files: [], value: "" } });
  expect(app.navigations).toEqual([]);
  expect(app.writes).toEqual([]);
});

test("asking Chat to send a gallery opens the same picker, not an empty Deliver desk", () => {
  const app = shell("open");
  const tree = app.render(false, true);
  const picker = find(tree, (node) => node.props["aria-label"] === "Choose photo folder")!;
  let opened = 0;
  (picker.props.ref as { current: unknown }).current = { click: () => opened++ };
  const voice = find(tree, (node) => node.type === "VoiceMic")!;
  (voice.props.onSend as (text: string) => void)("Send a gallery");
  expect(opened).toBe(1);
  expect(app.navigations).toEqual([]);
  expect(app.imports).toEqual([]);
  expect(app.writes).toHaveLength(1);
  expect(app.writes[0]?.[0]).toBe("celinen.dashboard.chat.v1:synthetic-owner");
});

test("browsing an existing gallery remains available from Chat", () => {
  const app = shell("open");
  const tree = app.render(false, true);
  const voice = find(tree, (node) => node.type === "VoiceMic")!;
  (voice.props.onSend as (text: string) => void)("Open gallery");
  expect(app.navigations).toEqual([{ to: "/deliver" }]);
  expect(app.imports).toEqual([]);
});

test("Chat's folder picker starts the shared import only after files are selected", () => {
  const app = shell("open");
  const tree = app.render(false, true);
  const picker = find(tree, (node) => node.props["aria-label"] === "Choose photo folder")!;
  const files = [
    new File(["synthetic JPEG"], "frame.jpg"),
    new File(["synthetic RAW"], "frame.arw"),
  ];
  const target = { files, value: "Synthetic folder" };
  (picker.props.onChange as (event: unknown) => void)({ currentTarget: target });
  expect(app.imports).toHaveLength(1);
  expect(app.imports[0]?.input).toEqual(files);
  expect(target.value).toBe("");
  const options = app.imports[0]?.options as { scope: string; libraryId: string };
  expect(options.scope).toBe("synthetic-owner");
  expect(options.libraryId).toMatch(/^shoot:[a-f0-9-]{36}$/);
  expect(app.navigations).toEqual([
    { to: "/studio", search: { shoot: options.libraryId.slice(6) } },
  ]);
  expect(app.writes).toEqual([]);
});

test("picker cancel stays home; actual photos start a fresh owner-scoped import", async () => {
  const app = shell("open");
  const tree = app.render(false, true);
  const picker = find(tree, (node) => node.props["aria-label"] === "Choose photos")!;
  const change = picker.props.onChange as (event: unknown) => void;
  change({ currentTarget: { files: [], value: "" } });
  expect(app.navigations).toEqual([]);
  const file = new File(["synthetic"], "frame.jpg");
  const target = { files: [file], value: "frame.jpg" };
  change({ currentTarget: target });
  expect(target.value).toBe("");
  expect(app.imports[0]?.input).toEqual([file]);
  const options = app.imports[0]?.options as { scope: string; libraryId: string };
  expect(options.scope).toBe("synthetic-owner");
  expect(options.libraryId).toMatch(/^shoot:[a-f0-9-]{36}$/);
  expect(app.navigations).toEqual([
    { to: "/studio", search: { shoot: options.libraryId.slice(6) } },
  ]);
  await Promise.resolve();
});

test("drop captures handles before navigating and does not write old library storage", () => {
  const app = shell("open");
  const tree = app.render(false, true);
  const drop = find(tree, (node) => typeof node.props.onDrop === "function")!;
  const transfer = { types: ["Files"] };
  let prevented = false;
  (drop.props.onDrop as (event: unknown) => void)({
    dataTransfer: transfer,
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {},
  });
  expect(prevented).toBe(true);
  expect(app.imports[0]?.kind).toBe("drop");
  expect(app.imports[0]?.input).toBe(transfer);
  expect(app.navigations).toHaveLength(1);
  expect(app.writes).toEqual([]);
});
function dashboard(tree: Element) {
  return find(tree, (node) => String(node.props.className).startsWith("celinen-dash"))!;
}
function mobileRule(selector: string): Rule | undefined {
  let result: Rule | undefined;
  css.walkAtRules("media", (media) => {
    if (media.params !== "(max-width: 767px)") return;
    media.walkRules((rule) => {
      if (rule.selectors.includes(selector)) result = rule;
    });
  });
  return result;
}
function declaration(rule: Rule | undefined, property: string) {
  let value: string | undefined;
  rule?.walkDecls(property, (decl) => {
    value = decl.value;
  });
  return value;
}

describe("dashboard mobile shell keeps tool space without changing desktop preferences", () => {
  test.each([null, "open", "mini"] as const)(
    "narrow shell is a named compact rail for saved mode %s",
    (mode) => {
      const fixture = shell(mode);
      const tree = fixture.render(true);
      expect(dashboard(tree).props.className).toContain("is-mini");
      expect(dashboard(tree).props.style).toEqual({ "--rail": "60px" });
      expect(find(tree, (node) => node.props["aria-label"] === "Resize sidebar")).toBeUndefined();
      expect(find(tree, (node) => node.props["aria-label"] === "Expand sidebar")).toBeUndefined();
      expect(
        find(
          tree,
          (node) =>
            node.props["aria-label"] === "Chat" && node.props.className === "celinen-dash__brand",
        )?.props.to,
      ).toBe("/dashboard");
      for (const label of [
        "Chat",
        "Galleries",
        "Develop",
        "Calendar",
        "Analytics",
        "Social accounts",
        "Tools",
        "Upgrade",
      ])
        expect(
          find(
            tree,
            (node) =>
              String(node.props.className).includes("celinen-dash__link") &&
              node.props["aria-label"] === label,
          ),
        ).toBeDefined();
      expect(find(tree, (node) => node.type === "SocialDock")?.props.mini).toBe(true);
      expect(find(tree, (node) => node.type === "AccountMenu")).toBeDefined();
      expect(fixture.writes).toEqual([]);
    },
  );

  test.each([176, 212, 248])(
    "desktop width %s survives mobile and back without a preference write",
    (width) => {
      const fixture = shell("open", width);
      expect(dashboard(fixture.render(false)).props.style).toEqual({ "--rail": `${width}px` });
      expect(dashboard(fixture.render(true)).props.style).toEqual({ "--rail": "60px" });
      const restored = fixture.render(false);
      expect(dashboard(restored).props.style).toEqual({ "--rail": `${width}px` });
      expect(dashboard(restored).props.className).not.toContain("is-mini");
      expect(find(restored, (node) => node.props["aria-label"] === "Resize sidebar")).toBeDefined();
      expect(fixture.writes).toEqual([]);
    },
  );

  test("a minimized desktop preference survives the round trip", () => {
    const fixture = shell("mini", 212);
    for (const mobile of [false, true, false])
      expect(dashboard(fixture.render(mobile)).props.style).toEqual({ "--rail": "60px" });
    expect(
      find(fixture.render(false), (node) => node.props["aria-label"] === "Expand sidebar"),
    ).toBeDefined();
    expect(fixture.writes).toEqual([]);
  });

  test("crossing into mobile cancels an active desktop drag without saving its width", () => {
    const fixture = shell("open", 212);
    const resize = find(
      fixture.render(false),
      (node) => node.props["aria-label"] === "Resize sidebar",
    )!;
    (resize.props.onPointerDown as (event: unknown) => void)({
      preventDefault() {},
      clientX: 212,
      pointerId: 1,
      currentTarget: { setPointerCapture() {} },
    });
    fixture.listeners.get("pointermove")!({ clientX: 190 });
    expect(dashboard(fixture.render(false)).props.style).toEqual({ "--rail": "190px" });
    expect(fixture.listeners.size).toBe(3);
    expect(dashboard(fixture.render(true)).props.style).toEqual({ "--rail": "60px" });
    expect(fixture.listeners.size).toBe(0);
    (resize.props.onLostPointerCapture as () => void)();
    expect(dashboard(fixture.render(false)).props.style).toEqual({ "--rail": "212px" });
    expect(fixture.writes).toEqual([]);
  });

  test("390px leaves 330px for tools instead of reserving 248px plus the appearance gutter", () => {
    expect(declaration(mobileRule(".celinen-dash"), "grid-template-columns")).toBe(
      "60px minmax(0, 1fr)",
    );
    for (const selector of [
      ".celinen-dash__body.is-tool:not(:has(.foto-develop))",
      ".celinen-dash__body.is-cal",
    ])
      expect(declaration(mobileRule(selector), "padding-right")).toBe("0");
    expect(declaration(mobileRule(".celinen-dash__theme"), "position")).toBe("static");
    expect(declaration(mobileRule(".celinen-dash__theme"), "flex-shrink")).toBe("0");
    expect(declaration(mobileRule(".celinen-dash__nav"), "overflow-y")).toBe("auto");
    // The desktop grid still consumes the user's saved inline --rail value.
    expect(css.toString()).toContain("grid-template-columns: var(--rail) minmax(0, 1fr)");
  });
});
