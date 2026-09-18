import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  defaultDevelopSettings,
  developSettingsSchema,
  type DevelopMask,
  type DevelopSettings,
} from "../src/lib/develop/contract";
import { canReuseNeutralDevelop, isNeutralDevelopRecipe } from "../src/lib/develop/neutral";
import { runNativeDevelop } from "../src/server/native-develop";
import { generatedBayerDng } from "./fixtures/generated-bayer";

// Keep the effective-control list explicit: changing any one must defeat reuse,
// even if a particular source image would happen to hide the adjustment.
const effectiveScalars = [
  "exposure",
  "contrast",
  "highlights",
  "shadows",
  "whites",
  "blacks",
  "temperature",
  "tint",
  "saturation",
  "vibrance",
  "texture",
  "clarity",
  "dehaze",
  "grain",
  "fade",
  "vignette",
  "bloom",
  "halation",
  "filmFalloff",
  "sharpening",
  "noiseReduction",
  "colorNoiseReduction",
] as const;
const wheels = ["shadows", "midtones", "highlights", "global"] as const;
const channels = ["red", "green", "blue"] as const;

function mask(patch: Partial<DevelopMask> = {}): DevelopMask {
  return {
    id: "neutral-mask",
    name: "Untouched mask",
    enabled: true,
    type: "radial",
    x: 0.5,
    y: 0.5,
    radius: 0.3,
    aspect: 1,
    angle: 0,
    feather: 0.5,
    invert: false,
    exposure: 0,
    temperature: 0,
    saturation: 0,
    ...patch,
  };
}

function freezeTree(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeTree(child);
  Object.freeze(value);
}

function legacyRecipe(): Record<string, unknown> {
  const recipe: Record<string, unknown> = structuredClone(defaultDevelopSettings());
  for (const key of [
    "curveInterpolation",
    "channelCurves",
    "filmFalloff",
    "grainLuminance",
    "sharpeningRadius",
    "sharpeningDetail",
    "sharpeningMasking",
  ])
    delete recipe[key];
  const grading = recipe["grading"] as Record<string, unknown>;
  delete grading["model"];
  delete grading["global"];
  return recipe;
}

function inactiveRecipe(model: "legacy" | "tonal"): DevelopSettings {
  const recipe = defaultDevelopSettings();
  recipe.grading.model = model;
  recipe.grading.balance = model === "legacy" ? -100 : 100;
  recipe.grading.blending = model === "legacy" ? 0 : 100;
  for (const [index, wheel] of wheels.entries()) recipe.grading[wheel].hue = index * 120;
  recipe.grainSize = 4;
  recipe.grainLuminance = 100;
  recipe.masks = [
    mask({ x: 0, y: 1, radius: 2, aspect: 10, angle: 180, feather: 0, invert: true }),
    mask({
      id: "disabled-adjustment",
      type: "linear",
      enabled: false,
      exposure: 5,
      temperature: -100,
      saturation: 100,
    }),
  ];
  // These extensions are not present in the older branch. Their absence must
  // not prevent this test file from checking the same conservative baseline.
  const values: Record<string, unknown> = recipe;
  for (const [key, value] of Object.entries({
    curveInterpolation: "smooth",
    sharpeningRadius: 3,
    sharpeningDetail: 0,
    sharpeningMasking: 100,
  }))
    if (key in values) values[key] = value;
  return recipe;
}

