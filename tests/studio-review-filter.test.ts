import { describe, expect, test } from "bun:test";
import type { Flag, Shot } from "../src/lib/imaging";
import {
  countReviewIssue,
  filterReviewIssue,
  hasReviewIssue,
  type ReviewIssue,
} from "../src/lib/studio/review-filter";

function frame(id: string, flags: Flag[]): Shot {
  return {
    id,
    file: new File([id], `${id}.jpg`, { type: "image/jpeg" }),
    name: `${id}.jpg`,
    relativePath: `${id}.jpg`,
    isRaw: false,
    previewUrl: null,
    sourceAvailable: true,
    width: 1,
    height: 1,
    sizeMb: 0,
    sharpness: 0,
    brightness: 0,
    clippedHighlights: 0,
    clippedShadows: 0,
    hash: id.padEnd(64, "0").slice(0, 64),
    score: 0,
    flags,
    verdict: "undecided",
    edits: {
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      saturation: 0,
      warmth: 0,
      crop: "orig",
    },
  };
}

describe("focused issue review", () => {
  const shots = [
    frame("blur", ["blur"]),
    frame("eyes", ["eyes-closed"]),
    frame("face", ["face-soft"]),
    frame("dark", ["underexposed"]),
    frame("bright", ["overexposed"]),
    frame("dupe", ["duplicate"]),
    frame("mixed", ["duplicate", "soft", "overexposed"]),
    frame("clean", []),
  ];

  test.each([
    ["focus", ["blur", "eyes", "face", "mixed"]],
    ["exposure", ["dark", "bright", "mixed"]],
    ["duplicates", ["dupe", "mixed"]],
  ] as Array<[ReviewIssue, string[]]>)("filters %s without mutating source order", (issue, ids) => {
    const result = filterReviewIssue(shots, issue);
    expect(result.map((shot) => shot.id)).toEqual(ids);
    expect(countReviewIssue(shots, issue)).toBe(ids.length);
    expect(shots).toHaveLength(8);
  });

  test("null returns an independent complete list and unknown flags never match", () => {
    const result = filterReviewIssue(shots, null);
    expect(result).toEqual(shots);
    expect(result).not.toBe(shots);
    expect(hasReviewIssue(frame("other", ["soft"]), "duplicates")).toBe(false);
  });
});
