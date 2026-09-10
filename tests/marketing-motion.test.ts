import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "postcss";
import { observeMarketingReveals } from "../src/lib/marketing-motion";

type Handler = (event: Event) => void;

// Each test owns a tiny DOM surface. Nothing replaces the process's browser globals,
// and no real document, account, storage, network, timer, or animation is involved.
class Events {
  listeners = new Map<string, Set<Handler>>();
  addEventListener(type: string, handler: Handler) {
    const entries = this.listeners.get(type) ?? new Set<Handler>();
    entries.add(handler);
    this.listeners.set(type, entries);
  }
  removeEventListener(type: string, handler: Handler) {
    this.listeners.get(type)?.delete(handler);
  }
  emit(type: string, target: unknown = this) {
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler({ type, target } as Event);
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce((count, entries) => count + entries.size, 0);
  }
}

class ElementFixture extends Events {
  children: ElementFixture[] = [];
  dataset: Record<string, string> = {};
  rect = { top: 100, bottom: 200 };
  id = "";
  reveal = false;
  constructor(readonly ownerDocument: DocumentFixture) {
    super();
  }
  append(child: ElementFixture) {
    this.children.push(child);
    return child;
  }
  contains(node: unknown): boolean {
    return node === this || this.children.some((child) => child.contains(node));
  }
  querySelectorAll(selector: string): ElementFixture[] {
    if (selector !== "[data-reveal]") throw new Error(`Unexpected selector: ${selector}`);
    return this.children.flatMap((child) => [
      ...(child.reveal ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  removeAttribute(name: string) {
    if (name !== "data-reveal-state") throw new Error(`Unexpected removal: ${name}`);
    delete this.dataset.revealState;
  }
  getBoundingClientRect() {
    return this.rect;
  }
}

class ObserverFixture {
  observed: ElementFixture[] = [];
  disconnected = false;
  throwOnObserve = false;
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {}
  observe(target: ElementFixture) {
    if (this.throwOnObserve && this.observed.length > 0)
      throw new Error("Observer registration failed after first target");
    this.observed.push(target);
  }
  disconnect() {
    this.disconnected = true;
  }
  // Deliberately remains callable after disconnect to reproduce an already queued
  // browser callback, not just prove removeEventListener/disconnect was invoked.
  deliver(target: ElementFixture, isIntersecting: boolean, intersectionRatio = 0) {
    this.callback(
      [{ target, isIntersecting, intersectionRatio } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

class MediaFixture extends Events {
  matches = false;
  change(reduced: boolean) {
    this.matches = reduced;
    this.emit("change");
  }
}

class WindowFixture extends Events {
  innerHeight = 800;
  location = { hash: "" };
  media = new MediaFixture();
  observers: ObserverFixture[] = [];
  constructorFailure = false;
  observeFailure = false;
  matchMedia: ((query: string) => MediaFixture) | undefined = (query) => {
    expect(query).toBe("(prefers-reduced-motion: reduce)");
    return this.media;
  };
  IntersectionObserver: typeof ObserverFixture | undefined;
  constructor() {
    super();
    this.IntersectionObserver = observerForWindow(this);
  }
}

function observerForWindow(view: WindowFixture) {
  return class extends ObserverFixture {
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      if (view.constructorFailure) throw new Error("Observer unavailable");
      super(callback, options);
      this.throwOnObserve = view.observeFailure;
      view.observers.push(this);
    }
  };
}

class DocumentFixture {
  defaultView: WindowFixture | null = new WindowFixture();
  activeElement: ElementFixture | null = null;
  nodes: ElementFixture[] = [];
  getElementById(id: string) {
    return this.nodes.find((node) => node.id === id) ?? null;
  }
  element(id = "", reveal = false) {
    const node = new ElementFixture(this);
    node.id = id;
    node.reveal = reveal;
    this.nodes.push(node);
    return node;
  }
}

function fixture() {
  const document = new DocumentFixture();
  const view = document.defaultView!;
  const root = document.element("public-page");
  const visible = root.append(document.element("visible", true));
  const below = root.append(document.element("below", true));
  below.rect = { top: 1_000, bottom: 1_200 };
  const above = root.append(document.element("above", true));
  above.rect = { top: -300, bottom: -100 };
  const start = () => observeMarketingReveals(root as unknown as HTMLElement);
  return { document, view, root, visible, below, above, start };
}

describe("public marketing motion progressive enhancement", () => {
  test("default content stays readable without a window, media query API, or observer", () => {
    for (const missing of ["window", "media", "observer"] as const) {
      const f = fixture();
      if (missing === "window") f.document.defaultView = null;
      if (missing === "media") f.view.matchMedia = undefined;
      if (missing === "observer") f.view.IntersectionObserver = undefined;
      const cleanup = f.start();
      expect(f.root.querySelectorAll("[data-reveal]").map((node) => node.dataset)).toEqual([
        {},
        {},
        {},
      ]);
      expect(f.view.observers).toHaveLength(0);
      expect(f.root.listenerCount + f.view.listenerCount + f.view.media.listenerCount).toBe(0);
      cleanup();
    }
  });

  test("only offscreen nodes are armed; unmarked elements are untouched", () => {
    const f = fixture();
    const other = f.root.append(f.document.element("never-animate"));
    const cleanup = f.start();
    expect(f.visible.dataset.revealState).toBe("visible");
    expect(f.below.dataset.revealState).toBe("outside");
    expect(f.above.dataset.revealState).toBe("outside");
    expect(other.dataset).toEqual({});
    expect(f.view.observers[0]!.observed).toEqual([f.visible, f.below, f.above]);
    cleanup();
  });

  test("enter, leave, and re-enter are reversible even for a very tall section", () => {
    const f = fixture();
    f.below.rect = { top: 50, bottom: 100_000 };
    const cleanup = f.start();
    const observer = f.view.observers[0]!;
    expect(observer.options?.threshold).toBe(0);
    observer.deliver(f.below, true, 0.00001);
    expect(f.below.dataset.revealState).toBe("visible");
    observer.deliver(f.below, false);
    expect(f.below.dataset.revealState).toBe("outside");
    observer.deliver(f.below, true, 0.00001);
    expect(f.below.dataset.revealState).toBe("visible");
    cleanup();
  });

  test("reduced motion starts visible, changes live, and fences obsolete callbacks", () => {
    const f = fixture();
    f.view.media.matches = true;
    const cleanup = f.start();
    expect(f.below.dataset).toEqual({});
    expect(f.view.observers).toHaveLength(0);
    f.view.media.change(false);
    const first = f.view.observers[0]!;
    expect(f.below.dataset.revealState).toBe("outside");
    f.view.media.change(true);
    expect(first.disconnected).toBe(true);
    expect(f.below.dataset).toEqual({});
    first.deliver(f.below, false);
    expect(f.below.dataset).toEqual({});
    f.view.media.change(false);
    expect(f.view.observers).toHaveLength(2);
    const second = f.view.observers[1]!;
    second.deliver(f.below, true);
    first.deliver(f.below, false);
    expect(f.below.dataset.revealState).toBe("visible");
    cleanup();
  });

  test("keyboard focus reveals the whole target and an observer cannot hide its focused child", () => {
    const f = fixture();
    const input = f.below.append(f.document.element("calculator-input"));
    const cleanup = f.start();
    f.document.activeElement = input;
    f.root.emit("focusin", input);
    expect(f.below.dataset.revealState).toBe("visible");
    f.view.observers[0]!.deliver(f.below, false);
    expect(f.below.dataset.revealState).toBe("visible");
    f.document.activeElement = null;
    f.view.observers[0]!.deliver(f.below, false);
    expect(f.below.dataset.revealState).toBe("outside");
    cleanup();
  });

  test("initial and changed encoded anchors expose containing and nested reveal nodes", () => {
    const f = fixture();
    const anchor = f.below.append(f.document.element("plans:été"));
    const nested = anchor.append(f.document.element("nested-plan", true));
    nested.rect = { top: 1_100, bottom: 1_180 };
    f.view.location.hash = "#plans%3A%C3%A9t%C3%A9";
    const cleanup = f.start();
    expect(f.below.dataset.revealState).toBe("visible");
    expect(nested.dataset.revealState).toBe("visible");
    f.view.location.hash = "#above";
    f.view.emit("hashchange");
    expect(f.above.dataset.revealState).toBe("visible");
    f.view.location.hash = "#%E0%A4%A";
    expect(() => f.view.emit("hashchange")).not.toThrow();
    const outside = f.document.element("outside-page", true);
    f.view.location.hash = "#outside-page";
    f.view.emit("hashchange");
    expect(outside.dataset).toEqual({});
    cleanup();
  });

  test("pageshow reconciles restored viewport geometry and replaces the old observer", () => {
    const f = fixture();
    const cleanup = f.start();
    const first = f.view.observers[0]!;
    f.visible.rect = { top: -400, bottom: -200 };
    f.below.rect = { top: 100, bottom: 300 };
    f.view.emit("pageshow");
    expect(first.disconnected).toBe(true);
    expect(f.view.observers).toHaveLength(2);
    expect(f.visible.dataset.revealState).toBe("outside");
    expect(f.below.dataset.revealState).toBe("visible");
    first.deliver(f.below, false);
    expect(f.below.dataset.revealState).toBe("visible");
    cleanup();
  });

  test("a queued pre-jump observer entry cannot hide the newly reached hash destination", () => {
    const f = fixture();
    const anchor = f.below.append(f.document.element("destination"));
    const cleanup = f.start();
    const beforeJump = f.view.observers[0]!;
    expect(f.below.dataset.revealState).toBe("outside");
    // Native anchor scrolling has moved the containing reveal node on screen,
    // but the earlier outside entry may still be waiting in the browser queue.
    f.below.rect = { top: 90, bottom: 290 };
    anchor.rect = { top: 100, bottom: 120 };
    f.view.location.hash = "#destination";
    f.view.emit("hashchange");
    expect(f.below.dataset.revealState).toBe("visible");
    beforeJump.deliver(f.below, false);
    expect(f.below.dataset.revealState).toBe("visible");
    cleanup();
  });

  test("constructor or registration failures leave the entire public page visible", () => {
    for (const failure of ["constructorFailure", "observeFailure"] as const) {
      const f = fixture();
      f.view[failure] = true;
      const cleanup = f.start();
      for (const node of f.root.querySelectorAll("[data-reveal]")) expect(node.dataset).toEqual({});
      for (const observer of f.view.observers) expect(observer.disconnected).toBe(true);
      cleanup();
    }
  });

  test("a queued callback after observer registration fails cannot hide fallback content", () => {
    const f = fixture();
    f.view.observeFailure = true;
    const cleanup = f.start();
    const observer = f.view.observers[0]!;
    expect(observer.observed).toEqual([f.visible]);
    expect(f.visible.dataset).toEqual({});
    observer.deliver(f.visible, false);
    expect(f.visible.dataset).toEqual({});
    cleanup();
  });

  test("cleanup restores readable DOM, removes subscriptions, and fences stale callbacks on remount", () => {
    const f = fixture();
    const cleanup = f.start();
    const first = f.view.observers[0]!;
    expect(f.root.listenerCount).toBe(1);
    expect(f.view.listenerCount).toBe(2);
    expect(f.view.media.listenerCount).toBe(1);
    cleanup();
    cleanup();
    expect(first.disconnected).toBe(true);
    expect(f.root.listenerCount + f.view.listenerCount + f.view.media.listenerCount).toBe(0);
    first.deliver(f.below, false);
    for (const node of f.root.querySelectorAll("[data-reveal]")) expect(node.dataset).toEqual({});
    const nextCleanup = f.start();
    const second = f.view.observers[1]!;
    second.deliver(f.below, true);
    first.deliver(f.below, false);
    expect(f.below.dataset.revealState).toBe("visible");
    nextCleanup();
  });

  test("public motion CSS exposes focused, reduced-motion, and printed content", () => {
    const css = parse(
      readFileSync(
        new URL("../src/components/marketing/marketing-motion.css", import.meta.url),
        "utf8",
      ),
    );
    const declarations = (selector: string, media?: string) => {
      const found: Record<string, string> = {};
      css.walkRules((rule) => {
        if (!rule.selectors.includes(selector)) return;
        const parent = rule.parent;
        if (
          media &&
          !(parent?.type === "atrule" && parent.name === "media" && parent.params === media)
        )
          return;
        rule.walkDecls((decl) => {
          found[decl.prop] = decl.value;
        });
      });
      return found;
    };
    for (const selector of [
      ".marketing-page [data-reveal-state]:focus-within",
      ".marketing-page [data-reveal-state]:target",
    ])
      expect(declarations(selector)).toMatchObject({
        opacity: "1",
        transform: "none",
        transition: "none",
      });
    expect(
      declarations(".marketing-page [data-reveal-state]", "(prefers-reduced-motion: reduce)"),
    ).toMatchObject({ opacity: "1", transform: "none", animation: "none", transition: "none" });
    expect(declarations(".marketing-page [data-reveal-state]", "print")).toMatchObject({
      opacity: "1",
      transform: "none",
    });
  });
});
