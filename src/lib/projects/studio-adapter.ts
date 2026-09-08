import { type Shot, type Edits } from "@/lib/imaging";
import type { HydratedStudioSession, StudioFilter } from "@/lib/studio/session";
import { hashBlob } from "./archive";
import {
  activity,
  now,
  PROCESSOR_VERSION,
  shotMetadata,
  projectSchema,
  validateProject,
  type Project,
  type ProjectFrame,
} from "./model";
import { commitProject, loadProject, readProjectBlobs } from "./repository";
import {
  verifyStudioHandoff,
  type DeliveryFocus,
  type StudioHandoff,
} from "@/lib/delivery/studio-handoff";

const digestCache = new WeakMap<Blob, Promise<string>>();
async function cachedHash(blob: Blob) {
  let pending = digestCache.get(blob);
  if (!pending) {
    pending = hashBlob(blob);
    digestCache.set(blob, pending);
  }
  return pending;
}
export async function versionId(assetId: string, edits: Edits): Promise<string> {
  return `edit:${await cachedHash(new Blob([JSON.stringify([assetId, PROCESSOR_VERSION, edits])]))}`;
}

export async function captureProject(
  project: Project,
  shots: readonly Shot[],
  selectedId: string | null,
  filter: StudioFilter,
  progress?: (done: number, total: number) => void,
): Promise<{ project: Project; blobs: Map<string, Blob> }> {
  const previous = new Map(project.frames.map((frame) => [frame.id, frame]));
  const shotIds = new Set(shots.map((shot) => shot.id));
  if (shotIds.size !== shots.length)
    throw new Error("Repeated source identifiers; no project was saved.");
  if (project.frames.some((frame) => !shotIds.has(frame.id)))
    throw new Error("Saving cannot remove existing project frames.");
  const blobs = new Map<string, Blob>();
  const frames: ProjectFrame[] = [];
  const editVersions = [...project.editVersions];
  const versions = new Set(editVersions.map((version) => version.id));
  const decisions = [...project.decisions];
  let changed = false;
  for (const [index, shot] of shots.entries()) {
    const old = previous.get(shot.id);
    let originalBlobId = old?.originalBlobId ?? null;
    if (shot.sourceAvailable !== false && shot.file.size > 0) {
      const incoming = await cachedHash(shot.file);
      if (originalBlobId && incoming !== originalBlobId)
        throw new Error(
          `${shot.name}: source bytes changed. The previous original and edits were preserved.`,
        );
      if (!originalBlobId) blobs.set(incoming, shot.file);
      originalBlobId = incoming;
    }
    let previewBlobId = old?.previewBlobId ?? null;
    if (shot.previewBlob) {
      previewBlobId = await cachedHash(shot.previewBlob);
      if (old?.previewBlobId !== previewBlobId) blobs.set(previewBlobId, shot.previewBlob);
    }
    const assetId =
      old?.assetId ??
      (originalBlobId ? `sha256:${originalBlobId}` : `unverified:${crypto.randomUUID()}`);
    const metadata = shotMetadata(shot);
    const currentVersionId =
      old && JSON.stringify(old.metadata.edits) === JSON.stringify(shot.edits)
        ? old.currentVersionId
        : await versionId(assetId, shot.edits);
    if (!versions.has(currentVersionId)) {
      editVersions.push({
        id: currentVersionId,
        assetId,
        edits: { ...shot.edits },
        processor: PROCESSOR_VERSION,
        actorId: "local-photographer",
        createdAt: now(),
        basis: old ? "photographer-saved" : "imported",
      });
      versions.add(currentVersionId);
    }
    if (!old || old.metadata.verdict !== shot.verdict)
      decisions.push({
        id: crypto.randomUUID(),
        frameId: shot.id,
        versionId: currentVersionId,
        from: old?.metadata.verdict ?? null,
        to: shot.verdict,
        actorId: old ? "local-photographer" : "source-import",
        at: now(),
        reversible: true,
      });
    const frame: ProjectFrame = projectSchema.shape.frames.element.parse({
      id: shot.id,
      assetId,
      originalBlobId,
      previewBlobId,
      metadata,
      currentVersionId,
      originalName: old?.originalName ?? shot.name,
      originalType:
        old?.originalBlobId || shot.sourceAvailable === false
          ? (old?.originalType ?? "application/octet-stream")
          : shot.file.type,
      originalModifiedAt:
        old?.originalBlobId || shot.sourceAvailable === false
          ? (old?.originalModifiedAt ?? 0)
          : shot.file.lastModified,
    });
    if (!old || JSON.stringify(old) !== JSON.stringify(frame)) changed = true;
    frames.push(frame);
    progress?.(index + 1, shots.length);
  }
  return {
    project: validateProject({
      ...project,
      frames,
      editVersions,
      decisions,
      selectedId,
      filter,
      activity: changed
        ? [
            ...project.activity,
            activity(
              "Studio checkpoint",
              `${frames.length} frames; ${frames.filter((frame) => frame.originalBlobId).length} original representations stored.`,
            ),
          ]
        : project.activity,
    }),
    blobs,
  };
}

