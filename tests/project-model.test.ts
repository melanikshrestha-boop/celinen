import { describe, expect, test } from "bun:test";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
import {
  PROCESSOR_VERSION,
  assertProjectAdvance,
  newProject,
  projectBlobIds,
  shotMetadata,
  validateProject,
  type Project,
} from "../src/lib/projects/model";

const at = "2026-09-04T12:00:00.000Z";
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const proofHash = "c".repeat(64);
const previewHash = "d".repeat(64);
const actorId = "local-photographer";

function shot(id: string, verdict: Shot["verdict"] = "undecided"): Shot {
  return {
    id,
    file: new File([id], "DSC_0001.jpg", { type: "image/jpeg", lastModified: 1234 }),
    name: "DSC_0001.jpg",
    relativePath: `${id}/DSC_0001.jpg`,
    isRaw: false,
    previewUrl: `blob:temporary-${id}`,
    previewBlob: new Blob(["preview"], { type: "image/jpeg" }),
    sourceAvailable: true,
    width: 6000,
    height: 4000,
    sizeMb: 5,
    sharpness: 42,
    brightness: 128,
    clippedHighlights: 0.01,
    clippedShadows: 0.02,
    hash: "1010".repeat(16),
    score: 80,
    flags: [],
    verdict,
    edits: { ...DEFAULT_EDITS },
    tone: { black: 4, white: 245, median: 125, rMean: 125, gMean: 128, bMean: 120, satMean: 0.4 },
    faces: { count: 1, faceSharpness: 21, eyesOpen: null, center: { x: 0.4, y: 0.5 } },
    develop: {
      origin: "sidecar",
      at: 1234,
      rating: 4,
      label: "Green",
      caption: "Original caption",
      processVersion: "15.0",
    },
  };
}

function fixture(): Project {
  const project = newProject({
    title: "Two-camera match",
    genre: "sports",
    brief: "Opening play and reactions",
    clientId: null,
    bookingId: null,
    invoiceIds: [],
    galleryIds: [],
  });
  for (const [frameId, checksum] of [
    ["camera-a", hashA],
    ["camera-b", hashB],
  ] as const) {
    const source = shot(frameId, frameId === "camera-a" ? "keep" : "undecided");
    const assetId = `sha256:${checksum}`;
    const versionId = `${frameId}-v1`;
    project.frames.push({
      id: frameId,
      assetId,
      originalBlobId: checksum,
      previewBlobId: previewHash,
      originalName: source.name,
      originalType: source.file.type,
      originalModifiedAt: source.file.lastModified,
      metadata: shotMetadata(source),
      currentVersionId: versionId,
    });
    project.editVersions.push({
      id: versionId,
      assetId,
      edits: { ...source.edits },
      processor: PROCESSOR_VERSION,
      createdAt: at,
      actorId,
      basis: "imported",
    });
  }
  project.selectedId = "camera-a";
  project.decisions.push({
    id: "decision-a",
    frameId: "camera-a",
    versionId: "camera-a-v1",
    from: null,
    to: "keep",
    actorId,
    at,
    reversible: true,
  });
  project.proofs.push({
    id: "proof-a",
    title: "First deadline",
    createdAt: at,
    state: "device-local",
    items: [
      {
        frameId: "camera-a",
        assetId: `sha256:${hashA}`,
        versionId: "camera-a-v1",
        blobId: proofHash,
        width: 1800,
        height: 1200,
      },
    ],
  });
  project.feedback.push({
    id: "feedback-a",
    proofId: "proof-a",
    frameId: "camera-a",
    versionId: "camera-a-v1",
    choice: "approve",
    comment: "Use this version",
    reviewer: "Test client",
    actorId,
    recordedBy: "photographer",
    at,
  });
  project.exports.push({
    id: "export-a",
    proofId: "proof-a",
    versionIds: ["camera-a-v1"],
    at,
    state: "download-prepared",
    kind: "proof-jpeg",
  });
  return validateProject(project);
}

const copy = (project: Project): Project => structuredClone(project);

