import { z } from "zod";
import {
  galleryPresentationSchema,
  galleryCovers,
  validateGalleryCovers,
  type GalleryPresentation,
} from "./gallery-presentation";
import { PHOTO_ID_MAX_LENGTH } from "@/lib/photo-identity";

// Workflow metadata only. Media processing stays in the existing renderer/native pipeline.
export const deliveryId = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const variantNames = ["proof", "phone", "full"] as const;
export type VariantName = (typeof variantNames)[number];
export function safeDeliveryFilename(input: string) {
  return Array.from(input, (char) =>
    char.charCodeAt(0) < 32 || char === "/" || char === "\\" ? "_" : char,
  ).join("");
}
const rendition = z
  .object({
    sha256: hash,
    bytes: z
      .number()
      .int()
      .positive()
      .max(30 * 1024 * 1024),
    width: z.number().int().positive().max(30000),
    height: z.number().int().positive().max(30000),
  })
  .strict();
export const versionInput = z
  .object({
    id: deliveryId,
    photoId: deliveryId,
    filename: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .refine((s) => safeDeliveryFilename(s) === s, "Use a filename, not a path."),
    source: z
      .object({
        projectId: deliveryId,
        frameId: z.string().min(1).max(PHOTO_ID_MAX_LENGTH),
        editVersionId: z.string().min(1).max(2000),
        originalSha256: hash,
      })
      .strict()
      .nullable(),
    variants: z.object({ proof: rendition, phone: rendition, full: rendition }).strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (Math.max(v.variants.proof.width, v.variants.proof.height) > 1600)
      ctx.addIssue({ code: "custom", message: "Proofs must be at most 1600 pixels." });
    if (Math.max(v.variants.phone.width, v.variants.phone.height) > 2048)
      ctx.addIssue({ code: "custom", message: "Phone files must be at most 2048 pixels." });
  });
export type VersionInput = z.infer<typeof versionInput>;
export type DeliveryVersion = VersionInput & {
  ready: boolean;
  createdAt: string;
  number: number;
  publishedAt: string | null;
};
export type DeliveryPhoto = {
  id: string;
  current: string | null;
  published: string | null;
  versions: DeliveryVersion[];
};
export type DeliveryComment = {
  id: string;
  versionId: string;
  photoId: string;
  body: string;
  role: "owner" | "client";
  at: string;
  revision: boolean;
  resolvedAt: string | null;
};
export type DeliveryState = {
  format: 1;
  presentation?: GalleryPresentation;
  title: string;
  clientName: string;
  message: string;
  status: "draft" | "live" | "closed";
  expiresAt: string;
  selectionLimit: number;
  selectionDeadline?: string | null;
  photos: DeliveryPhoto[];
  picks: string[];
  submissions: { id: string; at: string; items: { photoId: string; versionId: string }[] }[];
  comments: DeliveryComment[];
  approvals: { versionId: string; at: string; revokedAt: string | null }[];
  releases: { id: string; at: string; versionIds: string[] }[];
  released: string[];
  events: { id: string; at: string; role: "owner" | "client"; text: string }[];
  receipts: { id: string; fingerprint: string }[];
};
export const newDeliveryInput = z
  .object({
    id: deliveryId,
    title: z.string().trim().min(1).max(160),
    clientName: z.string().trim().min(1).max(120),
    message: z.string().trim().max(2000),
    selectionLimit: z.number().int().min(1).max(3000),
    selectionDeadline: z.string().datetime().nullable().optional(),
    expiresAt: z.string().datetime(),
    presentation: galleryPresentationSchema.optional(),
  })
  .strict();
