import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
import { hashBlob } from "../src/lib/projects/archive";
import {
  assertProjectAdvance,
  newProject,
  validateProject,
  type Project,
} from "../src/lib/projects/model";
import { captureProject, hydrateProject, versionId } from "../src/lib/projects/studio-adapter";

const urls = new Set<string>();
afterEach(() => {
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
});

function emptyProject(): Project {
  return newProject({
    title: "Two-camera match",
    genre: "sports",
    brief: "Preserve originals and versions",
    clientId: null,
    bookingId: null,
    invoiceIds: [],
    galleryIds: [],
  });
}

function shot(id = "camera-a", bytes = "abc", overrides: Partial<Shot> = {}): Shot {
  return {
    id,
    file: new File([bytes], "DSC_0001.jpg", { type: "image/jpeg", lastModified: 1234 }),
    name: "DSC_0001.jpg",
    relativePath: `${id}/DSC_0001.jpg`,
    isRaw: false,
    sourceAvailable: true,
    previewUrl: null,
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
    verdict: "undecided",
    edits: { ...DEFAULT_EDITS },
    develop: { origin: "sidecar", at: 1234, caption: "Original caption", rating: 4 },
    ...overrides,
  };
}

async function hydrate(project: Project, blobs: ReadonlyMap<string, Blob>) {
  const session = await hydrateProject(project, blobs);
  for (const source of session.shots) if (source.previewUrl) urls.add(source.previewUrl);
  return session;
}

