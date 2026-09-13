import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  saveDevelopExportScope,
  readDevelopExportScope,
  createDevelopBatchPlan,
  prepareDevelopBatch,
  developBatchZip,
  assertDevelopBatchCurrent,
  DEVELOP_BATCH_LIMITS,
  type DevelopBatchStore,
} from "../src/lib/develop/export-scope";
import {
  createDevelopDocument,
  pushHistory,
  currentRecipe,
  mergeDevelopImportCommit,
  type DevelopImportCommit,
  type DevelopLibrary,
  type DevelopPhoto,
} from "../src/lib/develop/store";
import { defaultDevelopSettings } from "../src/lib/develop/contract";

function storage() {
  const rows = new Map<string, string>();
  return {
    rows,
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    },
  };
}
const namespace = JSON.stringify(["synthetic-owner", "shoot:synthetic"]);
const config = { edge: 2048, quality: 95, sourceMode: "raw" as const };
const jpeg = () =>
  new Blob(
    [
      Uint8Array.from([
        255, 216, 255, 192, 0, 11, 8, 0, 2, 0, 3, 1, 1, 17, 0, 255, 218, 0, 8, 1, 1, 0, 0, 63, 0,
        17, 255, 217,
      ]),
    ],
    { type: "image/jpeg" },
  );
function handoff(ids: string[] = ["b", "a"], kind: "keepers" | "selected" | "group" = "keepers") {
  const session = storage();
  const token = saveDevelopExportScope(session, namespace, {
    kind,
    photoIds: ids,
    label: "Fixture keepers",
  });
  return {
    session,
    token,
    scope: readDevelopExportScope(session, namespace, `/develop?exportScope=${token}`)!,
  };
}
function fixture() {
  const { scope } = handoff();
  const photos: DevelopPhoto[] = ["a", "b", "rejected"].map((id) => ({
    id,
    name: "same.jpg",
    sourceFileName: `${id}.jpg`,
    sourceLastModified: 1,
    sourceBlob: new Blob([`source-${id}`], { type: "image/jpeg" }),
    sourceAvailable: true,
    sourceDigest: `digest-${id}`,
    previewBlob: new Blob([`preview-${id}`]),
    previewOrigin: "raster",
    isRaw: false,
    width: 3,
    height: 2,
    createdAt: 1,
  }));
  const documents = Object.fromEntries(
    photos.map((photo, index) => {
      const document = pushHistory(
        createDevelopDocument(photo.id),
        { ...defaultDevelopSettings(), exposure: index + 0.25 },
        "Fixture recipe",
      );
      document.metadata.flag = photo.id === "rejected" ? "reject" : "pick";
      return [photo.id, document];
    }),
  );
  const snapshot: DevelopImportCommit = { photos, documents };
  const reads: string[][] = [];
  const store: DevelopBatchStore = {
    namespace,
    async readPhotosWithDocuments(ids) {
      reads.push([...ids]);
      return structuredClone({
        photos: photos.filter((photo) => ids.includes(photo.id)),
        documents: Object.fromEntries(
          ids.filter((id) => documents[id]).map((id) => [id, documents[id]]),
        ),
      });
    },
  };
  return { scope, store, snapshot, reads };
}