export async function hydrateProject(
  project: Project,
  supplied?: ReadonlyMap<string, Blob>,
): Promise<HydratedStudioSession> {
  const blobs = supplied ?? (await readProjectBlobs(project));
  const urls: string[] = [];
  try {
    const shots: Shot[] = project.frames.map((frame) => {
      const original = frame.originalBlobId ? blobs.get(frame.originalBlobId) : null;
      const preview = frame.previewBlobId ? blobs.get(frame.previewBlobId) : null;
      if ((frame.originalBlobId && !original) || (frame.previewBlobId && !preview))
        throw new Error("Missing project media; the saved project was not replaced.");
      const previewUrl = preview ? URL.createObjectURL(preview) : null;
      if (previewUrl) urls.push(previewUrl);
      return {
        ...frame.metadata,
        id: frame.id,
        name: frame.originalName,
        sourceAvailable: Boolean(original),
        previewUrl,
        ...(preview ? { previewBlob: preview } : {}),
        file: new File(
          original ? [original] : preview ? [preview] : [],
          original ? frame.originalName : `${frame.originalName}.preview.jpg`,
          {
            type: original ? frame.originalType : "image/jpeg",
            lastModified: original ? frame.originalModifiedAt : 0,
          },
        ),
      } as Shot;
    });
    return {
      shots,
      selectedId: project.selectedId,
      filter: project.filter,
      updatedAt: Date.parse(project.updatedAt),
    };
  } catch (error) {
    for (const url of urls) URL.revokeObjectURL(url);
    throw error;
  }
}

/** One controller per mounted project: no legacy session globals or stores are touched. */
export class ProjectStudioSession {
  private document: Project | null = null;
  private loading: Promise<Project> | null = null;
  private queue: Promise<void> = Promise.resolve();
  constructor(
    readonly projectId: string,
    readonly deliveryFocus?: DeliveryFocus,
  ) {}
  deliveryReference(handoff: StudioHandoff) {
    if (!this.document || !this.deliveryFocus)
      throw new Error("Open the source project before viewing client feedback.");
    return verifyStudioHandoff(this.document, handoff, this.deliveryFocus);
  }
  async load() {
    // Strict Mode may start two hydration effects. Read one revision, then give
    // each caller its own disposable URLs without resetting an active writer.
    this.loading ??= loadProject(this.projectId);
    const initial = await this.loading;
    this.document ??= initial;
    if (this.deliveryFocus) {
      const frame = this.document.frames.find((f) => f.id === this.deliveryFocus!.frameId);
      if (
        !frame?.originalBlobId ||
        !this.document.editVersions.some(
          (v) => v.id === this.deliveryFocus!.versionId && v.assetId === frame.assetId,
        )
      )
        throw new Error(
          "The delivery source frame/version is unavailable. Reconnect its original project.",
        );
    }
    const session = await hydrateProject(this.document);
    return this.deliveryFocus
      ? { ...session, selectedId: this.deliveryFocus.frameId, filter: "all" as const }
      : session;
  }
  save(shots: Shot[], selectedId: string | null, filter: StudioFilter): Promise<void> {
    const snapshot = shots.map((shot) => ({
      ...shot,
      edits: { ...shot.edits },
      flags: [...shot.flags],
    }));
    const next = this.queue
      .catch(() => {})
      .then(async () => {
        if (!this.document) throw new Error("Open the project successfully before saving.");
        const captured = await captureProject(this.document, snapshot, selectedId, filter);
        this.document = await commitProject(captured.project, captured.blobs);
      });
    this.queue = next;
    return next;
  }
  async flush() {
    await this.queue;
  }
}
