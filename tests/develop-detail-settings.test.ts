import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  cloneDevelopSettings,
  defaultDevelopSettings,
  developSettingsSchema,
  type DevelopSettings,
} from "../src/lib/develop/contract";
import { encodeDevelopRequest } from "../src/lib/develop/client";
import { developProtocol, parseDevelopRequest } from "../src/server/native-develop";
import { applyReferenceLook } from "../src/lib/develop/reference-apply";
import {
  addSnapshot,
  createDevelopDocument,
  createDevelopPreset,
  currentRecipe,
  developDocumentSchema,
  developRecoveryDocuments,
  pushHistory,
  redoHistory,
  restoreSnapshot,
  undoHistory,
} from "../src/lib/develop/store";
import {
  createPresetPackage,
  developPresetFromPackage,
  exportPresetPackage,
  parsePresetPackage,
} from "../src/lib/develop/preset-package";

const detailDefaults = {
  sharpeningRadius: 1,
  sharpeningDetail: 100,
  sharpeningMasking: 0,
};
const adjustedDetail = {
  sharpeningRadius: 2.3,
  sharpeningDetail: 35,
  sharpeningMasking: 72,
};
const detailKeys = Object.keys(detailDefaults) as (keyof typeof detailDefaults)[];
function withoutDetail(settings: DevelopSettings) {
  const copy: Record<string, unknown> = structuredClone(settings);
  for (const key of detailKeys) delete copy[key];
  return copy;
}
// Captured from the existing serializer before adding the Detail extension.
const originalDefaultProtocol =
  "FOTO_DEVELOP_3\n0 0 0 0 0 0 0 0 0 0 0 0 0\n2\n0 0\n1 1\n0 0 0\n0 0 0\n0 0 0\n0 0 0\n0 0 0\n0 0 0\n0 0 0\n0 0 0\n0 0 0\n0 0 0\n0 0 0\n0 50 0 1 0 0 0 0 0 0 0\n0 0 1 1 0 0 0 0\n0\n2\n0 0\n1 1\n2\n0 0\n1 1\n2\n0 0\n1 1\n0\n1 0 0 0 0\n";

