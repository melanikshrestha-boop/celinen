import { describe, expect, test } from "bun:test";
import type { CullRow } from "../src/lib/studio/cull/engine";
import {
  applySuggestions,
  countFrames,
  decide,
  effectiveVerdict,
  filterFrames,
  formatRemaining,
  groupFrames,
  ingestProgress,
  matchesFilter,
  nextFrameId,
  type CullFrame,
} from "../src/lib/studio/cull/session";

function frame(
  id: string,
  suggestion?: Partial<CullRow>,
  extra: Partial<CullFrame> = {},
): CullFrame {
  return {
    id,
    name: `${id}.jpg`,
    width: 6000,
    height: 4000,
    bytes: 12_000_000,
    captureTimeMs: null,
    verdict: "undecided",
    decided: false,
    ...(suggestion
      ? {
          suggestion: {
            verdict: "undecided",
            reason: "none",
            score: 50,
            group: null,
            bestOfGroup: false,
            duplicate: false,
            ...suggestion,
          },
        }
      : {}),
    ...extra,
  };
}

describe("cull session model", () => {
  test("the photographer's decision outranks the engine's suggestion", () => {
    const suggested = frame("a", { verdict: "reject", reason: "out-of-focus" });
    expect(effectiveVerdict(suggested)).toBe("reject");
    const kept = decide(suggested, "keep");
    expect(kept.decided).toBe(true);
    expect(effectiveVerdict(kept)).toBe("keep");
    // A later pass may re-suggest; the decision stands.
    const reSuggested = applySuggestions(
      [kept],
      new Map([
        [
          "a",
          {
            verdict: "reject",
            reason: "duplicate",
            score: 10,
            group: 1,
            bestOfGroup: false,
            duplicate: true,
          } satisfies CullRow,
        ],
      ]),
    );
    expect(effectiveVerdict(reSuggested[0]!)).toBe("keep");
    expect(reSuggested[0]!.suggestion!.reason).toBe("duplicate");
    // Clearing a decision hands the frame back to the engine's view.
    expect(effectiveVerdict(decide(reSuggested[0]!, "undecided"))).toBe("reject");
  });

  test("filters and counts describe the same shoot", () => {
    const frames = [
      frame("keep", { verdict: "keep", reason: "strong-frame" }),
      frame("soft", { verdict: "reject", reason: "out-of-focus" }),
      frame("missed", { verdict: "reject", reason: "missed-focus" }),
      frame("shake", { verdict: "reject", reason: "motion-blur" }),
      frame("blink", { verdict: "reject", reason: "eyes-closed" }),
      frame("dark", { verdict: "reject", reason: "exposure" }),
      frame("dupe", { verdict: "reject", reason: "duplicate", group: 3, duplicate: true }),
      frame("best", { verdict: "keep", reason: "best-of-burst", group: 3, bestOfGroup: true }),
      frame("open"),
      frame("broken", undefined, { error: "This photo could not be read." }),
    ];
    const counts = countFrames(frames);
    expect(counts.all).toBe(10);
    expect(counts.keepers).toBe(2);
    expect(counts.rejects).toBe(6);
    expect(counts.undecided).toBe(2);
    // Missed focus belongs in the focus list a photographer actually opens.
    expect(counts["out-of-focus"]).toBe(2);
    expect(counts["motion-blur"]).toBe(1);
    expect(counts["eyes-closed"]).toBe(1);
    expect(counts.exposure).toBe(1);
    expect(counts.duplicates).toBe(2);
    expect(counts.unreadable).toBe(1);
    expect(filterFrames(frames, "keepers").map((f) => f.id)).toEqual(["keep", "best"]);
    expect(matchesFilter(frames[9]!, "undecided")).toBe(true);
  });

  test("bursts come back as stacks with the engine's pick in front", () => {
    const frames = [
      frame("b1", { group: 7, score: 40 }),
      frame("b2", { group: 7, score: 90, bestOfGroup: true }),
      frame("solo", { group: null, score: 70 }),
      frame("b3", { group: 7, score: 55 }),
    ];
    const groups = groupFrames(frames);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.frames.map((f) => f.id)).toEqual(["b2", "b1", "b3"]);
    expect(groups[0]!.bestId).toBe("b2");
    expect(groups[1]!.frames.map((f) => f.id)).toEqual(["solo"]);
    // Without a marked best, the highest score leads the stack.
    const unmarked = groupFrames([
      frame("x", { group: 2, score: 10 }),
      frame("y", { group: 2, score: 80 }),
    ]);
    expect(unmarked[0]!.bestId).toBe("y");
  });

  test("progress only claims a rate once it has one", () => {
    expect(ingestProgress(1000, 3, 0, 200).rate).toBeNull();
    expect(ingestProgress(1000, 3, 0, 200).remainingMs).toBeNull();
    const running = ingestProgress(1000, 100, 0, 5000);
    expect(running.rate).toBeCloseTo(20, 5);
    expect(running.remainingMs).toBeCloseTo(45000, 5);
    expect(running.done).toBe(false);
    expect(ingestProgress(10, 9, 1, 5000).done).toBe(true);
    expect(formatRemaining(null)).toBe("");
    expect(formatRemaining(4000)).toBe("a few seconds left");
    expect(formatRemaining(45000)).toBe("45 seconds left");
    expect(formatRemaining(130000)).toBe("2 min 10 sec left");
    expect(formatRemaining(600000)).toBe("10 minutes left");
  });

  test("review moves in a stream and stops at the ends", () => {
    const frames = [frame("a"), frame("b"), frame("c")];
    expect(nextFrameId(frames, null)).toBe("a");
    expect(nextFrameId(frames, "a")).toBe("b");
    expect(nextFrameId(frames, "c")).toBe("c");
    expect(nextFrameId(frames, "a", -1)).toBe("a");
    expect(nextFrameId(frames, "b", -1)).toBe("a");
    expect(nextFrameId([], "a")).toBeNull();
  });

  test("counting a ten-thousand frame card is one pass", () => {
    const frames = Array.from({ length: 10_000 }, (_, i) =>
      frame(`f${i}`, {
        verdict: i % 3 === 0 ? "keep" : "reject",
        reason: i % 3 === 0 ? "best-of-burst" : "duplicate",
        group: Math.floor(i / 5),
        bestOfGroup: i % 5 === 0,
        duplicate: i % 5 !== 0,
      }),
    );
    const started = performance.now();
    const counts = countFrames(frames);
    const groups = groupFrames(frames);
    const elapsed = performance.now() - started;
    expect(counts.all).toBe(10_000);
    expect(groups).toHaveLength(2000);
    // The review screen recounts on every decision; this has to stay trivial.
    expect(elapsed).toBeLessThan(500);
  });
});
