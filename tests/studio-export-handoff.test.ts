import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { saveDevelopExportScope, readDevelopExportScope } from "../src/lib/develop/export-scope";

const source = readFileSync(new URL("../src/routes/studio.tsx", import.meta.url), "utf8");
const start = source.indexOf("  async function openDevelop(");
const end = source.indexOf("  canonicalOpenRef.current =", start);
const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(start, end));

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
      () => true,
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
  return { run, state, storage, notes, navigations };
}

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