describe("explicit Develop export scope", () => {
  test("retains ordered exact IDs, scope and label without exporting or changing selection", () => {
    const f = handoff();
    expect(f.scope.photoIds).toEqual(["b", "a"]);
    expect(f.scope.namespace).toBe(namespace);
    expect(f.scope.label).toBe("Fixture keepers");
    expect(Object.isFrozen(f.scope.photoIds)).toBe(true);
    expect(readDevelopExportScope(f.session, namespace, `/develop?exportScope=${f.token}`)).toEqual(
      f.scope,
    );
    expect(readDevelopExportScope(f.session, namespace, "/develop")).toBeNull();
  });
  test.each([
    { ids: [] },
    { ids: ["a", "a"] },
    { ids: Array.from({ length: 201 }, (_, i) => String(i)) },
  ])("rejects empty, repeated or oversized sets %#", ({ ids }) => {
    expect(() => handoff(ids)).toThrow();
  });
  test("rejects missing, foreign, expired, future and ambiguous references", () => {
    const f = handoff();
    for (const href of [
      "/develop?exportScope=",
      `/develop?exportScope=${crypto.randomUUID()}`,
      `/develop?exportScope=${f.token}&exportScope=${f.token}`,
      `/develop?exportScope=${f.token}&deliveryVersion=v1`,
    ])
      expect(() => readDevelopExportScope(f.session, namespace, href)).toThrow();
    expect(() =>
      readDevelopExportScope(f.session, "another-owner", `/develop?exportScope=${f.token}`),
    ).toThrow();
    for (const now of [f.scope.createdAt - 1, f.scope.createdAt + 86400000])
      expect(() =>
        readDevelopExportScope(f.session, namespace, `/develop?exportScope=${f.token}`, now),
      ).toThrow();
  });
  test("rejects tampered envelope identity/schema and failed storage readback", () => {
    const f = handoff(),
      key = [...f.session.rows.keys()][0]!;
    for (const patch of [
      { id: crypto.randomUUID() },
      { photoIds: ["a", "a"] },
      { version: 2 },
      { approved: true },
    ]) {
      f.session.rows.set(key, JSON.stringify({ ...f.scope, ...patch }));
      expect(() =>
        readDevelopExportScope(f.session, namespace, `/develop?exportScope=${f.token}`),
      ).toThrow();
    }
    expect(() =>
      saveDevelopExportScope({ getItem: () => null, setItem() {} }, namespace, {
        kind: "keepers",
        photoIds: ["a"],
        label: "Keepers",
      }),
    ).toThrow("could not be saved");
    expect(() =>
      saveDevelopExportScope(
        {
          getItem: () => "existing",
          setItem() {
            throw new Error("must not overwrite");
          },
        },
        namespace,
        { kind: "keepers", photoIds: ["a"], label: "Keepers" },
      ),
    ).toThrow("already exists");
  });
});