export function newDelivery(input: z.infer<typeof newDeliveryInput>, now: string): DeliveryState {
  const parsed = newDeliveryInput.parse(input);
  if (
    Date.parse(parsed.expiresAt) <= Date.parse(now) ||
    Date.parse(parsed.expiresAt) > Date.parse(now) + 366 * 86400000
  )
    throw new Error("Choose an expiry within the next year.");
  // A device draft can finish connecting after its selection window closes.
  // Preserve that deadline instead of stranding its saved uploads. Client mutations
  // still fail closed; only an explicit owner extension can reopen the window.
  if (
    parsed.selectionDeadline &&
    Date.parse(parsed.selectionDeadline) > Date.parse(parsed.expiresAt)
  )
    throw new Error("The selection deadline must be no later than gallery expiry.");
  return {
    format: 1,
    title: parsed.title,
    clientName: parsed.clientName,
    message: parsed.message,
    selectionLimit: parsed.selectionLimit,
    ...(parsed.selectionDeadline !== undefined
      ? { selectionDeadline: parsed.selectionDeadline }
      : {}),
    expiresAt: parsed.expiresAt,
    status: "draft",
    ...(parsed.presentation ? { presentation: parsed.presentation } : {}),
    photos: [],
    picks: [],
    submissions: [],
    comments: [],
    approvals: [],
    releases: [],
    released: [],
    events: [],
    receipts: [],
  };
}

export const selectionRequestSchema = z
  .object({
    selectionLimit: z.number().int().min(1).max(3000),
    selectionDeadline: z.string().datetime().nullable(),
  })
  .strict();
export type SelectionRequest = z.infer<typeof selectionRequestSchema>;
export function selectionRequest(
  state: Pick<DeliveryState, "selectionLimit" | "selectionDeadline">,
): SelectionRequest {
  return {
    selectionLimit: state.selectionLimit,
    selectionDeadline: state.selectionDeadline ?? null,
  };
}
function validateSelectionDeadline(deadline: string | null, expiresAt: string, now: string) {
  if (
    deadline !== null &&
    (!Number.isFinite(Date.parse(deadline)) ||
      Date.parse(deadline) <= Date.parse(now) ||
      Date.parse(deadline) > Date.parse(expiresAt))
  )
    throw new Error("Choose a future selection deadline no later than the gallery expiry.");
}
export function selectionDeadlinePassed(state: DeliveryState, now: string): boolean {
  return (
    state.selectionDeadline != null && !(Date.parse(state.selectionDeadline) > Date.parse(now))
  );
}
export function validateSelectionRequest(
  state: DeliveryState,
  input: SelectionRequest,
  now: string,
) {
  const request = selectionRequestSchema.parse(input);
  if (selectionsLocked(state))
    throw new Error("Reopen submitted selections before changing the request.");
  if (request.selectionLimit < state.picks.length)
    throw new Error("The selection limit cannot be lower than the client's saved picks.");
  validateSelectionDeadline(request.selectionDeadline, state.expiresAt, now);
  return request;
}
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("selectionRequest"), request: selectionRequestSchema }).strict(),
  z.object({ type: z.literal("presentation"), presentation: galleryPresentationSchema }).strict(),
  z.object({ type: z.literal("reserve"), version: versionInput }).strict(),
  z
    .object({ type: z.literal("publish"), versionIds: z.array(deliveryId).min(1).max(3000) })
    .strict(),
  z.object({ type: z.literal("close") }).strict(),
  z.object({ type: z.literal("reopen"), expiresAt: z.string().datetime() }).strict(),
  z.object({ type: z.literal("pick"), photoId: deliveryId, on: z.boolean() }).strict(),
  z.object({ type: z.literal("submit"), photoIds: z.array(deliveryId).min(1).max(3000) }).strict(),
  z.object({ type: z.literal("reopenSelections") }).strict(),
  z
    .object({
      type: z.literal("comment"),
      versionId: deliveryId,
      body: z.string().trim().min(1).max(4000),
      revision: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal("resolve"), commentId: deliveryId }).strict(),
  z.object({ type: z.literal("approve"), versionId: deliveryId }).strict(),
  z
    .object({ type: z.literal("release"), versionIds: z.array(deliveryId).min(1).max(3000) })
    .strict(),
  z
    .object({
      type: z.literal("downloadHandoff"),
      versionIds: z.array(deliveryId).min(1).max(30),
      kind: z.enum(["phone", "full"]),
      container: z.enum(["file", "zip"]),
    })
    .strict(),
]);
export type DeliveryCommand = z.infer<typeof commandSchema>;
export type Actor = "owner" | "client";
const ownerCommands = new Set([
  "selectionRequest",
  "presentation",
  "reserve",
  "publish",
  "close",
  "reopen",
  "reopenSelections",
  "resolve",
  "release",
  "complete",
]);
const clientCommands = new Set(["pick", "submit", "approve", "downloadHandoff"]);

