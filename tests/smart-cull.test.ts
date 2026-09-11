import { describe, expect, test } from "bun:test";
import { smartCullPass, type SmartCullFrame } from "../src/lib/studio/smart-cull";

function frame(partial: Partial<SmartCullFrame> & { id: string }): SmartCullFrame {
  return {
    verdict: "undecided",
    score: 80,
    flags: [],
    ...partial,
  };
}

describe("smart cull", () => {
  test("protects existing photographer decisions", () => {
    const out = smartCullPass([
      frame({ id: "a", verdict: "keep", flags: ["blur"], score: 10 }),
      frame({ id: "b", verdict: "reject", score: 99 }),
    ]);
    expect(out.get("a")).toBe("keep");
    expect(out.get("b")).toBe("reject");
  });

  test("rejects blur, blinks, and weak scores on undecided frames", () => {
    const out = smartCullPass([
      frame({ id: "blur", flags: ["blur"], score: 90 }),
      frame({ id: "blink", flags: ["eyes-closed"], score: 90 }),
      frame({ id: "weak", score: 20 }),
      frame({ id: "strong", score: 88 }),
    ]);
    expect(out.get("blur")).toBe("reject");
    expect(out.get("blink")).toBe("reject");
    expect(out.get("weak")).toBe("reject");
    expect(out.get("strong")).toBe("keep");
  });

  test("keeps one frame per burst and prefers a sharp open-eyed pick", () => {
    const out = smartCullPass(
      [
        frame({ id: "blink", flags: ["eyes-closed"], score: 92 }),
        frame({ id: "soft", flags: ["soft"], score: 71 }),
        frame({ id: "crisp", score: 84 }),
      ],
      [{ frameIds: ["blink", "soft", "crisp"], recommendedId: "blink" }],
    );
    expect(out.get("blink")).toBe("reject");
    expect(out.get("crisp")).toBe("keep");
    expect(out.get("soft")).toBe("reject");
  });

  test("does not invent a burst pick when only one frame is still open", () => {
    const out = smartCullPass(
      [frame({ id: "only", score: 60 }), frame({ id: "gone", flags: ["blur"], score: 90 })],
      [{ frameIds: ["only", "gone"], recommendedId: "gone" }],
    );
    expect(out.get("gone")).toBe("reject");
    expect(out.get("only")).toBe("undecided");
  });
});
