import { describe, expect, test } from "bun:test";
import {
  bulkCounts,
  bulkTargets,
  cullCells,
  cullKeyAction,
  decisionSource,
  formatRate,
  importName,
  plainReading,
  toggledVerdict,
  type CullKeyAction,
} from "../src/components/cull/cull-review";
import { CullController } from "../src/lib/studio/cull/controller";
import {
  applySuggestions,
  countFrames,
  decide,
  effectiveVerdict,
  type CullFrame,
} from "../src/lib/studio/cull/session";
import type { CullStore } from "../src/lib/studio/cull/store";
import { libraryGridWindow } from "../src/lib/develop/library-window";
import { cullFrame, cullReading, cullRow, smallGame, sportsCard } from "./cull-review.fixture";

const ids = (frames: readonly { frame: CullFrame }[]) => frames.map((cell) => cell.frame.id);
const byId = (frames: readonly CullFrame[], id: string) => frames.find((frame) => frame.id === id)!;

describe("cull cells", () => {
  test("stacks collapse each burst to its best frame and count the burst", () => {
    const cells = cullCells(smallGame(), { filter: "all", stacked: true, expanded: new Set() });
    expect(ids(cells)).toEqual(["b1-best", "b2-best", "s-focus", "s-motion", "s-eyes", "s-open"]);
    expect(cells[0]).toMatchObject({
      stackId: "burst:1",
      stackCount: 4,
      lead: true,
      expanded: false,
    });
    expect(cells[2]).toMatchObject({ stackId: null, stackCount: 1 });
  });

  test("an open stack lays out every member, best first, right after the lead", () => {
    const cells = cullCells(smallGame(), {
      filter: "all",
      stacked: true,
      expanded: new Set(["burst:1"]),
    });
    expect(ids(cells).slice(0, 5)).toEqual(["b1-best", "b1-2", "b1-3", "b1-4", "b2-best"]);
    expect(cells.slice(0, 4).every((cell) => cell.expanded && cell.stackId === "burst:1")).toBe(
      true,
    );
    expect(cells.slice(1, 4).some((cell) => cell.lead)).toBe(false);
  });

  test("stacks off shows every frame in capture order", () => {
    const cells = cullCells(smallGame(), { filter: "all", stacked: false, expanded: new Set() });
    expect(cells).toHaveLength(10);
    expect(cells.every((cell) => cell.stackId === null)).toBe(true);
  });

  test("filters apply before stacking", () => {
    const rejects = cullCells(smallGame(), {
      filter: "rejects",
      stacked: true,
      expanded: new Set(),
    });
    // b1's three duplicates stack under the best of what the filter left.
    expect(ids(rejects)).toEqual(["b1-2", "b2-2", "s-focus", "s-motion"]);
    expect(rejects[0]!.stackCount).toBe(3);
    const eyes = cullCells(smallGame(), {
      filter: "eyes-closed",
      stacked: true,
      expanded: new Set(),
    });
    expect(ids(eyes)).toEqual(["s-eyes"]);
  });

  test("counts behind the filter chips match the fixture", () => {
    const counts = countFrames(smallGame());
    expect(counts.all).toBe(10);
    expect(counts.keepers).toBe(3); // two bests + the photographer's keep
    expect(counts.rejects).toBe(6);
    expect(counts.undecided).toBe(1);
    expect(counts["out-of-focus"]).toBe(1);
    expect(counts["motion-blur"]).toBe(1);
    expect(counts["eyes-closed"]).toBe(1);
    expect(counts.duplicates).toBe(6);
  });
});

