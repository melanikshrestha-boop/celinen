import { describe, expect, test } from "bun:test";
import { defaultDevelopSettings } from "../src/lib/develop/contract";
import {
  addSnapshot,
  createDevelopDocument,
  createDevelopStore,
  createVirtualCopyDocument,
  currentRecipe,
  pushHistory,
  undoHistory,
  type DevelopPhoto,
} from "../src/lib/develop/store";
import {
  assertPhotoNameAvailable,
  normalizePhotoDisplayName,
  photoExportFilename,
  renamedDevelopPhoto,
  uniquePhotoDisplayName,
  uniquePhotoExportFilename,
  virtualCopyPhoto,
} from "../src/lib/develop/photo-management";
import {
  createPresetPackage,
  developPresetFromPackage,
  exportPresetPackage,
  parsePresetPackage,
  PRESET_PACKAGE_MAX_BYTES,
  presetPackageFilename,
} from "../src/lib/develop/preset-package";

function photo(): DevelopPhoto {
  return {
    id: "sha256:original",
    name: "DSC0123.ARW",
    width: 6000,
    height: 4000,
    isRaw: true,
    sourceBlob: new File(["original bytes"], "DSC0123.ARW", { lastModified: 12 }),
    previewBlob: new Blob(["preview"], { type: "image/jpeg" }),
    previewOrigin: "embedded",
    sourceFileName: "DSC0123.ARW",
    sourceLastModified: 12,
    sourceDigest: "sha256:original",
    sourceAvailable: true,
    createdAt: 1,
  };
}
describe("Develop photo naming and virtual copy", () => {
  test("normalizes display names without altering originals or blob references", () => {
    const original = photo(),
      renamed = renamedDevelopPhoto(original, "  USC — final  ");
    expect(renamed.name).toBe("USC — final");
    expect(renamed.sourceFileName).toBe("DSC0123.ARW");
    expect(renamed.sourceDigest).toBe(original.sourceDigest);
    expect(renamed.sourceBlob).toBe(original.sourceBlob);
    expect(original.name).toBe("DSC0123.ARW");
    expect(photoExportFilename(renamed.name)).toBe("USC — final.jpg");
    expect(photoExportFilename("DSC0123.ARW", "png")).toBe("DSC0123.png");
    expect(photoExportFilename("client.final", "tif")).toBe("client.final.tif");
  });
  test("rejects unsafe paths, controls, reserved names and empty or overlong names", () => {
    for (const name of [
      "",
      " ",
      "..",
      "../photo",
      "photo\\name",
      "photo\0name",
      "photo\nname",
      "a?b",
      "COM1.jpg",
      "nul",
      "bad.",
      "photo\u202Ejpg",
      "x".repeat(181),
    ])
      expect(() => normalizePhotoDisplayName(name)).toThrow();
    expect(normalizePhotoDisplayName("cafe\u0301.jpg")).toBe("café.jpg");
    expect(() => photoExportFilename("photo", "exe" as "jpg")).toThrow();
  });
  test("collisions are case and Unicode compatibility insensitive with deterministic copy suffixes", () => {
    expect(() => assertPhotoNameAvailable("Ｆｏｔｏ", ["foto"])).toThrow();
    expect(() => assertPhotoNameAvailable("cafe\u0301", ["CAFÉ"])).toThrow();
    expect(uniquePhotoDisplayName("DSC0123.ARW", ["DSC0123.ARW"])).toBe("DSC0123 copy.ARW");
    expect(uniquePhotoDisplayName("DSC0123.ARW", ["dsc0123 COPY.arw", "DSC0123 copy 2.ARW"])).toBe(
      "DSC0123 copy 3.ARW",
    );
    expect(uniquePhotoDisplayName("x".repeat(180), []).length).toBe(180);
    expect(uniquePhotoDisplayName("📷".repeat(90), []).endsWith("\ud83d copy")).toBe(false);
    expect(uniquePhotoExportFilename("source.ARW", ["SOURCE.jpg", "source (2).jpg"])).toBe(
      "source (3).jpg",
    );
    expect(uniquePhotoExportFilename("source.jpeg", ["source.jpg"])).toBe("source (2).jpg");
    expect(uniquePhotoExportFilename("Free", [])).toBe("Free.jpg");
  });
  test("automatic names safely derive from existing POSIX names while explicit rename stays strict", () => {
    expect(photoExportFilename("game:final.jpg")).toBe("game-final.jpg");
    expect(photoExportFilename("x".repeat(200) + ".ARW").length).toBe(180);
    expect(photoExportFilename("CON.jpg")).toBe("Photo CON.jpg");
    expect(photoExportFilename("📷".repeat(100) + ".ARW").endsWith("\ud83d.jpg")).toBe(false);
    expect(uniquePhotoDisplayName("game:final.ARW", [])).toBe("game-final copy.ARW");
    expect(uniquePhotoDisplayName("game:final.ARW", ["game-final copy.ARW"])).toBe(
      "game-final copy 2.ARW",
    );
    expect(uniquePhotoDisplayName("x".repeat(200) + ".ARW", []).length).toBe(180);
    for (const inherited of ["game:final.jpg", "x".repeat(200) + ".jpg", "CON.jpg"])
      expect(() => normalizePhotoDisplayName(inherited)).toThrow();
  });
  test("virtual photos have distinct IDs and retain exact bytes, filename and fingerprint", async () => {
    const source = photo(),
      copy = virtualCopyPhoto(source, "copy:one", "Alternate", 20);
    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe("Alternate");
    expect(copy.sourceBlob).toBe(source.sourceBlob);
    expect(copy.previewBlob).toBe(source.previewBlob);
    expect(await copy.sourceBlob!.text()).toBe("original bytes");
    expect(copy.sourceFileName).toBe(source.sourceFileName);
    expect(copy.sourceDigest).toBe(source.sourceDigest);
    expect(copy.sourceLastModified).toBe(source.sourceLastModified);
    expect(source.createdAt).toBe(1);
    expect(() => virtualCopyPhoto(source, source.id, "Copy")).toThrow();
    expect(() =>
      virtualCopyPhoto({ ...source, sourceBlob: null, previewBlob: null }, "copy:missing", "Copy"),
    ).toThrow();
    expect(
      virtualCopyPhoto({ ...source, sourceBlob: null }, "copy:preview", "Copy").sourceAvailable,
    ).toBe(false);
  });
  test("copied histories/snapshots are independent, include redo and metadata, and never mutate source", () => {
    let source = createDevelopDocument("source");
    source = pushHistory(source, { ...currentRecipe(source), exposure: 1 }, "Exposure");
    source = addSnapshot(source, "Warm");
    source = pushHistory(source, { ...currentRecipe(source), temperature: 12 }, "Warm");
    source = undoHistory(source);
    source.metadata.rating = 4;
    const before = JSON.stringify(source),
      copy = createVirtualCopyDocument(source, "copy:new", 30);
    expect(copy.photoId).toBe("copy:new");
    expect(copy.revision).toBe(1);
    expect(copy.cursor).toBe(source.cursor);
    expect(copy.history).toHaveLength(3);
    expect(copy.metadata.rating).toBe(4);
    expect(copy.history.every((entry) => !source.history.some((old) => old.id === entry.id))).toBe(
      true,
    );
    expect(copy.snapshots[0]!.id).not.toBe(source.snapshots[0]!.id);
    copy.history[1]!.settings.exposure = 3;
    copy.snapshots[0]!.settings.temperature = 99;
    expect(JSON.stringify(source)).toBe(before);
    expect(() => createVirtualCopyDocument(source, "source")).toThrow();
  });
  test("mutations reject unavailable persistence instead of pretending a copy or rename saved", async () => {
    const store = createDevelopStore({ scope: "qa-copy-test", libraryId: "one" });
    await expect(store.renamePhoto("source", "New", "Old")).rejects.toThrow();
    await expect(store.createVirtualCopy("source", 0)).rejects.toThrow();
    store.close();
  });
});

