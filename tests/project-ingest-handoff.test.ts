import { describe, expect, test } from "bun:test";
import { DEFAULT_EDITS, parseXmpSidecar, type Shot } from "../src/lib/imaging";
import { createIngestResolver, mergeIngestedShots } from "../src/lib/studio/ingest";
import { newProject, validateProject, projectSchema } from "../src/lib/projects/model";
import { captureProject, hydrateProject } from "../src/lib/projects/studio-adapter";
import { createProjectArchive, parseProjectArchive } from "../src/lib/projects/archive";
import { createLightroomVerdicts } from "../src/lib/lightroom-matching";
import { planSidecarExport } from "../src/lib/studio/sidecar-export";
import { versionInput } from "../src/lib/delivery/workflow";

const name = "DSC_0001.jpg";
const project = () =>
  newProject({
    title: "Handoff regression",
    genre: "personal",
    brief: "",
    clientId: null,
    bookingId: null,
    invoiceIds: [],
    galleryIds: [],
  });
function source(path: string, bytes: string) {
  const file = new File([bytes], name, { type: "image/jpeg", lastModified: 1234 });
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}
function longPath(length: number) {
  let remaining = length - name.length - 1;
  const segments: string[] = [];
  while (remaining > 199) {
    segments.push("a".repeat(199));
    remaining -= 200;
  }
  segments.push("b".repeat(remaining));
  return `${segments.join("/")}/${name}`;
}
async function ingest(files: File[]) {
  const resolver = createIngestResolver(files, []);
  return Promise.all(
    files.map(async (file, index): Promise<Shot> => ({
      ...(await resolver.prepare(file))!,
      file,
      name,
      relativePath: file.webkitRelativePath,
      isRaw: false,
      sourceAvailable: true,
      previewUrl: null,
      width: 1,
      height: 1,
      sizeMb: file.size / 1024 / 1024,
      sharpness: 42,
      brightness: 128,
      clippedHighlights: 0,
      clippedShadows: 0,
      hash: "1010",
      score: 80,
      flags: [],
      verdict: index ? "reject" : "keep",
      edits: { ...DEFAULT_EDITS, exposure: index },
    })),
  );
}

