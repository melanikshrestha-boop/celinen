import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { saveDevelopExportScope, readDevelopExportScope } from "../src/lib/develop/export-scope";
import {
  parseStudioWorkflowIntent,
  selectDeadlineKeepers,
} from "../src/lib/studio/workflow-intents";

const source = readFileSync(new URL("../src/routes/studio.tsx", import.meta.url), "utf8");
const start = source.indexOf("  async function openDevelop(");
const end = source.indexOf("  canonicalOpenRef.current =", start);
const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(start, end));
const workflowStart = source.indexOf("  const openWorkflow =");
const workflowEnd = source.indexOf("  const shootBrief =", workflowStart);
const requestStart = source.indexOf("  const requestDevelopOutput = useCallback(");
const requestEnd = source.indexOf("  // Image edits and rendered exports", requestStart);
const workflowCode = new Bun.Transpiler({ loader: "tsx" }).transformSync(
  source.slice(requestStart, requestEnd) + source.slice(workflowStart, workflowEnd),
);

function fixture() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const notes: string[] = [],
    navigations: string[] = [];
  const state = {
    mounted: { current: true },
    delivery: null as object | null,
    proposal: { current: null as object | null },
    flush: async () => true,
    ready: true,
    shots: [
      { id: "b", verdict: "keep" },
      { id: "rejected-active", verdict: "reject" },
      { id: "a", verdict: "keep" },
      { id: "outside-scene", verdict: "keep" },
    ],
  };
  const run = (ids?: readonly string[]) =>
    new Function(
      "canPersistStudioSession",
      "sessionStatusRef",
      "setSyncNote",
      "proposalRef",
      "repository",
      "mountedRef",
      "developWorkspaceHref",
      "projectId",
      "shootId",
      "deliveryFocus",
      "latestSelectedIdRef",
      "canonicalView",
      "saveDevelopExportScope",
      "window",
      "sceneIds",
      "workbench",
      "navigate",
      "pauseSaving",
      code + "\nreturn openDevelop;",
    )(
      () => state.ready,
      { current: "ready" },
      (note: string) => notes.push(note),
      state.proposal,
      { namespace: "local:shoot-one", flush: () => state.flush() },
      state.mounted,
      () => "/shoots/one/develop?photo=not-a-keeper",
      undefined,
      "one",
      state.delivery,
      { current: "not-a-keeper" },
      { photoId: (id: string) => (id === "missing" ? null : `canonical:${id}`) },
      saveDevelopExportScope,
      { sessionStorage: storage },
      new Set(["b", "a"]),
      null,
      async ({ href }: { href: string }) => {
        navigations.push(href);
      },
      () => {
        throw new Error("An export error must not pause unrelated saves");
      },
    )(ids) as Promise<boolean>;
  const workflow = async (command: string) => {
    const pending: Promise<boolean>[] = [];
    const context = {
      useCallback: (callback: unknown) => callback,
      canPersistStudioSession: () => state.ready,
      sessionStatusRef: { current: "ready" },
      proposalRef: state.proposal,
      mountedRef: state.mounted,
      latestShotsRef: { current: state.shots },
      scopedShots: state.shots.filter((shot) => shot.id !== "outside-scene"),
      importingRef: { current: false },
      folderAbortRef: { current: null },
      setPeopleOpen: () => {},
      setSceneOpen: () => {},
      setBurstOpen: () => {},
      selectDeadlineKeepers,
      canonicalOpenRef: {
        current: (ids?: readonly string[]) => {
          const result = run(ids);
          pending.push(result);
          return result;
        },
      },
      setSyncNote: (note: string) => notes.push(note),
    };
    const openWorkflow = new Function(
      ...Object.keys(context),
      workflowCode + "\nreturn openWorkflow;",
    )(...Object.values(context));
    const reply = openWorkflow(parseStudioWorkflowIntent(command));
    await Promise.all(pending);
    return reply as string;
  };
  return { run, workflow, state, storage, notes, navigations };
}

test("deadline chat count survives the actual route callbacks into exact canonical scope", async () => {
  for (const count of [1, 2, 20]) {
    const app = fixture();
    const before = structuredClone(app.state.shots);
    const reply = await app.workflow(`prepare ${count} deadline photos`);
    expect(app.navigations).toHaveLength(1);
    const scope = readDevelopExportScope(app.storage, "local:shoot-one", app.navigations[0]!);
    expect(scope?.photoIds).toEqual(count === 1 ? ["canonical:b"] : ["canonical:b", "canonical:a"]);
    expect(app.state.shots).toEqual(before);
    expect(reply).not.toContain("exported successfully");
    if (count === 20) expect(reply).toContain("Only 2 of 20");
  }
});

test("deadline workflow cannot bypass empty scope, pending proposal, save failure or exact delivery fences", async () => {
  for (const setup of [
    (app: ReturnType<typeof fixture>) => {
      app.state.shots = [{ id: "rejected", verdict: "reject" }];
    },
    (app: ReturnType<typeof fixture>) => {
      app.state.proposal.current = {};
    },
    (app: ReturnType<typeof fixture>) => {
      app.state.ready = false;
    },
    (app: ReturnType<typeof fixture>) => {
      app.state.flush = async () => false;
    },
    (app: ReturnType<typeof fixture>) => {
      app.state.delivery = {};
    },
  ]) {
    const app = fixture();
    setup(app);
    await app.workflow("prepare 2 deadline photos");
    expect(app.navigations).toEqual([]);
  }
});

test("keeper handoff freezes exact ordered canonical IDs after saving, not active photo", async () => {
  const app = fixture();
  let flushed = false;
  app.state.flush = async () => {
    flushed = true;
    return true;
  };
  expect(await app.run(["b", "a"])).toBe(true);
  expect(flushed).toBe(true);
  const scope = readDevelopExportScope(app.storage, "local:shoot-one", app.navigations[0]!);
  expect(scope?.photoIds).toEqual(["canonical:b", "canonical:a"]);
  expect(scope?.label).toBe("Keepers in this scene");
});

test("missing, duplicate, empty and excessive scopes never navigate or substitute other photos", async () => {
  for (const ids of [["missing"], ["a", "a"], [], Array.from({ length: 201 }, (_, i) => `${i}`)]) {
    const app = fixture();
    expect(await app.run(ids)).toBe(false);
    expect(app.navigations).toEqual([]);
  }
});

test("paused saves, changed owner, pending proposals and exact delivery context block batch handoff", async () => {
  for (const setup of [
    (app: ReturnType<typeof fixture>) => {
      app.state.flush = async () => false;
    },
    (app: ReturnType<typeof fixture>) => {
      app.state.flush = async () => {
        app.state.mounted.current = false;
        return true;
      };
    },
    (app: ReturnType<typeof fixture>) => {
      app.state.proposal.current = {};
    },
    (app: ReturnType<typeof fixture>) => {
      app.state.delivery = {};
    },
  ]) {
    const app = fixture();
    setup(app);
    expect(await app.run(["a"])).toBe(false);
    expect(app.navigations).toHaveLength(0);
  }
});

test("Studio has no local-gallery publish claim or original-ZIP-as-edited-export action", () => {
  expect(source).not.toContain("sendTonightKeepers");
  expect(source).not.toContain("zipped to Downloads");
  expect(source).toContain("Download original keepers ZIP");
  expect(source).toContain("Develop edits are not included");
  const action = source.slice(
    source.indexOf('case "export_keepers":'),
    source.indexOf('case "write_xmp":'),
  );
  expect(action).toContain("canonicalExportRef.current()");
  expect(action).not.toContain("canonicalOpenRef.current()");
});