export function publishedVersion(photo: DeliveryPhoto): DeliveryVersion | undefined {
  return photo.versions.find((v) => v.id === photo.published && v.ready);
}
export function findVersion(state: DeliveryState, versionId: string) {
  const photo = state.photos.find((p) => p.versions.some((v) => v.id === versionId));
  const version = photo?.versions.find((v) => v.id === versionId);
  if (!photo || !version) throw new Error("Photo version not found in this gallery.");
  return { photo, version };
}
export function isOpen(state: DeliveryState, now: string): boolean {
  return state.status === "live" && Date.parse(state.expiresAt) > Date.parse(now);
}
export function unresolved(state: DeliveryState, photoId: string): DeliveryComment[] {
  return state.comments.filter((c) => c.photoId === photoId && c.revision && !c.resolvedAt);
}
export function isApproved(state: DeliveryState, versionId: string): boolean {
  const { photo, version } = findVersion(state, versionId);
  return (
    version.ready &&
    photo.published === versionId &&
    !unresolved(state, photo.id).length &&
    state.approvals.some((a) => a.versionId === versionId && !a.revokedAt)
  );
}
export function downloadable(state: DeliveryState, versionId: string, now: string): boolean {
  return isOpen(state, now) && state.released.includes(versionId) && isApproved(state, versionId);
}
export function objectPath(
  ownerId: string,
  galleryId: string,
  version: VersionInput,
  kind: VariantName,
): string {
  deliveryId.parse(ownerId);
  deliveryId.parse(galleryId);
  deliveryId.parse(version.id);
  hash.parse(version.variants[kind].sha256);
  return `${ownerId}/${galleryId}/${version.id}/${kind}-${version.variants[kind].sha256}.jpg`;
}

