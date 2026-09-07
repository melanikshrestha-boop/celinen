import { describe, expect, test } from "bun:test";
import { DEFAULT_EDITS } from "../src/lib/imaging";
import {
  PROCESSOR_VERSION,
  newProject,
  validateProject,
  type Project,
} from "../src/lib/projects/model";
import { addOfflineFeedback, approvedProofItems } from "../src/lib/projects/proofing";

const at = "2026-09-04T12:00:00.000Z";
type FeedbackInput = Parameters<typeof addOfflineFeedback>[1];

/** Two same-named originals; frame A has a newer edit than its first frozen proof. */
function fixture(): Project {
  const project = newProject({
    title: "Exact-version proof review",
    genre: "sports",
    brief: "",
    clientId: null,
    bookingId: null,
    invoiceIds: [],
    galleryIds: [],
  });
  for (const [frameId, checksum, verdict] of [
    ["camera-a", "a".repeat(64), "reject"],
    ["camera-b", "b".repeat(64), "keep"],
  ] as const) {
    const assetId = `sha256:${checksum}`;
    const versionId = `${frameId}-v1`;
    project.frames.push({
      id: frameId,
      assetId,
      originalBlobId: checksum,
      previewBlobId: null,
      originalName: "DSC_0001.jpg",
      originalType: "image/jpeg",
      originalModifiedAt: 1234,
      currentVersionId: versionId,
      metadata: {
        id: frameId,
        name: "DSC_0001.jpg",
        relativePath: `${frameId}/DSC_0001.jpg`,
        isRaw: false,
        width: 6000,
        height: 4000,
        sizeMb: 5,
        sharpness: 42,
        brightness: 128,
        clippedHighlights: 0,
        clippedShadows: 0,
        hash: "1010".repeat(16),
        score: 80,
        flags: [],
        verdict,
        edits: { ...DEFAULT_EDITS },
      },
    });
    project.editVersions.push({
      id: versionId,
      assetId,
      edits: { ...DEFAULT_EDITS },
      processor: PROCESSOR_VERSION,
      createdAt: at,
      actorId: "local-photographer",
      basis: "imported",
    });
    project.decisions.push({
      id: `decision-${frameId}`,
      frameId,
      versionId,
      from: null,
      to: verdict,
      actorId: "local-photographer",
      at,
      reversible: true,
    });
  }
  project.proofs.push({
    id: "proof-old",
    title: "First deadline",
    createdAt: at,
    state: "device-local",
    items: project.frames.map((frame, index) => ({
      frameId: frame.id,
      assetId: frame.assetId,
      versionId: frame.currentVersionId,
      blobId: (index === 0 ? "c" : "d").repeat(64),
      width: 1600,
      height: 1067,
    })),
  });
  const frame = project.frames[0];
  frame.metadata.edits = { ...DEFAULT_EDITS, temp: 12 };
  frame.currentVersionId = "camera-a-v2";
  project.editVersions.push({
    id: frame.currentVersionId,
    assetId: frame.assetId,
    edits: { ...frame.metadata.edits },
    processor: PROCESSOR_VERSION,
    createdAt: at,
    actorId: "local-photographer",
    basis: "photographer-saved",
  });
  project.proofs.push({
    id: "proof-new",
    title: "Second deadline",
    createdAt: at,
    state: "device-local",
    items: [
      { ...project.proofs[0].items[0], versionId: "camera-a-v2", blobId: "e".repeat(64) },
      { ...project.proofs[0].items[1] },
    ],
  });
  return validateProject(project);
}

function record(project: Project, overrides: Partial<FeedbackInput> = {}): Project {
  return addOfflineFeedback(project, {
    proofId: "proof-old",
    frameId: "camera-a",
    versionId: "camera-a-v1",
    choice: "approve",
    comment: "Use this exact version.",
    reviewer: "Reviewer reported by photographer",
    ...overrides,
  });
}

