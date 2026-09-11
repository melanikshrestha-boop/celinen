import { z } from "zod";
import { workspaceStorageKey } from "@/lib/workspace-storage";
import type { Project } from "@/lib/projects/model";
import { deliveryId, versionInput, type DeliveryState } from "./workflow";

const MAX_BYTES = 1024 * 1024;
export const HANDOFF_LIFETIME = 24 * 60 * 60 * 1000;
const scopeSchema = z.union([z.literal("device-local"), deliveryId]);
const noteSchema = z
  .object({
    id: deliveryId,
    photoId: deliveryId,
    versionId: deliveryId,
    body: z.string().min(1).max(4000),
    role: z.enum(["owner", "client"]),
    at: z.string().datetime(),
    revision: z.boolean(),
    resolvedAt: z.string().datetime().nullable(),
  })
  .strict();
const handoffSchema = z
  .object({
    format: z.literal(1),
    id: deliveryId,
    scope: scopeSchema,
    galleryId: deliveryId,
    galleryRevision: z.number().int().nonnegative().safe(),
    galleryTitle: z.string().min(1).max(160),
    capturedAt: z.number().int().nonnegative().safe(),
    photoId: deliveryId,
    versionId: deliveryId,
    versionNumber: z.number().int().positive().safe(),
    filename: z.string().min(1).max(240),
    source: versionInput.innerType().shape.source.unwrap(),
    notes: z.array(noteSchema).max(200),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    for (const note of value.notes) {
      if (note.photoId !== value.photoId || note.versionId !== value.versionId || ids.has(note.id))
        context.addIssue({
          code: "custom",
          message: "Feedback must belong to this exact photo version.",
        });
      ids.add(note.id);
    }
  });
export type StudioHandoff = z.infer<typeof handoffSchema>;
export type DeliveryFocus = { frameId: string; versionId: string; handoffId?: string };
export type HandoffStorage = Pick<Storage, "getItem" | "setItem">;
const recovery =
  "Client feedback is unavailable in this tab. Reopen this photo from Delivery to refresh it. Your edits are unchanged.";

function handoffKey(scope: string, id: string) {
  return workspaceStorageKey(
    `lenslabs.delivery-studio-reference.v1:${deliveryId.parse(id)}`,
    scopeSchema.parse(scope),
  );
}

/** A temporary, non-authoritative reference. Never an approval, edit command or AI prompt. */
export function createStudioHandoff(
  room: { id: string; revision: number; state: DeliveryState },
  versionId: string,
  scope: string,
  capturedAt = Date.now(),
): StudioHandoff {
  const photo = room.state.photos.find((entry) =>
    entry.versions.some((version) => version.id === versionId),
  );
  const version = photo?.versions.find((entry) => entry.id === versionId);
  if (!version?.source || version.photoId !== photo?.id)
    throw new Error(
      "This delivered version has no connected Studio source. Reconnect its original project first.",
    );
  const notes = room.state.comments.filter(
    (note) => note.photoId === photo.id && note.versionId === version.id,
  );
  if (notes.length > 200)
    throw new Error(
      "This version has too many notes for a temporary Studio reference. Review them in Delivery; no notes were dropped.",
    );
  return handoffSchema.parse({
    format: 1,
    id: crypto.randomUUID(),
    scope,
    galleryId: room.id,
    galleryRevision: room.revision,
    galleryTitle: room.state.title,
    capturedAt,
    photoId: photo.id,
    versionId: version.id,
    versionNumber: version.number,
    filename: version.filename,
    source: version.source,
    notes,
  });
}

export function saveStudioHandoff(storage: HandoffStorage, handoff: StudioHandoff) {
  const validated = handoffSchema.parse(handoff);
  const serialized = JSON.stringify(validated);
  if (new TextEncoder().encode(serialized).byteLength > MAX_BYTES)
    throw new Error(
      "This feedback is too large for a temporary handoff. Review it in Delivery; no notes were dropped.",
    );
  try {
    storage.setItem(handoffKey(validated.scope, validated.id), serialized);
    if (storage.getItem(handoffKey(validated.scope, validated.id)) !== serialized)
      throw new Error("Readback failed");
  } catch {
    throw new Error(
      "This browser could not preserve the feedback handoff. Free session storage or review the notes in Delivery; no edits were applied.",
    );
  }
}

export function readStudioHandoff(
  storage: HandoffStorage,
  scope: string,
  id: string,
  now = Date.now(),
): StudioHandoff {
  try {
    const serialized = storage.getItem(handoffKey(scope, id));
    if (
      !serialized ||
      serialized.length > MAX_BYTES ||
      new TextEncoder().encode(serialized).byteLength > MAX_BYTES
    )
      throw new Error(recovery);
    const value = handoffSchema.parse(JSON.parse(serialized));
    if (
      value.scope !== scope ||
      value.id !== id ||
      value.capturedAt > now ||
      now - value.capturedAt >= HANDOFF_LIFETIME
    )
      throw new Error(recovery);
    return value;
  } catch {
    throw new Error(recovery);
  }
}

/** Match IDs AND original bytes; duplicate names never determine the handoff target. */
export function verifyStudioHandoff(
  project: Project,
  handoff: StudioHandoff,
  focus: DeliveryFocus,
) {
  const value = handoffSchema.parse(handoff);
  const frame = project.frames.find((entry) => entry.id === focus.frameId);
  const version = project.editVersions.find(
    (entry) => entry.id === focus.versionId && entry.assetId === frame?.assetId,
  );
  if (
    project.id !== value.source.projectId ||
    focus.frameId !== value.source.frameId ||
    focus.versionId !== value.source.editVersionId ||
    focus.handoffId !== value.id ||
    !frame?.originalBlobId ||
    frame.originalBlobId !== value.source.originalSha256 ||
    !version
  )
    throw new Error(
      "The feedback does not match this source photo and edit version. Reopen it from Delivery; no notes were attached to another frame.",
    );
  return { handoff: value, reviewedEdits: { ...version.edits } };
}

/** Recheck the originating room after IO; a late click may not open a different gallery. */
export async function prepareStudioHandoff(
  room: { id: string; revision: number; state: DeliveryState },
  versionId: string,
  scope: string,
  load: (id: string) => Promise<Project>,
  stillCurrent: () => boolean,
) {
  const handoff = createStudioHandoff(room, versionId, scope);
  const project = await load(handoff.source.projectId);
  if (!stillCurrent())
    throw new Error(
      "The gallery or account changed while opening Studio. Reopen the photo from the current gallery.",
    );
  const focus = {
    frameId: handoff.source.frameId,
    versionId: handoff.source.editVersionId,
    handoffId: handoff.id,
  };
  verifyStudioHandoff(project, handoff, focus);
  return { handoff, focus };
}
