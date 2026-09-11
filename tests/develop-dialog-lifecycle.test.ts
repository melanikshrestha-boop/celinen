import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { defaultDevelopSettings } from "../src/lib/develop/contract";

// Run the actual component bodies and event handlers. Hooks and processing I/O
// are instance-local fakes, not shared module mocks. No browser, native service,
// account, IndexedDB, timers, or customer files are used by these regressions.
type Dialog = "AutoCropDialog" | "ReferencePresetDialog";
type Element = { type: unknown; props: Record<string, unknown>; children: unknown[] };
type Hook = {
  value?: unknown;
  deps?: unknown[];
  setup?: () => void | (() => void);
  cleanup?: void | (() => void);
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function settle() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
function elements(tree: unknown): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== "object" || !("children" in tree)) return [];
  const node = tree as Element;
  return [node, ...node.children.flatMap(elements)];
}
function text(tree: unknown): string {
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join("");
  return tree && typeof tree === "object" && "children" in tree
    ? (tree as Element).children.map(text).join("")
    : "";
}
function parentProcessing() {
  const calls: boolean[] = [];
  let locked = false;
  return {
    calls,
    processing(value: boolean) {
      calls.push(value);
      locked = value;
    },
    get locked() {
      return locked;
    },
  };
}
const transpiler = new Bun.Transpiler({
  loader: "tsx",
  tsconfig: {
    compilerOptions: { jsx: "react", jsxFactory: "jsx", jsxFragmentFactory: "Fragment" },
  },
});
function fixture(dialog: Dialog, parent = parentProcessing()) {
  const source = readFileSync(
    new URL(`../src/components/develop/${dialog}.tsx`, import.meta.url),
    "utf8",
  )
    .replace(/^import[\s\S]*?;\n/gm, "")
    .replace(/^export function /gm, "function ");
  const hooks: Hook[] = [];
  const queuedEffects: number[] = [];
  let cursor = 0;
  let mounted = true;
  let tree: unknown;
  let writesAfterUnmount = 0;
  let neutralCalls = 0;
  let analysisCalls = 0;
  let renderCalls = 0;
  const signals: AbortSignal[] = [];
  const neutral = deferred<Blob>();
  let currentNeutral = neutral;
  const current = defaultDevelopSettings();
  const applied: unknown[] = [];
  const stageWaiters = new Map<"analysis" | "render", ReturnType<typeof deferred<void>>>();
  let failure: "analysis" | "render" | null = null;
  function useState(initial: unknown) {
    const index = cursor++;
    const hook = (hooks[index] ??= {
      value: typeof initial === "function" ? (initial as () => unknown)() : initial,
    });
    return [
      hook.value,
      (value: unknown) => {
        if (!mounted) writesAfterUnmount++;
        hook.value =
          typeof value === "function" ? (value as (old: unknown) => unknown)(hook.value) : value;
      },
    ];
  }
  function useRef(initial: unknown) {
    const index = cursor++;
    return (hooks[index] ??= { value: { current: initial } }).value;
  }
  function useEffect(setup: Hook["setup"], deps?: unknown[]) {
    const index = cursor++;
    const previous = hooks[index];
    if (
      !previous ||
      !deps ||
      !previous.deps ||
      deps.length !== previous.deps.length ||
      deps.some((value, i) => !Object.is(value, previous.deps![i]))
    ) {
      hooks[index] = { ...previous, setup, deps };
      queuedEffects.push(index);
    }
  }
  const context = {
    useState,
    useRef,
    useEffect,
    jsx: (type: unknown, props: Element["props"] | null, ...children: unknown[]): Element => ({
      type,
      props: props ?? {},
      children,
    }),
    Fragment: Symbol("fragment"),
    URL: { createObjectURL: () => "blob:isolated-dialog-proof", revokeObjectURL: () => {} },
    defaultDevelopSettings,
    applyReferenceLook: (settings: unknown) => settings,
    createDevelopPreset: () => {
      throw new Error("This lifecycle fixture must not persist presets");
    },
    renderDevelop: async () => {
      renderCalls++;
      if (failure === "render") throw new Error("Reserved render failure");
      await stageWaiters.get("render")?.promise;
      return new Blob(["isolated rendered proof"]);
    },
    suggestAutoCrop: async () => {
      analysisCalls++;
      if (failure === "analysis") throw new Error("Reserved analysis failure");
      await stageWaiters.get("analysis")?.promise;
      return {
        crop: current.crop,
        confidence: "high",
        reasons: ["Reserved deterministic proposal"],
        analysis: { retainedArea: 1 },
      };
    },
    fitReferenceLook: async () => {
      analysisCalls++;
      if (failure === "analysis") throw new Error("Reserved analysis failure");
      await stageWaiters.get("analysis")?.promise;
      return {
        settings: current,
        diagnostics: { beforeRmse: 0.1, afterRmse: 0.01, improvement: 0.9 },
        warnings: [],
      };
    },
  };
  const component = new Function(
    ...Object.keys(context),
    transpiler.transformSync(`${source}\nreturn ${dialog};`),
  )(...Object.values(context));
  const props = {
    current,
    sourceName: "isolated-original.jpg",
    getNeutral: (signal: AbortSignal) => {
      neutralCalls++;
      signals.push(signal);
      // Deliberately ignores abort, like a queued decoder that cannot be stopped.
      return currentNeutral.promise;
    },
    processing: parent.processing,
    apply: (value: unknown) => applied.push(value),
    save: async () => {
      throw new Error("This lifecycle fixture must not save");
    },
    close: () => {},
  };
  function render() {
    if (!mounted) throw new Error("Cannot render an unmounted fixture");
    cursor = 0;
    tree = component(props);
    for (const index of queuedEffects.splice(0)) {
      const effect = hooks[index]!;
      effect.cleanup?.();
      effect.cleanup = effect.setup?.();
    }
  }
  function button(label: string) {
    const found = elements(tree).find((node) => node.type === "button" && text(node) === label);
    if (!found) throw new Error(`Missing actual ${dialog} button: ${label}`);
    return found;
  }
  render();
  if (dialog === "ReferencePresetDialog") {
    const input = elements(tree).find(
      (node) => node.props["aria-label"] === "Edited reference photo",
    );
    if (!input) throw new Error("The reference file input must remain accessible");
    (input.props.onChange as (event: unknown) => void)({
      target: {
        files: [new File(["reserved reference"], "reference.jpg", { type: "image/jpeg" })],
      },
    });
    render();
  }
  const start = button(dialog === "AutoCropDialog" ? "Suggest crop" : "Estimate preset").props
    .onClick as () => void;
  return {
    start,
    render,
    button,
    parent,
    neutral,
    applied,
    signals,
    nextSource() {
      currentNeutral = deferred<Blob>();
      return currentNeutral;
    },
    replayEffects() {
      // React may tear down and reactivate effects without discarding the hook
      // refs. A boolean `alive` fence alone does not identify the new operation.
      for (const hook of hooks) hook.cleanup?.();
      for (const hook of hooks) {
        if (hook.setup) hook.cleanup = hook.setup();
      }
    },
    failAt(stage: typeof failure) {
      failure = stage;
    },
    pauseAt(stage: "analysis" | "render") {
      const waiting = deferred<void>();
      stageWaiters.set(stage, waiting);
      return waiting;
    },
    cancel() {
      render();
      const label = dialog === "AutoCropDialog" ? "Cancel analysis" : "Cancel fitting";
      (button(label).props.onClick as () => void)();
    },
    unmount() {
      if (!mounted) return;
      mounted = false;
      for (const hook of hooks) hook.cleanup?.();
    },
    get state() {
      return {
        neutralCalls,
        analysisCalls,
        renderCalls,
        writesAfterUnmount,
        alerts: elements(tree)
          .filter((node) => node.props.role === "alert")
          .map(text),
        canApply: elements(tree).some(
          (node) =>
            node.type === "button" &&
            text(node).startsWith("Apply ") &&
            node.props.disabled === false,
        ),
      };
    },
  };
}

