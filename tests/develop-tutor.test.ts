import { describe, expect, test } from "bun:test";
import { defaultDevelopSettings } from "../src/lib/develop/contract";
import {
  applyLook,
  applySet,
  bezierArc,
  compileLook,
  lookTitle,
  parseBeats,
  pointerLabel,
  pointId,
} from "../src/lib/develop/tutor";

const sonderAsk = "make this more warm and apply color theory or cinematic that gives off sonder vibes";

describe("Develop look tutor beats", () => {
  test("parses OPEN POINT SET WAIT DONE without leaking tags into speech", () => {
    const beats = parseBeats(`
[OPEN:panel.basic]
[POINT:#slider-temp]
Warm the key so the world can stay cold.
[SET:temp:+18]
[WAIT]
[POINT:#slider-tint]
Green in the shade will fight the warmth.
[SET:tint:-4]
[DONE]
    `);
    expect(beats).toHaveLength(2);
    expect(beats[0]).toMatchObject({
      open: "panel-basic",
      point: "slider-temp",
      say: "Warm the key so the world can stay cold.",
      wait: true,
      sets: [{ path: "temp", delta: 18 }],
    });
    expect(beats[1]?.point).toBe("slider-tint");
    expect(beats[1]?.done).toBe(true);
    expect(beats.some((beat) => /\[/.test(beat.say))).toBe(false);
  });

  test("sonder dusk walks Temp Tint Highlights Shadows Teal Orange", () => {
    const beats = compileLook(sonderAsk, defaultDevelopSettings());
    expect(beats.map((beat) => beat.point)).toEqual([
      "slider-temp",
      "slider-tint",
      "slider-highlights",
      "slider-shadows",
      "tone-curve",
      "hsl-orange-sat",
    ]);
    expect(beats[0]?.sets).toEqual([{ path: "temp", delta: 18 }]);
    expect(beats[4]?.open).toBe("panel-curve");
    expect(beats[4]?.sets).toEqual([{ path: "curve.mid", delta: -12 }]);
    expect(beats[5]?.done).toBe(true);
    expect(beats[0]?.draw).toBe("subject");
    expect(beats[2]?.draw).toBe("windows");
    expect(beats[3]?.draw).toBe("world");
    expect(beats[5]?.draw).toBe("skin");
    expect(lookTitle(sonderAsk)).toBe("Look · Sonder dusk");
  });

  test("DRAW tags sit on the same beat as POINT and never leak into speech", () => {
    const beats = parseBeats(`
[DRAW:photo.subject]
[POINT:#slider-temp]
Warm the person. Leave the street cold.
[SET:temp:+18]
[WAIT]
    `);
    expect(beats).toHaveLength(1);
    expect(beats[0]).toMatchObject({ draw: "subject", point: "slider-temp" });
    expect(beats[0]?.say).not.toMatch(/\[/);
    expect(pointerLabel("slider-temp")).toBe("temp");
    expect(pointerLabel("wheel-shadows")).toBe("teal");
  });

  test("pointer labels stay one to three words like Clicky tags", () => {
    expect(pointerLabel("slider-highlights").split(" ").length).toBeLessThanOrEqual(3);
    expect(pointerLabel("hsl-orange-sat")).toBe("skin lock");
  });

  test("buddy flight arcs and lands on the target", () => {
    const start = { x: 0, y: 100 };
    const end = { x: 400, y: 100 };
    const mid = bezierArc(start, end, 0.5);
    const land = bezierArc(start, end, 1);
    expect(mid.y).toBeLessThan(start.y);
    expect(mid.scale).toBeGreaterThan(1.1);
    expect(land.x).toBeCloseTo(400, 5);
    expect(land.y).toBeCloseTo(100, 5);
    expect(land.scale).toBeCloseTo(1, 5);
  });

  test("already-warm photos skip Temp and do not repeat Highlights", () => {
    const current = defaultDevelopSettings();
    current.temperature = 24;
    const beats = compileLook(sonderAsk, current);
    expect(beats.map((beat) => beat.point)).toEqual([
      "slider-highlights",
      "slider-tint",
      "slider-shadows",
      "tone-curve",
      "hsl-orange-sat",
    ]);
    expect(beats.filter((beat) => beat.point === "slider-highlights")).toHaveLength(1);
  });

  test("browser-only sonder stays on Basic sliders the hosted renderer can apply", () => {
    const beats = compileLook(sonderAsk, defaultDevelopSettings(), { advanced: false });
    expect(beats.map((beat) => beat.point)).toEqual([
      "slider-temp",
      "slider-tint",
      "slider-highlights",
      "slider-shadows",
      "slider-blacks",
    ]);
    expect(beats.some((beat) => beat.point?.startsWith("wheel-") || beat.point?.startsWith("hsl-"))).toBe(
      false,
    );
  });

  test("relative sets write the same recipe Copy/Paste uses and Repeat does not double-apply", () => {
    const start = defaultDevelopSettings();
    const beats = compileLook(sonderAsk, start);
    const once = applyLook(start, beats, beats.length - 1);
    const twice = applyLook(start, beats, beats.length - 1);
    expect(once.temperature).toBe(18);
    expect(once.tint).toBe(-4);
    expect(once.highlights).toBe(-20);
    expect(once.shadows).toBe(15);
    expect(once.curve.some((point) => point.x > 0.3 && point.y < 0.62)).toBe(true);
    expect(once.hsl[1]?.saturation).toBe(-8);
    expect(twice).toEqual(once);
    expect(applySet(once, "temp", 18).temperature).toBe(36);
    expect(pointId("temp")).toBe("slider-temp");
    expect(pointId("curve.mid")).toBe("tone-curve");
    expect(pointId("wheel.shadows.hue")).toBe("wheel-shadows");
  });
});