describe("Portable FOTO look packages", () => {
  test("roundtrips recipe and seller-preparation metadata without image-specific crop/masks", () => {
    const recipe = defaultDevelopSettings();
    recipe.exposure = 0.5;
    recipe.crop.width = 0.5;
    recipe.masks = [
      {
        id: "private-mask",
        name: "private description",
        enabled: true,
        type: "linear",
        x: 0.5,
        y: 0.5,
        radius: 0.5,
        aspect: 1,
        angle: 0,
        feather: 0.5,
        invert: false,
        exposure: 1,
        temperature: 0,
        saturation: 0,
      },
    ];
    const before = JSON.stringify(recipe);
    const pkg = createPresetPackage(
      {
        title: "Game night",
        creator: "FOTO artist",
        license: "Contact the creator for commercial terms.",
        description: "Warm shadows.",
      },
      recipe,
    );
    const roundtrip = parsePresetPackage(exportPresetPackage(pkg));
    expect(roundtrip).toEqual(pkg);
    expect(roundtrip.settings.exposure).toBe(0.5);
    expect(roundtrip.settings.crop).toEqual(defaultDevelopSettings().crop);
    expect(roundtrip.settings.masks).toEqual([]);
    expect(exportPresetPackage(pkg)).not.toContain("private-mask");
    expect(JSON.stringify(recipe)).toBe(before);
    expect(presetPackageFilename("Game / Night")).toBe("FOTO-Game - Night.foto-preset.json");
  });
  test("import creates new local IDs and retains metadata without accepting foreign IDs", () => {
    const pkg = createPresetPackage({ title: "My look" }, defaultDevelopSettings());
    const a = developPresetFromPackage(pkg),
      b = developPresetFromPackage(pkg);
    expect(a.id).not.toBe(b.id);
    expect(a.revision).toBe(0);
    expect(a.packageMetadata).toEqual(pkg.metadata);
    expect(a.packageMetadata!.license).toBe("");
    expect(() => parsePresetPackage(JSON.stringify({ ...pkg, id: "replace-existing" }))).toThrow();
    expect(() => parsePresetPackage(JSON.stringify({ ...pkg, scope: "other-account" }))).toThrow();
  });
  test("rejects unsupported versions, corrupt data, unsafe metadata, invalid recipes and excessive UTF8", () => {
    const pkg = createPresetPackage({ title: "My look" }, defaultDevelopSettings());
    for (const value of [
      null,
      { ...pkg, version: 2 },
      { ...pkg, format: "adobe" },
      { ...pkg, metadata: { ...pkg.metadata, title: "" } },
      { ...pkg, settings: { ...pkg.settings, exposure: 100 } },
      { ...pkg, settings: { ...pkg.settings, crop: { ...pkg.settings.crop, width: 0.5 } } },
    ])
      expect(() => parsePresetPackage(JSON.stringify(value))).toThrow();
    expect(() => parsePresetPackage("{not json")).toThrow("not valid");
    expect(() => parsePresetPackage("x".repeat(PRESET_PACKAGE_MAX_BYTES + 1))).toThrow("256 KB");
    expect(() => parsePresetPackage("é".repeat(PRESET_PACKAGE_MAX_BYTES / 2 + 1))).toThrow(
      "256 KB",
    );
    expect(() => createPresetPackage({ title: "name\u202E" }, defaultDevelopSettings())).toThrow();
  });
  test("old v1 settings retain backward defaults without rewriting the package caller", () => {
    const pkg = createPresetPackage({ title: "Old look" }, defaultDevelopSettings());
    const legacy = structuredClone(pkg) as unknown as { settings: Record<string, unknown> };
    delete legacy.settings["channelCurves"];
    delete legacy.settings["filmFalloff"];
    delete legacy.settings["grainLuminance"];
    const restored = parsePresetPackage(JSON.stringify(legacy));
    expect(restored.settings.channelCurves).toEqual(defaultDevelopSettings().channelCurves);
    expect(restored.settings.filmFalloff).toBe(0);
    expect(restored.settings.grainLuminance).toBe(0);
    expect(legacy.settings["channelCurves"]).toBeUndefined();
  });
});
