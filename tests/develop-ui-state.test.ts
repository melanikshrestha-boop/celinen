import { describe, expect, test } from "bun:test";
import {
  currentDevelopRender,
  developImageReady,
  filteredDevelopSelection,
} from "../src/components/develop/develop-state";

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
