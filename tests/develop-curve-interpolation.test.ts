import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createCurveInterpolator, curveDisplayPath } from "../src/lib/develop/curve-interpolation";
import {
  defaultDevelopSettings,
  developSettingsSchema,
  cloneDevelopSettings,
  type DevelopSettings,
} from "../src/lib/develop/contract";
import { developProtocol } from "../src/server/native-develop";
import { applyReferenceLook } from "../src/lib/develop/reference-apply";
import {
  createDevelopDocument,
  pushHistory,
  undoHistory,
  redoHistory,
  currentRecipe,
  developDocumentSchema,
} from "../src/lib/develop/store";
import {
  createPresetPackage,
  exportPresetPackage,
  parsePresetPackage,
  developPresetFromPackage,
} from "../src/lib/develop/preset-package";

const bend = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0.25 },
  { x: 1, y: 1 },
];
describe("Opt-in shape-preserving curve interpolation", () => {
  test("PCHIP matches analytical values, exact knots and unchanged two-point linear arithmetic", () => {
    const curve = createCurveInterpolator(bend, "smooth");
    expect(curve.mode).toBe("smooth");
    expect(curve.evaluate(0.25)).toBe(0.078125);
    expect(curve.evaluate(0.75)).toBe(0.546875);
    for (const point of bend) expect(curve.evaluate(point.x)).toBe(point.y);
    expect(curve.evaluate(-1)).toBe(0);
    expect(curve.evaluate(2)).toBe(1);
    const two = [
        { x: 0, y: 0.15 },
        { x: 1, y: 0.82 },
      ],
      linear = createCurveInterpolator(two, "linear"),
      smooth = createCurveInterpolator(two, "smooth");
    expect(smooth.mode).toBe("linear");
    for (let i = 0; i <= 1000; i++)
      expect(smooth.evaluate(i / 1000)).toBe(linear.evaluate(i / 1000));
  });
  test("increasing/decreasing/turning/flat curves never overshoot segment bounds", () => {
    for (const points of [
      bend,
      bend.map((p) => ({ ...p, y: 1 - p.y })),
      [
        { x: 0, y: 0 },
        { x: 0.33, y: 0.8 },
        { x: 0.7, y: 0.8 },
        { x: 1, y: 0.1 },
      ],
      [
        { x: 0, y: 0.5 },
        { x: 0.45, y: 0.5 },
        { x: 1, y: 0.5 },
      ],
    ]) {
      const curve = createCurveInterpolator(points, "smooth");
      for (let i = 1; i < points.length; i++)
        for (let step = 0; step <= 100; step++) {
          const a = points[i - 1]!,
            b = points[i]!,
            y = curve.evaluate(a.x + ((b.x - a.x) * step) / 100);
          expect(y).toBeGreaterThanOrEqual(Math.min(a.y, b.y));
          expect(y).toBeLessThanOrEqual(Math.max(a.y, b.y));
        }
    }
    const turn = createCurveInterpolator(
      [
        { x: 0, y: 0 },
        { x: 0.5, y: 1 },
        { x: 1, y: 0 },
      ],
      "smooth",
    );
    const left = (turn.evaluate(0.5) - turn.evaluate(0.5 - 1e-6)) / 1e-6;
    const right = (turn.evaluate(0.5 + 1e-6) - turn.evaluate(0.5)) / 1e-6;
    expect(Math.abs(left)).toBeLessThan(0.00001);
    expect(Math.abs(right)).toBeLessThan(0.00001);
  });
  test("unrepresentable slopes fall back the whole curve, but small representable gaps stay smooth", () => {
    const extreme = [
      { x: 0, y: 0 },
      { x: 1e-310, y: 0.5 },
      { x: 1, y: 1 },
    ];
    const fallback = createCurveInterpolator(extreme, "smooth"),
      old = createCurveInterpolator(extreme, "linear");
    expect(fallback.mode).toBe("linear");
    for (const x of [0, 5e-311, 1e-310, 0.25, 0.75, 1])
      expect(fallback.evaluate(x)).toBe(old.evaluate(x));
    expect(
      createCurveInterpolator(
        [
          { x: 0, y: 0 },
          { x: 1e-12, y: 0.5 },
          { x: 1, y: 1 },
        ],
        "smooth",
      ).mode,
    ).toBe("smooth");
    expect(() =>
      createCurveInterpolator(
        [
          { x: 0, y: 0 },
          { x: 0, y: 1 },
        ],
        "smooth",
      ),
    ).toThrow();
    expect(() =>
      createCurveInterpolator(
        [
          { x: 0, y: 0 },
          { x: 1, y: NaN },
        ],
        "smooth",
      ),
    ).toThrow();
  });
  test("dense display samples include all knots, stay finite, and retain immutable source ownership", () => {
    const points = [
        { x: 0, y: 0 },
        { x: 0.333333, y: 0.8 },
        { x: 1, y: 1 },
      ],
      original = JSON.stringify(points);
    const path = curveDisplayPath(points, "smooth");
    expect(path.match(/[ML]/g)).toHaveLength(258);
    expect(path).toContain(`L${points[1]!.x * 200} ${(1 - points[1]!.y) * 200}`);
    expect(path).not.toMatch(/NaN|Infinity/);
    expect(JSON.stringify(points)).toBe(original);
    const frozen = createCurveInterpolator(points, "smooth"),
      expected = frozen.evaluate(0.5);
    points[1]!.y = 0.1;
    expect(frozen.evaluate(0.5)).toBe(expected);
  });
  test("old schema/history/presets remain Linear without mutating input, and Smooth survives undo/redo", () => {
    const old: Record<string, unknown> = structuredClone(defaultDevelopSettings());
    delete old.curveInterpolation;
    const snapshot = JSON.stringify(old),
      parsed = developSettingsSchema.parse(old);
    expect(parsed.curveInterpolation).toBe("linear");
    expect(JSON.stringify(old)).toBe(snapshot);
    expect(defaultDevelopSettings().curveInterpolation).toBe("linear");
    for (const invalid of ["cubic", "", null, 1])
      expect(() =>
        developSettingsSchema.parse({ ...parsed, curveInterpolation: invalid }),
      ).toThrow();
    const smooth: DevelopSettings = { ...parsed, curveInterpolation: "smooth", curve: bend };
    expect(cloneDevelopSettings(smooth)).toEqual(smooth);
    const doc = createDevelopDocument("curve-mode"),
      saved = pushHistory(doc, smooth, "Smooth curve");
    expect(currentRecipe(undoHistory(saved)).curveInterpolation).toBe("linear");
    expect(currentRecipe(redoHistory(undoHistory(saved))).curveInterpolation).toBe("smooth");
    const legacyDoc = JSON.parse(JSON.stringify(doc));
    delete legacyDoc.history[0].settings.curveInterpolation;
    expect(currentRecipe(developDocumentSchema.parse(legacyDoc)).curveInterpolation).toBe("linear");
    expect(legacyDoc.history[0].settings.curveInterpolation).toBeUndefined();
    const packageText = exportPresetPackage(createPresetPackage({ title: "Smooth" }, smooth));
    expect(
      developPresetFromPackage(parsePresetPackage(packageText)).settings.curveInterpolation,
    ).toBe("smooth");
    const legacyPackage = JSON.parse(packageText);
    delete legacyPackage.settings.curveInterpolation;
    expect(
      developPresetFromPackage(parsePresetPackage(JSON.stringify(legacyPackage))).settings
        .curveInterpolation,
    ).toBe("linear");
  });
  test("serializer keeps exact old v3/v4 forms and selects v5 with mandatory Detail tail for Smooth", () => {
    const base = defaultDevelopSettings(),
      v3 = developProtocol(base);
    expect(v3.startsWith("FOTO_DEVELOP_3\n")).toBe(true);
    const smooth = developProtocol({ ...base, curveInterpolation: "smooth" });
    expect(smooth).toBe(v3.replace("FOTO_DEVELOP_3\n", "FOTO_DEVELOP_5\n") + "1 100 0\n1\n");
    const detail = { ...base, sharpeningRadius: 2.5, sharpeningDetail: 35, sharpeningMasking: 70 },
      v4 = developProtocol(detail);
    expect(v4).toBe(v3.replace("FOTO_DEVELOP_3\n", "FOTO_DEVELOP_4\n") + "2.5 35 70\n");
    expect(developProtocol({ ...detail, curveInterpolation: "smooth" })).toBe(
      v4.replace("FOTO_DEVELOP_4\n", "FOTO_DEVELOP_5\n") + "1\n",
    );
  });
  test("reference points and fitted interpolation transfer together, preserving unrelated detail", () => {
    const current = {
      ...defaultDevelopSettings(),
      curveInterpolation: "smooth" as const,
      sharpeningRadius: 2.4,
      grain: 35,
    };
    const fit = { ...defaultDevelopSettings(), curve: bend };
    const result = applyReferenceLook(current, fit);
    expect(result.curveInterpolation).toBe("linear");
    expect(result.curve).toEqual(bend);
    expect(result.sharpeningRadius).toBe(2.4);
    expect(result.grain).toBe(35);
    expect(current.curveInterpolation).toBe("smooth");
  });
  test("actual selector commits once, cancels owned drag, and cannot replay stale mode state", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        fileURLToPath(new URL("./develop-curve-interpolation.fixture.ts", import.meta.url)),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(JSON.parse(out).passed).toBeGreaterThanOrEqual(12);
  });
});
