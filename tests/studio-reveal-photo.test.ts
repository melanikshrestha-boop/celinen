import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
import { filterCullFrames } from "../src/lib/studio/cull-review";
import { shotsOfCluster, shotsOfPerson } from "../src/lib/studio/people";
import { filterReviewIssue, type ReviewIssue } from "../src/lib/studio/review-filter";
import type { StudioFilter } from "../src/lib/studio/session";

const source = readFileSync(new URL("../src/routes/studio.tsx", import.meta.url), "utf8");
const transpiler = new Bun.Transpiler({ loader: "tsx" });
function between(startText: string, endText: string) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  if (start < 0 || end < 0) throw new Error(`Missing Studio boundary: ${startText}`);
  return source.slice(start, end);
}
const revealDefinition = transpiler.transformSync(
  between("  const revealShot = useCallback(", "  const selectReviewIssue = useCallback("),
);
const projection = transpiler.transformSync(
  between("  const scopedShots = useMemo(", "  const focusReviewQueue ="),
);
const selectCase = between('case "select_photo": {', 'case "apply_edits": {')
  .replace('case "select_photo": {', "")
  .replace(/}\s*$/, "");
const guard = between(
  "if (selectedId && !visible.some",
  "  }, [selectedId, visible, selectShot]);",
);

function fixture(withPeople = false) {
  const frame = (id: string, verdict: Shot["verdict"], score: number): Shot => ({
    id,
    name: `${id}.jpg`,
    file: new File([`original-${id}`], `${id}.jpg`),
    previewUrl: null,
    isRaw: false,
    width: 2,
    height: 2,
    sizeMb: 0,
    sharpness: 200,
    brightness: 100,
    clippedHighlights: 0,
    clippedShadows: 0,
    hash: "1".repeat(64),
    score,
    flags: verdict === "undecided" ? ["soft"] : [],
    verdict,
    edits: { ...DEFAULT_EDITS },
    subjects: [{ personId: id, source: "roster" }],
  });
  const shots = [frame("best", "keep", 90), frame("review", "undecided", 20)];
  const state = {
    selectedId: "review" as string | null,
    filter: "flagged" as StudioFilter,
    personFilter: withPeople ? "review" : null,
    clusterFilter: withPeople ? "review-group" : null,
    reviewIssue: null as ReviewIssue | null,
    sceneIds: null as ReadonlySet<string> | null,
  };
  const selectShot = (id: string | null) => {
    state.selectedId = id;
  };
  const selectFilter = (next: StudioFilter) => {
    state.filter = next;
    state.reviewIssue = null;
  };
  const revealShot = new Function(
    "useCallback",
    "selectFilter",
    "selectShot",
    "setPersonFilter",
    "setClusterFilter",
    "setSceneIds",
    "setSceneOpen",
    revealDefinition + "\nreturn revealShot;",
  )(
    (callback: unknown) => callback,
    selectFilter,
    selectShot,
    (id: string | null) => (state.personFilter = id),
    (id: string | null) => (state.clusterFilter = id),
    (ids: ReadonlySet<string> | null) => (state.sceneIds = ids),
    () => {},
  ) as (id: string) => void;
  const visible = () =>
    new Function(
      "useMemo",
      "shots",
      "personFilter",
      "clusterFilter",
      "eventPeople",
      "shotsOfPerson",
      "shotsOfCluster",
      "reviewIssue",
      "filter",
      "filterReviewIssue",
      "filterCullFrames",
      "sceneIds",
      projection + "\nreturn visible;",
    )(
      (calculate: () => unknown) => calculate(),
      shots,
      state.personFilter,
      state.clusterFilter,
      [{ id: "review-group", frameIds: ["review"] }],
      shotsOfPerson,
      shotsOfCluster,
      state.reviewIssue,
      state.filter,
      filterReviewIssue,
      filterCullFrames,
      state.sceneIds,
    ) as Shot[];
  const reconcile = () =>
    new Function("selectedId", "visible", "selectShot", guard)(
      state.selectedId,
      visible(),
      selectShot,
    );
  const execute = (query: string, code = selectCase) =>
    new Function("args", "currentShots", "unanalyzedIds", "selectShot", "revealShot", code)(
      { query },
      () => shots,
      { current: new Set() },
      selectShot,
      revealShot,
    ) as string;
  return { shots, state, visible, reconcile, execute, revealShot };
}

describe("explicit Studio photo navigation leaves filters, keyboard review does not", () => {
  test.each(["best", "best.jpg", "1"])(
    "the actual select_photo command opens %s instead of reverting to the red queue",
    async (query) => {
      const app = fixture(true);
      expect(app.visible().map((shot) => shot.id)).toEqual(["review"]);
      expect(app.execute(query)).toBe("opened best.jpg");
      app.reconcile();
      expect(app.state).toEqual({
        selectedId: "best",
        filter: "all",
        personFilter: null,
        clusterFilter: null,
        reviewIssue: null,
        sceneIds: null,
      });
      expect(app.visible().map((shot) => shot.id)).toEqual(["best", "review"]);
      expect(app.shots.map((shot) => shot.verdict)).toEqual(["keep", "undecided"]);
      expect(await Promise.all(app.shots.map((shot) => shot.file.text()))).toEqual([
        "original-best",
        "original-review",
      ]);
    },
  );

  test("the original select-only case reproduces its false opened receipt", () => {
    const prior = selectCase.replace("revealShot(target.id)", "selectShot(target.id)");
    expect(prior).not.toBe(selectCase);
    const app = fixture();
    expect(app.execute("best", prior)).toBe("opened best.jpg");
    expect(app.state.selectedId).toBe("best");
    app.reconcile();
    expect(app.state.selectedId).toBe("review");
    expect(app.state.filter).toBe("flagged");
  });

  test("the shared reveal callback clears people scopes for direct photo links", () => {
    const app = fixture(true);
    app.state.sceneIds = new Set(["review"]);
    app.revealShot("best");
    app.reconcile();
    expect(app.state.selectedId).toBe("best");
    expect(app.state.personFilter).toBeNull();
    expect(app.state.clusterFilter).toBeNull();
    expect(app.state.filter).toBe("all");
    expect(app.state.sceneIds).toBeNull();
  });

  test("scene filters combine with red-dot review without moving or deciding originals", () => {
    const app = fixture();
    app.state.sceneIds = new Set(["best"]);
    expect(app.visible()).toHaveLength(0);
    app.state.filter = "keepers";
    expect(app.visible().map((shot) => shot.id)).toEqual(["best"]);
    expect(app.shots.map((shot) => shot.verdict)).toEqual(["keep", "undecided"]);
  });

  test("an unknown requested photo leaves the existing queue and selection intact", () => {
    const app = fixture(true);
    const before = { ...app.state };
    expect(app.execute("missing.jpg")).toBe('failed: no frame matched "missing.jpg"');
    app.reconcile();
    expect(app.state).toEqual(before);
  });

  test("unsolicited hidden selections remain fenced and completed queues do not restart", () => {
    const app = fixture();
    app.state.selectedId = "best";
    app.reconcile();
    expect(app.state.selectedId).toBe("review");
    expect(app.state.filter).toBe("flagged");
    app.state.selectedId = null;
    app.reconcile();
    expect(app.state.selectedId).toBeNull();
    expect(app.visible().map((shot) => shot.id)).toEqual(["review"]);
  });
});
