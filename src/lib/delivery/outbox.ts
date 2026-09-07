import { decodeFile, DEFAULT_EDITS, renderToCanvas, type Edits } from "@/lib/imaging";
import { hashBlob } from "@/lib/projects/archive";
import { idbRequest } from "@/lib/projects/repository";
import {
  newDelivery,
  transition,
  versionInput,
  variantNames,
  safeDeliveryFilename,
  type DeliveryState,
  type VersionInput,
  type VariantName,
} from "./workflow";
import {
  changePrivateDelivery,
  createPrivateDelivery,
  getPrivateDelivery,
  getPrivateUploadTickets,
  verifyPrivateUpload,
} from "./remote.functions";
import { supabase } from "@/integrations/supabase/client";
import { assertSameAccount, nextPreparedAt, visibleToAccount } from "./account-boundary";
import {
  galleryPresentationSchema,
  sameGalleryPresentation,
  type GalleryPresentation,
} from "./gallery-presentation";

export type Draft = {
  id: string;
  state: DeliveryState;
  createdAt: string;
  synced: boolean;
  connecting?: boolean;
  ownerId?: string | null;
};
export type UploadJob = {
  ownerId?: string | null;
  id: string;
  galleryId: string;
  version: VersionInput;
  files: Record<VariantName, Blob>;
  uploaded: VariantName[];
  status: "queued" | "uploading" | "failed" | "ready";
  error: string | null;
  operationId: string;
  preparedAt: number;
};
async function open() {
  const req = indexedDB.open("lenslabs-delivery-outbox-v1", 1);
  req.onupgradeneeded = () => {
    req.result.createObjectStore("drafts", { keyPath: "id" });
    req.result
      .createObjectStore("uploads", { keyPath: "id" })
      .createIndex("galleryId", "galleryId");
  };
  const db = await idbRequest(req);
  db.onversionchange = () => db.close();
  return db;
}
async function put(store: "drafts" | "uploads", value: Draft | UploadJob) {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        store === "uploads" ? ["uploads", "drafts"] : ["drafts"],
        "readwrite",
      );
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () =>
        reject(
          tx.error ??
            new Error(
              "Local progress could not be saved. Remote work may have completed; refresh before retrying.",
            ),
        );
      const records = tx.objectStore(store);
      const request = records.get(value.id);
      request.onsuccess = () => {
        const old = request.result as Draft | UploadJob | undefined;
        if (old && old.ownerId !== value.ownerId) {
          tx.abort();
          return;
        }
        if (store === "uploads") {
          const parent = tx.objectStore("drafts").get((value as UploadJob).galleryId);
          parent.onsuccess = () => {
            const draft = parent.result as Draft | undefined;
            // A different tab may have claimed this device draft during image rendering.
            if (draft && draft.ownerId !== value.ownerId) {
              tx.abort();
              return;
            }
            records.put(value);
          };
        } else {
          // Job refreshes must not overwrite presentation saved in another tab.
          const previous = old as Draft | undefined;
          const next = value as Draft;
          records.put(
            previous
              ? {
                  ...next,
                  connecting: previous.connecting || next.connecting,
                  state: { ...next.state, presentation: previous.state.presentation },
                }
              : next,
          );
        }
      };
    });
  } finally {
    db.close();
  }
}
export const saveDraft = (draft: Draft) => put("drafts", draft);
export async function saveDraftPresentation(
  id: string,
  ownerId: string | null,
  expected: GalleryPresentation,
  input: GalleryPresentation,
): Promise<Draft> {
  const presentation = galleryPresentationSchema.parse(input);
  const db = await open();
  try {
    return await new Promise<Draft>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      let updated: Draft;
      let failure = "Presentation could not be saved. Your gallery has not been changed.";
      tx.oncomplete = () => resolve(updated);
      tx.onerror = tx.onabort = () => reject(new Error(failure));
      const records = tx.objectStore("drafts");
      const request = records.get(id);
      request.onsuccess = () => {
        const draft = request.result as Draft | undefined;
        if (!draft || draft.ownerId !== ownerId || draft.synced || draft.connecting) {
          failure =
            "This draft is connecting or belongs to another account. In the original account, retry Connect & upload to recover its connection, then edit the connected gallery. Saved photos are preserved.";
          tx.abort();
          return;
        }
        if (!sameGalleryPresentation(draft.state, { presentation: expected })) {
          failure = "Presentation changed in another tab. Reopen this gallery before saving.";
          tx.abort();
          return;
        }
        updated = { ...draft, state: { ...draft.state, presentation } };
        records.put(updated);
      };
    });
  } finally {
    db.close();
  }
}
export const saveJob = (job: UploadJob) => put("uploads", job);
export async function listDrafts(ownerId: string | null): Promise<Draft[]> {
  const db = await open();
  try {
    const drafts: Draft[] = await idbRequest(
      db.transaction("drafts").objectStore("drafts").getAll(),
    );
    return drafts.filter((draft) => visibleToAccount(draft, ownerId));
  } finally {
    db.close();
  }
}
export async function listUploadJobs(
  galleryId: string,
  ownerId: string | null,
): Promise<UploadJob[]> {
  const db = await open();
  try {
    const tx = db.transaction(["uploads", "drafts"]);
    const [jobs, draft]: [UploadJob[], Draft | undefined] = await Promise.all([
      idbRequest(tx.objectStore("uploads").index("galleryId").getAll(galleryId)),
      idbRequest(tx.objectStore("drafts").get(galleryId)),
    ]);
    if (draft && !visibleToAccount(draft, ownerId)) return [];
    return jobs
      .filter((job) => visibleToAccount(job, ownerId) && (!draft || job.ownerId === draft.ownerId))
      .sort(
        (a, b) =>
          (Number.isFinite(a.preparedAt) ? a.preparedAt : 0) -
            (Number.isFinite(b.preparedAt) ? b.preparedAt : 0) || a.id.localeCompare(b.id),
      );
  } finally {
    db.close();
  }
}
export async function createDraft(
  input: Parameters<typeof newDelivery>[0],
  ownerId: string | null,
) {
  const createdAt = new Date().toISOString();
  const state = newDelivery(input, createdAt);
  const existing = (await listDrafts(ownerId)).find((d) => d.id === input.id);
  if (existing) {
    if (
      existing.state.title !== state.title ||
      existing.state.clientName !== state.clientName ||
      existing.state.message !== state.message ||
      existing.state.expiresAt !== state.expiresAt ||
      existing.state.selectionLimit !== state.selectionLimit ||
      !sameGalleryPresentation(existing.state, state)
    )
      throw new Error(
        "This draft already exists with different details. Open it instead; no previous work was overwritten.",
      );
    return existing;
  }
  const draft = { id: input.id, state, createdAt, synced: false, ownerId };
  await saveDraft(draft);
  return draft;
}
function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not render this image."))),
      "image/jpeg",
      quality,
    ),
  );
}
/** Reuse LensLabs' existing non-destructive renderer. Originals and RAW files are never uploaded. */
export async function prepareUpload(
  galleryId: string,
  file: File,
  options: {
    ownerId: string | null;
    photoId?: string;
    source?: VersionInput["source"];
    edits?: Edits;
    focus?: { x: number; y: number } | null;
  },
): Promise<UploadJob> {
  if (!file.size || file.size > 150 * 1024 * 1024)
    throw new Error(`${file.name}: use a photo under 150 MB.`);
  if (!options.source && !/\.(jpe?g|png|webp)$/i.test(file.name))
    throw new Error(`${file.name}: export a JPEG, PNG, or WebP first. Import RAW through Studio.`);
  const bitmap = await decodeFile(file, 4800);
  try {
    const files = {} as Record<VariantName, Blob>;
    const variants = {} as VersionInput["variants"];
    for (const kind of variantNames) {
      const canvas = document.createElement("canvas");
      renderToCanvas(
        canvas,
        bitmap,
        options.edits ?? DEFAULT_EDITS,
        kind === "proof" ? 1600 : kind === "phone" ? 2048 : 4800,
        options.focus ?? null,
      );
      const blob = await canvasBlob(canvas, kind === "proof" ? 0.84 : 0.94);
      files[kind] = blob;
      variants[kind] = {
        sha256: await hashBlob(blob),
        bytes: blob.size,
        width: canvas.width,
        height: canvas.height,
      };
      canvas.width = canvas.height = 0;
    }
    const version = versionInput.parse({
      id: crypto.randomUUID(),
      photoId: options.photoId ?? crypto.randomUUID(),
      filename: safeDeliveryFilename(file.name.replace(/\.[^.]+$/, "")).slice(0, 230) + ".jpg",
      source: options.source ?? null,
      variants,
    });
    const previous = await listUploadJobs(galleryId, options.ownerId);
    const preparedAt = nextPreparedAt(previous);
    const job: UploadJob = {
      id: version.id,
      galleryId,
      ownerId: options.ownerId,
      version,
      files,
      uploaded: [],
      status: "queued",
      error: null,
      operationId: crypto.randomUUID(),
      preparedAt,
    };
    // Persist bytes BEFORE network work. A refresh can resume the same immutable reservation.
    await saveJob(job);
    return job;
  } finally {
    bitmap.close();
  }
}
export function draftWithJobs(draft: Draft, jobs: UploadJob[]): Draft {
  let state = draft.state;
  for (const job of jobs) {
    if (state.photos.some((p) => p.versions.some((v) => v.id === job.id))) continue;
    state = transition(
      state,
      { type: "reserve", version: job.version },
      "owner",
      job.operationId,
      `local:${job.id}`,
      draft.createdAt,
    );
    state = transition(
      state,
      { type: "complete", versionId: job.id },
      "owner",
      job.id,
      `local-verified:${job.id}`,
      draft.createdAt,
    );
  }
  return { ...draft, state };
}
export async function uploadJob(
  job: UploadJob,
  onChange: (job: UploadJob) => void,
  ensureActive: () => void,
) {
  const checkAccount = async () => {
    ensureActive();
    if (!job.ownerId)
      throw new Error("Connect this device draft to your account before uploading.");
    const { data } = await supabase.auth.getSession();
    ensureActive();
    assertSameAccount(job.ownerId, data.session?.user.id ?? null);
  };
  await checkAccount();
  let current: UploadJob = { ...job, status: "uploading", error: null };
  const persist = async () => {
    await saveJob(current);
    onChange(current);
  };
  await persist();
  try {
    let room = await getPrivateDelivery({ data: { id: job.galleryId } });
    await checkAccount();
    if (!room.state.photos.some((p) => p.versions.some((v) => v.id === job.id))) {
      room = await changePrivateDelivery({
        data: {
          id: job.galleryId,
          revision: room.revision,
          operationId: job.operationId,
          command: { type: "reserve", version: job.version },
        },
      });
    }
    if (!room.state.photos.some((p) => p.versions.some((v) => v.id === job.id && v.ready))) {
      await checkAccount();
      const result = await getPrivateUploadTickets({
        data: { id: job.galleryId, versionId: job.id },
      });
      for (const ticket of result.tickets) {
        // Only the server decides what is missing; device progress may be stale.
        await checkAccount();
        const blob = current.files[ticket.kind];
        if ((await hashBlob(blob)) !== current.version.variants[ticket.kind].sha256)
          throw new Error(
            "The saved upload checksum failed. Re-export this photo; the previous version is unchanged.",
          );
        await checkAccount();
        const { error } = await supabase.storage
          .from("delivery-private-v1")
          .uploadToSignedUrl(ticket.path, ticket.token, blob, {
            contentType: "image/jpeg",
            cacheControl: "120",
          });
        // A lost success response can leave an existing immutable object. Server verification is authoritative.
        if (
          error &&
          !["409", "ResourceAlreadyExists", "Duplicate"].includes(
            String((error as { statusCode?: string }).statusCode),
          )
        )
          throw new Error(`${ticket.kind}: upload interrupted. Retry this photo.`);
        if (!error) {
          current = { ...current, uploaded: [...current.uploaded, ticket.kind] };
          await persist();
        }
      }
    }
    await checkAccount();
    const verified = await verifyPrivateUpload({ data: { id: job.galleryId, versionId: job.id } });
    current = { ...current, status: "ready", uploaded: [...variantNames], error: null };
    await persist();
    return verified;
  } catch (error) {
    current = {
      ...current,
      status: "failed",
      error: error instanceof Error ? error.message : "Upload interrupted. Retry this photo.",
    };
    await persist();
    throw error;
  }
}
export async function connectDraft(draft: Draft, ownerId: string, ensureActive: () => void) {
  ensureActive();
  const { data } = await supabase.auth.getSession();
  ensureActive();
  assertSameAccount(ownerId, data.session?.user.id ?? null);
  draft = await claimDraft(draft.id, ownerId);
  ensureActive();
  const room = await createPrivateDelivery({
    data: {
      ownerId,
      id: draft.id,
      title: draft.state.title,
      clientName: draft.state.clientName,
      message: draft.state.message,
      expiresAt: draft.state.expiresAt,
      selectionLimit: draft.state.selectionLimit,
      presentation: draft.state.presentation,
    },
  });
  await saveDraft({ ...draft, synced: true, ownerId });
  return room;
}