describe("Conservative neutral Develop recipe classification", () => {
  test("defaults, signed zero and omitted legacy defaults are neutral without migration", () => {
    expect(isNeutralDevelopRecipe(defaultDevelopSettings())).toBe(true);
    const signed = defaultDevelopSettings();
    for (const key of effectiveScalars) signed[key] = -0;
    signed.crop.angle = -0;
    expect(isNeutralDevelopRecipe(signed)).toBe(true);
    const legacy = legacyRecipe();
    const before = structuredClone(legacy);
    freezeTree(legacy);
    expect(developSettingsSchema.safeParse(legacy).success).toBe(true);
    expect(isNeutralDevelopRecipe(legacy)).toBe(true);
    expect(legacy).toEqual(before);
    expect(Object.hasOwn(legacy, "channelCurves")).toBe(false);
    expect(Object.hasOwn(legacy["grading"] as object, "model")).toBe(false);
  });

  test("all 22 effective scalars block reuse at ordinary and smallest positive amounts", () => {
    expect(effectiveScalars).toHaveLength(22);
    for (const key of effectiveScalars) {
      for (const value of [Number.MIN_VALUE, 0.001, 1]) {
        const recipe = { ...defaultDevelopSettings(), [key]: value };
        expect(developSettingsSchema.safeParse(recipe).success).toBe(true);
        expect(isNeutralDevelopRecipe(recipe)).toBe(false);
      }
    }
  });

  test("RAW exposure and white balance are classified before any native second-stage reset", () => {
    for (const key of ["exposure", "temperature", "tint"] as const) {
      for (const value of [-1, -Number.MIN_VALUE, Number.MIN_VALUE, 1]) {
        const recipe = { ...inactiveRecipe("legacy"), [key]: value };
        const before = structuredClone(recipe);
        freezeTree(recipe);
        expect(isNeutralDevelopRecipe(recipe)).toBe(false);
        expect(recipe).toEqual(before);
      }
    }
  });

  test("all master and RGB curves require the exact two-point identity representation", () => {
    for (const channel of ["master", ...channels] as const) {
      for (const curve of [
        [
          { x: 0, y: Number.MIN_VALUE },
          { x: 1, y: 1 },
        ],
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 - Number.EPSILON },
        ],
        [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.5 },
          { x: 1, y: 1 },
        ],
      ]) {
        const recipe = defaultDevelopSettings();
        if (channel === "master") recipe.curve = curve;
        else recipe.channelCurves[channel] = curve;
        expect(developSettingsSchema.safeParse(recipe).success).toBe(true);
        expect(isNeutralDevelopRecipe(recipe)).toBe(false);
      }
    }
  });

  test("all eight HSL ranges treat hue, saturation and luminance as effective controls", () => {
    for (let channel = 0; channel < 8; channel++)
      for (const field of ["hue", "saturation", "luminance"] as const)
        for (const amount of [-1, Number.MIN_VALUE, 1]) {
          const recipe = defaultDevelopSettings();
          recipe.hsl[channel]![field] = amount;
          expect(isNeutralDevelopRecipe(recipe)).toBe(false);
        }
  });

  test("every grading wheel saturation and luminance is active, including the global wheel", () => {
    for (const model of ["legacy", "tonal"] as const)
      for (const wheel of wheels)
        for (const field of ["saturation", "luminance"] as const) {
          const recipe = inactiveRecipe(model);
          recipe.grading[wheel][field] = Number.MIN_VALUE;
          expect(isNeutralDevelopRecipe(recipe)).toBe(false);
        }
    for (const wheel of wheels) {
      const recipe = defaultDevelopSettings();
      recipe.grading[wheel].luminance = -1;
      expect(isNeutralDevelopRecipe(recipe)).toBe(false);
    }
  });

  test("valid inactive grading, grain and optional sharpening/interpolation shapes are neutral", () => {
    for (const model of ["legacy", "tonal"] as const) {
      const recipe = inactiveRecipe(model);
      const before = structuredClone(recipe);
      freezeTree(recipe);
      expect(developSettingsSchema.safeParse(recipe).success).toBe(true);
      expect(isNeutralDevelopRecipe(recipe)).toBe(true);
      expect(recipe).toEqual(before);
    }
    const shapeBounds = {
      grainSize: [0.5, 4],
      grainLuminance: [0, 100],
      sharpeningRadius: [0.5, 3],
      sharpeningDetail: [0, 100],
      sharpeningMasking: [0, 100],
      curveInterpolation: ["linear", "smooth"],
    };
    for (const [key, values] of Object.entries(shapeBounds)) {
      if (!(key in defaultDevelopSettings())) continue;
      for (const value of values)
        expect(isNeutralDevelopRecipe({ ...defaultDevelopSettings(), [key]: value })).toBe(true);
    }
  });

  test("disabled adjusted masks and enabled zero masks are inert, not tiny active masks", () => {
    const recipe = defaultDevelopSettings();
    recipe.masks = Array.from({ length: 12 }, (_, index) =>
      mask({
        id: `mask-${index}`,
        type: index % 2 ? "radial" : "linear",
        invert: Boolean(index % 3),
        radius: index % 2 ? 0.01 : 2,
        feather: index % 2 ? 0 : 1,
      }),
    );
    expect(isNeutralDevelopRecipe(recipe)).toBe(true);
    for (const field of ["exposure", "temperature", "saturation"] as const) {
      const adjusted = structuredClone(recipe);
      adjusted.masks[11]![field] = Number.MIN_VALUE;
      expect(isNeutralDevelopRecipe(adjusted)).toBe(false);
      adjusted.masks[11]!.enabled = false;
      expect(isNeutralDevelopRecipe(adjusted)).toBe(true);
    }
  });

  test("every crop geometry field must be exactly its no-op value", () => {
    for (const patch of [
      { x: 0.0000001 },
      { y: 0.0000001 },
      { width: 1 - Number.EPSILON },
      { height: 1 - Number.EPSILON },
      { angle: Number.MIN_VALUE },
      { angle: -Number.MIN_VALUE },
      { rotate: 90 },
      { rotate: 180 },
      { rotate: 270 },
      { flipX: true },
      { flipY: true },
    ]) {
      const recipe = defaultDevelopSettings();
      Object.assign(recipe.crop, patch);
      expect(developSettingsSchema.safeParse(recipe).success).toBe(true);
      expect(isNeutralDevelopRecipe(recipe)).toBe(false);
    }
  });

  test("invalid, incomplete and unknown fields fail closed even when otherwise inactive", () => {
    const defaults = defaultDevelopSettings();
    const invalid: unknown[] = [
      undefined,
      null,
      false,
      0,
      "Original",
      [],
      {},
      { ...defaults, version: 2 },
      { ...defaults, exposure: undefined },
      { ...defaults, exposure: "0" },
      { ...defaults, futureEffectiveControl: 0 },
      { ...defaults, hsl: defaults.hsl.slice(0, 7) },
      { ...defaults, hsl: [...defaults.hsl, { hue: 0, saturation: 0, luminance: 0 }] },
      { ...defaults, curve: [{ x: 0, y: 0 }] },
      { ...defaults, crop: { ...defaults.crop, angle: 360 } },
      { ...defaults, crop: { ...defaults.crop, rotation: 0 } },
      { ...defaults, channelCurves: { ...defaults.channelCurves, alpha: defaults.curve } },
      { ...defaults, grading: { ...defaults.grading, model: "future" } },
      { ...defaults, grading: { ...defaults.grading, balance: 101 } },
      { ...defaults, grading: { ...defaults.grading, blending: -1 } },
      {
        ...defaults,
        grading: { ...defaults.grading, global: { hue: 361, saturation: 0, luminance: 0 } },
      },
      { ...defaults, masks: [mask({ enabled: false, radius: 0 })] },
      { ...defaults, masks: [mask({ enabled: false, exposure: NaN })] },
      { ...defaults, masks: [mask(), mask()] },
      { ...defaults, masks: Array.from({ length: 13 }, (_, i) => mask({ id: String(i) })) },
    ];
    for (const key of effectiveScalars)
      for (const value of [NaN, Infinity, -Infinity]) invalid.push({ ...defaults, [key]: value });
    for (const [key, values] of Object.entries({
      grainSize: [0, 4.001, NaN, Infinity],
      grainLuminance: [-1, 101, NaN],
      grainColor: [-1, 101, NaN],
      sharpeningRadius: [0.499, 3.001, NaN],
      sharpeningDetail: [-1, 101, NaN],
      sharpeningMasking: [-1, 101, NaN],
      curveInterpolation: ["future", null],
    }))
      for (const value of values) invalid.push({ ...defaults, [key]: value });
    for (const input of invalid) {
      const before = structuredClone(input);
      freezeTree(input);
      expect(isNeutralDevelopRecipe(input)).toBe(false);
      expect(input).toEqual(before);
    }
  });
});

