import { describe, expect, test } from "bun:test";
import { ZodError } from "zod";
import {
  cloneDevelopSettings,
  defaultDevelopSettings,
  developSettingsSchema,
  developUserError,
  readDevelopSettings,
} from "../src/lib/develop/contract";
import {
  createDevelopDocument,
  currentRecipe,
  developDocumentSchema,
  type DevelopDocument,
} from "../src/lib/develop/store";

describe("Develop settings stay readable across additive recipe fields", () => {
  test("parametricCurve and lensCorrection round-trip through the saved document", () => {
    const settings = defaultDevelopSettings();
    settings.parametricCurve = { ...settings.parametricCurve, darks: 18, shadows: 10 };
    settings.lensCorrection = {
      ...settings.lensCorrection,
      enabled: true,
      vignetteCorrection: { enabled: true, amount: -12 },
    };
    const doc = createDevelopDocument("photo-compat", settings);
    const recipe = currentRecipe(doc);
    expect(recipe.parametricCurve.darks).toBe(18);
    expect(recipe.lensCorrection.enabled).toBe(true);
    expect(recipe.lensCorrection.vignetteCorrection.amount).toBe(-12);
  });

  test("unknown additive keys on every history step do not brick the photo", () => {
    const doc = createDevelopDocument("photo-future");
    const bloated = {
      ...doc,
      history: Array.from({ length: 19 }, (_, index) => ({
        ...doc.history[0]!,
        id: `hist-${index}`,
        settings: {
          ...doc.history[0]!.settings,
          futureDevinKnob: index,
        },
      })),
    };
    expect(() => developSettingsSchema.parse(bloated.history[0]!.settings)).toThrow(ZodError);
    expect(() => developDocumentSchema.parse(bloated)).toThrow(/unrecognized_keys|Unrecognized key/);
    const recipe = currentRecipe(bloated as unknown as DevelopDocument);
    expect(recipe.exposure).toBe(0);
    expect(recipe.parametricCurve).toEqual(defaultDevelopSettings().parametricCurve);
    expect("futureDevinKnob" in recipe).toBe(false);
  });

  test("out-of-range exposure is clamped instead of unmounting Develop", () => {
    expect(readDevelopSettings({ ...defaultDevelopSettings(), exposure: 12 }).exposure).toBe(5);
    expect(readDevelopSettings({ ...defaultDevelopSettings(), exposure: -12 }).exposure).toBe(-5);
    expect(readDevelopSettings({ ...defaultDevelopSettings(), grainSize: 0.1 }).grainSize).toBe(0.5);
  });

  test("readDevelopSettings keeps known parametric fields and drops junk", () => {
    const raw = {
      ...cloneDevelopSettings(defaultDevelopSettings()),
      parametricCurve: {
        highlights: 0,
        lights: -8,
        darks: 12,
        shadows: 0,
        pointCurve: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      },
      extraPleaseIgnore: true,
    };
    const read = readDevelopSettings(raw);
    expect(read.parametricCurve.lights).toBe(-8);
    expect(read.parametricCurve.darks).toBe(12);
    expect("extraPleaseIgnore" in read).toBe(false);
  });

  test("Develop status banner never paints a Zod issue array", () => {
    const error = developSettingsSchema.safeParse({
      ...defaultDevelopSettings(),
      extraPleaseIgnore: true,
    }).error;
    expect(error).toBeInstanceOf(ZodError);
    const message = developUserError(error);
    expect(message).toBe("Could not read saved edits. Originals are untouched.");
    expect(message.includes("unrecognized_keys")).toBe(false);
    expect(message.includes("parametricCurve")).toBe(false);
    expect(developUserError({ message: JSON.stringify(error!.issues) })).toBe(
      "Could not finish this edit. Originals are untouched.",
    );
  });
});
