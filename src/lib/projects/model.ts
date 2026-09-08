import { z } from "zod";
import type { Shot } from "@/lib/imaging";
import { PHOTO_ID_MAX_LENGTH } from "@/lib/photo-identity";

export const PROJECT_TYPES = [
  "sports",
  "event",
  "wedding",
  "portrait",
  "product",
  "property",
  "volume",
  "personal",
] as const;
export const PROCESSOR_VERSION = "lenslabs-canvas-v1";
const id = z.string().min(1).max(2000);
// Other record IDs retain their smaller bound; archive byte limits still apply.
const frameId = z.string().min(1).max(PHOTO_ID_MAX_LENGTH);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().datetime();
const number = z.number().finite();
const adjustment = number.min(-100).max(100);
export const editsSchema = z
  .object({
    exposure: adjustment,
    contrast: adjustment,
    temp: adjustment,
    saturation: adjustment,
    highlights: adjustment,
    shadows: adjustment,
    crop: z.enum(["orig", "1:1", "4:5", "3:2", "16:9"]),
  })
  .strict();
const verdict = z.enum(["undecided", "keep", "reject"]);
export const frameMetadataSchema = z
  .object({
    id: frameId,
    name: z.string().min(1).max(1000),
    relativePath: z.string().max(4000).optional(),
    captureTimeMs: number.int().positive().max(8.64e15).optional(),
    captureTimeBasis: z.enum(["utc", "camera_clock"]).optional(),
    cameraKey: z.string().max(512).optional(),
    analysisBackend: z.enum(["native-cpp", "worker", "main-thread"]).optional(),
    isRaw: z.boolean(),
    width: number.nonnegative(),
    height: number.nonnegative(),
    sizeMb: number.nonnegative(),
    sharpness: number,
    brightness: number,
    clippedHighlights: number,
    clippedShadows: number,
    hash: z.string().max(100),
    score: number.min(0).max(100),
    flags: z.array(
      z.enum([
        "soft",
        "blur",
        "underexposed",
        "overexposed",
        "duplicate",
        "face-soft",
        "eyes-closed",
      ]),
    ),
    verdict,
    edits: editsSchema,
    tone: z
      .object({
        black: number,
        white: number,
        median: number,
        rMean: number,
        gMean: number,
        bMean: number,
        satMean: number,
      })
      .optional(),
    faces: z
      .object({
        count: number.nonnegative(),
        faceSharpness: number,
        eyesOpen: z.boolean().nullable(),
        center: z.object({ x: number.min(0).max(1), y: number.min(0).max(1) }).optional(),
      })
      .optional(),
    develop: z
      .object({
        origin: z.enum(["lightroom", "sidecar", "lens os"]),
        at: number,
        rating: number.optional(),
        label: z.string().nullable().optional(),
        caption: z.string().optional(),
        cropped: z.boolean().optional(),
        processVersion: z.string().optional(),
      })
      .optional(),
    error: z.string().optional(),
  })
  .passthrough();