/** Explicit Connect action: atomically bind the draft and all its bytes before network work. */
async function claimDraft(id: string, ownerId: string) {
  const db = await open();
  try {
    return await new Promise<Draft>((resolve, reject) => {
      const tx = db.transaction(["drafts", "uploads"], "readwrite");
      let claimed: Draft;
      tx.oncomplete = () => resolve(claimed);
      tx.onerror = tx.onabort = () =>
        reject(
          new Error(
            "This draft cannot be connected to this account. Its saved files are preserved.",
          ),
        );
      const drafts = tx.objectStore("drafts"),
        uploads = tx.objectStore("uploads");
      const request = drafts.get(id);
      request.onsuccess = () => {
        const draft = request.result as Draft | undefined;
        if (!draft || (draft.ownerId !== null && draft.ownerId !== ownerId)) {
          tx.abort();
          return;
        }
        const jobs = uploads.index("galleryId").getAll(id);
        jobs.onsuccess = () => {
          const saved = jobs.result as UploadJob[];
          if (saved.some((job) => job.ownerId !== null && job.ownerId !== ownerId)) {
            tx.abort();
            return;
          }
          claimed = { ...draft, ownerId, connecting: true };
          drafts.put(claimed);
          for (const job of saved) uploads.put({ ...job, ownerId });
        };
      };
    });
  } finally {
    db.close();
  }
}