describe("keyboard", () => {
  const cases: [Parameters<typeof cullKeyAction>[0], CullKeyAction][] = [
    [{ key: "ArrowRight" }, { kind: "move", axis: "cell", step: 1 }],
    [{ key: "ArrowLeft" }, { kind: "move", axis: "cell", step: -1 }],
    [{ key: "ArrowDown" }, { kind: "move", axis: "row", step: 1 }],
    [{ key: "ArrowUp" }, { kind: "move", axis: "row", step: -1 }],
    [{ key: "l" }, { kind: "move", axis: "cell", step: 1 }],
    [{ key: "j" }, { kind: "move", axis: "cell", step: -1 }],
    [{ key: "k" }, { kind: "decide", verdict: "keep" }],
    // Shift applies and stays on the frame (Lightroom's caps-lock opposite).
    [
      { key: "K", shiftKey: true },
      { kind: "decide", verdict: "keep", stay: true },
    ],
    [{ key: "x" }, { kind: "decide", verdict: "reject" }],
    [{ key: "u" }, { kind: "decide", verdict: "undecided" }],
    // Photo Mechanic / Lightroom flags, stars, labels and tag.
    [{ key: "p" }, { kind: "decide", verdict: "keep" }],
    [
      { key: "0", code: "Digit0" },
      { kind: "rate", stars: 0 },
    ],
    [
      { key: "5", code: "Digit5" },
      { kind: "rate", stars: 5 },
    ],
    [
      { key: "#", code: "Digit3", shiftKey: true },
      { kind: "rate", stars: 3, stay: true },
    ],
    [
      { key: "6", code: "Digit6" },
      { kind: "label", label: "red" },
    ],
    [
      { key: "9", code: "Numpad9" },
      { kind: "label", label: "blue" },
    ],
    [{ key: "t" }, { kind: "tag" }],
    [
      { key: "T", shiftKey: true },
      { kind: "tag", stay: true },
    ],
    [{ key: " " }, { kind: "toggle" }],
    [{ key: "s" }, { kind: "stack" }],
    [{ key: "f" }, { kind: "af" }],
    [{ key: "c" }, { kind: "compare" }],
    [{ key: "z" }, { kind: "zoom" }],
    [{ key: "Enter" }, { kind: "open" }],
    [{ key: "Escape" }, { kind: "close" }],
    // Option-digit focuses a compare pane; Option on macOS changes the character, not the code.
    [
      { key: "¡", code: "Digit1", altKey: true },
      { kind: "pane", index: 0 },
    ],
    [
      { key: "¢", code: "Digit4", altKey: true },
      { kind: "pane", index: 3 },
    ],
    [{ key: "º", code: "Digit5", altKey: true }, null],
    // Modified keys belong to the browser and the app's edit keys (⌘Z, ⌘X).
    [{ key: "z", metaKey: true }, null],
    [{ key: "x", ctrlKey: true }, null],
    [{ key: "3", code: "Digit3", metaKey: true }, null],
    [{ key: "k", altKey: true }, null],
    [{ key: "ArrowRight", shiftKey: true }, null],
    [{ key: "q" }, null],
    [{ key: "Tab" }, null],
  ];
  for (const [event, action] of cases)
    test(`${JSON.stringify(event)} → ${JSON.stringify(action)}`, () => {
      expect(cullKeyAction(event)).toEqual(action);
    });

  test("space keeps a frame and takes that keep back", () => {
    const frame = cullFrame("a", { verdict: "reject", reason: "motion-blur" });
    expect(toggledVerdict(frame)).toBe("keep");
    expect(toggledVerdict({ ...frame, verdict: "keep", decided: true })).toBe("undecided");
    // An engine keep counts as the keep on screen.
    expect(toggledVerdict(cullFrame("b", { verdict: "keep" }))).toBe("undecided");
  });
});

/** The controller's store, in memory: the screen's decisions go through the real controller. */
function memoryStore(frames: CullFrame[]): CullStore & { saved: CullFrame[][] } {
  const saved: CullFrame[][] = [];
  const session = {
    id: "game",
    name: "Game",
    createdAt: 0,
    updatedAt: 0,
    frameCount: frames.length,
  };
  return {
    saved,
    create: async () => session,
    list: async () => [session],
    frames: async () => frames.slice(),
    thumbnail: async () => null,
    append: async () => {},
    update: async (_, changed) => {
      saved.push([...changed]);
    },
    close: () => {},
  };
}

