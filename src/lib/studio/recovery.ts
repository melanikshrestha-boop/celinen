import type { Shot } from "@/lib/imaging";
import { createProjectArchive, PROJECT_ARCHIVE_LIMITS } from "@/lib/projects/archive";
import { newProject } from "@/lib/projects/model";
import { captureProject } from "@/lib/projects/studio-adapter";
import type { StudioFilter } from "./session";

/** Exports the visible snapshot under a NEW identity. Never reads or writes stored projects. */
export async function createShootRecovery(
  shots: readonly Shot[],
  selectedId: string | null,
  filter: StudioFilter,
) {
  if (!shots.length) throw new Error("There are no photos in this tab to back up.");
  const snapshot = shots.map((shot) => ({
    ...shot,
    edits: { ...shot.edits },
    flags: [...shot.flags],
    ...(shot.develop ? { develop: { ...shot.develop } } : {}),
  }));
  // Reject oversized sources before hashing; never silently omit originals.
  const blobs = new Set(
    snapshot.flatMap((shot) => [
      ...(shot.sourceAvailable !== false && shot.file.size ? [shot.file] : []),
      ...(shot.previewBlob ? [shot.previewBlob] : []),
    ]),
  );
  for (const blob of blobs)
    if (blob.size > PROJECT_ARCHIVE_LIMITS.blobBytes)
      throw new Error(
        "A source exceeds the 128 MiB recovery-file limit. Keep this tab and your source folder open; nothing was replaced.",
      );
  if ([...blobs].reduce((sum, blob) => sum + blob.size, 0) > PROJECT_ARCHIVE_LIMITS.archiveBytes)
    throw new Error(
      "This shoot exceeds the 256 MiB recovery-file limit. Keep this tab open and retain your source folder; nothing was replaced.",
    );
  const project = newProject({
    title: "Recovered shoot",
    genre: "personal",
    brief:
      "Recovery of the visible photos, picks and applied edits. Pending previews and chat are not included.",
    clientId: null,
    bookingId: null,
    invoiceIds: [],
    galleryIds: [],
  });
  const captured = await captureProject(project, snapshot, selectedId, filter);
  return createProjectArchive(captured.project, captured.blobs);
}