describe("device-local proof feedback: exact versions and independent workflow states", () => {
  test("no feedback means no approval, even when a frame is a keeper", () => {
    const project = fixture();
    expect(project.frames[1].metadata.verdict).toBe("keep");
    expect(approvedProofItems(project, "proof-old")).toEqual([]);
    expect(approvedProofItems(project, "proof-new")).toEqual([]);
  });

  test.each(["favorite", "approve", "revision"] as const)(
    "%s appends offline feedback without changing culling, edits, proofs or delivery state",
    (choice) => {
      const project = fixture();
      const before = structuredClone(project);
      const result = record(project, { choice });
      expect(project).toEqual(before);
      expect(result).not.toBe(project);
      expect(result.frames).toEqual(before.frames);
      expect(result.editVersions).toEqual(before.editVersions);
      expect(result.decisions).toEqual(before.decisions);
      expect(result.proofs).toEqual(before.proofs);
      expect(result.exports).toEqual([]);
      expect(result.revision).toBe(before.revision);
      expect(result.feedback).toHaveLength(1);
      expect(result.activity).toHaveLength(before.activity.length + 1);
      expect(result.activity.at(-1)?.action).toBe("Feedback recorded");
      expect(result.feedback[0]).toMatchObject({
        choice,
        actorId: "local-photographer",
        recordedBy: "photographer",
        proofId: "proof-old",
        frameId: "camera-a",
        versionId: "camera-a-v1",
      });
      expect(Number.isFinite(Date.parse(result.feedback[0].at))).toBe(true);
      expect(result.feedback[0].id).toBeTruthy();
    },
  );

  test("approval returns the frozen old JPEG, not the current edit or a same-named frame", () => {
    const project = record(fixture());
    const approved = approvedProofItems(project, "proof-old");
    expect(project.frames[0].metadata.verdict).toBe("reject");
    expect(project.frames[0].currentVersionId).toBe("camera-a-v2");
    expect(approved).toEqual([project.proofs[0].items[0]]);
    expect(approved[0].versionId).toBe("camera-a-v1");
    expect(approved[0].blobId).toBe("c".repeat(64));
    expect(approvedProofItems(project, "proof-new")).toEqual([]);
  });

  test("a favorite alone is not approval", () => {
    expect(approvedProofItems(record(fixture(), { choice: "favorite" }), "proof-old")).toEqual([]);
  });

  test.each(["favorite", "revision"] as const)(
    "latest %s supersedes an approval while preserving the earlier record",
    (choice) => {
      const approved = record(fixture());
      const previous = structuredClone(approved.feedback[0]);
      const revised = record(approved, { choice, comment: "Latest recorded choice." });
      expect(approvedProofItems(approved, "proof-old")).toHaveLength(1);
      expect(approvedProofItems(revised, "proof-old")).toEqual([]);
      expect(revised.feedback).toHaveLength(2);
      expect(revised.feedback[0]).toEqual(previous);
      expect(revised.feedback[1].id).not.toBe(previous.id);
    },
  );

  test("approval can be recorded again after a revision request", () => {
    const revised = record(record(fixture()), { choice: "revision" });
    const reapproved = record(revised, { comment: "Original proof is approved after review." });
    expect(approvedProofItems(reapproved, "proof-old")).toEqual([reapproved.proofs[0].items[0]]);
    expect(reapproved.feedback.map((entry) => entry.choice)).toEqual([
      "approve",
      "revision",
      "approve",
    ]);
  });

  test("latest recorded entry wins across reviewer labels, using append order, not clock order", () => {
    const project = record(fixture(), { reviewer: "First reviewer" });
    project.feedback[0].at = "2099-01-01T00:00:00.000Z";
    const revised = record(project, { choice: "revision", reviewer: "Second reviewer" });
    expect(approvedProofItems(revised, "proof-old")).toEqual([]);
    expect(revised.feedback.map((entry) => entry.reviewer)).toEqual([
      "First reviewer",
      "Second reviewer",
    ]);
  });

  test("the same frame and version in another proof does not inherit approval", () => {
    const approved = record(fixture(), { frameId: "camera-b", versionId: "camera-b-v1" });
    expect(approvedProofItems(approved, "proof-old")).toEqual([approved.proofs[0].items[1]]);
    expect(approvedProofItems(approved, "proof-new")).toEqual([]);
    const newProofRevision = record(approved, {
      proofId: "proof-new",
      frameId: "camera-b",
      versionId: "camera-b-v1",
      choice: "revision",
    });
    expect(approvedProofItems(newProofRevision, "proof-old")).toHaveLength(1);
    expect(approvedProofItems(newProofRevision, "proof-new")).toEqual([]);
  });

  test("a newer version's revision does not revoke the older exact proof version's approval", () => {
    const project = record(record(fixture()), {
      proofId: "proof-new",
      versionId: "camera-a-v2",
      choice: "revision",
    });
    expect(approvedProofItems(project, "proof-old")).toEqual([project.proofs[0].items[0]]);
    expect(approvedProofItems(project, "proof-new")).toEqual([]);
  });

  test("results retain proof item order rather than feedback entry order", () => {
    const bFirst = record(fixture(), { frameId: "camera-b", versionId: "camera-b-v1" });
    const project = record(bFirst);
    const before = structuredClone(project);
    expect(approvedProofItems(project, "proof-old")).toEqual(project.proofs[0].items);
    expect(project).toEqual(before);
  });

  test.each([
    { proofId: "missing-proof" },
    { frameId: "missing-frame" },
    { versionId: "missing-version" },
    { versionId: "camera-a-v2" },
    { frameId: "camera-b" },
    { proofId: "proof-new" },
  ])("invalid or stale exact proof reference is rejected: %j", (overrides) => {
    const project = fixture();
    const before = structuredClone(project);
    expect(() => record(project, overrides)).toThrow(
      "Feedback must reference the exact proof version.",
    );
    expect(project).toEqual(before);
  });

  test("a proof removed from the caller's snapshot cannot receive stale form feedback", () => {
    const project = fixture();
    project.proofs = project.proofs.filter((proof) => proof.id !== "proof-old");
    expect(() => record(project)).toThrow("Feedback must reference the exact proof version.");
    expect(() => approvedProofItems(project, "proof-old")).toThrow("Proof not found.");
    expect(project.feedback).toEqual([]);
  });

  test("missing proof lookup fails explicitly rather than suggesting nothing was approved", () => {
    expect(() => approvedProofItems(fixture(), "missing-proof")).toThrow("Proof not found.");
  });

  test.each([
    ["blank reviewer", { reviewer: "   " }],
    ["oversized reviewer", { reviewer: "a".repeat(201) }],
    ["oversized comment", { comment: "a".repeat(4001) }],
  ] as const)("%s fails without appending partial state", (_label, overrides) => {
    const project = fixture();
    const before = structuredClone(project);
    expect(() => record(project, overrides)).toThrow();
    expect(project).toEqual(before);
  });

  test("reviewer whitespace is normalized and an empty comment is allowed", () => {
    const project = record(fixture(), { reviewer: "  Reported reviewer  ", comment: "" });
    expect(project.feedback[0].reviewer).toBe("Reported reviewer");
    expect(project.feedback[0].comment).toBe("");
  });
});