describe("project Studio adapter: source bytes and preview-only boundaries", () => {
  test("captures an original under its exact SHA-256, not its name or perceptual hash", async () => {
    const project = emptyProject();
    const before = structuredClone(project);
    const source = shot();
    const progress: number[][] = [];
    const captured = await captureProject(project, [source], source.id, "all", (done, total) =>
      progress.push([done, total]),
    );
    const checksum = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(captured.project.frames[0].assetId).toBe(`sha256:${checksum}`);
    expect(captured.project.frames[0].originalBlobId).toBe(checksum);
    expect(captured.blobs.get(checksum)).toBe(source.file);
    expect(captured.blobs.size).toBe(1);
    expect(captured.project.frames[0].originalModifiedAt).toBe(1234);
    expect(captured.project.frames[0].metadata).not.toHaveProperty("file");
    expect(captured.project.frames[0].metadata).not.toHaveProperty("sourceAvailable");
    expect(captured.project.frames[0].metadata).not.toHaveProperty("previewUrl");
    expect(captured.project.frames[0].metadata.develop).toEqual(source.develop);
    expect(captured.project.editVersions[0].basis).toBe("imported");
    expect(captured.project.decisions[0]).toMatchObject({
      frameId: source.id,
      versionId: captured.project.frames[0].currentVersionId,
      from: null,
      to: "undecided",
      actorId: "source-import",
      reversible: true,
    });
    expect(progress).toEqual([[1, 1]]);
    expect(project).toEqual(before);
  });

  test("duplicate filenames with distinct bytes remain distinct assets", async () => {
    const a = shot("camera-a", "original A");
    const b = shot("camera-b", "original B");
    const captured = await captureProject(emptyProject(), [a, b], b.id, "keepers");
    expect(captured.project.frames.map((frame) => frame.originalName)).toEqual([
      "DSC_0001.jpg",
      "DSC_0001.jpg",
    ]);
    expect(captured.project.frames[0].assetId).not.toBe(captured.project.frames[1].assetId);
    expect(captured.project.editVersions).toHaveLength(2);
    expect(captured.blobs.size).toBe(2);
    const hydrated = await hydrate(captured.project, captured.blobs);
    expect(await hydrated.shots[0].file.text()).toBe("original A");
    expect(await hydrated.shots[1].file.text()).toBe("original B");
    expect(hydrated.selectedId).toBe(b.id);
    expect(hydrated.filter).toBe("keepers");
  });

  test("identical originals reuse content and edit identity but keep separate frame decisions", async () => {
    const captured = await captureProject(
      emptyProject(),
      [shot("camera-a"), shot("camera-b", "abc", { verdict: "keep" })],
      null,
      "all",
    );
    expect(captured.project.frames).toHaveLength(2);
    expect(captured.project.frames[0].assetId).toBe(captured.project.frames[1].assetId);
    expect(captured.project.editVersions).toHaveLength(1);
    expect(captured.blobs.size).toBe(1);
    expect(captured.project.decisions.map((entry) => [entry.frameId, entry.to])).toEqual([
      ["camera-a", "undecided"],
      ["camera-b", "keep"],
    ]);
  });

  test("hydrate reconstructs original File facts and preview without changing saved metadata", async () => {
    const previewBlob = new Blob(["small preview"], { type: "image/jpeg" });
    const source = shot("camera-a", "source", { previewBlob });
    const captured = await captureProject(emptyProject(), [source], source.id, "flagged");
    const before = structuredClone(captured.project);
    const hydrated = await hydrate(captured.project, captured.blobs);
    const restored = hydrated.shots[0];
    expect(restored.file).toBeInstanceOf(File);
    expect(await restored.file.text()).toBe("source");
    expect(restored.file.name).toBe("DSC_0001.jpg");
    expect(restored.file.type).toBe("image/jpeg");
    expect(restored.file.lastModified).toBe(1234);
    expect(restored.sourceAvailable).toBe(true);
    expect(restored.previewBlob).toBe(previewBlob);
    expect(restored.previewUrl).toMatch(/^blob:/);
    expect(restored.develop).toEqual(source.develop);
    expect(hydrated.updatedAt).toBe(Date.parse(captured.project.updatedAt));
    expect(captured.project).toEqual(before);
  });

  test("preview-only bytes never become originals through capture, hydration or a repeated save", async () => {
    const previewBlob = new Blob(["small preview"], { type: "image/jpeg" });
    const source = shot("camera-a", "preview file bytes", {
      sourceAvailable: false,
      previewBlob,
    });
    const captured = await captureProject(emptyProject(), [source], source.id, "all");
    const frame = captured.project.frames[0];
    const previewHash = await hashBlob(previewBlob);
    expect(frame.assetId).toMatch(/^unverified:/);
    expect(frame.originalBlobId).toBeNull();
    expect(frame.previewBlobId).toBe(previewHash);
    expect(frame.originalType).toBe("application/octet-stream");
    expect(frame.originalModifiedAt).toBe(0);
    expect(captured.blobs.size).toBe(1);
    expect(captured.blobs.has(await hashBlob(source.file))).toBe(false);
    const hydrated = await hydrate(captured.project, captured.blobs);
    expect(hydrated.shots[0].sourceAvailable).toBe(false);
    expect(hydrated.shots[0].file.name).toBe("DSC_0001.jpg.preview.jpg");
    expect(await hydrated.shots[0].file.text()).toBe("small preview");
    const savedAgain = await captureProject(captured.project, hydrated.shots, source.id, "all");
    expect(savedAgain.project.frames[0].originalBlobId).toBeNull();
    expect(savedAgain.project.frames[0].assetId).toBe(frame.assetId);
    expect(savedAgain.project.editVersions).toEqual(captured.project.editVersions);
    expect(savedAgain.project.decisions).toEqual(captured.project.decisions);
    expect(savedAgain.blobs.size).toBe(0);
  });

  test("an empty source has no original even when availability was not explicitly false", async () => {
    const source = shot("empty", "");
    const captured = await captureProject(emptyProject(), [source], source.id, "all");
    expect(captured.project.frames[0].assetId).toMatch(/^unverified:/);
    expect(captured.project.frames[0].originalBlobId).toBeNull();
    expect(captured.blobs.size).toBe(0);
    const hydrated = await hydrate(captured.project, captured.blobs);
    expect(hydrated.shots[0].sourceAvailable).toBe(false);
    expect(hydrated.shots[0].file.size).toBe(0);
    expect(hydrated.shots[0].previewUrl).toBeNull();
  });

  test("reconnection adds verified original bytes while preserving provisional identity and history", async () => {
    const previewBlob = new Blob(["small preview"], { type: "image/jpeg" });
    const preview = shot("camera-a", "preview", {
      sourceAvailable: false,
      previewBlob,
      verdict: "keep",
    });
    const captured = await captureProject(emptyProject(), [preview], preview.id, "keepers");
    const frame = captured.project.frames[0];
    captured.project.proofs.push({
      id: "proof-before-reconnection",
      title: "Frozen preview proof",
      createdAt: captured.project.createdAt,
      state: "device-local",
      items: [
        {
          frameId: frame.id,
          assetId: frame.assetId,
          versionId: frame.currentVersionId,
          blobId: frame.previewBlobId!,
          width: 1600,
          height: 1067,
        },
      ],
    });
    captured.project.feedback.push({
      id: "recorded-before-reconnection",
      proofId: "proof-before-reconnection",
      frameId: frame.id,
      versionId: frame.currentVersionId,
      choice: "favorite",
      comment: "Keep this version on record.",
      reviewer: "Reported reviewer",
      actorId: "local-photographer",
      recordedBy: "photographer",
      at: captured.project.createdAt,
    });
    const project = validateProject(captured.project);
    const before = structuredClone(project);
    const original = new File(["reconnected original"], "DSC_0001.jpg", {
      type: "image/jpeg",
      lastModified: 9876,
    });
    const connected = await captureProject(
      project,
      [{ ...preview, file: original, sourceAvailable: true }],
      preview.id,
      "keepers",
    );
    const checksum = await hashBlob(original);
    expect(connected.project.frames[0].originalBlobId).toBe(checksum);
    expect(connected.project.frames[0].assetId).toBe(frame.assetId);
    expect(connected.project.frames[0].assetId).toMatch(/^unverified:/);
    expect(connected.project.frames[0].originalType).toBe("image/jpeg");
    expect(connected.project.frames[0].originalModifiedAt).toBe(9876);
    expect(connected.project.frames[0].currentVersionId).toBe(frame.currentVersionId);
    expect(connected.project.editVersions).toEqual(before.editVersions);
    expect(connected.project.decisions).toEqual(before.decisions);
    expect(connected.project.proofs).toEqual(before.proofs);
    expect(connected.project.feedback).toEqual(before.feedback);
    expect(connected.blobs.get(checksum)).toBe(original);
    expect(() => assertProjectAdvance(project, connected.project)).not.toThrow();
    expect(project).toEqual(before);
  });

  test("changed original bytes are refused without changing originals, edits or history", async () => {
    const source = shot();
    const captured = await captureProject(emptyProject(), [source], source.id, "all");
    const before = structuredClone(captured.project);
    const changed = shot(source.id, "different bytes", {
      verdict: "keep",
      edits: { ...DEFAULT_EDITS, temp: 20 },
    });
    await expect(captureProject(captured.project, [changed], source.id, "all")).rejects.toThrow(
      "source bytes changed",
    );
    expect(captured.project).toEqual(before);
    expect(await captured.blobs.get(before.frames[0].originalBlobId!)!.text()).toBe("abc");
  });

  test("missing original or declared preview drops that ghost frame instead of blocking the shoot", async () => {
    const source = shot("camera-a", "source", { previewBlob: new Blob(["preview"]) });
    const captured = await captureProject(emptyProject(), [source], source.id, "all");
    const before = structuredClone(captured.project);
    for (const key of captured.blobs.keys()) {
      const incomplete = new Map(captured.blobs);
      incomplete.delete(key);
      const session = await hydrateProject(captured.project, incomplete);
      expect(session.shots).toEqual([]);
    }
    expect(captured.project).toEqual(before);
  });

  test("hydration keeps frames that still have pixels and drops the rest", async () => {
    const a = shot("camera-a", "source A", { previewBlob: new Blob(["preview A"]) });
    const b = shot("camera-b", "source B", { previewBlob: new Blob(["preview B"]) });
    const captured = await captureProject(emptyProject(), [a, b], null, "all");
    const incomplete = new Map(captured.blobs);
    incomplete.delete(captured.project.frames[1].originalBlobId!);
    const session = await hydrateProject(captured.project, incomplete);
    expect(session.shots.map((item) => item.id)).toEqual([a.id]);
    for (const shot of session.shots) if (shot.previewUrl) URL.revokeObjectURL(shot.previewUrl);
  });
});