describe("Neutral native-render receipt ownership", () => {
  function receipt() {
    const source = new Blob(["exact original source"]);
    return {
      neutralBlob: new Blob(["rendered JPEG"]),
      owner: { id: "photo-a", source, renderKey: "raw:4096:95" },
      id: "photo-a",
      source,
      renderKey: "raw:4096:95",
      neutralRecipe: true,
    };
  }

  test("reuse requires a real matching receipt and a positively classified recipe", () => {
    const input = receipt();
    expect(canReuseNeutralDevelop(input)).toBe(true);
    expect(canReuseNeutralDevelop({ ...input, neutralRecipe: false })).toBe(false);
    expect(canReuseNeutralDevelop({ ...input, neutralBlob: null })).toBe(false);
    expect(canReuseNeutralDevelop({ ...input, neutralBlob: new Blob() })).toBe(false);
    expect(canReuseNeutralDevelop({ ...input, owner: null })).toBe(false);
    expect(canReuseNeutralDevelop({ ...input, id: null })).toBe(false);
    expect(canReuseNeutralDevelop({ ...input, owner: { ...input.owner, id: null } })).toBe(false);
    expect(
      canReuseNeutralDevelop({ ...input, id: null, owner: { ...input.owner, id: null } }),
    ).toBe(false);
  });

  test("different photo, identical-byte source copies, mode, edge or quality cannot reuse", () => {
    const input = receipt();
    expect(canReuseNeutralDevelop({ ...input, id: "photo-b" })).toBe(false);
    expect(canReuseNeutralDevelop({ ...input, owner: { ...input.owner, id: "photo-b" } })).toBe(
      false,
    );
    const copy = input.source.slice();
    expect(copy.size).toBe(input.source.size);
    expect(canReuseNeutralDevelop({ ...input, source: copy })).toBe(false);
    expect(canReuseNeutralDevelop({ ...input, owner: { ...input.owner, source: copy } })).toBe(
      false,
    );
    for (const renderKey of ["preview:4096:95", "raw:1600:95", "raw:4096:90"])
      expect(canReuseNeutralDevelop({ ...input, renderKey })).toBe(false);
    expect(canReuseNeutralDevelop(input)).toBe(true);
  });

  test("ownership inspection does not rewrite or transfer the caller's receipt", () => {
    const input = receipt();
    const owner = input.owner;
    const source = input.source;
    const blob = input.neutralBlob;
    Object.freeze(owner);
    Object.freeze(input);
    expect(canReuseNeutralDevelop(input)).toBe(true);
    expect(input.owner).toBe(owner);
    expect(input.source).toBe(source);
    expect(input.neutralBlob).toBe(blob);
    expect(input.owner.id).toBe("photo-a");
    expect(input.owner.renderKey).toBe("raw:4096:95");
  });
});

