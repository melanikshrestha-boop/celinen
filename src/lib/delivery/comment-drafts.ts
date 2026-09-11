import { z } from "zod";
import { deliveryId, type DeliveryComment } from "./workflow";

// Temporary, tab-local composition only. The server remains authoritative for sent comments.
const draftSchema = z
  .object({
    photoId: deliveryId,
    body: z.string().max(4000),
    revision: z.boolean(),
    operationId: deliveryId,
  })
  .strict();
export type CommentDraft = z.infer<typeof draftSchema>;
export type CommentDrafts = Record<string, CommentDraft>;
const envelope = z
  .object({
    format: z.literal(1),
    scope: z.string().max(100),
    entries: z.array(z.object({ versionId: deliveryId, draft: draftSchema }).strict()).max(128),
  })
  .strict();
const MAX_SERIALIZED = 1024 * 1024;
const PREFIX = "lenslabs.delivery-comment-drafts.v1:";
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function commentDraftScope(galleryId: string, generation: string | null) {
  deliveryId.parse(galleryId);
  if (generation !== null) deliveryId.parse(generation);
  return `${galleryId}:${generation ?? "initial"}`;
}

export function readCommentDrafts(storage: DraftStorage, scope: string): CommentDrafts {
  const raw = storage.getItem(PREFIX + scope);
  if (!raw) return {};
  if (raw.length > MAX_SERIALIZED) throw new Error("Saved notes are too large to restore.");
  const value = envelope.parse(JSON.parse(raw));
  if (value.scope !== scope) throw new Error("Saved notes belong to another invitation.");
  if (new Set(value.entries.map((entry) => entry.versionId)).size !== value.entries.length)
    throw new Error("Saved notes contain conflicting versions.");
  return Object.fromEntries(value.entries.map(({ versionId, draft }) => [versionId, draft]));
}

export function saveCommentDrafts(storage: DraftStorage, scope: string, drafts: CommentDrafts) {
  const entries = Object.entries(drafts).map(([versionId, draft]) => ({ versionId, draft }));
  const value = envelope.parse({ format: 1, scope, entries });
  const raw = JSON.stringify(value);
  if (raw.length > MAX_SERIALIZED) throw new Error("Notes exceed this tab’s recovery limit.");
  if (entries.length) storage.setItem(PREFIX + scope, raw);
  else storage.removeItem(PREFIX + scope);
}

export function updateCommentDraft(
  drafts: CommentDrafts,
  versionId: string,
  photoId: string,
  patch: Partial<Pick<CommentDraft, "body" | "revision">>,
): CommentDrafts {
  deliveryId.parse(versionId);
  const old = drafts[versionId];
  if (old && old.photoId !== photoId) throw new Error("This note belongs to another photo.");
  const body = patch.body ?? old?.body ?? "";
  const revision = patch.revision ?? old?.revision ?? false;
  if (old?.body === body && old.revision === revision) return drafts;
  const draft = draftSchema.parse({ photoId, body, revision, operationId: crypto.randomUUID() });
  const next = { ...drafts, [versionId]: draft };
  if (!body && !revision) delete next[versionId];
  return next;
}

/** A version change never silently retargets a note; the client explicitly carries it forward. */
export function moveCommentDraft(drafts: CommentDrafts, from: string, to: string, photoId: string) {
  deliveryId.parse(to);
  const old = drafts[from];
  if (!old || from === to) return drafts;
  if (old.photoId !== photoId || (drafts[to] && drafts[to]!.photoId !== photoId))
    throw new Error("A note cannot move to a different photo.");
  if (drafts[to]?.body.trim()) throw new Error("The new version already has an unsent note.");
  const next = { ...drafts, [to]: { ...old, operationId: crypto.randomUUID() } };
  delete next[from];
  return next;
}

/** A late success must not clear text or a change-request checkbox edited while sending. */
export function acknowledgeCommentDraft(
  drafts: CommentDrafts,
  versionId: string,
  operationId: string,
) {
  if (drafts[versionId]?.operationId !== operationId) return drafts;
  const next = { ...drafts };
  delete next[versionId];
  return next;
}

/** Reconcile a lost response by its exact receipt, never by matching text alone. */
export function reconcileCommentDrafts(
  drafts: CommentDrafts,
  comments: DeliveryComment[],
  role: "owner" | "client",
) {
  let next = drafts;
  for (const comment of comments) {
    const draft = next[comment.versionId];
    if (
      draft &&
      comment.role === role &&
      comment.id === draft.operationId &&
      comment.photoId === draft.photoId &&
      comment.body === draft.body.trim() &&
      comment.revision === draft.revision
    )
      next = acknowledgeCommentDraft(next, comment.versionId, comment.id);
  }
  return next;
}
