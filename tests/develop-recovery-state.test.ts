import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DevelopRecoveryDialog } from "../src/components/develop/DevelopRecoveryDialog";
import { developRecoveryAvailability } from "../src/components/develop/recovery-state";
import {
  createDevelopDocument,
  createDevelopStore,
  type DevelopLibrary,
  type DevelopPhoto,
  type DevelopRecovery,
} from "../src/lib/develop/store";

function photo(id: string, name = `${id}.ARW`): DevelopPhoto {
  return {
    id,
    name,
    width: 0,
    height: 0,
    isRaw: true,
    sourceBlob: null,
    previewBlob: null,
    sourceAvailable: false,
    createdAt: 1,
    sourceFileName: name,
    sourceLastModified: 0,
    sourceDigest: null,
  };
}
function recovery(ids: string[]): DevelopRecovery {
  return {
    version: 1,
    namespace: '["qa","one"]',
    documents: Object.fromEntries(ids.map((id) => [id, createDevelopDocument(id)])),
  };
}
function library(photos: DevelopPhoto[], ids = photos.map((value) => value.id)): DevelopLibrary {
  return {
    photos,
    documents: Object.fromEntries(ids.map((id) => [id, createDevelopDocument(id)])),
    presets: [],
  };
}

describe("Develop recovery checklist boundaries", () => {
  test("uses current photo names and order without adding recovery-only photos", () => {
    const available = developRecoveryAvailability(
      recovery(["a", "missing", "b"]),
      library([
        photo("b", "Client portrait.ARW"),
        photo("a", "Exterior.ARW"),
        photo("not-in-file"),
      ]),
    );
    expect(available.photos).toEqual([
      { id: "b", name: "Client portrait.ARW" },
      { id: "a", name: "Exterior.ARW" },
    ]);
    expect(available.missingPhotoIds).toEqual(["missing"]);
  });
  test("requires an actual photo and a matching stored document", () => {
    const current = library(
      [photo("no-document"), photo("wrong-document"), photo("good")],
      ["wrong-document", "good", "no-photo"],
    );
    current.documents["wrong-document"] = createDevelopDocument("different-id");
    const available = developRecoveryAvailability(
      recovery(["no-document", "wrong-document", "good", "no-photo"]),
      current,
    );
    expect(available.photos.map((value) => value.id)).toEqual(["good"]);
    expect(available.missingPhotoIds).toEqual(["no-document", "wrong-document", "no-photo"]);
  });
  test("existing preview-only records can recover edits without fabricating originals", () => {
    const current = library([photo("preview-only")]);
    const available = developRecoveryAvailability(recovery(["preview-only"]), current);
    expect(available.photos).toHaveLength(1);
    expect(current.photos[0]!.sourceBlob).toBeNull();
    expect(current.photos[0]!.sourceAvailable).toBe(false);
  });
  test("duplicate library entries cannot become duplicate restore selections", () => {
    const current = library([photo("same"), photo("same", "duplicate.ARW")]);
    const available = developRecoveryAvailability(recovery(["same"]), current);
    expect(available.photos).toHaveLength(1);
    expect(available.photos[0]!.name).toBe("same.ARW");
  });
  test("availability checks never change input documents or media", () => {
    const current = library([photo("a")]);
    const restored = recovery(["a", "missing"]);
    const before = JSON.stringify({ current, restored });
    const available = developRecoveryAvailability(restored, current);
    available.photos[0]!.name = "Changed UI label";
    expect(JSON.stringify({ current, restored })).toBe(before);
  });
  test("initial dialog content has a file chooser and no automatic restore or nested dialog", () => {
    const store = createDevelopStore({ scope: "qa", libraryId: "one" });
    let writes = 0;
    let commits = 0;
    const html = renderToStaticMarkup(
      createElement(DevelopRecoveryDialog, {
        store,
        scope: "qa",
        libraryId: "one",
        onClose() {},
        onCommitted() {
          commits += 1;
        },
        onRestored() {
          writes += 1;
        },
      }),
    );
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".json,application/json"');
    expect(html).toMatch(/disabled=""[^>]*>Preview selected/);
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('type="checkbox"');
    expect(writes).toBe(0);
    expect(commits).toBe(0);
    store.close();
  });
});