const binary = resolve(process.env["FOTO_TEST_DEVELOP_BINARY"] ?? "native/build/lenslabs-develop");
const publicPhoto = resolve("tests/fixtures/photos/basketball-action-usaf-pd.jpg");
describe.skipIf(process.platform !== "darwin" || !existsSync(binary) || !existsSync(publicPhoto))(
  "Neutral recipe reuse against the existing real native renderer",
  () => {
    test("inactive recipes render byte-identically on JPEG and sensor RAW; effective RAW edits do not", async () => {
      const directory = await mkdtemp(join(tmpdir(), "foto-neutral-recipe-"));
      const rawPath = join(directory, "synthetic.dng");
      const rawBytes = generatedBayerDng();
      const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
      const sourceHash = hash(readFileSync(publicPhoto));
      const controller = new AbortController();
      try {
        await writeFile(rawPath, rawBytes);
        for (const [path, sourceMode] of [
          [publicPhoto, "preview"],
          [rawPath, "raw"],
        ] as const) {
          const baseline = await runNativeDevelop(
            binary,
            path,
            defaultDevelopSettings(),
            128,
            0.95,
            controller.signal,
            sourceMode,
          );
          for (const recipe of [
            developSettingsSchema.parse(legacyRecipe()),
            inactiveRecipe("legacy"),
            inactiveRecipe("tonal"),
          ]) {
            const before = structuredClone(recipe);
            expect(isNeutralDevelopRecipe(recipe)).toBe(true);
            const rendered = await runNativeDevelop(
              binary,
              path,
              recipe,
              128,
              0.95,
              controller.signal,
              sourceMode,
            );
            expect(rendered.equals(baseline)).toBe(true);
            expect(recipe).toEqual(before);
          }
          if (sourceMode === "raw") {
            for (const patch of [{ exposure: 1.25 }, { temperature: 50, tint: -25 }]) {
              const recipe = { ...inactiveRecipe("legacy"), ...patch };
              expect(isNeutralDevelopRecipe(recipe)).toBe(false);
              const rendered = await runNativeDevelop(
                binary,
                path,
                recipe,
                128,
                0.95,
                controller.signal,
                sourceMode,
              );
              expect(rendered.equals(baseline)).toBe(false);
            }
          }
        }
        expect(hash(readFileSync(publicPhoto))).toBe(sourceHash);
        expect(readFileSync(rawPath)).toEqual(rawBytes);
      } finally {
        controller.abort();
        await unlink(rawPath).catch(() => {});
        await rmdir(directory);
      }
    }, 30_000);
  },
);