/** Deterministic transitions run only after server authentication. No client-supplied role or path. */
export function transition(
  before: DeliveryState,
  command: DeliveryCommand | { type: "complete"; versionId: string },
  actor: Actor,
  operationId: string,
  fingerprint: string,
  now: string,
): DeliveryState {
  deliveryId.parse(operationId);
  const receipt = before.receipts.find((r) => r.id === operationId);
  if (receipt) {
    if (receipt.fingerprint !== fingerprint)
      throw new Error("This operation ID was already used for a different request.");
    return before;
  }
  if (ownerCommands.has(command.type) && actor !== "owner")
    throw new Error("Only the photographer can do that.");
  if (clientCommands.has(command.type) && actor !== "client")
    throw new Error("This action belongs to the client.");
  if (actor === "client" && !isOpen(before, now)) throw new Error("This link is unavailable.");
  if (before.events.length >= 20000)
    throw new Error(
      "This gallery has reached its activity limit. Start a new delivery; existing history is preserved.",
    );
  const state = structuredClone(before);
  let text = "";
  switch (command.type) {
    case "selectionRequest": {
      Object.assign(state, validateSelectionRequest(state, command.request, now));
      text = "Selection request updated";
      break;
    }
    case "presentation":
      state.presentation = galleryPresentationSchema.parse(command.presentation);
      validateGalleryCovers(state, state.presentation);
      text = "Gallery presentation updated";
      break;
    case "reserve": {
      const v = versionInput.parse(command.version);
      if (state.photos.some((p) => p.versions.some((old) => old.id === v.id)))
        throw new Error("Version already exists. Resume its upload instead.");
      let photo = state.photos.find((p) => p.id === v.photoId);
      if (!photo) {
        if (state.photos.length >= 3000) throw new Error("A gallery supports up to 3,000 photos.");
        photo = { id: v.photoId, current: null, published: null, versions: [] };
        state.photos.push(photo);
      }
      if (photo.versions.length >= 30)
        throw new Error("A photo supports up to 30 immutable versions.");
      photo.versions.push({
        ...v,
        ready: false,
        createdAt: now,
        number: photo.versions.length + 1,
        publishedAt: null,
      });
      text = `Upload reserved: ${v.filename}`;
      break;
    }
    case "complete": {
      const { photo, version } = findVersion(state, command.versionId);
      if (version.ready) return before;
      version.ready = true;
      photo.current = [...photo.versions].reverse().find((v) => v.ready)!.id;
      text = `Upload verified: ${version.filename}`;
      break;
    }
    case "publish": {
      if (state.status === "closed" || Date.parse(state.expiresAt) <= Date.parse(now))
        throw new Error("Reopen this gallery with a future expiry first.");
      const photoIds = new Set<string>();
      for (const id of command.versionIds) {
        const { photo, version } = findVersion(state, id);
        if (!version.ready || photo.current !== id || photoIds.has(photo.id))
          throw new Error("Publish one current, verified version per photo.");
        photoIds.add(photo.id);
        if (photo.published !== id)
          state.released = state.released.filter(
            (old) => !photo.versions.some((v) => v.id === old),
          );
        photo.published = id;
        version.publishedAt ??= now;
      }
      state.status = "live";
      text = `${command.versionIds.length} photo versions published for review`;
      break;
    }
    case "close":
      state.status = "closed";
      text = "Gallery closed; new access disabled";
      break;
    case "reopen": {
      const expires = Date.parse(command.expiresAt);
      if (expires <= Date.parse(now) || expires > Date.parse(now) + 366 * 86400000)
        throw new Error("Choose an expiry within the next year.");
      state.expiresAt = command.expiresAt;
      state.status = state.photos.some((p) => p.published) ? "live" : "draft";
      text = "Gallery reopened with a new expiry";
      break;
    }
    case "pick": {
      if (selectionDeadlinePassed(state, now))
        throw new Error(
          "The selection deadline has passed. Ask your photographer to extend it; saved picks are preserved.",
        );
      const photo = state.photos.find((p) => p.id === command.photoId);
      if (!photo || !publishedVersion(photo))
        throw new Error("Only published photos can be selected.");
      if (selectionsLocked(state))
        throw new Error("Selections are submitted. Ask your photographer to reopen them.");
      state.picks = state.picks.filter((id) => id !== photo.id);
      if (command.on) state.picks.push(photo.id);
      if (state.picks.length > state.selectionLimit)
        throw new Error(`Choose up to ${state.selectionLimit} photos.`);
      text = command.on ? "Photo selected" : "Photo deselected";
      break;
    }
    case "submit": {
      if (selectionDeadlinePassed(state, now))
        throw new Error(
          "The selection deadline has passed. Ask your photographer to extend it; saved picks are preserved.",
        );
      if (selectionsLocked(state)) throw new Error("Selections are already submitted.");
      if (
        new Set(command.photoIds).size !== command.photoIds.length ||
        command.photoIds.length > state.selectionLimit
      )
        throw new Error("Invalid selection count.");
      if (
        command.photoIds.length !== state.picks.length ||
        command.photoIds.some((id) => !state.picks.includes(id))
      )
        throw new Error("Selections changed. Refresh before submitting.");
      const items = command.photoIds.map((id) => {
        const p = state.photos.find((photo) => photo.id === id);
        if (!p?.published) throw new Error("A selected photo is unavailable.");
        return { photoId: id, versionId: p.published };
      });
      state.submissions.push({ id: operationId, at: now, items });
      state.approvals = state.approvals.map((a) => ({ ...a, revokedAt: a.revokedAt ?? now }));
      state.released = [];
      text = `${items.length} selections submitted`;
      break;
    }
    case "reopenSelections":
      state.approvals = state.approvals.map((a) => ({ ...a, revokedAt: a.revokedAt ?? now }));
      state.released = [];
      text = "Selections reopened";
      break;
    case "comment": {
      const { photo, version } = findVersion(state, command.versionId);
      if (!version.ready || (actor === "client" && photo.published !== version.id))
        throw new Error("Refresh to comment on the published version.");
      if (command.revision && actor !== "client")
        throw new Error("Revision requests belong to the client; reply with a comment.");
      state.comments.push({
        id: operationId,
        versionId: version.id,
        photoId: photo.id,
        body: command.body,
        role: actor,
        at: now,
        revision: command.revision,
        resolvedAt: null,
      });
      if (command.revision) {
        state.approvals = state.approvals.map((a) =>
          photo.versions.some((v) => v.id === a.versionId)
            ? { ...a, revokedAt: a.revokedAt ?? now }
            : a,
        );
        state.released = state.released.filter((id) => !photo.versions.some((v) => v.id === id));
      }
      text = command.revision
        ? `Revision requested: ${version.filename}`
        : `Comment added: ${version.filename}`;
      break;
    }
    case "resolve": {
      const comment = state.comments.find((c) => c.id === command.commentId && c.revision);
      if (!comment) throw new Error("Revision request not found.");
      comment.resolvedAt = now;
      text = "Revision marked addressed; client approval still required";
      break;
    }
    case "approve": {
      const { photo, version } = findVersion(state, command.versionId);
      if (
        !selectionsLocked(state) ||
        !state.submissions.at(-1)?.items.some((i) => i.photoId === photo.id)
      )
        throw new Error("Submit your selections before approving a selected photo.");
      if (!version.ready || photo.published !== version.id || unresolved(state, photo.id).length)
        throw new Error(
          "This version is not ready for approval. Your photographer must address open revisions first.",
        );
      state.approvals = state.approvals.map((a) =>
        a.versionId === version.id ? { ...a, revokedAt: a.revokedAt ?? now } : a,
      );
      state.approvals.push({ versionId: version.id, at: now, revokedAt: null });
      text = `Exact version approved: ${version.filename}`;
      break;
    }
    case "release": {
      if (!isOpen(state, now)) throw new Error("Reopen the gallery before releasing finals.");
      if (!selectionsLocked(state)) throw new Error("Wait for submitted selections.");
      if (new Set(command.versionIds).size !== command.versionIds.length)
        throw new Error("Duplicate release versions.");
      for (const id of command.versionIds) {
        const { photo } = findVersion(state, id);
        if (
          !isApproved(state, id) ||
          !state.submissions.at(-1)?.items.some((i) => i.photoId === photo.id)
        )
          throw new Error(
            "Only the client's approved, selected, published versions can be released.",
          );
      }
      state.released = [...new Set([...state.released, ...command.versionIds])];
      state.releases.push({ id: operationId, at: now, versionIds: [...command.versionIds] });
      text = `${command.versionIds.length} approved finals released`;
      break;
    }
    case "downloadHandoff": {
      if (command.container === "file" && command.versionIds.length !== 1)
        throw new Error("An individual browser handoff must contain exactly one file.");
      if (new Set(command.versionIds).size !== command.versionIds.length)
        throw new Error("Duplicate versions cannot share a browser handoff receipt.");
      for (const versionId of command.versionIds) {
        if (!downloadable(state, versionId, now))
          throw new Error("Only currently released finals can record a browser handoff.");
      }
      const format = command.kind === "full" ? "high-resolution" : "phone";
      const noun = command.versionIds.length === 1 ? "copy" : "files";
      const container = command.container === "zip" ? " in a ZIP part" : "";
      text = `Browser handoff recorded: ${command.versionIds.length} ${format} ${noun}${container}; final save location not verified`;
      break;
    }
  }
  state.events.push({ id: operationId, at: now, role: actor, text });
  state.receipts.push({ id: operationId, fingerprint });
  return state;
}

