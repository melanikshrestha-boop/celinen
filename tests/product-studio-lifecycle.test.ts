import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULT_EDITS, type Shot, type Verdict } from "../src/lib/imaging";
import { applyImportCull, attachImportAnalysis } from "../src/lib/studio/cull-on-import";
import { proposeCull, type StudioProposal } from "../src/lib/studio/proposals";
import { createProductAnalytics } from "../src/lib/product-analytics";
import {
  analysisDecoderDomain,
  connectProductAnalytics,
  cullReviewTelemetry,
  productOperation,
} from "../src/lib/product-lifecycle";

// Execute the actual Studio callbacks, not copies of their event conditions.
// React setters and decoding I/O are instance-local doubles. Culling/proposals and
// analytics use their real implementations. No native process, network, account,
// IndexedDB, user photograph, or browser profile is touched.
const source = readFileSync(new URL("../src/routes/studio.tsx", import.meta.url), "utf8");
const transpiler = new Bun.Transpiler({ loader: "tsx" });
function between(start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Missing Studio callback boundary: ${start}`);
  return source.slice(from, to);
}
const callbacks = [
  between("  const runImportCull = useCallback(", "  const selectShot = useCallback("),
  between("  const showProposal = useCallback(", "  const stageRecipe = useCallback("),
  between("  const stageCull = useCallback(", "  const groupFaces = useCallback("),
  between("  const setVerdict = useCallback(", "  const applyVerdicts = useCallback("),
].join("\n");
const owner = "12345678-1234-4123-a123-123456789012";
const shoot = "12345678-1234-4123-a123-123456789014";
type Capture = { event: string; properties: Record<string, unknown> };
type Review = ReturnType<typeof cullReviewTelemetry>;
type Actions = {
  runImportCull: () => void;
  stageCull: (decide: (frame: Shot) => Verdict, title: string, description: string) => string;
  discardProposal: (retainAcceptedTelemetry?: unknown) => string;
  setVerdict: (id: string, verdict: Verdict, advance?: boolean) => void;
};
function photo(id: string, overrides: Partial<Shot> = {}): Shot {
  return {
    id,
    name: `${id}.jpg`,
    file: new File([`synthetic-${id}`], `${id}.jpg`),
    isRaw: false,
    previewUrl: null,
    width: 160,
    height: 120,
    sizeMb: 0.001,
    sharpness: 200,
    brightness: 120,
    clippedHighlights: 0,
    clippedShadows: 0,
    hash: "1".repeat(64),
    score: 90,
    flags: [],
    verdict: "undecided",
    edits: { ...DEFAULT_EDITS },
    analysisBackend: "native-cpp",
    ...overrides,
  };
}
function fixture(
  options: { applied?: boolean; failAnalysis?: boolean; consent?: boolean; enabled?: boolean } = {},
) {
  const events: Capture[] = [];
  let accepted = options.consent !== false;
  const client = createProductAnalytics({
    config: {
      enabled: options.enabled === false ? "false" : "true",
      host: "https://us.i.posthog.com",
      key: "phc_SYNTHETICTESTONLY",
    },
    accountId: owner,
    cookie: () => (accepted ? "foto_consent=accepted" : "foto_consent=rejected"),
    fetch: async (_url, init) => {
      events.push(JSON.parse(String(init.body)) as Capture);
      return { ok: true };
    },
  });
  const close = connectProductAnalytics(owner, client, () => accepted);
  const originals = [photo("sharp"), photo("blur", { hash: "0".repeat(64), flags: ["blur"] })];
  if (options.failAnalysis)
    for (const frame of originals) {
      frame.hash = "";
      frame.score = 0;
    }
  const latestShotsRef = { current: originals };
  const importCullRef = {
    current: { token: 0, running: false, applied: options.applied === true },
  };
  const proposalRef = { current: null as StudioProposal | null };
  const reviewTelemetry = { current: null as Review | null };
  const selected = { current: originals[0]!.id };
  const undoRef = { current: [] as unknown[] };
  let syncNote: string | null = null;
  let checkpoints = 0;
  let analysisCalls = 0;
  const context = {
    useCallback: (fn: unknown) => fn,
    importingRef: { current: false },
    proposalRef,
    sessionStatusRef: { current: "ready" },
    canPersistStudioSession: (status: string) => status === "ready",
    importCullRef,
    latestShotsRef,
    unanalyzedIds: {
      current: new Set(options.failAnalysis ? originals.map((frame) => frame.id) : []),
    },
    storageScope: owner,
    shootId: shoot,
    projectId: undefined,
    productOperation,
    cullReviewTelemetry,
    analysisDecoderDomain,
    analyseFile: async () => {
      analysisCalls++;
      throw new Error("PRIVATE-CANARY-/Users/client/photo.jpg");
    },
    attachImportAnalysis,
    applyImportCull,
    updateShots: (update: (frames: Shot[]) => Shot[]) => {
      latestShotsRef.current = update(latestShotsRef.current);
    },
    reviewTelemetry,
    undoRef,
    latestSelectedIdRef: selected,
    renderedProposalRef: { current: null },
    recipeRef: { current: null },
    setLoupeStatus: () => {},
    setProposal: (proposal: StudioProposal | null) => {
      proposalRef.current = proposal;
    },
    setCompareBefore: () => {},
    selectFilter: () => {},
    selectShot: (id: string | null) => {
      if (id) selected.current = id;
    },
    setSyncNote: (value: string | null | ((previous: string | null) => string | null)) => {
      syncNote = typeof value === "function" ? value(syncNote) : value;
    },
    proposeCull,
    checkpoint: () => {
      checkpoints++;
    },
    visible: originals,
  };
  const actions = new Function(
    ...Object.keys(context),
    transpiler.transformSync(
      `${callbacks}\nreturn {runImportCull, stageCull, discardProposal, setVerdict};`,
    ),
  )(...Object.values(context)) as Actions;
  return {
    events,
    actions,
    originals,
    latestShotsRef,
    importCullRef,
    proposalRef,
    reviewTelemetry,
    undoRef,
    close,
    revoke: () => {
      accepted = false;
    },
    analysisCalls: () => analysisCalls,
    checkpoints: () => checkpoints,
    async settle() {
      // Production intentionally owns the asynchronous task; its running bit is
      // the observable completion fence. Bound waits so a regression cannot hang.
      for (let i = 0; i < 100 && importCullRef.current.running; i++) await Promise.resolve();
      expect(importCullRef.current.running).toBe(false);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    },
  };
}

describe("actual Studio lifecycle producers", () => {
  test("already-applied all-analysis-failed retry emits failure without completing or inventing decisions", async () => {
    const h = fixture({ applied: true, failAnalysis: true });
    try {
      h.actions.runImportCull();
      await h.settle();
      expect(h.analysisCalls()).toBe(2);
      expect(h.events.map((event) => event.event)).toEqual(["cull_started", "cull_failed"]);
      expect(h.events[1]!.properties.photo_count).toBe(2);
      expect(JSON.stringify(h.events)).not.toContain("PRIVATE-CANARY");
      expect(h.latestShotsRef.current).toBe(h.originals);
      expect(h.latestShotsRef.current.map((frame) => frame.verdict)).toEqual([
        "undecided",
        "undecided",
      ]);
      expect(h.undoRef.current).toHaveLength(0);
    } finally {
      h.close();
    }
  });

  test("actual successful import cull preserves V1 decisions and emits measured completion", async () => {
    const h = fixture();
    try {
      const expected = applyImportCull(h.originals);
      const bytes = await Promise.all(h.originals.map((frame) => frame.file.text()));
      h.actions.runImportCull();
      await h.settle();
      expect(h.latestShotsRef.current).toEqual(expected.shots);
      expect(h.latestShotsRef.current.map((frame) => frame.verdict)).toEqual(["keep", "reject"]);
      expect(h.events.map((event) => event.event)).toEqual(["cull_started", "cull_completed"]);
      expect(h.events[1]!.properties).toMatchObject({
        keepers_suggested: 1,
        decoder_domain: "native-cpp-v1",
        shoot_id: shoot,
        user_id: owner,
      });
      expect(h.events[1]!.properties.processing_ms).toBeGreaterThanOrEqual(0);
      expect(h.originals.map((frame) => frame.verdict)).toEqual(["undecided", "undecided"]);
      expect(await Promise.all(h.originals.map((frame) => frame.file.text()))).toEqual(bytes);
      h.latestShotsRef.current.forEach((frame, index) =>
        expect(frame.file).toBe(h.originals[index]!.file),
      );
      expect(h.undoRef.current).toHaveLength(1);
    } finally {
      h.close();
    }
  });

  test("proposal staging emits completion but no acceptance or decision mutation", async () => {
    const h = fixture();
    try {
      const receipt = h.actions.stageCull(() => "keep", "Synthetic proposal", "Synthetic details");
      await h.settle();
      expect(receipt).toContain("Preview ready");
      expect(h.proposalRef.current?.frames).toHaveLength(2);
      expect(h.latestShotsRef.current).toBe(h.originals);
      expect(h.events.map((event) => event.event)).toEqual(["cull_started", "cull_completed"]);
    } finally {
      h.close();
    }
  });

  test("discard invalidates retained renderer callbacks and subsequent actual K/X actions", async () => {
    const h = fixture();
    try {
      h.actions.stageCull(() => "keep", "Synthetic proposal", "Synthetic details");
      const pendingRenderer = h.reviewTelemetry.current!;
      h.actions.discardProposal();
      pendingRenderer.shown("sharp");
      pendingRenderer.review("sharp", "keep");
      h.actions.setVerdict("sharp", "keep", false);
      h.actions.setVerdict("blur", "reject", false);
      await h.settle();
      expect(h.proposalRef.current).toBeNull();
      expect(h.reviewTelemetry.current).toBeNull();
      expect(h.events.map((event) => event.event)).toEqual(["cull_started", "cull_completed"]);
      expect(h.latestShotsRef.current.map((frame) => frame.verdict)).toEqual(["keep", "reject"]);
      expect(h.checkpoints()).toBe(2);
    } finally {
      h.close();
    }
  });

  test("React discard event is not mistaken for retain-accepted authorization", async () => {
    const h = fixture();
    try {
      h.actions.stageCull(() => "keep", "Synthetic proposal", "Synthetic details");
      const pendingRenderer = h.reviewTelemetry.current!;
      h.actions.discardProposal({ type: "click" });
      pendingRenderer.shown("sharp");
      h.actions.setVerdict("sharp", "keep", false);
      await h.settle();
      expect(h.reviewTelemetry.current).toBeNull();
      expect(h.events.map((event) => event.event)).toEqual(["cull_started", "cull_completed"]);
    } finally {
      h.close();
    }
  });

  test("actual staged cull exception emits failure while preserving originals", async () => {
    const h = fixture();
    try {
      expect(() =>
        h.actions.stageCull(
          () => {
            throw new Error("synthetic failure");
          },
          "Test",
          "Test",
        ),
      ).toThrow("synthetic failure");
      await h.settle();
      expect(h.events.map((event) => event.event)).toEqual(["cull_started", "cull_failed"]);
      expect(h.latestShotsRef.current).toBe(h.originals);
      expect(h.proposalRef.current).toBeNull();
    } finally {
      h.close();
    }
  });

  for (const options of [{ consent: false }, { enabled: false }]) {
    test(`analytics unavailable does not affect actual V1 cull: ${JSON.stringify(options)}`, async () => {
      const h = fixture(options);
      try {
        const expected = applyImportCull(h.originals);
        h.actions.runImportCull();
        await h.settle();
        expect(h.latestShotsRef.current).toEqual(expected.shots);
        expect(h.events).toHaveLength(0);
      } finally {
        h.close();
      }
    });
  }
});
