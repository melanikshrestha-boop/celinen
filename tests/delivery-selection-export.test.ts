import { describe, expect, test } from "bun:test";
import {
  submittedEditorLookup,
  submittedSelectionCsv,
  submittedSelectionRows,
} from "../src/lib/delivery/selection-export";
import type { DeliveryComment, DeliveryState, DeliveryVersion } from "../src/lib/delivery/workflow";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-09-08T06:00:00.000Z";
const metadata = { bytes: 1, sha256: "a".repeat(64), width: 1, height: 1 };
function version(photoId: string, versionId: string, number = 1): DeliveryVersion {
  return {
    id: versionId,
    photoId,
    filename: '=Same, "camera" name.jpg',
    source: null,
    variants: { proof: metadata, phone: metadata, full: metadata },
    ready: true,
    createdAt: at,
    number,
    publishedAt: at,
  };
}
function comment(
  n: number,
  photoId: string,
  versionId: string,
  overrides: Partial<DeliveryComment> = {},
): DeliveryComment {
  return {
    id: id(n),
    photoId,
    versionId,
    body: "Keep the crop, 東京 📷\nNo rush",
    role: "client",
    at,
    revision: false,
    resolvedAt: null,
    ...overrides,
  };
}
function fixture(): DeliveryState {
  const firstPhoto = id(1),
    secondPhoto = id(2),
    firstVersion = id(11),
    secondVersion = id(12);
  return {
    format: 1,
    title: "Duplicate names",
    clientName: "QA Client",
    message: "",
    status: "live",
    expiresAt: "2026-09-09T06:00:00.000Z",
    selectionLimit: 2,
    photos: [
      {
        id: firstPhoto,
        current: firstVersion,
        published: firstVersion,
        versions: [version(firstPhoto, firstVersion)],
      },
      {
        id: secondPhoto,
        current: secondVersion,
        published: secondVersion,
        versions: [version(secondPhoto, secondVersion)],
      },
    ],
    picks: [firstPhoto, secondPhoto],
    submissions: [
      {
        id: id(20),
        at,
        items: [
          { photoId: firstPhoto, versionId: firstVersion },
          { photoId: secondPhoto, versionId: secondVersion },
        ],
      },
    ],
    comments: [
      comment(30, firstPhoto, firstVersion),
      comment(31, firstPhoto, firstVersion, {
        body: '+Please remove the "exit" sign',
        revision: true,
      }),
      comment(32, firstPhoto, id(99), { body: "Newer version note" }),
      comment(33, firstPhoto, firstVersion, { body: "Photographer reply", role: "owner" }),
    ],
    approvals: [],
    releases: [],
    released: [],
    events: [],
    receipts: [],
  };
}

describe("exact submitted selection export", () => {
  test("keeps duplicate filenames as separate rows using exact photo and version IDs", () => {
    const state = fixture();
    const rows = submittedSelectionRows(state);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.filename)).toEqual([
      '=Same, "camera" name.jpg',
      '=Same, "camera" name.jpg',
    ]);
    expect(rows.map((row) => [row.photoId, row.versionId])).toEqual(
      state.submissions[0]!.items.map((item) => [item.photoId, item.versionId]),
    );
  });

  test("exports only exact-version client notes without mutating the source state", () => {
    const state = fixture();
    const before = structuredClone(state);
    const csv = submittedSelectionCsv(state);
    expect(csv).toContain('"Keep the crop, 東京 📷\nNo rush');
    expect(csv).toContain('"\'+Please remove the ""exit"" sign"');
    expect(csv).not.toContain("Newer version note");
    expect(csv).not.toContain("Photographer reply");
    expect(csv).toContain('"Open"');
    expect(state).toEqual(before);
    const rows = submittedSelectionRows(state);
    rows[0]!.clientNotes[0]!.body = "Changed export only";
    expect(state.comments[0]!.body).toBe("Keep the crop, 東京 📷\nNo rush");
  });

  test("uses the latest immutable submission rather than mutable current picks", () => {
    const state = fixture();
    state.submissions.push({
      id: id(21),
      at: "2026-09-08T06:30:00.000Z",
      items: [state.submissions[0]!.items[0]!],
    });
    state.picks = [state.photos[1]!.id];
    const rows = submittedSelectionRows(state);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.submissionId).toBe(id(21));
    expect(rows[0]!.photoId).toBe(state.photos[0]!.id);
  });

  test("quotes every cell and neutralizes spreadsheet formulas", () => {
    const csv = submittedSelectionCsv(fixture());
    expect(csv).toStartWith('"Submission (UTC)","Submission ID",');
    expect(csv).toContain('"\'=Same, ""camera"" name.jpg"');
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  test("fails closed when there is no snapshot, a missing historic version, or a duplicate", () => {
    const state = fixture();
    expect(() => submittedSelectionRows({ ...state, submissions: [] })).toThrow(
      "No submitted selection",
    );
    const missing = structuredClone(state);
    missing.photos[0]!.versions = [];
    expect(() => submittedSelectionRows(missing)).toThrow("no rows were omitted");
    const duplicate = structuredClone(state);
    duplicate.submissions[0]!.items.push(duplicate.submissions[0]!.items[0]!);
    expect(() => submittedSelectionRows(duplicate)).toThrow("duplicate version");
  });
});