export function selectionsLocked(state: DeliveryState): boolean {
  const submitted = state.submissions.at(-1);
  if (!submitted) return false;
  const submitIndex = state.events.findIndex((e) => e.id === submitted.id);
  return !state.events.slice(submitIndex + 1).some((e) => e.text === "Selections reopened");
}
export function nextAction(state: DeliveryState, actor: Actor, now: string): string {
  if (state.status === "closed" || Date.parse(state.expiresAt) <= Date.parse(now))
    return "Gallery closed";
  if (state.status === "draft") return "Review your photos, then publish the gallery";
  if (!selectionsLocked(state) && selectionDeadlinePassed(state, now))
    return actor === "owner"
      ? "Selection deadline passed · saved picks are preserved"
      : "Selection deadline passed · ask your photographer for an extension";
  if (!selectionsLocked(state))
    return actor === "owner"
      ? "Waiting for the client’s selections"
      : "Choose your favourites, then submit your selection";
  if (state.comments.some((c) => c.revision && !c.resolvedAt))
    return actor === "owner"
      ? "Address the client’s revision requests"
      : "Your photographer is working on your changes";
  const selected = state.submissions
    .at(-1)!
    .items.map((i) => state.photos.find((p) => p.id === i.photoId)?.published)
    .filter((id): id is string => !!id);
  if (selected.some((id) => !isApproved(state, id)))
    return actor === "owner"
      ? "Waiting for approval of the current edits"
      : "Review and approve each selected photo";
  if (selected.some((id) => !state.released.includes(id)))
    return actor === "owner"
      ? "Approved photos are ready to release"
      : "Approved — your photographer will release the finals";
  return actor === "owner"
    ? "Finals released · client downloads are available"
    : "Your photos are ready to download";
}

