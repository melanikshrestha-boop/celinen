import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ColorGrading } from "../src/components/develop/ColorGrading";
import { DevelopSlider } from "../src/components/develop/DevelopControls";
import {
  defaultDevelopSettings,
  developSettingsSchema,
  type DevelopGrade,
} from "../src/lib/develop/contract";
import {
  ColorWheelGesture,
  ColorGradingOwnership,
  keyboardGrade,
  neutralGrading,
  wheelGrade,
  wheelPosition,
  wrapHue,
} from "../src/components/develop/color-grading";
const grade = (patch: Partial<DevelopGrade> = {}): DevelopGrade => ({
  hue: 0,
  saturation: 0,
  luminance: 0,
  ...patch,
});

describe("Color grading wheel coordinates", () => {
  test("cardinal positions, radius and center match hue/saturation without changing luminance", () => {
    for (const [x, y, hue] of [
      [1, 0, 0],
      [0, 1, 90],
      [-1, 0, 180],
      [0, -1, 270],
    ])
      expect(wheelGrade({ x: x!, y: y! }, grade({ luminance: 14 }))).toEqual(
        grade({ hue, saturation: 100, luminance: 14 }),
      );
    expect(wheelGrade({ x: 0, y: 0 }, grade({ hue: 225 }))).toEqual(grade({ hue: 225 }));
    expect(wheelGrade({ x: 0.3, y: 0.4 }, grade()).saturation).toBe(50);
    expect(wheelGrade({ x: 5, y: -5 }, grade()).saturation).toBe(100);
  });
  test("1,000 hue/radius positions round-trip through wheel space within displayed precision", () => {
    for (let i = 0; i < 1000; i++) {
      const before = grade({
        hue: (i * 47) % 360,
        saturation: (i % 100) + 1,
        luminance: (i % 201) - 100,
      });
      const after = wheelGrade(wheelPosition(before), before);
      expect(after.hue).toBeCloseTo(before.hue, 1);
      expect(after.saturation).toBeCloseTo(before.saturation, 1);
      expect(after.luminance).toBe(before.luminance);
    }
  });
  test("focused and Adobe Alt arrows preserve independent channels and wrap/clamp correctly", () => {
    const before = grade({ hue: 359, saturation: 95, luminance: -6 });
    expect(keyboardGrade(before, "ArrowRight")?.hue).toBe(0);
    expect(keyboardGrade(before, "ArrowLeft", { alt: true })?.hue).toBe(0);
    expect(keyboardGrade(before, "ArrowRight", { alt: true, shift: true })?.hue).toBe(349);
    expect(keyboardGrade(before, "ArrowUp", { shift: true })).toEqual({
      ...before,
      saturation: 100,
    });
    expect(keyboardGrade(grade(), "ArrowDown")?.saturation).toBe(0);
    expect(keyboardGrade(before, "Escape")).toBeNull();
    expect(wrapHue(-721)).toBe(359);
  });
});

