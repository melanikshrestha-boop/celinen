import { describe, expect, test } from "bun:test";
import { defaultDevelopSettings } from "../src/lib/develop/contract";
import {
  applyLook,
  applySet,
  bezierArc,
  clientOnNorm,
  compileLook,
  driveSet,
  lookMetricsFromHistogram,
  lookTitle,
  parseBeats,
  pointerLabel,
  pointId,
  trustedPointer,
  valueAt,
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

  test("cinematic is a full RAW grade, not a temperature bump", () => {
    const beats = compileLook("cinematic", defaultDevelopSettings());
    const points = beats.map((beat) => beat.point);
    expect(points[0]).toBe("slider-highlights");
    expect(points).toContain("slider-vibrance");
    expect(points).toContain("tone-curve");
    expect(points).toContain("hsl-orange-sat");
    expect(points).toContain("wheel-shadows");
    expect(points).toContain("slider-grain");
    expect(points).toContain("slider-sharpening");
    expect(points.some((id) => id === "slider-temp")).toBe(false);
    const look = applyLook(defaultDevelopSettings(), beats, beats.length - 1);
    expect(look.highlights).toBe(-28);
    expect(look.shadows).toBe(14);
    expect(look.blacks).toBe(-14);
    expect(look.contrast).toBe(10);
    expect(look.grading.shadows.saturation).toBe(14);
    expect(look.grain).toBe(14);
    expect(look.vignette).toBe(-18);
    expect(look.sharpening).toBe(32);
    expect(beats.length).toBeGreaterThan(6);
  });

  test("cinematic tone SETs follow histogram clip and mid", () => {
    const cold = lookMetricsFromHistogram({
      channels: [
        Array.from({ length: 256 }, (_, i) => (i === 20 ? 100 : 0)),
        Array.from({ length: 256 }, (_, i) => (i === 20 ? 100 : 0)),
        Array.from({ length: 256 }, (_, i) => (i === 200 ? 100 : 0)),
      ],
      encodedLuminance: Array.from({ length: 256 }, (_, i) => (i === 20 ? 100 : 0)),
      luminance: Array(1024).fill(0),
      maximum: Array(256).fill(0),
      pixels: 100,
      shadows: 8,
      shadowClipped: 8,
      highlights: 6,
    });
    expect(cold.clipHi).toBeGreaterThan(0.03);
    expect(cold.clipLo).toBeGreaterThan(0.04);
    expect(cold.warmth).toBeLessThan(-0.06);
    const beats = compileLook("cinematic", defaultDevelopSettings(), { metrics: cold });
    const look = applyLook(defaultDevelopSettings(), beats, beats.length - 1);
    expect(look.highlights).toBe(-42);
    expect(look.shadows).toBe(22);
    expect(look.temperature).toBe(12);
  });

  test("plain asks start a RAW tone pass instead of only Temp", () => {
    const beats = compileLook("fix this", defaultDevelopSettings());
    expect(beats.map((beat) => beat.point)).toEqual([
      "slider-highlights",
      "slider-shadows",
      "slider-whites",
      "slider-blacks",
      "slider-contrast",
    ]);
  });

  test("SET writes parametric, straighten and grain onto the same recipe", () => {
    const start = defaultDevelopSettings();
    const parametric = applySet(start, "parametric.darks", 20);
    expect(parametric.parametricCurve.darks).toBe(20);
    expect(parametric.curve).toEqual(start.curve);
    expect(applySet(start, "straighten", 3).crop.angle).toBe(3);
    expect(applySet(start, "grain", 12).grain).toBe(12);
    expect(pointId("parametric.lights")).toBe("slider-parametric-lights");
    expect(pointId("straighten")).toBe("slider-straighten");
  });

  test("driveSet does not dump a look when there is no live control", () => {
    expect(driveSet("slider-temp", { path: "temp", delta: 18 })).toBe(false);
    expect(driveSet("tone-curve", { path: "curve.mid", delta: -12 })).toBe(false);
  });

  test("Clicky's synthetic pointerup does not skip WAIT; photographer clicks do", () => {
    expect(trustedPointer({ isTrusted: false })).toBe(false);
    expect(trustedPointer({ isTrusted: true })).toBe(true);
    expect(trustedPointer({} as Event)).toBe(false);
  });

  test("SET targets are origin-relative so Back does not add the delta twice", () => {
    const start = defaultDevelopSettings();
    const beats = compileLook(sonderAsk, start);
    const first = applyLook(start, beats, 0);
    expect(valueAt(first, "temp")).toBe(18);
    expect(valueAt(applySet(first, "temp", 18), "temp")).toBe(36);
    const again = applyLook(start, beats, 0);
    expect(valueAt(again, "temp")).toBe(18);
    const lens = applySet(start, "lens.vignetteCorrection.amount", -20);
    expect(lens.lensCorrection.enabled).toBe(true);
    expect(lens.lensCorrection.vignetteCorrection.enabled).toBe(true);
    expect(lens.lensCorrection.vignetteCorrection.amount).toBe(-20);
  });

  test("curve pointer math matches ToneCurve's SVG mapping so Clicky pulls the mid point", () => {
    const box = { left: 0, top: 0, width: 200, height: 200 };
    const at = clientOnNorm(box, 0.62, 0.62);
    expect(at.x).toBeCloseTo(124, 5);
    expect(at.y).toBeCloseTo(76, 5);
    expect((at.x - box.left) / box.width).toBeCloseTo(0.62, 5);
    expect(1 - (at.y - box.top) / box.height).toBeCloseTo(0.62, 5);
    const next = applySet(defaultDevelopSettings(), "curve.mid", -12);
    const mid = next.curve.find((point) => point.x > 0.35 && point.x < 0.82);
    expect(mid?.x).toBeCloseTo(0.62, 5);
    expect(mid?.y).toBeCloseTo(0.5, 5);
  });
});
