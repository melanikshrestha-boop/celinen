import { describe, expect, test } from "bun:test";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
import { cullReview, filterCullFrames, nextCullReviewId } from "../src/lib/studio/cull-review";

const shot = (id: string, patch: Partial<Shot> = {}): Shot => ({
  id,
  name: `${id}.jpg`,
  file: new File([id], `${id}.jpg`),
  isRaw: false,
  previewUrl: null,
  width: 256,
  height: 256,
  sizeMb: 0.1,
  sharpness: 200,
  brightness: 110,
  clippedHighlights: 0,
  clippedShadows: 0,
  hash: "1".repeat(64),
  score: 90,
  flags: [],
  verdict: "undecided",
  edits: { ...DEFAULT_EDITS },
  ...patch,
});

describe("color-dot review", () => {
  test("green means a saved keep, dark red means a saved reject, not a claimed perfect expression", () => {
    expect(cullReview(shot("keep", { verdict: "keep", flags: ["blur"] }))).toEqual({
      dot: "keep",
      label: "Kept",
    });
    expect(cullReview(shot("reject", { verdict: "reject" }))).toEqual({
      dot: "reject",
      label: "Rejected",
    });
    expect(cullReview(shot("unknown", { hash: "", score: 0 })).dot).toBe("pending");
    expect(cullReview(shot("clean"))).toEqual({ dot: "pending", label: "Not yet picked" });
  });
  test("low light alone never becomes a red warning", () => {
    for (const score of [20, 50, 90]) {
      expect(cullReview(shot("dark", { flags: ["underexposed"], score })).dot).not.toBe("review");
    }
    expect(cullReview(shot("dark-blur", { flags: ["underexposed", "blur"] })).dot).toBe("review");
  });
  test("real warnings and manual red labels are review, not automatic rejection", () => {
    for (const flag of [
      "blur",
      "soft",
      "face-soft",
      "eyes-closed",
      "duplicate",
      "overexposed",
    ] as const)
      expect(cullReview(shot(flag, { flags: [flag] })).dot).toBe("review");
    expect(
      cullReview(shot("marked", { develop: { origin: "sidecar", at: 0, label: "Red" } })).label,
    ).toBe("Marked for review");
    expect(cullReview(shot("error", { error: "Unreadable" })).dot).toBe("review");
  });
  test("red queue and dot counts share one policy and preserve source order", () => {
    const frames = [
      shot("dark", { flags: ["underexposed"] }),
      shot("focus", { flags: ["blur"] }),
      shot("keep", { verdict: "keep" }),
      shot("eyes", { flags: ["eyes-closed"] }),
      shot("reject", { verdict: "reject" }),
    ];
    const snapshot = frames.map((frame) => ({ ...frame }));
    expect(filterCullFrames(frames, "flagged").map((frame) => frame.id)).toEqual(["focus", "eyes"]);
    expect(filterCullFrames(frames, "keepers").map((frame) => frame.id)).toEqual(["keep"]);
    expect(filterCullFrames(frames, "rejected").map((frame) => frame.id)).toEqual(["reject"]);
    expect(filterCullFrames(frames, "all")).toEqual(frames);
    expect(frames).toEqual(snapshot);
  });
  test("K/X resolve a red warning and advance only through remaining red dots", () => {
    let frames = [
      shot("a", { flags: ["blur"] }),
      shot("skip", { verdict: "keep" }),
      shot("b", { flags: ["eyes-closed"] }),
    ];
    let visible = filterCullFrames(frames, "flagged");
    expect(nextCullReviewId(visible, "a")).toBe("b");
    frames = frames.map((frame) => (frame.id === "a" ? { ...frame, verdict: "keep" } : frame));
    visible = filterCullFrames(frames, "flagged");
    expect(visible.map((frame) => frame.id)).toEqual(["b"]);
    expect(nextCullReviewId(visible, "b")).toBeNull();
    frames = frames.map((frame) => (frame.id === "b" ? { ...frame, verdict: "reject" } : frame));
    expect(filterCullFrames(frames, "flagged")).toHaveLength(0);
    expect(nextCullReviewId(visible, "missing")).toBeNull();
  });
});
