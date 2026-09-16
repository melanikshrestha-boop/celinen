import { describe, expect, test } from "bun:test";
import { defaultDevelopSettings } from "../src/lib/develop/contract";
import { applySet, pointId, TUTOR_IDS } from "../src/lib/develop/tutor";
import { transportDevelopSettings } from "../src/lib/develop/parametric";

describe("Develop controls write the canonical recipe", () => {
  test("panel and control ids Clicky opens actually exist on the desk", () => {
    for (const id of [
      "panel-curve",
      "panel-effects",
      "panel-detail",
      "panel-crop",
      "panel-lens",
      "panel-masks",
      "tone-curve",
      "slider-parametric-highlights",
      "slider-straighten",
      "wheel-shadows",
    ])
      expect(TUTOR_IDS).toContain(id);
  });

  test("parametric and crop edits do not fork a second curve or crop object graph", () => {
    const start = defaultDevelopSettings();
    const next = applySet(applySet(start, "parametric.lights", -12), "crop.angle", 2);
    expect(next.curve).toEqual(start.curve);
    expect(next.parametricCurve.lights).toBe(-12);
    expect(next.parametricCurve.pointCurve).toEqual(start.parametricCurve.pointCurve);
    expect(next.crop.angle).toBe(2);
    expect(next.crop.width).toBe(start.crop.width);
    expect(pointId("parametric.highlights")).toBe("slider-parametric-highlights");
  });

  test("engine transport reads those same recipe fields", () => {
    const settings = defaultDevelopSettings();
    settings.parametricCurve.lights = -12;
    settings.crop.angle = 2;
    const transported = transportDevelopSettings(settings);
    expect(transported.crop.angle).toBe(2);
    expect(transported.curve.some((point) => Math.abs(point.y - point.x) > 0.001)).toBe(true);
  });
});
