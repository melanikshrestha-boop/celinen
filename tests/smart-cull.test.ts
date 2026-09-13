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

  test("routes blur, blinks, and weak scores to review", () => {
    const out = smartCullPass([
      frame({ id: "blur", flags: ["blur"], score: 90 }),
      frame({ id: "blink", flags: ["eyes-closed"], score: 90 }),
      frame({ id: "weak", score: 20 }),
      frame({ id: "strong", score: 88 }),
    ]);
    expect(out.get("blur")).toBe("undecided");
    expect(out.get("blink")).toBe("undecided");
    expect(out.get("weak")).toBe("undecided");
    expect(out.get("strong")).toBe("keep");
  });

  test("burst recommendations cannot promote an unresolved blink or reject soft peers", () => {
    const out = smartCullPass(
      [
        frame({ id: "blink", flags: ["eyes-closed"], score: 92 }),
        frame({ id: "soft", flags: ["soft"], score: 71 }),
        frame({ id: "crisp", score: 84 }),
      ],
      [{ frameIds: ["blink", "soft", "crisp"], recommendedId: "blink" }],
    );
    expect(out.get("blink")).toBe("undecided");
    expect(out.get("crisp")).toBe("keep");
    expect(out.get("soft")).toBe("undecided");
  });

  test("does not invent a burst pick when only one frame is still open", () => {
    const out = smartCullPass(
      [frame({ id: "only", score: 60 }), frame({ id: "gone", flags: ["blur"], score: 90 })],
      [{ frameIds: ["only", "gone"], recommendedId: "gone" }],
    );
    expect(out.get("gone")).toBe("undecided");
    expect(out.get("only")).toBe("undecided");
  });

  test("burst peers retain multiple strong candidates, including underexposed-only frames", () => {
    const frames = [frame({ id: "a", score: 90 }), frame({ id: "b", score: 91, flags: ["underexposed"] }),
      frame({ id: "low", score: 20 }), frame({ id: "dupe", score: 99, flags: ["duplicate"] }),
      frame({ id: "manual", verdict: "reject", score: 100 })];
    const before = structuredClone(frames);
    const out = smartCullPass(frames, [{ frameIds: frames.map((item) => item.id), recommendedId: "dupe" }]);
    expect([...out.values()]).toEqual(["keep", "keep", "undecided", "undecided", "reject"]);
    expect(frames).toEqual(before);
  });
});