describe("Color grading gesture transaction", () => {
  test("shared ownership rejects overlapping wheels, keyboard and numeric edits before either can publish", () => {
    const ownership = new ColorGradingOwnership();
    const draft = { shadows: grade(), highlights: grade() };
    const history: (typeof draft)[] = [];
    const wheel = (range: keyof typeof draft) =>
      new ColorWheelGesture((next, commit) => {
        if (!ownership.claim(`wheel:${range}`)) return;
        draft[range] = next;
        if (commit) history.push(structuredClone(draft));
      });
    const shadows = wheel("shadows"),
      highlights = wheel("highlights");
    expect(ownership.claim("wheel:shadows")).toBe(true);
    shadows.begin(1, draft.shadows, { x: 0.5, y: 0 }, {});
    expect(ownership.claim("wheel:highlights")).toBe(false);
    expect(ownership.claim("numeric:shadows:luminance")).toBe(false);
    // Even an accidentally dispatched second handler cannot publish a preview.
    highlights.begin(2, draft.highlights, { x: 0.5, y: 0 }, {});
    ownership.release("wheel:highlights");
    expect(ownership.current).toBe("wheel:shadows");
    shadows.finish(1);
    ownership.release("wheel:shadows");
    highlights.finish(2, true);
    expect(history).toHaveLength(1);
    expect(history[0]).toEqual({ shadows: grade({ saturation: 50 }), highlights: grade() });
    expect(draft).toEqual(history[0]);
  });
  test("cancel releases shared ownership without saving or admitting another wheel's draft", () => {
    const owners: (string | null)[] = [];
    const ownership = new ColorGradingOwnership((owner) => owners.push(owner));
    const events: { value: DevelopGrade; commit: boolean }[] = [];
    const gesture = new ColorWheelGesture((value, commit) => events.push({ value, commit }));
    ownership.claim("wheel:shadows");
    gesture.begin(1, grade(), { x: 0.7, y: 0 }, {});
    expect(ownership.claim("wheel:highlights")).toBe(false);
    gesture.finish(1, true);
    ownership.release("wheel:shadows");
    expect(events.at(-1)).toEqual({ value: grade(), commit: false });
    expect(events.some((event) => event.commit)).toBe(false);
    expect(owners).toEqual(["wheel:shadows", null]);
    expect(ownership.claim("wheel:highlights")).toBe(true);
  });
  function fixture() {
    const events: { value: DevelopGrade; commit: boolean }[] = [];
    const gesture = new ColorWheelGesture((value, commit) =>
      events.push({ value: { ...value }, commit }),
    );
    return { events, gesture };
  }
  test("many preview moves produce exactly one commit; lost capture cannot double-save", () => {
    const { events, gesture } = fixture();
    gesture.begin(1, grade(), { x: 0.2, y: 0 }, {});
    for (let i = 1; i <= 100; i++) gesture.move(1, { x: 0.2, y: i / 100 }, {});
    expect(events.length).toBeGreaterThan(50);
    expect(events.every((event) => !event.commit)).toBe(true);
    gesture.finish(1);
    gesture.finish(1, true);
    expect(events.filter((event) => event.commit)).toHaveLength(1);
    expect(gesture.value).toBeNull();
  });
  test("cancel restores the original grade and never commits history", () => {
    const { events, gesture } = fixture();
    const before = grade({ hue: 47, saturation: 24, luminance: 8 });
    gesture.begin(3, before, { x: 0.6, y: 0.3 }, {});
    gesture.move(3, { x: -0.6, y: 0.7 }, {});
    gesture.finish(3, true);
    expect(events.at(-1)).toEqual({ value: before, commit: false });
    expect(events.some((event) => event.commit)).toBe(false);
  });
  test("a second pointer, stale pointerup and discarded photo cannot change the gesture", () => {
    const { events, gesture } = fixture();
    gesture.begin(1, grade(), { x: 0.4, y: 0 }, {});
    expect(gesture.begin(2, grade(), { x: -1, y: -1 }, {})).toBe(false);
    gesture.move(2, { x: -1, y: -1 }, {});
    gesture.finish(2);
    expect(events).toHaveLength(1);
    gesture.discard();
    gesture.move(1, { x: 1, y: 1 }, {});
    gesture.finish(1);
    expect(events).toHaveLength(1);
  });
  test("Shift locks hue; Control/Command locks saturation", () => {
    for (const mode of [{ shift: true }, { hueOnly: true }]) {
      const { events, gesture } = fixture();
      gesture.begin(1, grade({ hue: 80, saturation: 32 }), { x: 0.5, y: 0 }, mode);
      gesture.move(1, { x: 0, y: -0.8 }, mode);
      const next = events.at(-1)!.value;
      if (mode.shift) expect(next).toMatchObject({ hue: 80, saturation: 80 });
      else expect(next).toMatchObject({ hue: 270, saturation: 32 });
    }
  });
  test("fine movement has no initial jump, crosses hue zero correctly and rebases modifiers", () => {
    const { events, gesture } = fixture();
    const before = grade({ hue: 359, saturation: 40 });
    const from = wheelPosition(grade({ hue: 359, saturation: 80 }));
    gesture.begin(1, before, from, { fine: true });
    expect(events).toHaveLength(0);
    gesture.move(1, wheelPosition(grade({ hue: 9, saturation: 90 })), { fine: true });
    expect(events.at(-1)!.value.hue).toBeCloseTo(0, 4);
    expect(events.at(-1)!.value.saturation).toBeCloseTo(41, 4);
    const count = events.length;
    gesture.move(1, { x: -1, y: 0 }, {});
    expect(events).toHaveLength(count);
    gesture.move(1, { x: 0, y: 1 }, {});
    expect(events.at(-1)!.value.hue).toBe(90);
  });
  test("no-op clicks and return to initial value append no history", () => {
    const { events, gesture } = fixture();
    gesture.begin(1, grade(), { x: 0, y: 0 }, {});
    gesture.finish(1);
    expect(events).toHaveLength(0);
    gesture.begin(2, grade(), { x: 0.7, y: 0 }, {});
    gesture.move(2, { x: 0, y: 0 }, {});
    gesture.finish(2);
    expect(events.some((event) => event.commit)).toBe(false);
  });
});