describe("import identities through project and editor handoff", () => {
  test("a 4000-character source path survives capture, archive and reconnect without migrating IDs", async () => {
    const path = longPath(4000);
    expect(path.length).toBe(4000);
    const files = [source(path, "first"), source(path, "other")];
    const shots = await ingest(files);
    expect(shots[0]!.id.length).toBeGreaterThan(4000);
    const captured = await captureProject(project(), shots, shots[1]!.id, "rejected");
    const frame = captured.project.frames[0]!;
    const proofId = crypto.randomUUID();
    captured.project.proofs.push({
      id: proofId,
      title: "Recorded proof",
      state: "device-local",
      createdAt: captured.project.createdAt,
      items: [
        {
          frameId: frame.id,
          assetId: frame.assetId,
          versionId: frame.currentVersionId,
          blobId: frame.originalBlobId!,
          width: 1,
          height: 1,
        },
      ],
    });
    captured.project.feedback.push({
      id: crypto.randomUUID(),
      proofId,
      frameId: frame.id,
      versionId: frame.currentVersionId,
      choice: "favorite",
      comment: "Original version",
      reviewer: "Synthetic reviewer",
      actorId: "local-photographer",
      recordedBy: "photographer",
      at: captured.project.createdAt,
    });
    const archive = await createProjectArchive(captured.project, captured.blobs);
    const parsed = await parseProjectArchive(archive);
    const document = validateProject(parsed.document);
    const restored = await hydrateProject(document, parsed.blobs);
    expect(restored.shots.map((shot) => shot.id)).toEqual(shots.map((shot) => shot.id));
    expect(restored.selectedId).toBe(shots[1]!.id);
    expect(restored.filter).toBe("rejected");
    expect(document.proofs[0]!.items[0]!.frameId).toBe(shots[0]!.id);
    expect(document.feedback[0]!.frameId).toBe(shots[0]!.id);
    expect(await Promise.all(restored.shots.map((shot) => shot.file.text()))).toEqual([
      "first",
      "other",
    ]);
    const resolver = createIngestResolver(files, restored.shots);
    const identities = await Promise.all(files.map((file) => resolver.prepare(file)));
    expect(identities.map((identity) => identity!.id)).toEqual(shots.map((shot) => shot.id));
    const merged = mergeIngestedShots(restored.shots, shots);
    expect(merged.map((shot) => shot.verdict)).toEqual(["keep", "reject"]);
    expect(merged.map((shot) => shot.edits.exposure)).toEqual([0, 1]);
    expect(
      (await captureProject(document, merged, merged[1]!.id, "all")).project.decisions,
    ).toEqual(document.decisions);
    const changed = source(path, "third");
    await expect(createIngestResolver([changed], restored.shots).prepare(changed)).rejects.toThrow(
      "different bytes",
    );
  });

  test("delivery source references accept the same long photo identity as its saved project", async () => {
    const shots = await ingest([source(longPath(4000), "first")]);
    const captured = await captureProject(project(), shots, shots[0]!.id, "all");
    const frame = captured.project.frames[0]!;
    const schema = versionInput.innerType().shape.source.unwrap();
    const input = {
      projectId: captured.project.id,
      frameId: frame.id,
      editVersionId: frame.currentVersionId,
      originalSha256: frame.originalBlobId!,
    };
    expect(schema.parse(input)).toEqual(input);
  });

  test("new frame bounds stay finite and unrelated record and path limits do not grow", async () => {
    const shots = await ingest([source("card/DSC_0001.jpg", "first")]);
    const captured = await captureProject(project(), shots, shots[0]!.id, "all");
    const schema = projectSchema.shape.frames.element;
    const frame = captured.project.frames[0]!;
    expect(
      schema.safeParse({
        ...frame,
        id: "i".repeat(4200),
        metadata: { ...frame.metadata, id: "i".repeat(4200) },
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ ...frame, id: "i".repeat(4201) }).success).toBe(false);
    expect(schema.safeParse({ ...frame, assetId: "i".repeat(2001) }).success).toBe(false);
    expect(
      schema.safeParse({
        ...frame,
        metadata: { ...frame.metadata, relativePath: "p".repeat(4001) },
      }).success,
    ).toBe(false);
    expect(() => validateProject({ ...captured.project, selectedId: "unknown" })).toThrow(
      "Selected frame is missing",
    );
    const deliverySource = versionInput.innerType().shape.source.unwrap();
    expect(
      deliverySource.safeParse({
        projectId: captured.project.id,
        frameId: "i".repeat(4201),
        editVersionId: frame.currentVersionId,
        originalSha256: frame.originalBlobId,
      }).success,
    ).toBe(false);
  });

  test("same-path content collisions are preserved in projects but cannot target one Adobe photo", async () => {
    const shots = await ingest([
      source("card/DSC_0001.jpg", "first"),
      source("card/DSC_0001.jpg", "other"),
    ]);
    const captured = await captureProject(project(), shots, shots[0]!.id, "all");
    const restored = await hydrateProject(captured.project, captured.blobs);
    expect(restored.shots).toHaveLength(2);
    expect(() => createLightroomVerdicts(restored.shots)).toThrow("duplicate source paths");
    expect(() => planSidecarExport(restored.shots)).toThrow("different picks or settings");
  });

  test("repeated basenames in distinct folders keep separate picks in XMP and Adobe payloads", async () => {
    const shots = await ingest([
      source("card-a/DSC_0001.jpg", "first"),
      source("card-b/DSC_0001.jpg", "other"),
    ]);
    const captured = await captureProject(project(), shots, shots[0]!.id, "all");
    const parsed = await parseProjectArchive(
      await createProjectArchive(captured.project, captured.blobs),
    );
    const restored = await hydrateProject(validateProject(parsed.document), parsed.blobs);
    const plan = planSidecarExport(restored.shots);
    expect(plan.entries.map((entry) => entry.path)).toEqual([
      "card-a/DSC_0001.xmp",
      "card-b/DSC_0001.xmp",
    ]);
    expect(plan.entries.map((entry) => parseXmpSidecar(entry.text!).pick)).toEqual([1, -1]);
    expect(
      createLightroomVerdicts(restored.shots).map((frame) => [frame.relativePath, frame.verdict]),
    ).toEqual([
      ["card-a/DSC_0001.jpg", "keep"],
      ["card-b/DSC_0001.jpg", "reject"],
    ]);
  });

  test("portable sidecar path limits stay intact even when a long path saves to a project", async () => {
    const shots = await ingest([source(longPath(4000), "first")]);
    const captured = await captureProject(project(), shots, shots[0]!.id, "all");
    const restored = await hydrateProject(captured.project, captured.blobs);
    expect(() => planSidecarExport(restored.shots)).toThrow(
      "valid, unambiguous relative filenames",
    );
    expect(createLightroomVerdicts(restored.shots)[0]!.relativePath).toBe(shots[0]!.relativePath!);
  });
});
