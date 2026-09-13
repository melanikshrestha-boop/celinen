import { describe, expect, test } from "bun:test";
import type { Shot } from "../src/lib/imaging";
import { DEFAULT_EDITS } from "../src/lib/imaging";
import {
  shortlistRequest,
  validateShortlistResponse,
  requestShortlist,
  shortlistSummary,
} from "../src/lib/studio/shortlist";
import { parseLocalCommand } from "../src/lib/studio/commands";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { shortlistProtocol } from "../src/server/native-studio-plugin";
import { applyProposal, proposeCull } from "../src/lib/studio/proposals";

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
  score: 80,
  flags: [],
  verdict: "undecided",
  edits: { ...DEFAULT_EDITS },
  analysisBackend: "native-cpp",
  ...extra,
});
const frames = () => [
  shot("manual", { verdict: "keep", score: 10 }),
  shot("candidate"),
  shot("reject", { verdict: "reject", score: 99 }),
  shot("review", { flags: ["blur"] }),
];
const response = () => ({
  status: "suggestions-only",
  method: "measured-diversity-v1",
  selectedIds: ["manual", "candidate"],
  candidateIds: ["candidate"],
  reviewIds: ["review"],
  targetCount: 2,
  shortfall: 0,
  manualKeepsOverTarget: 0,
  groupsCovered: 1,
  groupCount: 1,
  limitations: ["No semantic recognition."],
});

