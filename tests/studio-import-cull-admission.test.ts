import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
import * as cull from "../src/lib/studio/cull-on-import";

const source = readFileSync(new URL("../src/routes/studio.tsx", import.meta.url), "utf8");
const start = source.indexOf("  const runImportCull = useCallback(");
const end = source.indexOf("  const selectShot = useCallback(", start);
if (start < 0 || end < 0) throw new Error("Studio import-cull callback missing");
const body = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(start, end));
function callbackBody(from: string, to: string) {
  const begin = source.indexOf(from);
  const finish = source.indexOf(to, begin);
  if (begin < 0 || finish < 0) throw new Error(`Studio callback missing: ${from}`);
  return new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(begin, finish));
}
const updateBody = callbackBody(
  "  const updateShots = useCallback(",
  "  const runImportCull = useCallback(",
);
const verdictBody = callbackBody(
  "  const setVerdict = useCallback(",
  "  const applyVerdicts = useCallback(",
);
const shot = (id: string, extra: Partial<Shot> = {}): Shot => ({
  id,
  name: `${id}.jpg`,
  file: new File([id], `${id}.jpg`),
  isRaw: false,
  previewUrl: null,
  width: 10,
  height: 10,
  sizeMb: 0.01,
  sharpness: 200,
  brightness: 120,
  clippedHighlights: 0,
  clippedShadows: 0,
  hash: "aaaaaaaaaaaaaaaa",
  score: 90,
  flags: [],
  verdict: "undecided",
  edits: { ...DEFAULT_EDITS },
  analysisBackend: "native-cpp",
  ...extra,
});

// Run the actual callback with instance-local refs; no module mocks, databases,
// original photographs, or browser state are involved.
function fixture(photos: Shot[]) {
  const state = {
    photos: { current: photos },
    importing: { current: false },
    proposal: { current: null },
    status: { current: "ready" },
    run: { current: { running: false, rerun: false, token: 0, pending: new Map<string, Shot>() } },
    abort: { current: null as AbortController | null },
    owner: { current: "synthetic-owner:shoot" },
    mounted: { current: true },
    unanalyzed: { current: new Set<string>() },
    analysisCalls: [] as File[],
    failedFiles: new Set<File>(),
    undo: { current: [] as unknown[] },
    notes: [] as string[],
    wait: Promise.resolve(),
  };
  const context = {
    ...cull,
    useCallback: (callback: unknown) => callback,
    importingRef: state.importing,
    proposalRef: state.proposal,
    sessionStatusRef: state.status,
    canPersistStudioSession: (status: string) => status === "ready",
    importCullRef: state.run,
    importAbortRef: state.abort,
    importCullOwnerRef: state.owner,
    mountedRef: state.mounted,
    latestShotsRef: state.photos,
    unanalyzedIds: state.unanalyzed,
    analyseFile: async (file: File) => {
      state.analysisCalls.push(file);
      await state.wait;
      if (state.failedFiles.has(file)) throw new Error("Synthetic analysis failure");
      return {
        width: 10,
        height: 10,
        backend: "native-cpp" as const,
        analysis: {
          sharpness: 200,
          brightness: 120,
          clippedHighlights: 0,
          clippedShadows: 0,
          hash: "aaaaaaaaaaaaaaaa",
        },
      };
    },
    updateShots: (update: (shots: Shot[]) => Shot[]) => {
      state.photos.current = update(state.photos.current);
    },
    undoRef: state.undo,
    latestSelectedIdRef: { current: photos[0]?.id ?? null },
    setSyncNote: (note: string) => state.notes.push(note),
    setShots: () => {},
    checkpoint: () => {},
    visible: photos,
    filter: "all",
    reviewIssue: null,
    nextCullReviewId: () => null,
    selectShot: () => {},
  };
  const updateContext = Object.fromEntries(
    Object.entries(context).filter(([key]) => key !== "updateShots"),
  );
  context.updateShots = new Function(
    ...Object.keys(updateContext),
    `${updateBody}\nreturn updateShots;`,
  )(...Object.values(updateContext));
  const run = new Function(...Object.keys(context), `${body}\nreturn runImportCull;`)(
    ...Object.values(context),
  ) as (newIds?: readonly string[]) => void;
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const setVerdict = new Function(...Object.keys(context), `${verdictBody}\nreturn setVerdict;`)(
    ...Object.values(context),
  ) as (id: string, verdict: Shot["verdict"], advance?: boolean) => void;
  return { state, run, settle, setVerdict, updateShots: context.updateShots };
}