// Execute the current editor reducer and handoff effect without global module mocks.
const editorSource = readFileSync(
  new URL("../src/components/develop/DevelopPage.tsx", import.meta.url),
  "utf8",
);
const transpiler = new Bun.Transpiler({ loader: "tsx" });
function editorFragment(start: string, end: string) {
  const from = editorSource.indexOf(start);
  const to = editorSource.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Missing editor test boundary: ${start}`);
  return editorSource.slice(from, to);
}
function executeEditor(code: string, context: Record<string, unknown>) {
  return new Function(...Object.keys(context), transpiler.transformSync(code))(
    ...Object.values(context),
  );
}
describe("Develop route handoff and catalog ownership", () => {
  test.each(["valid", "foreign", "missing"])(
    "actual handoff effect opens only the exact valid scope without changing the active selection (%s)",
    (condition) => {
      const f = handoff();
      const calls: [string, unknown][] = [];
      executeEditor(
        editorFragment(
          "  useEffect(() => {\n    if (!hydration.current.ready || !ready)",
          "  useEffect(() => {\n    setDialogError",
        ),
        {
          useEffect: (callback: () => void) => callback(),
          hydration: { current: { ready: true } },
          ready: true,
          store: { namespace: condition === "foreign" ? "another-owner" : namespace },
          href: `/develop?exportScope=${f.token}`,
          openedExportScope: { current: "" },
          sessionStorage: f.session,
          readDevelopExportScope,
          library: {
            photos: condition === "missing" ? [{ id: "a" }] : [{ id: "a" }, { id: "b" }],
            documents: { a: {}, b: {} },
          },
          setExportScope: (value: unknown) => calls.push(["scope", value]),
          setBatchProof: (value: unknown) => calls.push(["proof", value]),
          setBatchIndex: (value: unknown) => calls.push(["index", value]),
          setDialog: (value: unknown) => calls.push(["dialog", value]),
          setLoadError: (value: unknown) => calls.push(["error", value]),
          errorMessage: (error: Error) => error.message,
          // There intentionally are no active-photo, selectedSet, or filter setters.
        },
      );
      if (condition === "valid") {
        expect(calls).toEqual([
          ["scope", f.scope],
          ["proof", null],
          ["index", 0],
          ["dialog", "export"],
        ]);
      } else {
        expect(calls.map(([kind]) => kind)).toEqual(["error"]);
      }
    },
  );
  test.each(["preview", "download"])(
    "actual %s action flushes first and refuses late results after owner navigation",
    async (kind) => {
      for (const navigate of ["never", "flush", "render"] as const) {
        const f = fixture();
        const plan = await createDevelopBatchPlan(f.scope, f.store, config);
        const proof = await prepareDevelopBatch(plan, f.store, { render: async () => jpeg() });
        const hydration = { current: { ready: true } };
        const calls: string[] = [];
        let busy = "";
        const context = {
          exportScope: f.scope,
          batchProof: proof,
          batchReady: true,
          dialog: "export",
          editsLocked: () => false,
          hydration,
          alive: { current: true },
          operationLock: { current: null },
          exportAbort: { current: null },
          setDialogError: () => {},
          setBatchProof: (value: unknown) => value && calls.push("proof"),
          setBatchIndex: () => {},
          setBusy: (value: string) => (busy = value),
          setBatchProgress: () => {},
          setNotice: () => {},
          setDialog: () => {},
          flush: async () => {
            calls.push("flush");
            await Promise.resolve();
            if (navigate === "flush") hydration.current = { ready: true };
            return true;
          },
          store: f.store,
          exportEdge: config.edge,
          exportQuality: config.quality,
          exportSourceMode: config.sourceMode,
          createDevelopBatchPlan,
          prepareDevelopBatch: async () => {
            calls.push("native");
            if (navigate === "render") hydration.current = { ready: true };
            return proof;
          },
          developBatchZip: async () => {
            calls.push("zip");
            if (navigate === "render") hydration.current = { ready: true };
            return new Blob(["synthetic ZIP"]);
          },
          download: () => calls.push("download"),
          errorMessage: (error: Error) => error.message,
        };
        const action = executeEditor(
          editorFragment(
            "  async function previewBatchExport() {",
            "  async function previewExport() {",
          ) + `\nreturn ${kind === "preview" ? "previewBatchExport" : "downloadBatchExport"};`,
          context,
        ) as () => Promise<void>;
        await action();
        expect(calls).toEqual(
          navigate === "flush"
            ? ["flush"]
            : kind === "preview"
              ? navigate === "render"
                ? ["flush", "native"]
                : ["flush", "native", "proof"]
              : navigate === "render"
                ? ["flush", "zip"]
                : ["flush", "zip", "download"],
        );
        expect(busy).toBe("");
        expect(context.operationLock.current).toBeNull();
        expect(context.exportAbort.current).toBeNull();
      }
    },
  );
  test.each([false, true])(
    "canonical manifest order wins over completion order without replacing a dirty draft (raced=%s)",
    async (raced) => {
      const f = fixture();
      const dirty = structuredClone(f.snapshot.documents.b!);
      dirty.history[dirty.cursor]!.settings.exposure = 3;
      let library: DevelopLibrary = {
        photos: [f.snapshot.photos[1]!],
        documents: { b: dirty },
        presets: [],
      };
      const receipt = {
        photos: [f.snapshot.photos[0]!],
        documents: { a: f.snapshot.documents.a! },
      };
      const docs = { current: library.documents };
      const changes = { current: new Map([["a", receipt]]) };
      let scheduled!: () => Promise<unknown>;
      let fullReads = 0;
      let error = "";
      const canonicalIds = raced ? ["a", "b", "rejected"] : ["a", "b"];
      const code = editorFragment(
        "  useEffect(() => {\n    if (!ready || !hydration.current.ready || failed.current",
        "  function persistBatch(",
      ).replace("void (async () => {", "return (async () => {");
      executeEditor(code, {
        useEffect: (callback: () => void) => callback(),
        setTimeout: (callback: typeof scheduled) => (scheduled = callback),
        clearTimeout: () => {},
        ready: true,
        hydration: { current: { ready: true } },
        failed: { current: false },
        pendingRef: { current: 0 },
        alive: { current: true },
        catalogChanges: changes,
        importState: { selectedId: null, jobId: null },
        importSelection: { current: { selected: true, jobId: null } },
        importing: false,
        reconnectLibrary: { current: library },
        docs,
        store: {
          ...f.store,
          readManifest: async () => ({ photoIds: canonicalIds }),
          loadLibrary: async () => {
            fullReads++;
            return { ...f.snapshot, presets: [] };
          },
        },
        mergeDevelopImportCommit,
        presetsChanged: { current: false },
        draftDirtyRef: { current: true },
        selectedRef: { current: "b" },
        revisions: { current: { b: dirty.revision } },
        currentRecipe,
        draftRef: { current: currentRecipe(dirty) },
        setDraft: () => {
          throw new Error("A pending draft cannot be replaced by an import refresh");
        },
        setLibrary: (update: (previous: DevelopLibrary) => DevelopLibrary) => {
          library = update(library);
        },
        operationLock: { current: null },
        setSaveError: (value: string) => (error = value),
        errorMessage: (value: Error) => value.message,
        catalogSignal: 1,
        pending: 0,
        repository: {},
      });
      await scheduled();
      expect(error).toBe("");
      expect(library.photos.map((photo) => photo.id)).toEqual(canonicalIds);
      expect(library.documents.b).toBe(dirty);
      expect(currentRecipe(library.documents.b!).exposure).toBe(3);
      expect(changes.current.size).toBe(0);
      expect(fullReads).toBe(raced ? 1 : 0);
    },
  );
});

describe("canonical native batch proof and ZIP", () => {
  test("uses frozen per-photo native recipes in scope order and archives the exact proof bytes", async () => {
    const f = fixture(),
      plan = await createDevelopBatchPlan(f.scope, f.store, config);
    const calls: unknown[] = [];
    const proof = await prepareDevelopBatch(plan, f.store, {
      render: async (source, recipe, options) => {
        calls.push({ source: await source.text(), exposure: recipe!.exposure, options });
        return jpeg();
      },
    });
    expect(plan.frames.map((frame) => frame.id)).toEqual(["b", "a"]);
    expect(plan.frames.map((frame) => frame.filename)).toEqual(["same.jpg", "same (2).jpg"]);
    expect(calls).toEqual([
      {
        source: "source-b",
        exposure: 1.25,
        options: { edge: 2048, quality: 0.95, sourceMode: "preview", nativeOnly: true },
      },
      {
        source: "source-a",
        exposure: 0.25,
        options: { edge: 2048, quality: 0.95, sourceMode: "preview", nativeOnly: true },
      },
    ]);
    expect(proof.images.map((image) => [image.width, image.height])).toEqual([
      [3, 2],
      [3, 2],
    ]);
    const zip = await developBatchZip(proof, f.store);
    const bytes = new Uint8Array(await zip.arrayBuffer()),
      data = new Uint8Array(await jpeg().arrayBuffer());
    expect(new TextDecoder().decode(bytes)).toContain("same (2).jpg");
    expect(Array.from(bytes.slice(38, 38 + data.length))).toEqual(Array.from(data));
    expect(f.snapshot.documents.rejected!.metadata.flag).toBe("reject");
    expect(f.reads.every((ids) => ids.join() === "b,a")).toBe(true);
    expect(Object.isFrozen(plan.frames[0]!.recipe.crop)).toBe(true);
  });
  test.each(["missing", "foreign", "nonkeeper", "source"])(
    "refuses %s before any rendering",
    async (kind) => {
      const f = fixture();
      if (kind === "missing") delete f.snapshot.documents.b;
      if (kind === "foreign") f.store.namespace = "other-account";
      if (kind === "nonkeeper") f.snapshot.documents.b!.metadata.flag = "reject";
      if (kind === "source") f.snapshot.photos[1]!.sourceBlob = null;
      await expect(createDevelopBatchPlan(f.scope, f.store, config)).rejects.toThrow();
    },
  );
  test("RAW never silently swaps the original and the explicitly chosen saved preview", async () => {
    const f = fixture();
    f.snapshot.photos[1]!.isRaw = true;
    const raw = await createDevelopBatchPlan(f.scope, f.store, config);
    expect(raw.frames[0]!.sourceMode).toBe("raw");
    expect(await raw.frames[0]!.source.text()).toBe("source-b");
    const preview = await createDevelopBatchPlan(f.scope, f.store, {
      ...config,
      sourceMode: "preview",
    });
    expect(preview.frames[0]!.sourceMode).toBe("preview");
    expect(await preview.frames[0]!.source.text()).toBe("preview-b");
    f.snapshot.photos[1]!.previewBlob = null;
    await expect(
      createDevelopBatchPlan(f.scope, f.store, { ...config, sourceMode: "preview" }),
    ).rejects.toThrow();
  });
  test.each(["recipe", "revision", "flag", "bytes", "digest", "name"])(
    "changed %s cannot reuse an earlier proof",
    async (change) => {
      const f = fixture(),
        plan = await createDevelopBatchPlan(f.scope, f.store, config);
      const proof = await prepareDevelopBatch(plan, f.store, { render: async () => jpeg() });
      if (change === "recipe")
        f.snapshot.documents.b!.history[f.snapshot.documents.b!.cursor]!.settings.exposure = 4;
      if (change === "revision") f.snapshot.documents.b!.revision++;
      if (change === "flag") f.snapshot.documents.b!.metadata.flag = "reject";
      if (change === "bytes") f.snapshot.photos[1]!.sourceBlob = new Blob(["changed!"]);
      if (change === "digest") f.snapshot.photos[1]!.sourceDigest = "reconnected";
      if (change === "name") f.snapshot.photos[1]!.name = "renamed.jpg";
      await expect(developBatchZip(proof, f.store)).rejects.toThrow();
    },
  );
  test("a mutation during render, failure or cancellation never yields a partial proof", async () => {
    for (const outcome of ["mutation", "failure", "cancel"] as const) {
      const f = fixture(),
        plan = await createDevelopBatchPlan(f.scope, f.store, config),
        controller = new AbortController();
      let calls = 0;
      await expect(
        prepareDevelopBatch(plan, f.store, {
          signal: controller.signal,
          render: async () => {
            calls++;
            if (outcome === "mutation") f.snapshot.documents.b!.revision++;
            if (outcome === "failure") throw new Error("synthetic native failure");
            if (outcome === "cancel") controller.abort();
            return jpeg();
          },
        }),
      ).rejects.toThrow();
      expect(calls).toBe(outcome === "mutation" ? 2 : 1);
    }
  });
  test("rejects fake plans/proofs, malformed JPEGs, excessive output and pre-cancelled downloads", async () => {
    const f = fixture(),
      plan = await createDevelopBatchPlan(f.scope, f.store, config);
    await expect(assertDevelopBatchCurrent({ ...plan }, f.store)).rejects.toThrow();
    await expect(
      prepareDevelopBatch(plan, f.store, { render: async () => new Blob(["not JPEG"]) }),
    ).rejects.toThrow();
    await expect(
      prepareDevelopBatch(plan, f.store, {
        render: async () => new Blob([new Uint8Array(DEVELOP_BATCH_LIMITS.bytes + 1)]),
      }),
    ).rejects.toThrow("100 MiB");
    const proof = await prepareDevelopBatch(plan, f.store, { render: async () => jpeg() });
    await expect(developBatchZip({ ...proof }, f.store)).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    await expect(developBatchZip(proof, f.store, controller.signal)).rejects.toThrow();
  });
});