describe("Additive native Detail settings", () => {
  test("absent v1 fields receive exact compatibility defaults without mutating saved input", () => {
    const legacy = withoutDetail({ ...defaultDevelopSettings(), sharpening: 73, exposure: 0.4 });
    const original = JSON.stringify(legacy);
    const parsed = developSettingsSchema.parse(legacy);
    expect(parsed).toMatchObject({ version: 1, sharpening: 73, exposure: 0.4, ...detailDefaults });
    expect(JSON.stringify(legacy)).toBe(original);
    expect(defaultDevelopSettings()).toMatchObject(detailDefaults);
    expect(cloneDevelopSettings(parsed)).toEqual(parsed);
    for (const key of detailKeys) {
      const partial = { ...legacy, [key]: adjustedDetail[key] };
      expect(developSettingsSchema.parse(partial)).toMatchObject({
        ...detailDefaults,
        [key]: adjustedDetail[key],
      });
    }
  });

  test("all finite inclusive bounds validate even with sharpening zero; invalid data is rejected", () => {
    for (const [key, minimum, maximum] of [
      ["sharpeningRadius", 0.5, 3],
      ["sharpeningDetail", 0, 100],
      ["sharpeningMasking", 0, 100],
    ] as const) {
      for (const value of [minimum, (minimum + maximum) / 2, maximum])
        expect(
          developSettingsSchema.parse({ ...defaultDevelopSettings(), [key]: value })[key],
        ).toBe(value);
      for (const value of [minimum - 0.001, maximum + 0.001, NaN, Infinity, -Infinity, null, "1"])
        expect(() =>
          developProtocol({ ...defaultDevelopSettings(), [key]: value } as DevelopSettings),
        ).toThrow();
    }
    expect(() =>
      developSettingsSchema.parse({ ...defaultDevelopSettings(), detailRadius: 2 }),
    ).toThrow();
  });

  test("default extension emits the complete unchanged v3 byte sequence", () => {
    expect(developProtocol(defaultDevelopSettings())).toBe(originalDefaultProtocol);
    const legacy = developSettingsSchema.parse(withoutDetail(defaultDevelopSettings()));
    expect(developProtocol(legacy)).toBe(originalDefaultProtocol);
    const active = { ...defaultDevelopSettings(), sharpening: 85, texture: 20 };
    expect(developProtocol(active).startsWith("FOTO_DEVELOP_3\n")).toBe(true);
    expect(developProtocol(active)).toBe(
      developProtocol(developSettingsSchema.parse(withoutDetail(active))),
    );
  });

  test("only nondefault Detail fields select v4 and append an exact ordered tail", () => {
    for (const patch of [
      adjustedDetail,
      { sharpeningRadius: 0.5 },
      { sharpeningRadius: 1.000001 },
      { sharpeningDetail: 0 },
      { sharpeningMasking: 100 },
    ]) {
      const settings = { ...defaultDevelopSettings(), ...patch };
      const expected =
        originalDefaultProtocol.replace("FOTO_DEVELOP_3\n", "FOTO_DEVELOP_4\n") +
        `${settings.sharpeningRadius} ${settings.sharpeningDetail} ${settings.sharpeningMasking}\n`;
      expect(developProtocol(settings)).toBe(expected);
      expect(settings.sharpening).toBe(0);
    }
    const custom = {
      ...defaultDevelopSettings(),
      ...adjustedDetail,
      exposure: 0.75,
      filmFalloff: 43,
    };
    custom.grading.global = { hue: 211, saturation: 25, luminance: -6 };
    const legacy = developProtocol({ ...custom, ...detailDefaults });
    expect(developProtocol(custom)).toBe(
      legacy.replace("FOTO_DEVELOP_3\n", "FOTO_DEVELOP_4\n") + "2.3 35 72\n",
    );
  });

  test("request metadata carries all Detail fields while original bytes and caller settings stay intact", async () => {
    const source = new Blob([new Uint8Array([0, 255, 1, 17, 82])]);
    const settings = { ...defaultDevelopSettings(), ...adjustedDetail, sharpening: 64 };
    const before = JSON.stringify(settings);
    const packet = encodeDevelopRequest(source, settings, 8192, 0.95, "raw");
    const parsed = parseDevelopRequest(Buffer.from(await packet.arrayBuffer()));
    expect(parsed.settings).toEqual(settings);
    expect(parsed.source).toEqual(Buffer.from(await source.arrayBuffer()));
    expect(parsed).toMatchObject({ edge: 8192, sourceMode: "raw", quality: 0.95 });
    expect(JSON.stringify(settings)).toBe(before);
  });

  test("undo, redo, snapshots and recovery retain Detail values without changing source history", () => {
    const original = createDevelopDocument("detail-test");
    const serialized = JSON.stringify(original);
    const edited = addSnapshot(
      pushHistory(
        original,
        { ...defaultDevelopSettings(), ...adjustedDetail, sharpening: 60 },
        "Detail",
      ),
      "Defined edges",
    );
    expect(currentRecipe(undoHistory(edited))).toMatchObject(detailDefaults);
    expect(currentRecipe(redoHistory(undoHistory(edited)))).toMatchObject(adjustedDetail);
    const reset = pushHistory(edited, defaultDevelopSettings(), "Reset");
    expect(currentRecipe(restoreSnapshot(reset, edited.snapshots[0]!.id))).toMatchObject(
      adjustedDetail,
    );
    const recovery = developRecoveryDocuments(
      { [original.photoId]: original },
      original.photoId,
      currentRecipe(edited),
    );
    expect(currentRecipe(recovery[original.photoId]!)).toMatchObject(adjustedDetail);
    expect(
      currentRecipe(developDocumentSchema.parse(JSON.parse(JSON.stringify(edited)))),
    ).toMatchObject(adjustedDetail);
    expect(JSON.stringify(original)).toBe(serialized);
    const oldDocument = JSON.parse(serialized);
    oldDocument.history[0].settings = withoutDetail(defaultDevelopSettings());
    expect(currentRecipe(developDocumentSchema.parse(oldDocument))).toMatchObject(detailDefaults);
    expect(oldDocument.history[0].settings.sharpeningRadius).toBeUndefined();
  });

  test("portable and saved presets retain new values while old packages default without migration", () => {
    const settings = { ...defaultDevelopSettings(), ...adjustedDetail, sharpening: 67 };
    const preset = createDevelopPreset("Defined texture", settings);
    expect(preset.settings).toMatchObject(adjustedDetail);
    const portable = createPresetPackage({ title: "Defined texture" }, settings);
    const restored = parsePresetPackage(exportPresetPackage(portable));
    expect(developPresetFromPackage(restored).settings).toMatchObject(adjustedDetail);
    const old = { ...portable, settings: withoutDetail(settings) };
    const serialized = JSON.stringify(old);
    expect(parsePresetPackage(serialized).settings).toMatchObject({
      ...detailDefaults,
      sharpening: 67,
    });
    expect(JSON.stringify(old)).toBe(serialized);
    settings.sharpeningRadius = 0.5;
    expect(preset.settings.sharpeningRadius).toBe(2.3);
    expect(portable.settings.sharpeningRadius).toBe(2.3);
  });

  test("reference fitting never replaces independent sharpening shape controls", () => {
    const current = { ...defaultDevelopSettings(), ...adjustedDetail, sharpening: 53 };
    const fitted = { ...defaultDevelopSettings(), sharpening: 0, contrast: 24 };
    const merged = applyReferenceLook(current, fitted);
    expect(merged).toMatchObject({ ...adjustedDetail, sharpening: 53, contrast: 24 });
    expect(fitted).toMatchObject(detailDefaults);
    merged.sharpeningRadius = 0.5;
    expect(current.sharpeningRadius).toBe(2.3);
  });

  test("actual Detail controls publish bounded preview/commit values and reset compatibility defaults", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        fileURLToPath(new URL("./develop-detail-controls.fixture.ts", import.meta.url)),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [output, errors, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(errors).toBe("");
    expect(code).toBe(0);
    expect(JSON.parse(output).passed).toBeGreaterThanOrEqual(30);
  });
});
