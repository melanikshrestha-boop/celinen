import { describe, expect, test } from "bun:test";
import { defaultDevelopSettings } from "../src/lib/develop/contract";
import {
  applyLook,
  applySet,
  compileLook,
  lookTitle,
  parseBeats,
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
      "wheel-shadows",
      "hsl-orange-sat",
    ]);
    expect(beats[0]?.sets).toEqual([{ path: "temp", delta: 18 }]);
    expect(beats[4]?.open).toBe("panel-grading");
    expect(beats[4]?.sets).toEqual([
      { path: "wheel.shadows.hue", delta: 200 },
      { path: "wheel.shadows.sat", delta: 12 },
    ]);
    expect(beats[5]?.done).toBe(true);
    expect(lookTitle(sonderAsk)).toBe("Look · Sonder dusk");
  });

  test("already-warm photos skip Temp and do not repeat Highlights", () => {
    const current = defaultDevelopSettings();
    current.temperature = 24;
    const beats = compileLook(sonderAsk, current);
    expect(beats.map((beat) => beat.point)).toEqual([
      "slider-highlights",
      "slider-tint",
      "slider-shadows",
      "wheel-shadows",
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
    expect(once.grading.shadows.hue).toBe(200);
    expect(once.grading.shadows.saturation).toBe(12);
    expect(once.hsl[1]?.saturation).toBe(-8);
    expect(twice).toEqual(once);
    expect(applySet(once, "temp", 18).temperature).toBe(36);
    expect(pointId("temp")).toBe("slider-temp");
    expect(pointId("wheel.shadows.hue")).toBe("wheel-shadows");
  });
});
