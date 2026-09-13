import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createCullShootView } from "../src/lib/develop/cull-view";
import { createDevelopImportSession } from "../src/lib/develop/import-session";
import { createShootRepository } from "../src/lib/develop/shoot-repository";
import type { DevelopPhotoInput, DevelopStoreChange } from "../src/lib/develop/store";
import type { Shot } from "../src/lib/imaging";
import * as cull from "../src/lib/studio/cull-on-import";
import { developIdbDouble } from "./fixtures/develop-idb-double";

const source = readFileSync(new URL("../src/routes/studio.tsx", import.meta.url), "utf8");
function callback(from: string, to: string) {
  const start = source.indexOf(from),
    end = source.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error(`Missing actual Studio callback: ${from}`);
  return new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(start, end));
}
const updateBody = callback(
  "  const updateShots = useCallback(",
  "  const runImportCull = useCallback(",
);
const runBody = callback(
  "  const runImportCull = useCallback(",
  "  const selectShot = useCallback(",
);
const verdictBody = callback(
  "  const setVerdict = useCallback(",
  "  const applyVerdicts = useCallback(",
);

function runtime() {
  const state = {
    shots: { current: [] as Shot[] },
    run: { current: { running: false, rerun: false, token: 0, pending: new Map<string, Shot>() } },
    importing: { current: false },
    owner: { current: "synthetic-owner" },
    status: { current: "ready" },
    abort: { current: null as AbortController | null },
    unanalyzed: { current: new Set<string>() },
    calls: 0,
    undo: { current: [] as unknown[] },
  };
  const context = {
    ...cull,
    useCallback: (fn: unknown) => fn,
    sessionStatusRef: state.status,
    canPersistStudioSession: (value: string) => value === "ready",
    latestShotsRef: state.shots,
    importCullRef: state.run,
    importingRef: state.importing,
    importCullOwnerRef: state.owner,
    importAbortRef: state.abort,
    unanalyzedIds: state.unanalyzed,
    mountedRef: { current: true },
    proposalRef: { current: null },
    latestSelectedIdRef: { current: null },
    undoRef: state.undo,
    setShots: () => {},
    setSyncNote: () => {},
    checkpoint: () => {},
    visible: [],
    filter: "all",
    reviewIssue: null,
    nextCullReviewId: () => null,
    selectShot: () => {},
    analyseFile: async () => {
      state.calls++;
      throw new Error("Durable measured evidence must not decode again.");
    },
  };
  const updateShots = new Function(...Object.keys(context), `${updateBody}\nreturn updateShots;`)(
    ...Object.values(context),
  ) as (update: (shots: Shot[]) => Shot[]) => void;
  const complete = { ...context, updateShots };
  const run = new Function(...Object.keys(complete), `${runBody}\nreturn runImportCull;`)(
    ...Object.values(complete),
  ) as (ids?: readonly string[]) => void;
  const setVerdict = (id: string, verdict: Shot["verdict"], advance = false) => {
    // React rebuilds this callback when the visible contact sheet changes.
    const rendered = { ...complete, visible: state.shots.current };
    const action = new Function(...Object.keys(rendered), `${verdictBody}\nreturn setVerdict;`)(
      ...Object.values(rendered),
    ) as (id: string, verdict: Shot["verdict"], advance?: boolean) => void;
    action(id, verdict, advance);
  };
  return { state, updateShots, run, setVerdict };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Actual repository + structured-clone transaction double + actual callbacks.
// Tiny synthetic blobs only; this is not browser or image-quality evidence.
async function heldImport() {
  const db = developIdbDouble();
  const options = {
    scope: `synthetic-cull-refresh-${crypto.randomUUID()}`,
    libraryId: "shoot",
    factory: db.factory,
  };
  const repository = createShootRepository(options);
  const view = createCullShootView(repository);
  await view.read();
  const app = runtime();
  const raw = deferred<void>(),
    saved = deferred<DevelopStoreChange>();
  const stopPhotos = repository.subscribe((change) => {
    if (change.kind === "photos" && change.commit?.photos.length) saved.resolve(change);
  });
  const preparePreview = async (
    file: File,
    input: DevelopPhotoInput,
  ): Promise<DevelopPhotoInput> => {
    if (file.name.endsWith(".ARW")) {
      await raw.promise;
      throw new Error("Synthetic held RAW decode failure");
    }
    return {
      ...input,
      width: 12,
      height: 8,
      previewBlob: new Blob(["synthetic preview"]),
      previewOrigin: "embedded",
      analysis: {
        version: 1,
        kind: "mechanical",
        namespace: repository.namespace,
        photoId: input.id,
        sourceDigest: input.sourceDigest,
        engine: { name: "native-cpp", version: "synthetic-1" },
        representation: "embedded-preview",
        width: 12,
        height: 8,
        analysis: {
          sharpness: 200,
          brightness: 120,
          clippedHighlights: 0,
          clippedShadows: 0,
          hash: "01".repeat(32),
          tone: {
            black: 0,
            white: 255,
            median: 120,
            rMean: 120,
            gMean: 120,
            bMean: 120,
            satMean: 0.2,
          },
        },
      },
    };
  };
  const session = createDevelopImportSession(options, {
    store: repository.store,
    preparePreview,
    unloadTarget: null,
    withLock: async (_name, work) => work(),
  });
  const stopProgress = session.subscribe(() => {
    const report = session.getSnapshot();
    app.state.importing.current =
      !report.observing && ["discovering", "processing"].includes(report.phase);
  });
  const original = new File(["synthetic sports original"], "new.jpg", {
    type: "image/jpeg",
    lastModified: 123,
  });
  const work = session.startFiles([new File(["synthetic raw"], "held.ARW"), original]);
  const change = await saved.promise;
  const first = await view.read(undefined, () => true, [change]);
  app.updateShots(() => first.shots);
  app.run(first.shots.map((shot) => shot.id));
  const before = await repository.read();
  return {
    app,
    view,
    repository,
    session,
    original,
    first,
    before,
    finish: async () => {
      raw.resolve();
      await work;
    },
    close: async () => {
      raw.resolve();
      await work;
      stopPhotos();
      stopProgress();
      session.stopObserving();
      repository.close();
    },
  };
}

test.each(["automatic admission", "keep", "reject", "undecided"] as const)(
  "full read after held import preserves %s",
  async (choice) => {
    const manual = choice === "automatic admission" ? undefined : choice;
    const f = await heldImport();
    try {
      const id = f.first.shots[0]!.id;
      expect(f.app.state.importing.current).toBe(true);
      expect(f.app.state.run.current.pending.has(id)).toBe(true);
      if (manual) {
        f.app.setVerdict(id, manual, false);
        expect(f.app.state.shots.current[0]!.verdict).toBe(manual);
        expect(f.app.state.run.current.pending.size).toBe(0);
        await f.view.save(f.app.state.shots.current, null, "all");
      }
      await f.finish();
      expect(f.session.getSnapshot()).toMatchObject({
        phase: "complete",
        saved: 1,
        failed: 1,
        analyzed: 1,
      });
      expect(f.app.state.importing.current).toBe(false);
      // The failed RAW produces no photo receipt. The terminal progress notification
      // schedules a catalog read with no changes, exactly the route's full-read path.
      const refreshed = await f.view.read();
      const old = new Map(f.app.state.shots.current.map((shot) => [shot.id, shot]));
      const merged = refreshed.shots.map((shot) =>
        cull.mergePreservedImportAnalysis(shot, old.get(shot.id)),
      );
      f.app.updateShots(() => merged);
      f.app.run(merged.filter((shot) => !old.has(shot.id)).map((shot) => shot.id));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(f.app.state.shots.current[0]!.verdict).toBe(manual ?? "keep");
      expect(f.app.state.calls).toBe(0);
      expect(f.app.state.run.current.pending.size).toBe(0);
      await f.view.save(f.app.state.shots.current, null, "all");
      const after = await f.repository.read();
      expect(after.manifest.photoIds).toEqual(f.before.manifest.photoIds);
      expect(await after.photos[0]!.sourceBlob!.text()).toBe(await f.original.text());
      expect(after.photos[0]!.sourceDigest).toBe(f.before.photos[0]!.sourceDigest);
      expect(after.documents[id]!.history).toEqual(f.before.documents[id]!.history);
      expect(after.documents[id]!.analysis).toEqual(f.before.documents[id]!.analysis);
      expect(after.documents[id]!.metadata.flag).toBe(
        manual === "reject" ? "reject" : manual === "undecided" ? null : "pick",
      );
    } finally {
      await f.close();
    }
  },
);

test.each(["owner", "digest", "file", "missing"] as const)(
  "canonical reread cannot carry pending admission across a changed %s",
  async (change) => {
    const f = await heldImport();
    try {
      await f.finish();
      const refreshed = await f.view.read();
      const altered = refreshed.shots.map((shot): Shot => ({
        ...shot,
        ...(change === "owner"
          ? {
              develop: {
                ...shot.develop!,
                canonical: { namespace: "other-owner", photoId: shot.id },
              },
            }
          : {}),
        ...(change === "digest" ? { sourceDigest: `sha256:${"f".repeat(64)}` } : {}),
        ...(change === "file" ? { file: new File(["replacement"], shot.file.name) } : {}),
        ...(change === "missing" ? { sourceAvailable: false } : {}),
      }));
      f.app.updateShots(() => altered);
      f.app.run([]);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(f.app.state.shots.current[0]!.verdict).toBe("undecided");
      expect(f.app.state.run.current.pending.size).toBe(0);
      expect(f.app.state.calls).toBe(0);
      const after = await f.repository.read();
      expect(after.documents).toEqual(f.before.documents);
      expect(after.manifest).toEqual(f.before.manifest);
      expect(await after.photos[0]!.sourceBlob!.text()).toBe(await f.original.text());
    } finally {
      await f.close();
    }
  },
);
