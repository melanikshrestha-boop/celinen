import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  addSnapshot,
  createDevelopStore,
  currentRecipe,
  developPhotoFromFile,
  mergeDevelopImportCommit,
  pushHistory,
  type DevelopImportCommit,
  type DevelopLibrary,
  type DevelopStoreChange,
} from "../src/lib/develop/store";
import type { DevelopSettings } from "../src/lib/develop/contract";
import { developIdbDouble } from "./fixtures/develop-idb-double";

// Execute the real subscription, catalog refresh/adoption, and draft save actions.
// React scheduling and IndexedDB are instance-local doubles; all photos are synthetic.
const source = readFileSync(
  new URL("../src/components/develop/DevelopPage.tsx", import.meta.url),
  "utf8",
);
const transpiler = new Bun.Transpiler({ loader: "tsx" });
function between(start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Missing catalog boundary: ${start}`);
  return source.slice(from, to);
}
const subscriptionCode = between(
  "  useEffect(() => {\n    const unsubscribe = repository.subscribe",
  "  useEffect(() => {\n    setImportFailures",
);
const refreshCode = between(
  "  useEffect(() => {\n    if (!ready || !hydration.current.ready",
  "  function persistBatch(",
).replace("void (async () => {", "return (async () => {");
const saveCode = [
  between("  function markDraftDirty(", "  const adopt = useCallback("),
  between("  function persistBatch(", "  flushLatest.current ="),
].join("\n");
function execute(code: string, context: Record<string, unknown>, result = "") {
  return new Function(...Object.keys(context), transpiler.transformSync(code) + result)(
    ...Object.values(context),
  );
}

async function fixture() {
  const db = developIdbDouble();
  const options = {
    scope: `catalog-qa-${crypto.randomUUID()}`,
    libraryId: "reserved-shoot",
    factory: db.factory,
  };
  const writer = createDevelopStore(options);
  const reader = createDevelopStore(options);
  const inputs = await Promise.all(
    ["a", "b", "c"].map((id) => developPhotoFromFile(new File([`synthetic ${id}`], `${id}.jpg`))),
  );
  const [a, b, c] = inputs;
  const first = await writer.addPhotosWithDocuments([a!]);
  await writer.saveDocument({
    ...addSnapshot(first.documents[a!.id]!, "Preserved snapshot"),
    metadata: { flag: "pick", rating: 4, colorLabel: "green" },
  });
  let library = await reader.loadLibrary();
  const reconnectLibrary = { current: library };
  const docs = { current: library.documents };
  const revisions = {
    current: Object.fromEntries(
      Object.entries(docs.current).map(([id, doc]) => [id, doc.revision]),
    ),
  };
  const selectedRef = { current: a!.id };
  const draftRef = { current: currentRecipe(docs.current[a!.id]!) };
  const draftDirtyRef = { current: false };
  const pendingRef = { current: 0 };
  const queue = { current: Promise.resolve() };
  const failed = { current: false };
  const catalogChanges = { current: new Map<string, DevelopImportCommit | null>() };
  const reads: string[][] = [];
  let error = "";
  let listener!: (change: DevelopStoreChange) => void;
  let unsubscribe: (() => void) | undefined;
  const repository = {
    subscribe(callback: typeof listener) {
      listener = callback;
      unsubscribe = reader.subscribe(callback);
      return unsubscribe;
    },
  };
  const context = {
    useEffect: (callback: () => unknown) => callback(),
    repository,
    importSession: { restore: async () => {} },
    catalogChanges,
    presetsChanged: { current: false },
    setCatalogSignal: () => {},
    setNotice: () => {},
    errorMessage: (value: Error) => value.message,
    ready: true,
    hydration: { current: { ready: true } },
    failed,
    pendingRef,
    alive: { current: true },
    catalogSignal: 0,
    pending: 0,
    importState: { selectedId: null, jobId: null },
    importSelection: { current: { selected: true, jobId: null } },
    importing: false,
    reconnectLibrary,
    docs,
    revisions,
    selectedRef,
    draftRef,
    draftDirtyRef,
    operationLock: { current: null },
    queue,
    store: {
      ...reader,
      readPhotosWithDocuments: async (ids: string[]) => {
        reads.push([...ids]);
        return reader.readPhotosWithDocuments(ids);
      },
    },
    mergeDevelopImportCommit,
    currentRecipe,
    pushHistory,
    setLibrary: (update: (old: DevelopLibrary) => DevelopLibrary) => {
      library = update(library);
      reconnectLibrary.current = library;
    },
    setDraft: (value: DevelopSettings) => (draftRef.current = value),
    setDraftDirty: (value: boolean) => (draftDirtyRef.current = value),
    setPending: () => {},
    setSaveError: (value: string) => (error = value),
  };
  execute(subscriptionCode, context);
  const actions = execute(saveCode, context, "\nreturn { commitDraft };") as {
    commitDraft: () => void;
  };
  return {
    a: a!,
    b: b!,
    c: c!,
    writer,
    reader,
    receive: (change: DevelopStoreChange) => listener(change),
    setDraft(exposure: number) {
      draftRef.current = { ...draftRef.current, exposure };
      draftDirtyRef.current = true;
    },
    async saveDraft() {
      actions.commitDraft();
      await queue.current;
    },
    async refresh() {
      let run!: () => Promise<void>;
      execute(refreshCode, {
        ...context,
        setTimeout: (callback: typeof run) => {
          run = callback;
          return 0;
        },
        clearTimeout: () => {},
      });
      await run();
    },
    get state() {
      return {
        library,
        error,
        dirty: draftDirtyRef.current,
        draft: draftRef.current,
        selected: selectedRef.current,
        reads,
        pendingIds: [...catalogChanges.current.keys()],
      };
    },
    close() {
      unsubscribe?.();
      writer.close();
      reader.close();
    },
  };
}

describe("Develop authoritative catalog receipts", () => {
  test("an old batch cannot block a new photo after another entry saves; the active draft survives its next save", async () => {
    const f = await fixture();
    try {
      const initialA = f.state.library.photos[0]!;
      await f.writer.addPhotosWithDocuments([f.a, f.b]);
      f.setDraft(1);
      await f.saveDraft();
      const savedA = await f.reader.readPhoto(f.a.id);
      const activeA = f.state.library.documents[f.a.id];
      f.setDraft(2);
      await f.refresh();
      expect(f.state.error).toBe("");
      expect(f.state.library.photos.map((photo) => photo.id)).toEqual([f.a.id, f.b.id]);
      expect(f.state.reads).toEqual([[f.a.id]]);
      expect(f.state.pendingIds).toEqual([]);
      expect(f.state.selected).toBe(f.a.id);
      expect(f.state.dirty).toBe(true);
      expect(f.state.draft.exposure).toBe(2);
      expect(f.state.library.documents[f.a.id]).toEqual(activeA);
      expect(f.state.library.documents[f.a.id]!.revision).toBe(savedA!.document.revision);
      expect(f.state.library.photos[0]!.sourceBlob).toBe(initialA.sourceBlob);
      expect(f.state.library.photos[0]!.sourceDigest).toBe(initialA.sourceDigest);
      await f.saveDraft();
      const after = await f.reader.loadLibraryWithManifest();
      expect(currentRecipe(after.documents[f.a.id]!).exposure).toBe(2);
      expect(after.documents[f.a.id]!.metadata).toEqual(savedA!.document.metadata);
      expect(after.documents[f.a.id]!.snapshots).toEqual(savedA!.document.snapshots);
      expect(after.manifest.photoIds).toEqual([f.a.id, f.b.id]);
      expect(after.photos.map((photo) => photo.sourceDigest)).toEqual([
        f.a.sourceDigest,
        f.b.sourceDigest,
      ]);
    } finally {
      f.close();
    }
  });

  test("overlapping batches retain first-seen order and the latest photo metadata", async () => {
    const f = await fixture();
    try {
      await f.writer.addPhotosWithDocuments([f.a, f.b]);
      await f.writer.renamePhoto(f.a.id, "renamed.jpg", f.a.name);
      await f.writer.addPhotosWithDocuments([f.a, f.c]);
      await f.refresh();
      expect(f.state.error).toBe("");
      expect(f.state.library.photos.map((photo) => photo.name)).toEqual([
        "renamed.jpg",
        "b.jpg",
        "c.jpg",
      ]);
      expect(f.state.library.photos.map((photo) => photo.id)).toEqual(
        (await f.reader.readManifest()).photoIds,
      );
      expect(f.state.reads).toEqual([]);
      expect(f.state.pendingIds).toEqual([]);
    } finally {
      f.close();
    }
  });

  test("a targeted reread does not move an earlier imported pick behind a later cached photo", async () => {
    const f = await fixture();
    try {
      const added = await f.writer.addPhotosWithDocuments([f.b]);
      const picked = await f.writer.saveDocument({
        ...added.documents[f.b.id]!,
        metadata: { flag: "pick", rating: 5, colorLabel: null },
      });
      await f.writer.addPhotosWithDocuments([f.c]);
      f.setDraft(2);
      await f.refresh();
      expect(f.state.error).toBe("");
      expect(f.state.library.photos.map((photo) => photo.id)).toEqual([f.a.id, f.b.id, f.c.id]);
      expect(f.state.library.documents[f.b.id]).toEqual(picked);
      expect(f.state.reads).toEqual([[f.b.id]]);
      expect(f.state.draft.exposure).toBe(2);
      expect(f.state.dirty).toBe(true);
    } finally {
      f.close();
    }
  });

  test("a still-authoritative stale revision remains rejected without changing the draft or library", async () => {
    const f = await fixture();
    try {
      const stale = await f.reader.readPhotosWithDocuments([f.a.id]);
      f.setDraft(1);
      await f.saveDraft();
      f.setDraft(2);
      const before = f.state.library;
      f.receive({ kind: "photos", ids: [f.a.id], commit: stale });
      await f.refresh();
      expect(f.state.error).toContain("changed in another tab");
      expect(f.state.library).toBe(before);
      expect(f.state.draft.exposure).toBe(2);
      expect(f.state.dirty).toBe(true);
      expect(f.state.pendingIds).toEqual([f.a.id]);
    } finally {
      f.close();
    }
  });

  test("duplicate or mismatched authoritative receipt entries still fail closed", async () => {
    for (const kind of ["duplicate", "identity"] as const) {
      const f = await fixture();
      try {
        const malformed = await f.reader.readPhotosWithDocuments([f.a.id]);
        if (kind === "duplicate") malformed.photos.push(malformed.photos[0]!);
        else malformed.documents[f.a.id]!.photoId = f.b.id;
        const before = f.state.library;
        f.receive({ kind: "photos", ids: [f.a.id], commit: malformed });
        await f.refresh();
        expect(f.state.error).toContain("receipt does not match");
        expect(f.state.library).toBe(before);
        expect(f.state.pendingIds).toEqual([f.a.id]);
      } finally {
        f.close();
      }
    }
  });
});