describe("Legacy grading intent", () => {
  test("only zero saturation and luminance on every wheel counts as neutral", () => {
    const settings = defaultDevelopSettings();
    settings.grading.shadows.hue = 42;
    settings.grading.balance = 72;
    expect(neutralGrading(settings.grading)).toBe(true);
    for (const range of ["shadows", "midtones", "highlights", "global"] as const) {
      for (const key of ["saturation", "luminance"] as const) {
        const candidate = structuredClone(settings.grading);
        candidate[range][key] = 1;
        expect(neutralGrading(candidate)).toBe(false);
      }
    }
  });
  test("legacy recipes remain legacy until the explicit persisted model switch", () => {
    const saved = defaultDevelopSettings();
    const { model: _, ...legacy } = saved.grading;
    const restored = developSettingsSchema.parse({ ...saved, grading: legacy });
    expect(restored.grading.model).toBe("legacy");
    const edited = {
      ...restored,
      grading: { ...restored.grading, shadows: grade({ hue: 200, saturation: 20 }) },
    };
    expect(developSettingsSchema.parse(edited).grading.model).toBe("legacy");
    expect(
      developSettingsSchema.parse({ ...edited, grading: { ...edited.grading, model: "tonal" } })
        .grading.model,
    ).toBe("tonal");
  });
  test("actual three-way component exposes colored sliders and never writes on render", () => {
    let writes = 0;
    const html = renderToStaticMarkup(
      createElement(ColorGrading, {
        value: defaultDevelopSettings(),
        Slider: DevelopSlider,
        change() {
          writes += 1;
        },
      }),
    );
    expect(html.match(/class="develop-grade-wheel"/g)).toHaveLength(3);
    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-label="Shadows color wheel"');
    expect(html).toContain('aria-label="Global color grading"');
    expect(html).toContain('aria-label="Reset all color grading"');
    expect(html).toContain('aria-label="Shadows hue value"');
    expect(html).not.toContain("develop-grade-swatch");
    expect(writes).toBe(0);
  });
  test("legacy nonneutral renders an explicit upgrade action without automatic migration", () => {
    const value = defaultDevelopSettings();
    value.grading.model = "legacy";
    value.grading.global.saturation = 12;
    let writes = 0;
    const html = renderToStaticMarkup(
      createElement(ColorGrading, {
        value,
        Slider: DevelopSlider,
        change() {
          writes += 1;
        },
      }),
    );
    expect(html).toContain("Use updated grading");
    expect(html).toContain("Saved grading keeps its original rendering.");
    expect(value.grading.model).toBe("legacy");
    expect(value.grading.global.saturation).toBe(12);
    expect(writes).toBe(0);
  });
});
