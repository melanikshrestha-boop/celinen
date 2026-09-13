import { describe, expect, test } from "bun:test";
import {
  DEFAULT_FIRST_PASS_THRESHOLDS,
  firstPassVerdict,
  type FirstPassFrame,
} from "../src/lib/studio/first-pass";

const frame = (overrides: Partial<FirstPassFrame> = {}): FirstPassFrame => ({
  verdict: "undecided",
  score: 60,
  flags: [],
  ...overrides,
});

describe("mechanical first pass protects existing decisions and unreadable frames", () => {
  test.each(["keep", "reject"] as const)("an existing %s is never replaced", (verdict) => {
    for (const score of [0, 44, 45, 69, 70, 100, NaN, Infinity]) {
      expect(firstPassVerdict(frame({ verdict, score }))).toBe(verdict);
      expect(
        firstPassVerdict(frame({ verdict, score, flags: ["blur", "duplicate", "eyes-closed"] })),
      ).toBe(verdict);
      expect(firstPassVerdict(frame({ verdict, score, error: "Could not decode source" }))).toBe(
        verdict,
      );
      expect(
        firstPassVerdict(
          frame({ verdict, score, develop: { origin: "lightroom", at: 0, label: "Red" } }),
        ),
      ).toBe(verdict);
    }
  });

  test.each(["Could not decode source", "Missing original", ""])(
    "an error record stays undecided: %s",
    (error) => {
      expect(firstPassVerdict(frame({ error, score: 0, flags: ["blur"] }))).toBe("undecided");
      expect(firstPassVerdict(frame({ error, score: 100 }))).toBe("undecided");
    },
  );

  test.each([NaN, Infinity, -Infinity, -1, 100.01])(
    "invalid analysis score %d cannot become a verdict",
    (score) => {
      expect(firstPassVerdict(frame({ score }))).toBe("undecided");
      expect(firstPassVerdict(frame({ score, flags: ["blur"] }))).toBe("undecided");
    },
  );

  test("the helper does not mutate a frame, flags or thresholds", () => {
    const source = frame({ score: 100, flags: ["blur"] });
    const before = structuredClone(source);
    Object.freeze(source.flags);
    Object.freeze(source);
    const thresholds = Object.freeze({ rejectBelow: 45, keepAt: 70 });
    expect(firstPassVerdict(source, thresholds)).toBe("undecided");
    expect(source).toEqual(before);
    expect(thresholds).toEqual({ rejectBelow: 45, keepAt: 70 });
  });
});

describe("first-pass thresholds and flag precedence", () => {
  test.each(["red", "Red", "RED"])(
    "a saved %s review label protects an undecided high-score photo",
    (label) => {
      const source = frame({ score: 90, develop: { origin: "lightroom", at: 0, label } });
      const before = structuredClone(source);
      expect(firstPassVerdict(source)).toBe("undecided");
      expect(source).toEqual(before);
    },
  );

  test.each([null, "", "Green", "Yellow"])(
    "a non-red label %s does not prevent an otherwise clean suggestion",
    (label) => {
      expect(
        firstPassVerdict(frame({ score: 90, develop: { origin: "lightroom", at: 0, label } })),
      ).toBe("keep");
    },
  );

  test("defaults retain legacy configuration and the inclusive keep boundary", () => {
    expect(DEFAULT_FIRST_PASS_THRESHOLDS).toEqual({ rejectBelow: 45, keepAt: 70 });
    expect(Object.isFrozen(DEFAULT_FIRST_PASS_THRESHOLDS)).toBe(true);
  });

  test.each([
    [0, "undecided"],
    [44, "undecided"],
    [44.999, "undecided"],
    [45, "undecided"],
    [60, "undecided"],
    [69.999, "undecided"],
    [70, "keep"],
    [70.001, "keep"],
    [100, "keep"],
  ] as const)("score %d suggests %s", (score, expected) => {
    expect(firstPassVerdict(frame({ score }))).toBe(expected);
  });

  test.each(["blur", "soft", "face-soft", "duplicate", "eyes-closed", "overexposed"] as const)(
    "%s routes to review even at a high score",
    (flag) => {
      expect(firstPassVerdict(frame({ score: 100, flags: [flag] }))).toBe("undecided");
      expect(firstPassVerdict(frame({ score: 60, flags: [flag] }))).toBe("undecided");
    },
  );

  test.each(["underexposed"] as const)(
    "%s alone does not introduce a new rejection criterion",
    (flag) => {
      expect(firstPassVerdict(frame({ score: 100, flags: [flag] }))).toBe("keep");
      expect(firstPassVerdict(frame({ score: 60, flags: [flag] }))).toBe("undecided");
    },
  );

  test("legacy rejectBelow does not reject and custom keepAt remains inclusive", () => {
    const thresholds = { rejectBelow: 30, keepAt: 85 };
    expect(firstPassVerdict(frame({ score: 29.9 }), thresholds)).toBe("undecided");
    expect(firstPassVerdict(frame({ score: 30 }), thresholds)).toBe("undecided");
    expect(firstPassVerdict(frame({ score: 84.9 }), thresholds)).toBe("undecided");
    expect(firstPassVerdict(frame({ score: 85 }), thresholds)).toBe("keep");
    expect(firstPassVerdict(frame({ score: 100, flags: ["duplicate"] }), thresholds)).toBe(
      "undecided",
    );
  });

  test("coincident thresholds still leave low scores for review", () => {
    const thresholds = { rejectBelow: 50, keepAt: 50 };
    expect(firstPassVerdict(frame({ score: 49.9 }), thresholds)).toBe("undecided");
    expect(firstPassVerdict(frame({ score: 50 }), thresholds)).toBe("keep");
    expect(firstPassVerdict(frame({ score: 0 }), { rejectBelow: 0, keepAt: 0 })).toBe("keep");
    expect(firstPassVerdict(frame({ score: 100 }), { rejectBelow: 100, keepAt: 100 })).toBe("keep");
  });

  test.each([
    { rejectBelow: -1, keepAt: 70 },
    { rejectBelow: 45, keepAt: 101 },
    { rejectBelow: 80, keepAt: 70 },
    { rejectBelow: NaN, keepAt: 70 },
    { rejectBelow: 45, keepAt: NaN },
    { rejectBelow: Infinity, keepAt: 70 },
    { rejectBelow: 45, keepAt: -Infinity },
    { rejectBelow: 0, keepAt: -1 },
    { rejectBelow: 101, keepAt: 100 },
  ])(
    "invalid threshold configuration %# refuses rather than silently changing the split",
    (thresholds) => {
      expect(() => firstPassVerdict(frame(), thresholds)).toThrow(RangeError);
    },
  );
});