describe("decisions", () => {
  test("the photographer's decision is marked as theirs, the engine's as a suggestion", () => {
    const game = smallGame();
    expect(decisionSource(byId(game, "s-eyes"))).toBe("photographer");
    expect(decisionSource(byId(game, "s-focus"))).toBe("engine");
    expect(decisionSource(byId(game, "s-open"))).toBe("none");
  });

  test("a decision survives a re-suggestion from the shoot pass", () => {
    const decided = smallGame().map((frame) =>
      frame.id === "b1-best" ? decide(frame, "reject") : frame,
    );
    const resuggested = applySuggestions(
      decided,
      new Map([
        ["b1-best", cullRow({ verdict: "keep", reason: "best-of-burst", score: 99 })],
        ["s-eyes", cullRow({ verdict: "reject", reason: "eyes-closed", score: 5 })],
      ]),
    );
    expect(effectiveVerdict(byId(resuggested, "b1-best"))).toBe("reject");
    expect(byId(resuggested, "b1-best").suggestion?.score).toBe(99);
    expect(effectiveVerdict(byId(resuggested, "s-eyes"))).toBe("keep");
  });

  test("bulk keep and reject never target a frame the photographer decided", () => {
    const game = smallGame();
    expect(bulkTargets(game, "rejects", "keep")).not.toContain("s-eyes");
    expect(bulkTargets(game, "all", "reject")).not.toContain("s-eyes");
    expect(bulkTargets(game, "all", "reject")).toHaveLength(9);
    expect(bulkTargets(game, "all", "undecided")).toEqual(["s-eyes"]);
  });

  test("the numbers on the bulk buttons are the frames a click would change", () => {
    const game = smallGame().map((frame) =>
      frame.id === "b1-2" || frame.id === "s-focus" ? decide(frame, "reject") : frame,
    );
    for (const filter of ["all", "keepers", "rejects", "undecided", "duplicates"] as const)
      expect(bulkCounts(game, filter)).toEqual({
        open: bulkTargets(game, filter, "keep").length,
        decided: bulkTargets(game, filter, "undecided").length,
      });
    expect(bulkCounts(game, "rejects")).toEqual({ open: 4, decided: 2 });
  });

  test("through the controller: a bulk reject keeps the photographer's keep, survives a re-rank, and undoes", async () => {
    const store = memoryStore(smallGame());
    const controller = new CullController(store);
    await controller.open("game");
    const screen = controller.snapshot().frames;

    await controller.decide(bulkTargets(screen, "all", "reject"), "reject");
    let frames = controller.snapshot().frames;
    expect(byId(frames, "s-eyes")).toMatchObject({ verdict: "keep", decided: true });
    expect(frames.filter((frame) => frame.decided && frame.verdict === "reject")).toHaveLength(9);
    expect(controller.snapshot().canUndo).toBe(true);
    expect(store.saved.at(-1)).toHaveLength(9);

    await controller.rerank();
    frames = controller.snapshot().frames;
    expect(effectiveVerdict(byId(frames, "s-eyes"))).toBe("keep");
    expect(frames.filter((frame) => effectiveVerdict(frame) === "reject")).toHaveLength(9);

    await controller.undo();
    frames = controller.snapshot().frames;
    expect(frames.filter((frame) => frame.decided)).toEqual([
      expect.objectContaining({ id: "s-eyes", verdict: "keep" }),
    ]);
    controller.dispose();
  });

  test("clear only reaches the photographer's own decisions, and undoing it restores them", async () => {
    const controller = new CullController(memoryStore(smallGame()));
    await controller.open("game");
    await controller.decide(
      bulkTargets(controller.snapshot().frames, "keepers", "undecided"),
      "undecided",
    );
    expect(byId(controller.snapshot().frames, "s-eyes").decided).toBe(false);
    await controller.undo();
    expect(byId(controller.snapshot().frames, "s-eyes")).toMatchObject({
      verdict: "keep",
      decided: true,
    });
    controller.dispose();
  });
});