describe("project model: validated identities and independent workflow states", () => {
  test("an editorial project starts without a client, booking, invoice or gallery", () => {
    const project = newProject({
      title: "  On deadline  ",
      genre: "sports",
      brief: "",
      clientId: null,
      bookingId: null,
      invoiceIds: [],
      galleryIds: [],
    });
    expect(project.title).toBe("On deadline");
    expect(project.clientId).toBeNull();
    expect(project.bookingId).toBeNull();
    expect(project.frames).toEqual([]);
    expect(project.invoiceIds).toEqual([]);
    expect(project.galleryIds).toEqual([]);
    expect(project.revision).toBe(0);
    expect(project.activity[0]?.detail).toContain("no publication or payment implied");
  });

  test("two camera files with identical filenames keep separate content identities", () => {
    const project = fixture();
    expect(project.frames.map((frame) => frame.originalName)).toEqual([
      "DSC_0001.jpg",
      "DSC_0001.jpg",
    ]);
    expect(new Set(project.frames.map((frame) => frame.assetId)).size).toBe(2);
    expect(project.frames.map((frame) => frame.metadata.relativePath)).toEqual([
      "camera-a/DSC_0001.jpg",
      "camera-b/DSC_0001.jpg",
    ]);
  });

  for (const key of [
    "frames",
    "editVersions",
    "decisions",
    "proofs",
    "feedback",
    "exports",
    "activity",
  ] as const) {
    test(`rejects duplicate ${key} identifiers rather than filtering them`, () => {
      const project = fixture();
      project[key] = [...project[key], structuredClone(project[key][0])] as never;
      expect(() => validateProject(project)).toThrow("Duplicate project record identifiers");
    });
  }

  test("rejects duplicate links and a booking without its client", () => {
    const project = fixture();
    project.invoiceIds = ["invoice-a", "invoice-a"];
    expect(() => validateProject(project)).toThrow("Duplicate project links");
    project.invoiceIds = [];
    project.galleryIds = ["gallery-a", "gallery-a"];
    expect(() => validateProject(project)).toThrow("Duplicate project links");
    project.galleryIds = [];
    project.bookingId = "booking-a";
    expect(() => validateProject(project)).toThrow("requires its client");
  });

  test("original asset identity must use the exact lowercase original checksum", () => {
    const project = fixture();
    project.frames[0]!.assetId = `sha256:${hashB}`;
    project.editVersions[0]!.assetId = `sha256:${hashB}`;
    expect(() => validateProject(project)).toThrow("checksum");
    project.frames[0]!.originalBlobId = "A".repeat(64);
    expect(() => validateProject(project)).toThrow();
  });

  test("a disconnected asset must explicitly remain unverified until original bytes exist", () => {
    const project = fixture();
    project.frames[1]!.originalBlobId = null;
    expect(() => validateProject(project)).toThrow("marked unverified");
    project.frames[1]!.assetId = "unverified:camera-b";
    project.editVersions[1]!.assetId = "unverified:camera-b";
    expect(validateProject(project).frames[1]?.assetId).toBe("unverified:camera-b");
  });

  test("requires current versions to belong to the same frame asset with matching edits", () => {
    for (const mutate of [
      (project: Project) => {
        project.frames[0]!.currentVersionId = "missing-version";
      },
      (project: Project) => {
        project.frames[0]!.currentVersionId = "camera-b-v1";
      },
      (project: Project) => {
        project.frames[0]!.metadata.edits.temp = 20;
      },
      (project: Project) => {
        project.frames[0]!.metadata.id = "camera-b";
      },
    ]) {
      const project = fixture();
      mutate(project);
      expect(() => validateProject(project)).toThrow("current edit version is inconsistent");
    }
  });

  test("rejects a selected frame that does not exist", () => {
    const project = fixture();
    project.selectedId = "missing-frame";
    expect(() => validateProject(project)).toThrow("Selected frame is missing");
  });

  test("rejects dangling selection history", () => {
    const project = fixture();
    project.decisions[0]!.frameId = "missing-frame";
    expect(() => validateProject(project)).toThrow();
    project.decisions[0]!.frameId = "camera-a";
    project.decisions[0]!.versionId = "missing-version";
    expect(() => validateProject(project)).toThrow();
  });

  test("selection history cannot refer to another asset's existing edit version", () => {
    const project = fixture();
    project.decisions[0]!.versionId = "camera-b-v1";
    expect(() => validateProject(project)).toThrow();
  });

  test("historical edit versions cannot point at a nonexistent asset", () => {
    const project = fixture();
    project.editVersions.push({
      ...project.editVersions[0]!,
      id: "orphan-version",
      assetId: "sha256:" + "f".repeat(64),
    });
    expect(() => validateProject(project)).toThrow();
  });

  test("proof items must link the exact frame, asset and version without repeats", () => {
    for (const mutate of [
      (project: Project) => {
        project.proofs[0]!.items[0]!.frameId = "missing-frame";
      },
      (project: Project) => {
        project.proofs[0]!.items[0]!.versionId = "missing-version";
      },
      (project: Project) => {
        project.proofs[0]!.items[0]!.versionId = "camera-b-v1";
      },
      (project: Project) => {
        project.proofs[0]!.items[0]!.assetId = `sha256:${hashB}`;
      },
      (project: Project) => {
        project.proofs[0]!.items.push({ ...project.proofs[0]!.items[0]! });
      },
    ]) {
      const project = fixture();
      mutate(project);
      expect(() => validateProject(project)).toThrow();
    }
  });

  test("feedback cannot drift to another proof, frame or version", () => {
    for (const field of ["proofId", "frameId", "versionId"] as const) {
      const project = fixture();
      project.feedback[0]![field] = "missing-record";
      expect(() => validateProject(project)).toThrow("exact proof version");
    }
    const project = fixture();
    project.feedback[0]!.versionId = "camera-b-v1";
    expect(() => validateProject(project)).toThrow("exact proof version");
  });

  test("exports cannot refer to another proof or version", () => {
    const project = fixture();
    project.exports[0]!.proofId = "missing-proof";
    expect(() => validateProject(project)).toThrow();
    project.exports[0]!.proofId = "proof-a";
    project.exports[0]!.versionIds = ["camera-b-v1"];
    expect(() => validateProject(project)).toThrow();
  });

  test("an export manifest cannot repeat a version identifier", () => {
    const project = fixture();
    project.exports[0]!.versionIds.push("camera-a-v1");
    expect(() => validateProject(project)).toThrow();
  });

  test("client feedback remains separate from the photographer's selection", () => {
    const project = fixture();
    project.frames[0]!.metadata.verdict = "reject";
    project.decisions[0]!.to = "reject";
    project.feedback[0]!.choice = "favorite";
    const loaded = validateProject(JSON.parse(JSON.stringify(project)));
    expect(loaded.feedback[0]?.choice).toBe("favorite");
    expect(loaded.frames[0]?.metadata.verdict).toBe("reject");
    expect(loaded.decisions[0]?.to).toBe("reject");
    expect(loaded.proofs[0]?.state).toBe("device-local");
    expect(loaded.exports[0]?.state).toBe("download-prepared");
  });

  test("metadata round-trip preserves supplied fields while excluding browser handles", () => {
    const source = Object.assign(shot("camera-a"), {
      importedMetadata: {
        IPTC: { Credit: "Original credit", Caption: "A < B & C" },
        EXIF: { CameraSerial: "serial-001", Orientation: 6 },
        proprietary: { untouched: [1, "original", null] },
      },
    });
    const metadata = shotMetadata(source);
    expect(metadata).not.toHaveProperty("file");
    expect(metadata).not.toHaveProperty("previewUrl");
    expect(metadata).not.toHaveProperty("previewBlob");
    expect(metadata).not.toHaveProperty("sourceAvailable");
    expect(metadata.importedMetadata).toEqual(source.importedMetadata);
    const project = fixture();
    project.frames[0]!.metadata = { ...metadata, verdict: "keep" };
    const reloaded = validateProject(JSON.parse(JSON.stringify(project)));
    expect(reloaded.frames[0]?.metadata).toEqual(project.frames[0]!.metadata);
    expect(source.previewUrl).toBe("blob:temporary-camera-a");
  });

  test("schema rejects unknown structural fields and nonfinite or out-of-range edits", () => {
    expect(() => validateProject({ ...fixture(), success: true })).toThrow();
    for (const value of [NaN, Infinity, -Infinity, 101, -101]) {
      const project = fixture();
      project.frames[0]!.metadata.edits.temp = value;
      project.editVersions[0]!.edits.temp = value;
      expect(() => validateProject(project)).toThrow();
    }
  });

  test("revision counters reject unsafe integers before compare-and-swap persistence", () => {
    for (const revision of [
      Number.MAX_SAFE_INTEGER + 1,
      Number.MAX_VALUE,
      -1,
      0.5,
      NaN,
      Infinity,
    ]) {
      expect(() => validateProject({ ...fixture(), revision })).toThrow();
    }
    expect(validateProject({ ...fixture(), revision: Number.MAX_SAFE_INTEGER }).revision).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  test("collects unique original, preview and proof hashes for a complete backup manifest", () => {
    expect(new Set(projectBlobIds(fixture()))).toEqual(
      new Set([hashA, hashB, previewHash, proofHash]),
    );
  });
});

describe("project advances preserve source assets and immutable history", () => {
  test("reconnecting a preview-only asset preserves its original provisional identity and history", () => {
    const previewOnly = fixture();
    const provisionalId = "unverified:original-preview-camera-a";
    previewOnly.frames[0]!.assetId = provisionalId;
    previewOnly.frames[0]!.originalBlobId = null;
    previewOnly.editVersions[0]!.assetId = provisionalId;
    previewOnly.proofs[0]!.items[0]!.assetId = provisionalId;
    const current = validateProject(previewOnly);
    const connected = copy(current);
    connected.frames[0]!.originalBlobId = hashA;
    const valid = validateProject(connected);
    expect(() => assertProjectAdvance(current, valid)).not.toThrow();
    expect(valid.frames[0]?.assetId).toBe(provisionalId);
    expect(valid.frames[0]?.originalBlobId).toBe(hashA);
    expect(valid.editVersions).toEqual(current.editVersions);
    expect(valid.proofs).toEqual(current.proofs);
    expect(valid.feedback).toEqual(current.feedback);
    expect(valid.decisions).toEqual(current.decisions);
    expect(projectBlobIds(valid)).toContain(hashA);
    expect(current.frames[0]?.originalBlobId).toBeNull();

    const wrongReconnection = copy(valid);
    wrongReconnection.frames[0]!.originalBlobId = hashB;
    expect(() => assertProjectAdvance(valid, wrongReconnection)).toThrow("bytes cannot change");
  });

  test("new edits retain old versions, old proofs and their exact feedback references", () => {
    const current = fixture();
    const next = copy(current);
    const frame = next.frames[0]!;
    const edits = { ...frame.metadata.edits, temp: 20 };
    next.editVersions.push({
      ...next.editVersions[0]!,
      id: "camera-a-v2",
      edits,
      basis: "photographer-saved",
    });
    frame.currentVersionId = "camera-a-v2";
    frame.metadata.edits = { ...edits };
    next.activity.push({
      id: "saved-v2",
      at,
      actorId,
      action: "Edit saved",
      detail: "New warm version",
    });
    const valid = validateProject(next);
    expect(() => assertProjectAdvance(current, valid)).not.toThrow();
    expect(valid.editVersions.map((version) => version.id)).toContain("camera-a-v1");
    expect(valid.proofs[0]?.items[0]?.versionId).toBe("camera-a-v1");
    expect(valid.feedback[0]?.versionId).toBe("camera-a-v1");
    expect(valid.exports[0]?.versionIds).toEqual(["camera-a-v1"]);
    expect(current.frames[0]?.metadata.edits.temp).toBe(0);
  });

  test("rejects advancing another project or a stale revision", () => {
    const current = fixture();
    const next = copy(current);
    next.revision += 1;
    expect(() => assertProjectAdvance(current, next)).toThrow("another tab");
    next.revision = current.revision;
    next.id = crypto.randomUUID();
    expect(() => assertProjectAdvance(current, next)).toThrow("another tab");
  });

  test("cannot silently remove an existing frame or replace its original bytes", () => {
    const current = fixture();
    const next = copy(current);
    next.frames.pop();
    expect(() => assertProjectAdvance(current, next)).toThrow("remove existing");
    const replaced = copy(current);
    replaced.frames[0]!.originalBlobId = hashB;
    expect(() => assertProjectAdvance(current, replaced)).toThrow("bytes cannot change");
  });

  for (const key of [
    "editVersions",
    "decisions",
    "proofs",
    "feedback",
    "exports",
    "activity",
  ] as const) {
    test(`cannot prune or replace existing ${key} records`, () => {
      const current = fixture();
      const removed = copy(current);
      removed[key] = [] as never;
      expect(() => assertProjectAdvance(current, removed)).toThrow("history is immutable");
      const replaced = copy(current);
      replaced[key][0]!.id = "replacement-id";
      expect(() => assertProjectAdvance(current, replaced)).toThrow("history is immutable");
    });
  }

  test("cannot rewrite the image version inside an already shared proof", () => {
    const current = fixture();
    const changed = copy(current);
    changed.proofs[0]!.items[0]!.blobId = "e".repeat(64);
    expect(() => assertProjectAdvance(current, changed)).toThrow("proofs history is immutable");
  });
});