describe("Studio automatic cull admission", () => {
  test("opening an analyzed saved gallery cannot silently convert restored U to K", async () => {
    const photos = [
      shot("restored-u"),
      shot("manual-k", { verdict: "keep" }),
      shot("manual-x", { verdict: "reject" }),
    ];
    const app = fixture(photos);
    app.run();
    await app.settle();
    expect(app.state.photos.current.map((photo) => photo.verdict)).toEqual([
      "undecided",
      "keep",
      "reject",
    ]);
    expect(app.state.analysisCalls).toHaveLength(0);
    expect(app.state.undo.current).toHaveLength(0);
    expect(app.state.notes).toHaveLength(0);
  });

  test("an already-analyzed new import is eligible after hydration without touching restored U", async () => {
    const app = fixture([shot("restored-u", { score: 0, flags: ["blur"] })]);
    app.run();
    await app.settle();
    app.state.photos.current.push(shot("new"));
    app.run(["new"]);
    await app.settle();
    expect(app.state.photos.current.map((photo) => photo.verdict)).toEqual(["undecided", "keep"]);
    expect(app.state.analysisCalls).toHaveLength(0);
  });

  test("new IDs accumulate while ingest runs, never expanding to the restored gallery", async () => {
    const app = fixture([shot("restored-u"), shot("new-a"), shot("new-b")]);
    app.state.importing.current = true;
    app.run(["new-a"]);
    app.run(["new-b"]);
    expect(app.state.photos.current.every((photo) => photo.verdict === "undecided")).toBe(true);
    app.state.importing.current = false;
    app.run([]);
    await app.settle();
    expect(app.state.photos.current.map((photo) => photo.verdict)).toEqual([
      "undecided",
      "keep",
      "keep",
    ]);
  });

  test("restored analysis can recover measurements without changing saved undecided decisions", async () => {
    const original = shot("restored-u", { hash: "", score: 0 });
    const app = fixture([original]);
    app.state.unanalyzed.current.add(original.id);
    app.run([]);
    await app.settle();
    expect(app.state.analysisCalls).toEqual([original.file]);
    expect(app.state.photos.current[0]!.hash).toBe("aaaaaaaaaaaaaaaa");
    expect(app.state.photos.current[0]!.verdict).toBe("undecided");
    expect(app.state.photos.current[0]!.file).toBe(original.file);
    expect(app.state.unanalyzed.current.size).toBe(0);
    expect(app.state.undo.current).toHaveLength(0);
  });

  test("an import arriving during failed recovery still gets one coalesced follow-up pass", async () => {
    const failed = shot("restored-failed", { hash: "", score: 0 });
    const app = fixture([failed]);
    app.state.failedFiles.add(failed.file);
    app.state.unanalyzed.current.add(failed.id);
    let release!: () => void;
    app.state.wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    app.run([]);
    const incoming = shot("new", { hash: "", score: 0 });
    app.updateShots((frames) => [...frames, incoming]);
    app.state.unanalyzed.current.add(incoming.id);
    app.run([incoming.id]);
    app.run([]);
    app.run([]);
    release();
    await app.settle();
    expect(app.state.analysisCalls.filter((file) => file === incoming.file)).toHaveLength(1);
    expect(app.state.photos.current.map((frame) => frame.verdict)).toEqual(["undecided", "keep"]);
    expect(app.state.run.current.running).toBe(false);
    expect(app.state.run.current.rerun).toBe(false);
    const calls = [...app.state.analysisCalls];
    expect(calls.filter((file) => file === failed.file)).toHaveLength(2);
    await app.settle();
    expect(app.state.analysisCalls).toEqual(calls);
  });

  test("a coalesced pass cannot start after cancellation, owner change, pause, or new ingest", async () => {
    for (const stop of ["abort", "owner", "unmount", "token", "paused", "importing"] as const) {
      const failed = shot("restored-failed", { hash: "", score: 0 });
      const app = fixture([failed]);
      app.state.failedFiles.add(failed.file);
      app.state.unanalyzed.current.add(failed.id);
      let release!: () => void;
      app.state.wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      app.run([]);
      const incoming = shot("new", { hash: "", score: 0 });
      app.updateShots((frames) => [...frames, incoming]);
      app.state.unanalyzed.current.add(incoming.id);
      app.run([incoming.id]);
      if (stop === "abort") app.state.abort.current?.abort();
      if (stop === "owner") app.state.owner.current = "foreign-owner";
      if (stop === "unmount") app.state.mounted.current = false;
      if (stop === "token") app.state.run.current.token++;
      if (stop === "paused") app.state.status.current = "conflicted";
      if (stop === "importing") app.state.importing.current = true;
      release();
      await app.settle();
      expect(app.state.analysisCalls).toEqual([failed.file]);
      expect(app.state.photos.current.every((frame) => frame.verdict === "undecided")).toBe(true);
      expect(app.state.notes).toHaveLength(0);
    }
  });

  test.each(["keep", "reject", "undecided"] as const)(
    "an explicit %s during analysis wins, including U on an already undecided frame",
    async (verdict) => {
      const app = fixture([shot("new", { hash: "", score: 0 })]);
      app.state.unanalyzed.current.add("new");
      let release!: () => void;
      app.state.wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      app.run(["new"]);
      app.setVerdict("new", verdict, false);
      release();
      await app.settle();
      expect(app.state.photos.current[0]!.hash).toBe("aaaaaaaaaaaaaaaa");
      expect(app.state.photos.current[0]!.verdict).toBe(verdict);
      expect(app.state.run.current.pending.size).toBe(0);
      expect(app.state.notes).toHaveLength(0);
    },
  );

  test("a proposal or external K→U change cannot re-admit queued automatic decisions", async () => {
    const app = fixture([shot("new")]);
    app.state.importing.current = true;
    app.run(["new"]);
    app.updateShots((frames) => frames.map((frame) => ({ ...frame, verdict: "keep" })));
    app.updateShots((frames) => frames.map((frame) => ({ ...frame, verdict: "undecided" })));
    app.state.importing.current = false;
    app.run([]);
    await app.settle();
    expect(app.state.photos.current[0]!.verdict).toBe("undecided");
    expect(app.state.run.current.pending.size).toBe(0);
  });

  test("late analysis cannot attach to a replaced original, owner, cancelled run, or paused session", async () => {
    const mutations = [
      (app: ReturnType<typeof fixture>) => {
        app.state.owner.current = "other-owner:shoot";
      },
      (app: ReturnType<typeof fixture>) => {
        app.state.mounted.current = false;
      },
      (app: ReturnType<typeof fixture>) => {
        app.state.run.current.token++;
      },
      (app: ReturnType<typeof fixture>) => {
        app.state.abort.current?.abort();
      },
      (app: ReturnType<typeof fixture>) => {
        app.state.status.current = "conflicted";
      },
      (app: ReturnType<typeof fixture>) => {
        app.updateShots((frames) =>
          frames.map((frame) => ({ ...frame, file: new File(["replacement"], "new.jpg") })),
        );
      },
      (app: ReturnType<typeof fixture>) => {
        app.updateShots((frames) =>
          frames.map((frame) => ({ ...frame, sourceDigest: "replacement-digest" })),
        );
      },
      (app: ReturnType<typeof fixture>) => {
        app.updateShots((frames) =>
          frames.map((frame) => ({
            ...frame,
            develop: {
              ...frame.develop!,
              canonical: { namespace: "foreign-owner", photoId: frame.id },
            },
          })),
        );
      },
      (app: ReturnType<typeof fixture>) => {
        app.updateShots((frames) => frames.map((frame) => ({ ...frame, sourceAvailable: false })));
      },
    ];
    for (const mutate of mutations) {
      const app = fixture([shot("new", { hash: "", score: 0 })]);
      app.state.unanalyzed.current.add("new");
      let release!: () => void;
      app.state.wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      app.run(["new"]);
      mutate(app);
      release();
      await app.settle();
      expect(app.state.photos.current[0]!.hash).toBe("");
      expect(app.state.photos.current[0]!.verdict).toBe("undecided");
      expect(app.state.unanalyzed.current.has("new")).toBe(true);
      expect(app.state.notes).toHaveLength(0);
    }
  });

  test("actual hydration/refresh wiring admits no restored IDs and only newly projected IDs", () => {
    expect(source).toContain("        runImportCull([]);");
    const statement = source.match(/runImportCull\(merged\.filter\([^;]+;/)?.[0];
    expect(statement).toBeDefined();
    const calls: string[][] = [];
    new Function("merged", "old", "runImportCull", statement!)(
      [shot("old"), shot("new-a"), shot("new-b")],
      new Map([["old", shot("old")]]),
      (ids: string[]) => calls.push(ids),
    );
    expect(calls).toEqual([["new-a", "new-b"]]);
  });
});