for (const dialog of ["AutoCropDialog", "ReferencePresetDialog"] as const) {
  describe(`${dialog}: processing lease survives route changes safely`, () => {
    test("cleanup immediately releases processing and ignores an uncancelable old source", async () => {
      const f = fixture(dialog);
      f.start();
      expect(f.parent.calls).toEqual([true]);
      expect(f.state.neutralCalls).toBe(1);
      f.unmount();
      expect(f.signals[0]!.aborted).toBe(true);
      expect(f.parent.calls).toEqual([true, false]);
      expect(f.parent.locked).toBe(false);
      f.neutral.resolve(new Blob(["late original"]));
      await settle();
      expect(f.state.analysisCalls).toBe(0);
      expect(f.state.renderCalls).toBe(0);
      expect(f.state.writesAfterUnmount).toBe(0);
      expect(f.parent.calls).toEqual([true, false]);
      expect(f.applied).toEqual([]);
    });

    test("the old finally cannot unlock a replacement dialog on the next photo", async () => {
      const parent = parentProcessing();
      const older = fixture(dialog, parent);
      older.start();
      older.unmount();
      const newer = fixture(dialog, parent);
      try {
        newer.start();
        expect(parent.calls).toEqual([true, false, true]);
        older.neutral.resolve(new Blob(["previous photo"]));
        await settle();
        expect(parent.locked).toBe(true);
        expect(parent.calls).toEqual([true, false, true]);
        expect(older.state.analysisCalls).toBe(0);
        expect(older.state.writesAfterUnmount).toBe(0);
        newer.neutral.resolve(new Blob(["current photo"]));
        await settle();
        expect(newer.state.analysisCalls).toBe(1);
        expect(parent.calls).toEqual([true, false, true, false]);
      } finally {
        newer.unmount();
      }
    });

    test("rapid duplicate action callbacks admit only one analysis before React rerenders", async () => {
      const f = fixture(dialog);
      try {
        f.start();
        f.start();
        expect(f.state.neutralCalls).toBe(1);
        expect(f.parent.calls).toEqual([true]);
        f.neutral.resolve(new Blob(["original"]));
        await settle();
        expect(f.state.analysisCalls).toBe(1);
        expect(f.parent.calls).toEqual([true, false]);
      } finally {
        f.unmount();
      }
    });

    test("a stale finally cannot release a newer controller after effect reactivation", async () => {
      const f = fixture(dialog);
      try {
        f.start();
        f.replayEffects();
        const next = f.nextSource();
        f.start();
        expect(f.state.neutralCalls).toBe(2);
        expect(f.signals[0]!.aborted).toBe(true);
        expect(f.signals[1]!.aborted).toBe(false);
        expect(f.parent.calls).toEqual([true, false, true]);
        f.neutral.resolve(new Blob(["old source completing after reactivation"]));
        await settle();
        expect(f.state.analysisCalls).toBe(0);
        expect(f.state.renderCalls).toBe(0);
        expect(f.parent.locked).toBe(true);
        expect(f.parent.calls).toEqual([true, false, true]);
        next.resolve(new Blob(["new source"]));
        await settle();
        expect(f.state.analysisCalls).toBe(1);
        expect(f.parent.calls).toEqual([true, false, true, false]);
      } finally {
        f.unmount();
      }
      expect(f.parent.calls).toEqual([true, false, true, false]);
    });

    test("success releases exactly once and still requires explicit apply", async () => {
      const f = fixture(dialog);
      try {
        f.start();
        f.neutral.resolve(new Blob(["original"]));
        await settle();
        f.render();
        expect(f.parent.calls).toEqual([true, false]);
        expect(f.applied).toEqual([]);
        const apply = f.button(
          dialog === "AutoCropDialog" ? "Apply suggested crop" : "Apply estimated look",
        );
        expect(apply.props.disabled).toBe(false);
        (apply.props.onClick as () => void)();
        expect(f.applied).toHaveLength(1);
      } finally {
        f.unmount();
      }
      expect(f.parent.calls).toEqual([true, false]);
    });

    test("cancellation ignores a late source and releases exactly once", async () => {
      const f = fixture(dialog);
      try {
        f.start();
        f.cancel();
        expect(f.signals[0]!.aborted).toBe(true);
        f.neutral.resolve(new Blob(["late original"]));
        await settle();
        f.render();
        expect(f.state.analysisCalls).toBe(0);
        expect(f.state.renderCalls).toBe(0);
        expect(f.parent.calls).toEqual([true, false]);
        expect(f.applied).toEqual([]);
      } finally {
        f.unmount();
      }
      expect(f.parent.calls).toEqual([true, false]);
    });

    for (const stage of ["analysis", "render"] as const) {
      test(`cancellation during uncancelable ${stage} never admits another stage or result`, async () => {
        const f = fixture(dialog);
        try {
          const waiting = f.pauseAt(stage);
          f.start();
          f.neutral.resolve(new Blob(["original"]));
          await settle();
          expect(f.state.analysisCalls).toBe(1);
          expect(f.state.renderCalls).toBe(stage === "render" ? 1 : 0);
          f.cancel();
          expect(f.signals[0]!.aborted).toBe(true);
          waiting.resolve();
          await settle();
          f.render();
          expect(f.state.analysisCalls).toBe(1);
          expect(f.state.renderCalls).toBe(stage === "render" ? 1 : 0);
          expect(f.state.canApply).toBe(false);
          expect(f.parent.calls).toEqual([true, false]);
          expect(f.applied).toEqual([]);
        } finally {
          f.unmount();
        }
        expect(f.parent.calls).toEqual([true, false]);
      });
    }

    for (const stage of ["neutral", "analysis", "render"] as const) {
      test(`${stage} failure releases exactly once without applying edits`, async () => {
        const f = fixture(dialog);
        try {
          f.start();
          if (stage === "neutral") f.neutral.reject(new Error("Reserved neutral failure"));
          else {
            f.failAt(stage);
            f.neutral.resolve(new Blob(["original"]));
          }
          await settle();
          f.render();
          expect(f.parent.calls).toEqual([true, false]);
          expect(f.state.alerts).toEqual([`Reserved ${stage} failure`]);
          expect(f.applied).toEqual([]);
        } finally {
          f.unmount();
        }
        expect(f.parent.calls).toEqual([true, false]);
      });
    }
  });
}