/** Never include unpublished media, object keys, source project IDs, or request fingerprints in a client DTO. */
export function clientState(state: DeliveryState): DeliveryState {
  const visible = state.photos
    .filter((p) => p.published)
    .map((p) => ({
      ...p,
      current: p.published,
      versions: p.versions
        .filter((v) => v.id === p.published)
        .map((v) => ({
          ...v,
          source: null,
          variants: {
            proof: { ...v.variants.proof, sha256: "" },
            phone: {
              ...v.variants.phone,
              sha256: state.released.includes(v.id) ? v.variants.phone.sha256 : "",
            },
            full: {
              ...v.variants.full,
              sha256: state.released.includes(v.id) ? v.variants.full.sha256 : "",
            },
          },
        })),
    }));
  const visibleComments = state.comments.filter((c) =>
    state.photos.some((p) => p.versions.some((v) => v.id === c.versionId && v.publishedAt)),
  );
  return {
    ...state,
    ...(state.presentation?.design
      ? {
          presentation: {
            ...state.presentation,
            design: {
              ...state.presentation.design,
              coverVersionIds: galleryCovers(state, "client").map((v) => v.id),
            },
          },
        }
      : {}),
    photos: visible,
    receipts: [],
    events: state.events.filter(
      (e) =>
        !e.text.startsWith("Upload ") &&
        (!state.comments.some((c) => c.id === e.id) || visibleComments.some((c) => c.id === e.id)),
    ),
    comments: visibleComments,
    approvals: state.approvals.filter((a) => visible.some((p) => p.published === a.versionId)),
  };
}
