import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createDevelopDocument, currentRecipe, pushHistory } from "../src/lib/develop/store";
import { defaultDevelopSettings } from "../src/lib/develop/contract";
import { developViewFilter } from "../src/lib/develop/cull-view";

// Execute the actual component's hydration, adoption, and adjustment functions.
// Only React setters and repository I/O are replaced with isolated in-memory
// fixtures. No browser, native server, IndexedDB, account, or customer data.
const source = readFileSync(
  new URL("../src/components/develop/DevelopPage.tsx", import.meta.url),
  "utf8",
);
const transpiler = new Bun.Transpiler({ loader: "tsx" });
function between(start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Missing component boundary: ${start}`);
  return source.slice(from, to);
}
const hydrationCode = between(
  "  const adopt = useCallback(",
  "  useEffect(() => {\n    const unsubscribe = repository.subscribe",
);
const lockCode = between("  function editsLocked() {", "  const adopt = useCallback(");
const changeCode = between("  function change(next:", "  function select(");
const fenceCode = source.includes("  // Hydration fences the current route")
  ? between("  // Hydration fences the current route", "  const [saveError,")
  : "";
function execute(code: string, context: Record<string, unknown>, result = "") {
  return new Function(...Object.keys(context), transpiler.transformSync(`${code}\n${result}`))(
    ...Object.values(context),
  );
}
const tick = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}
function fixture() {
  let documents = Object.fromEntries(["a", "b", "c"].map((id) => [id, createDevelopDocument(id)]));
  const photos = ["a", "b", "c"].map((id) => ({ id, sourceBlob: new Blob([id]) }));
  const docs = { current: structuredClone(documents) };
  const selectedRef = { current: "a" };
  const draftRef = { current: defaultDevelopSettings() };
  const draftDirtyRef = { current: false };
  const alive = { current: true };
  let hydrationRef: { current: unknown } | undefined;
  let effect!: () => () => void;
  let cleanup: (() => void) | undefined;
  let gate: ReturnType<typeof deferred> | null = null;
  let manifestReads = 0;
  let saves = 0;
  let ready = false;
  let loadError = "";
  const repository = {
    async flush() {
      if (draftDirtyRef.current) {
        const id = selectedRef.current;
        documents = {
          ...documents,
          [id]: pushHistory(documents[id]!, draftRef.current, "Adjustment before navigation"),
        };
        draftDirtyRef.current = false;
        saves++;
      }
      return true;
    },
    async readManifest() {
      manifestReads++;
      const waiting = gate;
      if (waiting) await waiting.promise;
      return { selectedId: "a", filter: "all" };
    },
  };
  const context: Record<string, unknown> = {
    useCallback: (fn: unknown) => fn,
    useEffect: (fn: typeof effect) => (effect = fn),
    useRef: (initial: unknown) => (hydrationRef ??= { current: initial }),
    docs,
    revisions: { current: {} },
    setLibrary: () => undefined,
    setSelected: (id: string) => (selectedRef.current = id),
    setSelectedSet: () => undefined,
    currentRecipe,
    defaultDevelopSettings,
    draftRef,
    setDraft: (recipe: ReturnType<typeof defaultDevelopSettings>) => (draftRef.current = recipe),
    draftDirtyRef,
    setDraftDirty: (value: boolean) => (draftDirtyRef.current = value),
    selectedRef,
    repository,
    store: {
      loadLibrary: async () => ({ photos, documents: structuredClone(documents), presets: [] }),
    },
    projectId: null,
    stableDeliveryFocus: undefined,
    readStudioSessionSnapshot: async () => null,
    scope: "reserved-memory-fixture",
    shootId: "legacy",
    href: "/shoots/legacy/develop?photo=a",
    focusedFrame: undefined,
    developViewFilter,
    viewBaseline: { current: null },
    explicitViewFilter: { current: false },
    viewFilter: { current: "all" },
    setFilter: () => undefined,
    hydrated: { current: false },
    setReady: (value: boolean) => (ready = value),
    setLoadError: (value: string) => (loadError = value),
    errorMessage: (error: Error) => error.message,
    failed: { current: false },
    operationLock: { current: null },
    alive,
    source: photos[0]!.sourceBlob,
    setBefore: () => undefined,
    setActivePreset: () => undefined,
    markDraftDirty: (value: boolean) => (draftDirtyRef.current = value),
  };
  function render(href: string) {
    context.href = href;
    if (fenceCode) {
      const { hydration: _hydration, ...renderContext } = context;
      context.hydration = execute(fenceCode, renderContext, "return hydration;");
    }
    context.editsLocked = execute(lockCode, context, "return editsLocked;");
    execute(hydrationCode, context);
  }
  function runEffect() {
    cleanup?.();
    cleanup = effect();
  }
  function adjust(exposure: number) {
    const change = execute(changeCode, context, "return change;");
    change({ ...draftRef.current, exposure }, "Exposure", false);
  }
  render(String(context.href));
  runEffect();
  return {
    render,
    runEffect,
    adjust,
    delay() {
      gate = deferred();
      return gate;
    },
    resume() {
      gate = null;
    },
    unmount() {
      alive.current = false;
      cleanup?.();
    },
    get state() {
      return {
        selected: selectedRef.current,
        exposure: draftRef.current.exposure,
        dirty: draftDirtyRef.current,
        ready,
        loadError,
        manifestReads,
        saves,
        documents,
        locked: (context.editsLocked as () => boolean)(),
      };
    },
  };
}

describe("warm Develop route hydration preserves the prior edit", () => {
  test("locks the old controls immediately and saves the existing draft before selecting another photo", async () => {
    const f = fixture();
    await tick();
    f.adjust(1);
    expect(f.state.dirty).toBe(true);
    const waiting = f.delay();
    f.render("/shoots/legacy/develop?photo=b");
    expect(f.state.locked).toBe(true);
    f.adjust(2); // An old pointer callback must not mutate the newly requested source.
    expect(f.state.exposure).toBe(1);
    f.runEffect();
    await tick();
    expect(f.state.ready).toBe(false);
    expect(f.state.saves).toBe(1);
    expect(currentRecipe(f.state.documents.a!).exposure).toBe(1);
    waiting.resolve();
    await tick();
    expect(f.state.selected).toBe("b");
    expect(f.state.exposure).toBe(0);
    expect(f.state.locked).toBe(false);
    expect(f.state.loadError).toBe("");
    expect(currentRecipe(f.state.documents.a!).exposure).toBe(1);
    f.unmount();
  });

  test("an older request cancelled while reading the manifest cannot replace the newer selection", async () => {
    const f = fixture();
    await tick();
    const older = f.delay();
    f.render("/shoots/legacy/develop?photo=b");
    f.runEffect();
    await tick();
    expect(f.state.manifestReads).toBe(2);
    f.resume();
    f.render("/shoots/legacy/develop?photo=c");
    f.runEffect();
    await tick();
    expect(f.state.selected).toBe("c");
    f.adjust(3);
    older.resolve();
    await tick();
    expect(f.state.selected).toBe("c");
    expect(f.state.exposure).toBe(3);
    expect(f.state.dirty).toBe(true);
    f.unmount();
  });

  test("unmount during a manifest read cannot adopt late results", async () => {
    const f = fixture();
    await tick();
    const waiting = f.delay();
    f.render("/shoots/legacy/develop?photo=b");
    f.runEffect();
    await tick();
    f.unmount();
    waiting.resolve();
    await tick();
    expect(f.state.selected).toBe("a");
  });

  test("a newly rendered target fences old results even before effect cleanup runs", async () => {
    const f = fixture();
    await tick();
    const older = f.delay();
    f.render("/shoots/legacy/develop?photo=b");
    f.runEffect();
    await tick();
    f.render("/shoots/legacy/develop?photo=c");
    older.resolve();
    await tick();
    expect(f.state.selected).toBe("a");
    expect(f.state.locked).toBe(true);
    f.resume();
    f.runEffect();
    await tick();
    expect(f.state.selected).toBe("c");
    expect(f.state.locked).toBe(false);
    f.unmount();
  });

  test("an ordinary rerender keeps the current draft and available controls", async () => {
    const f = fixture();
    await tick();
    f.adjust(1);
    f.render("/shoots/legacy/develop?photo=a");
    expect(f.state.locked).toBe(false);
    expect(f.state.exposure).toBe(1);
    expect(f.state.dirty).toBe(true);
    expect(f.state.saves).toBe(0);
    f.unmount();
  });
});