describe("project Studio adapter: immutable edit and decision history", () => {
  test("unchanged checkpoint adds no blobs, versions, decisions or activity", async () => {
    const source = shot();
    const captured = await captureProject(emptyProject(), [source], source.id, "all");
    const same = await captureProject(captured.project, [source], source.id, "all");
    expect(same.project).toEqual(captured.project);
    expect(same.blobs.size).toBe(0);
  });

  test("edits append versions without rewriting history; undo reuses the previous version", async () => {
    const source = shot();
    const captured = await captureProject(emptyProject(), [source], source.id, "all");
    const before = structuredClone(captured.project);
    const warm = { ...source, edits: { ...source.edits, temp: 20 } };
    const edited = await captureProject(captured.project, [warm], source.id, "all");
    expect(edited.project.editVersions).toHaveLength(2);
    expect(edited.project.editVersions[0]).toEqual(before.editVersions[0]);
    expect(edited.project.editVersions[1]).toMatchObject({
      assetId: before.frames[0].assetId,
      basis: "photographer-saved",
      actorId: "local-photographer",
      edits: warm.edits,
    });
    expect(edited.project.frames[0].currentVersionId).not.toBe(before.frames[0].currentVersionId);
    expect(edited.project.decisions).toEqual(before.decisions);
    expect(edited.blobs.size).toBe(0);
    expect(captured.project).toEqual(before);
    expect(() => assertProjectAdvance(captured.project, edited.project)).not.toThrow();
    const undone = await captureProject(edited.project, [source], source.id, "all");
    expect(undone.project.frames[0].currentVersionId).toBe(before.frames[0].currentVersionId);
    expect(undone.project.editVersions).toEqual(edited.project.editVersions);
    expect(undone.project.frames[0].metadata.edits).toEqual(DEFAULT_EDITS);
    expect(() => assertProjectAdvance(edited.project, undone.project)).not.toThrow();
  });

  test("verdict changes append exact-version reversible decisions without rewriting older decisions", async () => {
    const source = shot();
    const initial = await captureProject(emptyProject(), [source], source.id, "all");
    const changed = { ...source, verdict: "keep" as const, edits: { ...source.edits, temp: 10 } };
    const kept = await captureProject(initial.project, [changed], source.id, "keepers");
    expect(kept.project.decisions).toHaveLength(2);
    expect(kept.project.decisions[0]).toEqual(initial.project.decisions[0]);
    expect(kept.project.decisions[1]).toMatchObject({
      frameId: source.id,
      versionId: kept.project.frames[0].currentVersionId,
      from: "undecided",
      to: "keep",
      actorId: "local-photographer",
      reversible: true,
    });
    const rejected = await captureProject(
      kept.project,
      [{ ...changed, verdict: "reject" }],
      source.id,
      "rejected",
    );
    expect(rejected.project.decisions.slice(0, 2)).toEqual(kept.project.decisions);
    expect(rejected.project.decisions[2]).toMatchObject({ from: "keep", to: "reject" });
    expect(rejected.project.editVersions).toEqual(kept.project.editVersions);
  });

  test("duplicate source IDs or missing saved frames cannot replace an existing project", async () => {
    const source = shot();
    const captured = await captureProject(emptyProject(), [source], source.id, "all");
    const before = structuredClone(captured.project);
    await expect(
      captureProject(captured.project, [source, source], source.id, "all"),
    ).rejects.toThrow("Repeated source identifiers");
    await expect(captureProject(captured.project, [], null, "all")).rejects.toThrow(
      "Saving cannot remove existing project frames",
    );
    expect(captured.project).toEqual(before);
  });

  test("version identity is deterministic and depends on both asset and edit recipe", async () => {
    const assetId = `sha256:${"a".repeat(64)}`;
    const initial = await versionId(assetId, { ...DEFAULT_EDITS });
    expect(initial).toMatch(/^edit:[a-f0-9]{64}$/);
    expect(await versionId(assetId, { ...DEFAULT_EDITS })).toBe(initial);
    expect(await versionId(assetId, { ...DEFAULT_EDITS, temp: 1 })).not.toBe(initial);
    expect(await versionId(`sha256:${"b".repeat(64)}`, { ...DEFAULT_EDITS })).not.toBe(initial);
  });
});