describe("native shortlist safety boundary", () => {
  test("photographer language requests a proposal, never auto-rejection or export", () => {
    for (const input of [
      "shortlist 20 photos",
      "pick 20 photos",
      "choose 20 frames",
      "shortlist 20",
    ])
      expect(parseLocalCommand(input)?.calls).toEqual([
        { name: "propose_shortlist", args: { n: 20 } },
      ]);
    for (const input of [
      "do not shortlist 20",
      "what does shortlist 20 mean?",
      "shortlist 20 and send",
    ])
      expect(
        parseLocalCommand(input)?.calls.some((call) => call.name === "propose_shortlist") ?? false,
      ).toBe(false);
  });
  test("originals never leave via a receipt and all IDs/picks remain exact", () => {
    const photos = frames();
    photos[0]!.id = `sha256:${"a".repeat(64)}:${"long".repeat(90)}`;
    const request = shortlistRequest(photos, 2);
    expect(request.frames.map((f) => f.id)).toEqual(photos.map((f) => f.id));
    expect(request.frames.map((f) => f.verdict)).toEqual(photos.map((f) => f.verdict));
    expect(JSON.stringify(request)).not.toContain("previewUrl");
    expect(request.frames[0]).not.toHaveProperty("file");
    expect(request.frames[0]).not.toHaveProperty("previewBlob");
  });
  test("red holds, unavailable originals, and unfinished analysis remain review-only", () => {
    const photos = [
      shot("red", { develop: { label: "Red" } } as Partial<Shot>),
      shot("missing", { sourceAvailable: false }),
      shot("pending"),
      shot("failed", { error: "corrupt" }),
    ];
    const request = shortlistRequest(photos, 4, new Set(["pending"]));
    expect(request.frames[0]?.manualReview).toBe(true);
    expect(request.frames[1]?.sourceAvailable).toBe(false);
    expect(request.frames[2]?.analysisAvailable).toBe(false);
    expect(request.frames[3]?.analysisAvailable).toBe(false);
    for (const candidate of photos) {
      const result = {
        ...response(),
        targetCount: 4,
        selectedIds: [candidate.id],
        candidateIds: [candidate.id],
        reviewIds: photos.filter((f) => f.id !== candidate.id).map((f) => f.id),
        shortfall: 3,
      };
      expect(() => validateShortlistResponse(result, request)).toThrow("invalid");
    }
  });
  test("underexposure alone is not a reject signal", () => {
    const request = shortlistRequest([shot("low-key", { score: 50, flags: ["underexposed"] })], 1);
    expect(
      validateShortlistResponse(
        {
          ...response(),
          selectedIds: ["low-key"],
          candidateIds: ["low-key"],
          reviewIds: [],
          targetCount: 1,
        },
        request,
      ).selectedIds,
    ).toEqual(["low-key"]);
  });
  test("response validation protects IDs, manual decisions, order, count and uncertainty", () => {
    const request = shortlistRequest(frames(), 2);
    const valid = validateShortlistResponse(response(), request);
    expect(Object.isFrozen(valid)).toBe(true);
    expect(Object.isFrozen(valid.selectedIds)).toBe(true);
    for (const patch of [
      { selectedIds: ["candidate", "manual"] },
      { selectedIds: ["manual", "reject"] },
      { candidateIds: ["reject"] },
      { selectedIds: ["manual", "foreign"] },
      { selectedIds: ["candidate"] },
      { candidateIds: ["candidate", "candidate"] },
      { reviewIds: [] },
      { reviewIds: ["review", "review"] },
      { reviewIds: ["candidate", "review"] },
      { targetCount: 3 },
      { shortfall: 10 },
      { manualKeepsOverTarget: 1 },
      { groupsCovered: 2 },
      { method: "semantic-perfect-v1" },
    ])
      expect(() => validateShortlistResponse({ ...response(), ...patch }, request)).toThrow(
        "invalid",
      );
  });
  test("invalid target counts and repeated IDs fail before requesting", () => {
    for (const target of [0, -1, 1.1, NaN, Infinity, 100001])
      expect(() => shortlistRequest(frames(), target)).toThrow();
    expect(() => shortlistRequest([], 1)).toThrow();
    expect(() => shortlistRequest([shot("same"), shot("same")], 1)).toThrow();
  });
  test("shortfall and protected-keeps-over-target are reported honestly", () => {
    const request = shortlistRequest(
      [shot("a", { verdict: "keep" }), shot("b", { verdict: "keep" })],
      1,
    );
    const result = validateShortlistResponse(
      {
        ...response(),
        targetCount: 1,
        selectedIds: ["a", "b"],
        candidateIds: [],
        reviewIds: [],
        manualKeepsOverTarget: 1,
      },
      request,
    );
    expect(shortlistSummary(result)).toContain("over target");
    expect(shortlistSummary(result)).toContain("Nothing is saved until you accept");
    const empty = validateShortlistResponse(
      {
        ...response(),
        selectedIds: [],
        candidateIds: [],
        reviewIds: ["x"],
        groupsCovered: 0,
        shortfall: 2,
      },
      shortlistRequest([shot("x", { flags: ["blur"] })], 2),
    );
    expect(shortlistSummary(empty)).toContain("2 short of target");
  });
  test("cancel before or during native response cannot publish a shortlist", async () => {
    const controller = new AbortController();
    const request = shortlistRequest(frames(), 2);
    let calls = 0;
    controller.abort();
    await expect(
      requestShortlist(request, {
        signal: controller.signal,
        fetch: (async () => {
          calls++;
          return Response.json(response());
        }) as typeof fetch,
      }),
    ).rejects.toThrow();
    expect(calls).toBe(0);
    const late = new AbortController();
    await expect(
      requestShortlist(request, {
        signal: late.signal,
        fetch: (async () => {
          late.abort();
          return Response.json(response());
        }) as typeof fetch,
      }),
    ).rejects.toThrow();
    await expect(
      requestShortlist(request, {
        fetch: (async () => new Response(null, { status: 503 })) as typeof fetch,
      }),
    ).rejects.toThrow("unavailable (503)");
  });
  test("client validates actual C++ output across missing/unknown/low-quality evidence", () => {
    const photos = [
      ...frames(),
      shot("unknown", { analysisBackend: undefined }),
      shot("soft-unflagged", { sharpness: 129 }),
      shot("bright-unflagged", { brightness: 230 }),
      shot("low-key", { flags: ["underexposed"], score: 20 }),
      shot("pending"),
    ];
    const request = shortlistRequest(photos, 4, new Set(["pending"]));
    const run = spawnSync("native/build/lenslabs-shortlist", {
      input: shortlistProtocol(request),
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
    const result = validateShortlistResponse(JSON.parse(run.stdout), request);
    expect(result.selectedIds).toEqual(["manual", "candidate", "low-key"]);
    expect(result.shortfall).toBe(1);
    expect(result.reviewIds).toEqual([
      "review",
      "unknown",
      "soft-unflagged",
      "bright-unflagged",
      "pending",
    ]);
  });
});

// Execute the actual async route branch with isolated frames, not a duplicate implementation.
const route = readFileSync(new URL("../src/routes/studio.tsx", import.meta.url), "utf8");
const branchStart = route.indexOf('        case "propose_shortlist":');
const branchEnd = route.indexOf('        case "keep_top":', branchStart);
const branch = new Bun.Transpiler({ loader: "tsx" }).transformSync(
  `async function execute(){ switch("propose_shortlist"){${route.slice(branchStart, branchEnd)}}}`,
);
function routeFixture() {
  const state = {
    photos: frames(),
    owner: { current: "account:shoot" },
    mounted: { current: true },
    proposal: { current: null as ReturnType<typeof proposeCull> | null },
    importing: { current: false },
    pending: { current: new Set<string>() },
    ready: true,
    abort: { current: null as AbortController | null },
    staged: 0,
    wait: Promise.resolve(),
  };
  const context = {
    importingRef: state.importing,
    folderAbortRef: { current: null },
    proposalRef: state.proposal,
    sessionStatusRef: { current: "ready" },
    canPersistStudioSession: () => state.ready,
    currentShots: () => state.photos,
    num: () => 2,
    unanalyzedIds: state.pending,
    shortlistRequest,
    shortlistSummary,
    shortlistOwnerRef: state.owner,
    shortlistAbortRef: state.abort,
    mountedRef: state.mounted,
    requestShortlist: (
      request: Parameters<typeof requestShortlist>[0],
      options: Parameters<typeof requestShortlist>[1],
    ) =>
      requestShortlist(request, {
        ...options,
        fetch: (async () => {
          await state.wait;
          return Response.json(response());
        }) as typeof fetch,
      }),
    stageCull: (decide: Parameters<typeof proposeCull>[1], title: string, description: string) => {
      state.staged++;
      state.proposal.current = proposeCull(state.photos, decide, { title, description });
      return "preview ready";
    },
  };
  const execute = new Function(...Object.keys(context), `${branch}\nreturn execute;`)(
    ...Object.values(context),
  ) as () => Promise<string>;
  return { state, execute };
}

describe("shortlist through actual Studio route", () => {
  test("proposal needs approval, protects K/X and uncertain frames, and invalidates after a new decision", async () => {
    const { state, execute } = routeFixture();
    expect(await execute()).toBe("preview ready");
    expect(state.photos.map((f) => f.verdict)).toEqual([
      "keep",
      "undecided",
      "reject",
      "undecided",
    ]);
    const proposal = state.proposal.current!;
    expect(proposal.frames.map((f) => [f.id, f.afterVerdict])).toEqual([["candidate", "keep"]]);
    expect(applyProposal(state.photos, proposal).map((f) => f.verdict)).toEqual([
      "keep",
      "keep",
      "reject",
      "undecided",
    ]);
    state.photos[1] = { ...state.photos[1]!, verdict: "reject" };
    expect(() => applyProposal(state.photos, proposal)).toThrow("shoot changed");
  });
  test("late native result never replaces newer owner, picks, source, import or proposal", async () => {
    const changes = [
      (s: ReturnType<typeof routeFixture>["state"]) => {
        s.owner.current = "other-account";
      },
      (s: ReturnType<typeof routeFixture>["state"]) => {
        s.mounted.current = false;
      },
      (s: ReturnType<typeof routeFixture>["state"]) => {
        s.photos[1] = { ...s.photos[1]!, verdict: "reject" };
      },
      (s: ReturnType<typeof routeFixture>["state"]) => {
        s.photos[1] = { ...s.photos[1]!, file: new File(["new"], "new.jpg") };
      },
      (s: ReturnType<typeof routeFixture>["state"]) => {
        s.photos.reverse();
      },
      (s: ReturnType<typeof routeFixture>["state"]) => {
        s.pending.current.add("candidate");
      },
      (s: ReturnType<typeof routeFixture>["state"]) => {
        s.importing.current = true;
      },
      (s: ReturnType<typeof routeFixture>["state"]) => {
        s.ready = false;
      },
      (s: ReturnType<typeof routeFixture>["state"]) => {
        s.proposal.current = proposeCull(s.photos, () => "keep", {
          title: "new",
          description: "new",
        });
      },
      (s: ReturnType<typeof routeFixture>["state"]) => {
        s.abort.current?.abort();
      },
    ];
    for (const change of changes) {
      const { state, execute } = routeFixture();
      let release!: () => void;
      state.wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      const run = execute();
      change(state);
      release();
      await expect(run).rejects.toThrow();
      expect(state.staged).toBe(0);
    }
  });
});
