import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  addSnapshot,
  createDevelopDocument,
  currentRecipe,
  pushHistory,
  type DevelopDocument,
} from "../src/lib/develop/store";
import {
  cloneDevelopSettings,
  defaultDevelopSettings,
  type DevelopSettings,
} from "../src/lib/develop/contract";
import {
  currentDevelopExportProof,
  type DevelopExportProof,
} from "../src/components/develop/develop-state";
import { photoExportFilename } from "../src/lib/develop/photo-management";

// Execute the actual editor actions, draft update, navigation fence, and leave guard.
// Only React setters and persistence I/O are replaced with instance-local doubles.
// No browser, account, IndexedDB, network, or customer files are used.
const source = readFileSync(
  new URL("../src/components/develop/DevelopPage.tsx", import.meta.url),
  "utf8",
);
const guardSource = readFileSync(
  new URL("../src/components/workbench/useToolLeaveGuard.ts", import.meta.url),
  "utf8",
)
  .replace(/^import[^\n]+\n/gm, "")
  .replace("export function useToolLeaveGuard", "function useToolLeaveGuard");
const transpiler = new Bun.Transpiler({ loader: "tsx" });
function between(start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Missing editor boundary: ${start}`);
  return source.slice(from, to);
}
const actionCode = [
  between("  function editsLocked() {", "  const adopt = useCallback("),
  between(
    "  const adopt = useCallback(",
    "  useEffect(() => {\n    let cancelled = false;\n    const request = hydration.current;",
  ),
  between("  function updateDoc(", "  function change(next:"),
  between("  function commitDraft(", "  flushLatest.current ="),
  between("  async function previewExport() {", "  async function confirmDialog() {"),
  between(
    "  async function confirmDialog() {",
    "  useEffect(() => {\n    const handler = (e: KeyboardEvent)",
  ),
].join("\n");
const fenceCode = between("  // Hydration fences the current route", "  const [saveError,");
function execute(code: string, context: Record<string, unknown>, result: string) {
  return new Function(...Object.keys(context), transpiler.transformSync(`${code}\n${result}`))(
    ...Object.values(context),
  );
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
type Location = { pathname: string; search: { shoot: string; photo: string } };
type Blocker = {
  shouldBlockFn: (locations: { current: Location; next: Location }) => Promise<boolean>;
};
type EditorActions = {
  confirmDialog: () => Promise<void>;
  previewExport: () => Promise<void>;
  updateDoc: (document: DevelopDocument, internal: boolean) => Promise<boolean>;
  commitDraft: () => void;
  adopt: (library: unknown, selected: string, exact: boolean) => void;
};

function fixture(delayFirstFlush = false, action: "snapshot" | "export" = "snapshot") {
  const gate = deferred();
  const renderGate = deferred();
  const renderEntered = deferred();
  const documents: Record<string, DevelopDocument> = Object.fromEntries(
    (["a", "b"] as const).map((id) => [
      id,
      pushHistory(
        createDevelopDocument(id),
        { ...defaultDevelopSettings(), exposure: id === "a" ? 1 : -1 },
        "Synthetic starting edit",
      ),
    ]),
  );
  const photos = ["a", "b"].map((id) => ({
    id,
    name: `${id}.jpg`,
    sourceBlob: new Blob([`synthetic ${id}`]),
  }));
  const docs = { current: structuredClone(documents) };
  const selectedRef = { current: "a" };
  const draftRef = { current: currentRecipe(documents.a!) };
  const draftDirtyRef = { current: false };
  const operationLock: { current: "dialog" | null } = { current: null };
  const exportAbort: { current: AbortController | null } = { current: null };
  const repository = {};
  const hydration = {
    current: { href: "/develop?shoot=reserved&photo=a", repository, ready: true },
  };
  const writes: DevelopDocument[] = [];
  const downloads: string[] = [];
  const proofs: DevelopExportProof[] = [];
  let flushCalls = 0;
  let confirmations = 0;
  let notice = "";
  let dialog: string | null = action;
  let dialogError = "";
  const flush = async () => {
    if (++flushCalls === 1 && delayFirstFlush) await gate.promise;
    return true;
  };
  const persistBatch = async (updates: DevelopDocument[]) => {
    for (const document of updates) {
      docs.current[document.photoId] = document;
      documents[document.photoId] = structuredClone(document);
      writes.push(structuredClone(document));
    }
    return true;
  };
  const context = {
    useCallback: (fn: unknown) => fn,
    hydration,
    failed: { current: false },
    operationLock,
    alive: { current: true },
    dialog: action,
    selectedRef,
    draftRef,
    draftDirtyRef,
    cloneDevelopSettings,
    setDialogError: (value: string) => (dialogError = value),
    setBusy: () => {},
    exportAbort,
    flush,
    name: "Reserved snapshot",
    docs,
    photo: photos[0],
    addSnapshot,
    currentRecipe,
    defaultDevelopSettings,
    pushHistory,
    persistBatch,
    markDraftDirty: (value: boolean) => (draftDirtyRef.current = value),
    setDraft: (value: DevelopSettings) => (draftRef.current = value),
    setNotice: (value: string) => (notice = value),
    setDialog: (value: string | null) => (dialog = value),
    setName: () => {},
    errorMessage: (error: Error) => error.message,
    exportRequest: {
      id: "a",
      source: photos[0]!.sourceBlob,
      recipeKey: JSON.stringify(draftRef.current),
      edge: 1600,
      quality: 95,
      sourceMode: "preview",
    },
    exportProof: null,
    editorProof: { current: null },
    currentDevelopExportProof,
    renderDevelop: async () => {
      renderEntered.resolve();
      await renderGate.promise;
      return new Blob(["synthetic export"]);
    },
    createImageBitmap: async () => ({ width: 16, height: 12, close: () => {} }),
    download: (_blob: Blob, filename: string) => downloads.push(filename),
    photoExportFilename,
    setExportProof: (proof: DevelopExportProof | null) => {
      if (proof) proofs.push(proof);
    },
    revisions: { current: {} },
    setLibrary: () => {},
    setSelected: (value: string) => (selectedRef.current = value),
    setSelectedSet: () => {},
    setDraftDirty: (value: boolean) => (draftDirtyRef.current = value),
  };
  const actions = execute(
    actionCode,
    context,
    "return { confirmDialog, previewExport, updateDoc, commitDraft, adopt };",
  ) as EditorActions;
  let blocker!: Blocker;
  const registerGuard = execute(
    guardSource,
    {
      useBlocker: (value: Blocker) => (blocker = value),
      useEffect: () => {},
      useAccount: () => null,
      window: {
        confirm: () => {
          confirmations++;
          return true;
        },
      },
    },
    "return useToolLeaveGuard;",
  ) as (risk: string, beforeLeave: () => Promise<boolean>) => void;
  registerGuard("Develop still has work that has not finished saving.", flush);

  return {
    actions,
    release: gate.resolve,
    renderEntered: renderEntered.promise,
    releaseRender: renderGate.resolve,
    rejectRender: renderGate.reject,
    cancelExport: () => exportAbort.current?.abort(),
    async navigateToB() {
      const blocked = await blocker.shouldBlockFn({
        current: { pathname: "/develop", search: { shoot: "reserved", photo: "a" } },
        next: { pathname: "/develop", search: { shoot: "reserved", photo: "b" } },
      });
      if (blocked) return false;
      execute(
        fenceCode,
        {
          useRef: () => hydration,
          href: "/develop?shoot=reserved&photo=b",
          repository,
        },
        "",
      );
      // Model completion of this route's library read with the real adoption function.
      actions.adopt({ photos, documents: structuredClone(documents), presets: [] }, "b", true);
      hydration.current.ready = true;
      return true;
    },
    get state() {
      return {
        selected: selectedRef.current,
        exposure: draftRef.current.exposure,
        documents: structuredClone(documents),
        writes: structuredClone(writes),
        confirmations,
        notice,
        dialog,
        dialogError,
        downloads: [...downloads],
        proofs: [...proofs],
      };
    },
  };
}

describe("Develop dialog actions stay with their navigation owner", () => {
  test("an old snapshot awaiting flush cannot change the newly hydrated photo or its next save", async () => {
    const f = fixture(true);
    const pending = f.actions.confirmDialog();
    try {
      expect(await f.navigateToB()).toBe(true);
      expect(f.state.confirmations).toBe(1);
      expect(f.state.selected).toBe("b");
      expect(f.state.exposure).toBe(-1);
    } finally {
      f.release();
      await pending;
    }
    const afterResume = f.state;
    f.actions.commitDraft();
    expect(currentRecipe(f.state.documents.b!).exposure).toBe(-1);
    expect(afterResume.exposure).toBe(-1);
    expect(afterResume.selected).toBe("b");
    expect(f.state.writes).toEqual([]);
    expect(f.state.notice).not.toBe("Snapshot saved");
  });

  test("a snapshot still saves for the same photo and navigation owner", async () => {
    const f = fixture();
    await f.actions.confirmDialog();
    expect(f.state.writes.map((document) => document.photoId)).toEqual(["a"]);
    expect(f.state.documents.a!.snapshots).toHaveLength(1);
    expect(f.state.documents.a!.snapshots[0]!.name).toBe("Reserved snapshot");
    expect(f.state.selected).toBe("a");
    expect(f.state.exposure).toBe(1);
    expect(currentRecipe(f.state.documents.b!).exposure).toBe(-1);
    expect(f.state.notice).toBe("Snapshot saved");
    expect(f.state.dialog).toBeNull();
    expect(f.state.dialogError).toBe("");
  });

  test("an internal document update for A preserves B's active draft and next save", async () => {
    const f = fixture();
    expect(await f.navigateToB()).toBe(true);
    const updatedA = addSnapshot(f.state.documents.a!, "Background A snapshot");
    expect(await f.actions.updateDoc(updatedA, true)).toBe(true);
    const afterUpdate = f.state;
    f.actions.commitDraft();
    expect(currentRecipe(f.state.documents.b!).exposure).toBe(-1);
    expect(afterUpdate.exposure).toBe(-1);
    expect(afterUpdate.selected).toBe("b");
    expect(f.state.writes.map((document) => document.photoId)).toEqual(["a"]);
    expect(f.state.documents.a!.snapshots).toHaveLength(1);
  });

  for (const action of ["previewExport", "confirmDialog"] as const) {
    for (const outcome of ["success", "failure"] as const) {
      test(`${action} cannot publish a late export ${outcome} after same-shoot navigation`, async () => {
        const f = fixture(false, "export");
        const pending = f.actions[action]();
        try {
          await f.renderEntered;
          expect(await f.navigateToB()).toBe(true);
          expect(f.state.selected).toBe("b");
        } finally {
          if (outcome === "success") f.releaseRender();
          else f.rejectRender(new Error("Reserved old-photo render failure"));
          await pending;
        }
        expect(f.state.proofs).toEqual([]);
        expect(f.state.downloads).toEqual([]);
        expect(f.state.notice).toBe("");
        expect(f.state.dialogError).toBe("");
        expect(f.state.dialog).toBe("export");
        expect(f.state.exposure).toBe(-1);
        expect(f.state.writes).toEqual([]);
      });
    }
  }

  test("same-owner Stop preview still reports cancellation without publishing proof pixels", async () => {
    const f = fixture(false, "export");
    const pending = f.actions.previewExport();
    try {
      await f.renderEntered;
      f.cancelExport();
    } finally {
      f.rejectRender(new DOMException("Reserved cancelled render", "AbortError"));
      await pending;
    }
    expect(f.state.dialogError).toBe("Export preview cancelled.");
    expect(f.state.proofs).toEqual([]);
    expect(f.state.downloads).toEqual([]);
    expect(f.state.selected).toBe("a");
    expect(f.state.exposure).toBe(1);
  });
});