describe("session names", () => {
  const at = new Date(2026, 8, 17, 21, 4);
  const file = (name: string, relative = "") => {
    const value = new File(["x"], name);
    if (relative) Object.defineProperty(value, "webkitRelativePath", { value: relative });
    return value;
  };

  test("a folder names the session", () => {
    expect(importName([file("a.NEF", "Lakers vs Celtics/DCIM/a.NEF")], at)).toBe(
      "Lakers vs Celtics",
    );
  });

  test("loose files are named for when they were picked", () => {
    expect(importName([file("a.NEF"), file("b.NEF", "b.NEF")], at)).toMatch(/^Sep 17, 9:04\sPM$/);
  });
});

describe("plain-language measurements", () => {
  const value = (reading: ReturnType<typeof cullReading>, label: string) =>
    plainReading(reading).find((row) => row.label === label)?.value;

  test("reads focus, motion, exposure and subject", () => {
    expect(plainReading(cullReading()).map((row) => row.label)).toEqual([
      "Focus",
      "Motion",
      "Exposure",
      "Subject",
    ]);
    expect(value(cullReading(), "Focus")).toBe("Sharp");
    expect(value(cullReading({ acuitySubject: 0.4, acuityBest: 0.45 }), "Focus")).toBe(
      "Slightly soft",
    );
    expect(value(cullReading({ acuitySubject: 0.2, acuityBest: 0.6 }), "Focus")).toBe(
      "Soft, focus missed the subject",
    );
    expect(value(cullReading({ motion: 0.5, globalSmear: true }), "Motion")).toBe("Camera shake");
    expect(value(cullReading({ motion: 0.35 }), "Motion")).toBe("Subject motion");
    expect(value(cullReading(), "Motion")).toBe("Frozen");
    expect(value(cullReading({ subjectLuma: 20 }), "Exposure")).toBe("Night");
    expect(value(cullReading({ hasFace: false, subjectLuma: 20 }), "Exposure")).toBe("Too dark");
    expect(value(cullReading({ hasFace: false, faceBox: { x: 0.2, y: 0.2, width: 0.2, height: 0.3 } }), "Subject")).toBe(
      "Face sharp",
    );
    expect(value(cullReading({ subjectLuma: 235, subjectClipped: 60 }), "Exposure")).toBe(
      "Bright, highlights clipped on the subject",
    );
    expect(value(cullReading(), "Exposure")).toBe("Good");
    expect(value(cullReading({ eyesClosed: true }), "Subject")).toBe("Eyes closed");
    // No face is not a flaw, so it is not listed as one.
    expect(value(cullReading({ hasFace: false }), "Subject")).toBeUndefined();
  });

  test("formats the ingest rate", () => {
    expect(formatRate(null)).toBe("");
    expect(formatRate(0)).toBe("");
    expect(formatRate(4.25)).toBe("4.3/sec");
    expect(formatRate(117.6)).toBe("118/sec");
  });
});

describe("virtual window at 10,000 frames", () => {
  const sizes = { minCardWidth: 176, cardHeight: 164, gap: 8, padding: 16 };

  test("mounts a bounded window wherever the card is scrolled", () => {
    const cells = cullCells(sportsCard(10_000), {
      filter: "all",
      stacked: true,
      expanded: new Set(),
    });
    expect(cells).toHaveLength(10_000);
    for (const scrollTop of [0, 50_000, 150_000, 10_000_000]) {
      const window = libraryGridWindow({
        ...sizes,
        count: cells.length,
        viewportWidth: 1440,
        viewportHeight: 900,
        scrollTop,
      });
      expect(window.end - window.start).toBeGreaterThan(0);
      expect(window.end - window.start).toBeLessThanOrEqual(window.columns * 10);
      expect(window.end).toBeLessThanOrEqual(10_000);
    }
  });
});