export const projectSchema = z
  .object({
    format: z.literal("lenslabs-project"),
    version: z.literal(1),
    id: z.string().uuid(),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    organizationId: z.literal("local-studio"),
    ownerId: z.literal("local-photographer"),
    title: z.string().trim().min(1).max(200),
    genre: z.enum(PROJECT_TYPES),
    brief: z.string().max(20000),
    clientId: id.nullable(),
    bookingId: id.nullable(),
    invoiceIds: z.array(id),
    galleryIds: z.array(id),
    references: z.array(
      z
        .object({
          kind: z.enum(["client", "booking", "invoice", "gallery"]),
          id,
          snapshot: z.record(z.unknown()),
          capturedAt: date,
        })
        .strict(),
    ),
    createdAt: date,
    updatedAt: date,
    frames: z
      .array(
        z
          .object({
            id: frameId,
            assetId: id,
            originalBlobId: hash.nullable(),
            previewBlobId: hash.nullable(),
            originalName: z.string().min(1).max(1000),
            originalType: z.string().max(200),
            originalModifiedAt: number.nonnegative(),
            metadata: frameMetadataSchema,
            currentVersionId: id,
          })
          .strict(),
      )
      .max(20000),
    editVersions: z
      .array(
        z
          .object({
            id,
            assetId: id,
            edits: editsSchema,
            processor: z.literal(PROCESSOR_VERSION),
            createdAt: date,
            actorId: id,
            basis: z.enum(["imported", "photographer-saved"]),
          })
          .strict(),
      )
      .max(200000),
    decisions: z
      .array(
        z
          .object({
            id,
            frameId,
            versionId: id,
            from: verdict.nullable(),
            to: verdict,
            actorId: id,
            at: date,
            reversible: z.literal(true),
          })
          .strict(),
      )
      .max(200000),
    selectedId: frameId.nullable(),
    filter: z.enum(["all", "keepers", "flagged", "rejected", "todo"]),
    activity: z
      .array(
        z
          .object({
            id,
            at: date,
            actorId: id,
            action: z.string().min(1).max(300),
            detail: z.string().max(2000),
          })
          .strict(),
      )
      .max(200000),
    proofs: z.array(
      z
        .object({
          id,
          title: z.string().min(1).max(200),
          createdAt: date,
          state: z.literal("device-local"),
          items: z.array(
            z
              .object({
                frameId,
                assetId: id,
                versionId: id,
                blobId: hash,
                width: number.int().positive(),
                height: number.int().positive(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    feedback: z.array(
      z
        .object({
          id,
          proofId: id,
          frameId,
          versionId: id,
          choice: z.enum(["favorite", "approve", "revision"]),
          comment: z.string().max(4000),
          reviewer: z.string().trim().min(1).max(200),
          actorId: z.literal("local-photographer"),
          recordedBy: z.literal("photographer"),
          at: date,
        })
        .strict(),
    ),
    exports: z.array(
      z
        .object({
          id,
          proofId: id,
          versionIds: z.array(id),
          at: date,
          state: z.literal("download-prepared"),
          kind: z.literal("proof-jpeg"),
        })
        .strict(),
    ),
  })
  .strict();
export type Project = z.infer<typeof projectSchema>;
export type ProjectFrame = Project["frames"][number];
export type EditVersion = Project["editVersions"][number];
export type Proof = Project["proofs"][number];
export type ProjectInput = Pick<
  Project,
  "title" | "genre" | "brief" | "clientId" | "bookingId" | "invoiceIds" | "galleryIds"
>;

export const now = () => new Date().toISOString();
export function activity(action: string, detail: string): Project["activity"][number] {
  return { id: crypto.randomUUID(), at: now(), actorId: "local-photographer", action, detail };
}
export function newProject(input: ProjectInput): Project {
  return validateProject({
    ...input,
    format: "lenslabs-project",
    version: 1,
    id: crypto.randomUUID(),
    revision: 0,
    organizationId: "local-studio",
    ownerId: "local-photographer",
    createdAt: now(),
    updatedAt: now(),
    frames: [],
    editVersions: [],
    decisions: [],
    proofs: [],
    feedback: [],
    exports: [],
    references: [],
    selectedId: null,
    filter: "all",
    activity: [
      activity("Project created", "Device-local project; no publication or payment implied."),
    ],
  });
}

const unique = (ids: string[]) => new Set(ids).size === ids.length;
/** All relationships are validated before loading or restoring; never filter broken records out. */
export function validateProject(value: unknown): Project {
  const project = projectSchema.parse(value);
  for (const records of [
    project.frames,
    project.editVersions,
    project.decisions,
    project.proofs,
    project.feedback,
    project.exports,
    project.activity,
  ])
    if (!unique(records.map((row) => row.id)))
      throw new Error("Duplicate project record identifiers.");
  if (!unique(project.invoiceIds) || !unique(project.galleryIds))
    throw new Error("Duplicate project links.");
  if (
    !unique(project.references.map((ref) => `${ref.kind}:${ref.id}`)) ||
    project.references.some((ref) => ref.snapshot["id"] !== ref.id)
  )
    throw new Error("Invalid reference snapshot identities.");
  if (project.bookingId && !project.clientId)
    throw new Error("A linked booking requires its client.");
  const frames = new Map(project.frames.map((frame) => [frame.id, frame]));
  const versions = new Map(project.editVersions.map((version) => [version.id, version]));
  const proofs = new Map(project.proofs.map((proof) => [proof.id, proof]));
  if (project.selectedId && !frames.has(project.selectedId))
    throw new Error("Selected frame is missing.");
  for (const frame of project.frames) {
    const version = versions.get(frame.currentVersionId);
    if (
      frame.metadata.id !== frame.id ||
      !version ||
      version.assetId !== frame.assetId ||
      JSON.stringify(version.edits) !== JSON.stringify(frame.metadata.edits)
    )
      throw new Error("An asset's current edit version is inconsistent.");
    if (
      frame.originalBlobId &&
      !frame.assetId.startsWith("unverified:") &&
      frame.assetId !== `sha256:${frame.originalBlobId}`
    )
      throw new Error("Original identity does not match its checksum.");
    if (!frame.originalBlobId && !frame.assetId.startsWith("unverified:"))
      throw new Error("Missing originals must be marked unverified.");
  }
  const assetIds = new Set(project.frames.map((frame) => frame.assetId));
  if (project.editVersions.some((version) => !assetIds.has(version.assetId)))
    throw new Error("Edit version references a missing asset.");
  for (const decision of project.decisions) {
    if (
      !frames.has(decision.frameId) ||
      versions.get(decision.versionId)?.assetId !== frames.get(decision.frameId)?.assetId
    )
      throw new Error("Selection history references a missing or unrelated asset version.");
  }
  for (const proof of project.proofs) {
    if (!unique(proof.items.map((item) => item.frameId)))
      throw new Error("Repeated frame in a proof.");
    for (const item of proof.items)
      if (
        frames.get(item.frameId)?.assetId !== item.assetId ||
        versions.get(item.versionId)?.assetId !== item.assetId
      )
        throw new Error("Proof references the wrong asset or version.");
  }
  for (const feedback of project.feedback)
    if (
      !proofs
        .get(feedback.proofId)
        ?.items.some(
          (item) => item.frameId === feedback.frameId && item.versionId === feedback.versionId,
        )
    )
      throw new Error("Feedback must reference the exact proof version.");
  for (const exported of project.exports)
    if (
      !unique(exported.versionIds) ||
      !proofs.has(exported.proofId) ||
      exported.versionIds.some(
        (versionId) =>
          !proofs.get(exported.proofId)!.items.some((item) => item.versionId === versionId),
      )
    )
      throw new Error("Export record references an unrelated proof version.");
  return project;
}

export function projectBlobIds(project: Project): string[] {
  return [
    ...new Set(
      [
        ...project.frames.flatMap((frame) => [frame.originalBlobId, frame.previewBlobId]),
        ...project.proofs.flatMap((proof) => proof.items.map((item) => item.blobId)),
      ].filter((key): key is string => key !== null),
    ),
  ];
}

/** Portable metadata is data only. Browser objects are deliberately excluded. */
export function shotMetadata(shot: Shot): ProjectFrame["metadata"] {
  const {
    file: _file,
    previewUrl: _url,
    previewBlob: _blob,
    sourceAvailable: _available,
    ...metadata
  } = shot;
  return frameMetadataSchema.parse(JSON.parse(JSON.stringify(metadata)));
}

export function assertProjectAdvance(current: Project, next: Project): void {
  if (current.id !== next.id || current.revision !== next.revision)
    throw new Error(
      "Project changed in another tab. Reload before saving; no changes were overwritten.",
    );
  const nextFrames = new Map(next.frames.map((frame) => [frame.id, frame]));
  if (current.frames.some((frame) => !nextFrames.has(frame.id)))
    throw new Error("Saving cannot remove existing project assets.");
  for (const frame of current.frames) {
    const replacement = nextFrames.get(frame.id)!;
    if (frame.originalBlobId && replacement.originalBlobId !== frame.originalBlobId)
      throw new Error("An original's bytes cannot change silently.");
    if (
      frame.originalBlobId &&
      (frame.originalName !== replacement.originalName ||
        frame.originalType !== replacement.originalType ||
        frame.originalModifiedAt !== replacement.originalModifiedAt)
    )
      throw new Error("Original source facts cannot change silently.");
  }
  for (const key of [
    "editVersions",
    "decisions",
    "proofs",
    "feedback",
    "exports",
    "activity",
  ] as const) {
    const nextRecords = new Map(next[key].map((row) => [row.id, JSON.stringify(row)]));
    if (current[key].some((row) => nextRecords.get(row.id) !== JSON.stringify(row)))
      throw new Error(`Existing ${key} history is immutable.`);
  }
}
