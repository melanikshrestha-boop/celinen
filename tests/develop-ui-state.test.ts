import { describe, expect, test } from "bun:test";
import {
  currentDevelopRender,
  currentDevelopExportProof,
  developImageReady,
  filteredDevelopSelection,
  developProcessingSource,
} from "../src/components/develop/develop-state";

describe("editor and export processing source parity", () => {
  const original = new Blob(["sensor RAW"]),
    preview = new Blob(["camera JPEG"]);
  const photo = { isRaw: true, sourceAvailable: true, sourceBlob: original, previewBlob: preview };
  test("sensor mode uses original bytes, never a camera proxy for the editor", () => {
    const selected = developProcessingSource(photo, "raw");
    expect(selected.source).toBe(original);
    expect(selected.sourceMode).toBe("raw");
    expect(selected.source).not.toBe(preview);
  });
  test("explicit preview mode changes both editor and export to the same proxy", () => {
    const selected = developProcessingSource(photo, "preview");
    expect(selected.source).toBe(preview);
    expect(selected.sourceMode).toBe("preview");
  });
  test("missing original stays explicitly preview only; raster originals never enter RAW mode", () => {
    expect(
      developProcessingSource({ ...photo, sourceAvailable: false, sourceBlob: null }, "raw"),
    ).toEqual({ source: preview, sourceMode: "preview" });
    expect(developProcessingSource({ ...photo, isRaw: false }, "raw")).toEqual({
      source: original,
      sourceMode: "preview",
    });
    expect(developProcessingSource(null, "raw")).toEqual({ source: null, sourceMode: "preview" });
  });
  test("mode, output dimensions or compression change invalidates a displayed old frame", () => {
    const owner = {
      id: "photo",
      source: original,
      sourceGeometry: false,
      renderKey: "raw:4096:95",
    };
    expect(currentDevelopRender(owner, "photo", original, false, "raw:4096:95")).toBe(true);
    for (const key of ["preview:4096:95", "raw:1600:95", "raw:4096:80"])
      expect(currentDevelopRender(owner, "photo", original, false, key)).toBe(false);
  });
});

describe("Develop export proof provenance", () => {
  const request = {
    id: "raw-photo",
    source: new Blob(["sensor"]),
    recipeKey: '{"exposure":1}',
    edge: 4096,
    quality: 95,
    sourceMode: "raw" as const,
  };
  const proof = { ...request, blob: new Blob(["jpeg"]), width: 4096, height: 2730 };
  test("only an exact render request can reuse a downloadable proof", () => {
    expect(currentDevelopExportProof(proof, { ...request })).toBe(true);
    expect(currentDevelopExportProof(null, request)).toBe(false);
    expect(currentDevelopExportProof(proof, null)).toBe(false);
  });
  test("every pixel or source setting invalidates a prior proof", () => {
    for (const patch of [
      { id: "other-photo" },
      { source: new Blob(["sensor"]) },
      { recipeKey: '{"exposure":2}' },
      { edge: 1600 },
      { quality: 90 },
      { sourceMode: "preview" as const },
    ])
      expect(currentDevelopExportProof(proof, { ...request, ...patch })).toBe(false);
  });
});

describe("Develop preview coordinate provenance", () => {
  const source = new Blob(["source"]);
  const final = { id: "photo", source, sourceGeometry: false };
  const uncropped = { id: "photo", source, sourceGeometry: true };

  test("a cropped/final render cannot become a source-space editing surface", () => {
    expect(currentDevelopRender(final, "photo", source, true)).toBe(false);
    expect(currentDevelopRender(uncropped, "photo", source, true)).toBe(true);
  });
  test("a source-space render cannot masquerade as the completed cropped view", () => {
    expect(currentDevelopRender(uncropped, "photo", source, false)).toBe(false);
    expect(currentDevelopRender(final, "photo", source, false)).toBe(true);
  });
  test("ordinary slider changes may retain the previous correctly shaped preview", () => {
    // Recipe values are deliberately not part of the owner: do not blank every
    // drag while a new exposure/color render is being prepared.
    expect(currentDevelopRender(final, "photo", source, false)).toBe(true);
    expect(currentDevelopRender(uncropped, "photo", source, true)).toBe(true);
  });
  test("photo identity and actual source object must both match", () => {
    expect(currentDevelopRender(final, "other-photo", source, false)).toBe(false);
    expect(currentDevelopRender(final, "photo", new Blob(["source"]), false)).toBe(false);
    expect(currentDevelopRender(final, "photo", null, false)).toBe(false);
    expect(currentDevelopRender(null, "photo", source, false)).toBe(false);
  });
  test("geometry remains gated until the currently displayed image has loaded", () => {
    expect(developImageReady("blob:old-crop", "blob:uncropped")).toBe(false);
    expect(developImageReady(null, "blob:uncropped")).toBe(false);
    expect(developImageReady(null, null)).toBe(false);
    expect(developImageReady("blob:uncropped", "blob:uncropped")).toBe(true);
  });
});

describe("Develop filtered edit targets", () => {
  test("preserves a visible active photo and removes invisible sync targets", () => {
    const before = new Set(["pick", "reject", "other-pick"]);
    const next = filteredDevelopSelection(["pick", "other-pick"], "pick", before);
    expect(next.activeId).toBe("pick");
    expect([...next.selectedIds]).toEqual(["pick", "other-pick"]);
    expect([...before]).toEqual(["pick", "reject", "other-pick"]);
  });
  test("a filtered-out active photo moves to the first visible photograph", () => {
    const next = filteredDevelopSelection(["pick", "other-pick"], "reject", new Set(["reject"]));
    expect(next.activeId).toBe("pick");
    expect([...next.selectedIds]).toEqual(["pick"]);
  });
  test("no matches clears both active source and sync target set", () => {
    const next = filteredDevelopSelection([], "reject", new Set(["reject"]));
    expect(next.activeId).toBeNull();
    expect(next.selectedIds.size).toBe(0);
  });
  test("returning from an empty filter selects the first available photo", () => {
    const next = filteredDevelopSelection(["first", "second"], null, new Set());
    expect(next.activeId).toBe("first");
    expect([...next.selectedIds]).toEqual(["first"]);
  });
  test("the visible active source remains selected even if an old set omitted it", () => {
    const next = filteredDevelopSelection(["first", "active"], "active", new Set(["first"]));
    expect([...next.selectedIds]).toEqual(["first", "active"]);
  });
});
