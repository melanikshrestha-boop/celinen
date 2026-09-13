import { expect, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

if (!process.argv.includes("--degraded-chat-fixture")) {
  test("unavailable cloud history leaves a recoverable temporary workspace", () => {
    const result = Bun.spawnSync(
      [process.execPath, fileURLToPath(import.meta.url), "--degraded-chat-fixture"],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
    expect(new TextDecoder().decode(result.stdout)).toContain("DEGRADED_CHAT_OK");
  });
} else {
  // Exercise the real provider lifecycle with deterministic hooks. No DOM, Auth,
  // IndexedDB, customer records, or network are available to this isolated process.
  globalThis.fetch = (() => {
    throw new Error("Unexpected network access");
  }) as typeof fetch;
  const React = await import("react");
  type Effect = { dependencies?: readonly unknown[]; cleanup?: () => void };
  const slots: unknown[] = [];
  const effects = new Map<number, Effect>();
  let cursor = 0;
  let dirty = false;
  let queuedEffects: (() => void)[] = [];
  const same = (a?: readonly unknown[], b?: readonly unknown[]) =>
    !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  mock.module("react", () => ({
    ...React,
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [
        slots[index],
        (next: unknown) => {
          const value = typeof next === "function" ? next(slots[index]) : next;
          if (!Object.is(value, slots[index])) {
            slots[index] = value;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo(factory: () => unknown, dependencies: readonly unknown[]) {
      const index = cursor++;
      const prior = slots[index] as
        { value: unknown; dependencies: readonly unknown[] } | undefined;
      if (!prior || !same(prior.dependencies, dependencies))
        slots[index] = { value: factory(), dependencies };
      return (slots[index] as { value: unknown }).value;
    },
    useCallback(callback: unknown, dependencies: readonly unknown[]) {
      const index = cursor++;
      const prior = slots[index] as
        { value: unknown; dependencies: readonly unknown[] } | undefined;
      if (!prior || !same(prior.dependencies, dependencies))
        slots[index] = { value: callback, dependencies };
      return (slots[index] as { value: unknown }).value;
    },
    useEffect(effect: () => (() => void) | undefined, dependencies?: readonly unknown[]) {
      const index = cursor++;
      const prior = effects.get(index);
      if (!prior || !same(prior.dependencies, dependencies))
        queuedEffects.push(() => {
          prior?.cleanup?.();
          effects.set(index, { dependencies, cleanup: effect() });
        });
    },
  }));
  let blocker: {
    shouldBlockFn: (input: unknown) => Promise<boolean>;
    enableBeforeUnload: () => boolean;
  };
  const router = await import("@tanstack/react-router");
  mock.module("@tanstack/react-router", () => ({
    ...router,
    useBlocker: (options: typeof blocker) => {
      blocker = options;
    },
  }));
  let leaveGuard: (() => Promise<boolean>) | undefined;
  const account = {
    registerLeaveGuard: (guard: () => Promise<boolean>) => {
      leaveGuard = guard;
      return () => {
        leaveGuard = undefined;
      };
    },
  };
  mock.module("@/components/account/AccountProvider", () => ({ useAccount: () => account }));
  mock.module("@/components/account/useWorkspaceText", () => ({
    useWorkspaceText: () => (text: string) => text,
  }));
  mock.module("@/components/workbench/context", () => ({ useWorkbench: () => null }));
  mock.module("@/components/workbench/ChatRecents", () => ({ ChatRecents: () => null }));
  let failList = true;
  let failSave = false;
  let listCalls = 0;
  let saveCalls = 0;
  let confirmation = false;
  let confirms = 0;
  const { newChat } = await import("../src/lib/chat-history");
  const saved = {
    ...newChat("current"),
    revision: 2,
    title: "Preserved cloud chat",
    messages: [{ role: "user" as const, text: "Cloud history" }],
  };
  let waitingList: Promise<(typeof saved)[]> | null = null;
  mock.module("@/lib/chat-history.functions", () => ({
    listWorkspaceChats: async () => {
      listCalls++;
      if (waitingList) return waitingList;
      if (failList)
        throw new Error(
          "Cloud chat history is unavailable. Check the chat-history migration and try again.",
        );
      return [saved];
    },
    readWorkspaceChat: async () => ({ ...saved, messages: [...saved.messages] }),
    saveWorkspaceChat: async ({ data }: { data: { record: typeof saved } }) => {
      saveCalls++;
      if (failSave) throw new Error("Your chat could not be saved to your account.");
      return { ...data.record, revision: data.record.revision + 1 };
    },
    deleteWorkspaceChat: async () => {
      throw new Error("No test may delete history");
    },
  }));
  Object.assign(globalThis, {
    window: {
      location: { href: "https://fixture.invalid/workspace" },
      addEventListener() {},
      removeEventListener() {},
      confirm() {
        confirms++;
        return confirmation;
      },
    },
  });
  const { ChatHistoryProvider } = await import("../src/components/workbench/ChatHistory");
  const element = ChatHistoryProvider({
    scope: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    project: "current",
    children: null,
  });
  const Session = element.type as (props: typeof element.props) => React.ReactElement<{
    value: {
      active: ReturnType<typeof newChat>;
      ready: boolean;
      temporary: boolean;
      blocked: boolean;
      unavailable: boolean;
      recovering: boolean;
      error: string;
      rows: unknown[];
      snapshot(messages: { role: "user"; text: string }[], draft: string): void;
      retry(): void;
      select(id?: string): Promise<boolean>;
    };
  }>;
  let state: ReturnType<typeof Session>["props"]["value"];
  function render() {
    cursor = 0;
    dirty = false;
    state = Session(element.props).props.value;
    const pending = queuedEffects;
    queuedEffects = [];
    pending.forEach((effect) => effect());
  }
  async function settle() {
    for (let index = 0; index < 20; index++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (dirty) render();
    }
  }
  render();
  await settle();
  assert.equal(state!.ready, true, "failed initial history must not hide the composer");
  assert.equal(state!.temporary, true);
  assert.equal(state!.blocked, false);
  assert.equal(state!.unavailable, true);
  assert.match(state!.error, /stays in this tab/i);
  assert.equal(saveCalls, 0);
  assert.equal(await leaveGuard!(), true, "empty degraded chat must not trap sign-out");
  assert.equal(blocker!.enableBeforeUnload(), false);
  const temporaryId = state!.active.id;
  state!.snapshot([{ role: "user", text: "Keep my review" }], "Unsent draft");
  await settle();
  assert.equal(saveCalls, 0, "temporary work must not be uploaded");
  assert.equal(blocker!.enableBeforeUnload(), true);
  assert.equal(await leaveGuard!(), false, "unsaved temporary work requires discard consent");
  assert.ok(confirms > 0);
  const beforeSameShoot = confirms;
  assert.equal(
    await blocker!.shouldBlockFn({
      next: {
        routeId: "/shoots/$id/develop",
        pathname: "/shoots/legacy/develop",
        search: {},
      },
    }),
    false,
    "canonical Develop in the same workspace retains temporary chat without a discard prompt",
  );
  assert.equal(confirms, beforeSameShoot);
  assert.equal(
    await blocker!.shouldBlockFn({
      next: { routeId: "/develop", pathname: "/develop", search: {} },
    }),
    true,
    "bare Develop changes to the dashboard shell and must protect the unmounting temporary chat",
  );
  assert.equal(confirms, beforeSameShoot + 1);
  assert.equal(state!.active.id, temporaryId);
  assert.equal(state!.active.draft, "Unsent draft");
  assert.equal(state!.active.messages[0]!.text, "Keep my review");
  assert.equal(saveCalls, 0);
  assert.equal(
    await blocker!.shouldBlockFn({
      next: {
        routeId: "/workspace",
        pathname: "/workspace",
        search: { shoot: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      },
    }),
    true,
    "switching shoots must warn about the temporary conversation",
  );
  state!.retry();
  await settle();
  assert.equal(listCalls, 2);
  assert.equal(state!.active.id, temporaryId);
  assert.equal(state!.active.draft, "Unsent draft");
  assert.equal(state!.active.messages[0]!.text, "Keep my review");
  assert.equal(state!.ready, true);
  failList = false;
  state!.retry();
  await settle();
  assert.equal(state!.unavailable, false);
  assert.equal(state!.error, "");
  assert.equal(state!.temporary, true, "recovery must not silently publish temporary messages");
  assert.equal(state!.active.id, temporaryId);
  assert.equal(state!.active.draft, "Unsent draft");
  assert.equal(state!.rows.length, 1);
  assert.equal(saveCalls, 0);
  assert.equal(await state!.select(saved.id), false);
  confirmation = true;
  assert.equal(await state!.select(saved.id), true);
  await settle();
  assert.equal(state!.temporary, false);
  assert.equal(state!.active.id, saved.id);
  failSave = true;
  state!.snapshot([{ role: "user", text: "Must not silently lose a failed cloud save" }], "");
  await settle();
  assert.equal(state!.blocked, true, "actual save errors must remain blocking and exportable");
  assert.equal(state!.temporary, false, "a failed cloud save must not become a disposable chat");
  await assert.rejects(() => leaveGuard!(), /could not be saved/);
  for (const effect of effects.values()) effect.cleanup?.();
  // A fatal local transcript error arising during Retry cannot be hidden by its
  // later success or failure. The original text must remain available to export.
  for (const succeeds of [true, false]) {
    slots.length = 0;
    effects.clear();
    queuedEffects = [];
    dirty = false;
    failList = true;
    waitingList = null;
    render();
    await settle();
    let finish!: (rows: (typeof saved)[]) => void;
    let reject!: (error: Error) => void;
    waitingList = new Promise((resolve, fail) => {
      finish = resolve;
      reject = fail;
    });
    state!.retry();
    await settle();
    state!.snapshot([{ role: "user", text: "x".repeat(32_001) }], "Retain draft");
    await settle();
    assert.equal(state!.blocked, true);
    if (succeeds) finish([saved]);
    else reject(new Error("History remains offline"));
    await settle();
    assert.equal(state!.blocked, true);
    assert.match(state!.error, /saved-message limit/);
    assert.equal(state!.active.messages[0]!.text.length, 32_001);
    assert.equal(state!.active.draft, "Retain draft");
    for (const effect of effects.values()) effect.cleanup?.();
  }
  // A response arriving after account/shoot unmount must not reopen old history.
  slots.length = 0;
  effects.clear();
  queuedEffects = [];
  dirty = false;
  let resolveList!: (rows: (typeof saved)[]) => void;
  mock.module("@/lib/chat-history.functions", () => ({
    listWorkspaceChats: () =>
      new Promise<(typeof saved)[]>((resolve) => {
        resolveList = resolve;
      }),
    readWorkspaceChat: async () => saved,
  }));
  render();
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (dirty) render();
  for (const effect of effects.values()) effect.cleanup?.();
  dirty = false;
  resolveList([saved]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(dirty, false, "late responses must not update the closed workspace");
  console.log("DEGRADED_CHAT_OK");
}