describe("submitted editor lookup", () => {
  function editorFixture() {
    const state = fixture();
    state.photos[0]!.versions[0]!.filename = "IMG_1001.JPG";
    state.photos[1]!.versions[0]!.filename = "IMG_1002.JPG";
    return state;
  }

  test("formats the immutable latest submission for Lightroom and Capture One", () => {
    const state = editorFixture();
    const before = structuredClone(state);
    expect(submittedEditorLookup(state, "lightroom")).toEqual({
      target: "lightroom",
      filenames: ["IMG_1001.JPG", "IMG_1002.JPG"],
      text: "IMG_1001.JPG,IMG_1002.JPG",
    });
    expect(submittedEditorLookup(state, "capture-one").text).toBe("IMG_1001.JPG IMG_1002.JPG");
    expect(state).toEqual(before);
  });

  test("uses submitted versions instead of mutable picks or newer published versions", () => {
    const state = editorFixture();
    state.picks = [state.photos[1]!.id];
    const newer = version(state.photos[0]!.id, id(90), 2);
    newer.filename = "NEWER.JPG";
    state.photos[0]!.versions.push(newer);
    state.photos[0]!.published = newer.id;
    expect(submittedEditorLookup(state, "lightroom").text).toBe("IMG_1001.JPG,IMG_1002.JPG");
  });

  test("blocks exact, case-only, and Unicode-normalized duplicate filenames", () => {
    for (const [first, second] of [
      ["same.jpg", "same.jpg"],
      ["SAME.JPG", "same.jpg"],
      ["Cafe\u0301.jpg", "Caf\u00e9.jpg"],
    ]) {
      const state = editorFixture();
      state.photos[0]!.versions[0]!.filename = first;
      state.photos[1]!.versions[0]!.filename = second;
      expect(() => submittedEditorLookup(state, "lightroom")).toThrow("duplicate filenames");
      expect(() => submittedEditorLookup(state, "capture-one")).toThrow("duplicate filenames");
    }
  });

  test("blocks delimiters and Lightroom partial-name matches that could over-select", () => {
    const comma = editorFixture();
    comma.photos[0]!.versions[0]!.filename = "IMG,1001.JPG";
    expect(() => submittedEditorLookup(comma, "lightroom")).toThrow("contains a comma");

    const whitespace = editorFixture();
    whitespace.photos[0]!.versions[0]!.filename = "IMG 1001.JPG";
    expect(() => submittedEditorLookup(whitespace, "capture-one")).toThrow("contains whitespace");

    const partial = editorFixture();
    partial.photos[0]!.versions[0]!.filename = "1001.JPG";
    partial.photos[1]!.versions[0]!.filename = "IMG_1001.JPG";
    expect(() => submittedEditorLookup(partial, "lightroom")).toThrow("partially matches");
  });
});
