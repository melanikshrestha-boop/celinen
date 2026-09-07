import { decodeFile, renderToCanvas } from "@/lib/imaging";
import { hashBlob } from "./archive";
import { activity, now, validateProject, type Project } from "./model";
import { hydrateProject } from "./studio-adapter";
import { commitProject, readProjectBlobs } from "./repository";
import { makeZip } from "@/lib/zip";

export async function prepareProjectProof(
  project: Project,
  progress: (done: number, total: number) => void,
): Promise<Project> {
  const keepers = project.frames.filter(
    (frame) => frame.metadata.verdict === "keep" && !frame.metadata.error,
  );
  if (!keepers.length) throw new Error("Choose some keepers in Studio first.");
  if (keepers.length > 200)
    throw new Error(
      "This release supports up to 200 keepers per proof set. Smaller first deliveries are supported; large proof jobs are a release gate.",
    );
  const session = await hydrateProject(project);
  const shots = new Map(session.shots.map((shot) => [shot.id, shot]));
  const blobs = new Map<string, Blob>();
  const items: Project["proofs"][number]["items"] = [];
  try {
    for (const [i, frame] of keepers.entries()) {
      const shot = shots.get(frame.id)!;
      const bitmap = await decodeFile(shot.file, 1800);
      try {
        const canvas = document.createElement("canvas");
        renderToCanvas(canvas, bitmap, frame.metadata.edits, 1600, shot.faces?.center ?? null);
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) => (value ? resolve(value) : reject(new Error("Could not render proof."))),
            "image/jpeg",
            0.92,
          ),
        );
        const blobId = await hashBlob(blob);
        blobs.set(blobId, blob);
        items.push({
          frameId: frame.id,
          assetId: frame.assetId,
          versionId: frame.currentVersionId,
          blobId,
          width: canvas.width,
          height: canvas.height,
        });
        progress(i + 1, keepers.length);
      } finally {
        bitmap.close();
      }
    }
    const proof = {
      id: crypto.randomUUID(),
      title: `Proof ${project.proofs.length + 1}`,
      createdAt: now(),
      state: "device-local" as const,
      items,
    };
    return commitProject(
      validateProject({
        ...project,
        proofs: [...project.proofs, proof],
        activity: [
          ...project.activity,
          activity(
            "Proof prepared",
            `${items.length} frozen JPEG versions; device-local, not published.`,
          ),
        ],
      }),
      blobs,
    );
  } finally {
    for (const shot of session.shots) if (shot.previewUrl) URL.revokeObjectURL(shot.previewUrl);
  }
}

export function addOfflineFeedback(
  project: Project,
  input: Pick<
    Project["feedback"][number],
    "proofId" | "frameId" | "versionId" | "choice" | "comment" | "reviewer"
  >,
): Project {
  return validateProject({
    ...project,
    feedback: [
      ...project.feedback,
      {
        ...input,
        id: crypto.randomUUID(),
        actorId: "local-photographer",
        recordedBy: "photographer",
        at: now(),
      },
    ],
    activity: [
      ...project.activity,
      activity(
        "Feedback recorded",
        `${input.choice} recorded by photographer for an exact proof version.`,
      ),
    ],
  });
}

export function approvedProofItems(project: Project, proofId: string) {
  const proof = project.proofs.find((entry) => entry.id === proofId);
  if (!proof) throw new Error("Proof not found.");
  return proof.items.filter(
    (item) =>
      [...project.feedback]
        .reverse()
        .find(
          (entry) =>
            entry.proofId === proofId &&
            entry.frameId === item.frameId &&
            entry.versionId === item.versionId,
        )?.choice === "approve",
  );
}

export async function prepareApprovedProofDownload(
  project: Project,
  proofId: string,
): Promise<{ blob: Blob; project: Project }> {
  const items = approvedProofItems(project, proofId);
  if (!items.length) throw new Error("Record approval for at least one exact proof version first.");
  const blobs = await readProjectBlobs(project);
  const total = items.reduce((sum, item) => sum + (blobs.get(item.blobId)?.size ?? 0), 0);
  if (total > 100 * 1024 * 1024)
    throw new Error("Proof download exceeds this browser release's 100 MiB ZIP limit.");
  const manifest = {
    version: 1,
    projectId: project.id,
    proofId,
    scope: "approved-proof-jpeg",
    state: "download-prepared",
    createdAt: now(),
    items: items.map((item, i) => ({
      ...item,
      file: `proof-${i + 1}.jpg`,
      approval: [...project.feedback]
        .reverse()
        .find(
          (entry) =>
            entry.proofId === proofId &&
            entry.frameId === item.frameId &&
            entry.versionId === item.versionId,
        ),
    })),
  };
  const entries = [{ path: "manifest.json", text: JSON.stringify(manifest, null, 2) }];
  const binary: { path: string; bytes: Uint8Array }[] = [];
  for (const [i, item] of items.entries()) {
    const media = blobs.get(item.blobId);
    if (!media || (await hashBlob(media)) !== item.blobId)
      throw new Error("Proof checksum failed; download was not prepared.");
    binary.push({ path: `proof-${i + 1}.jpg`, bytes: new Uint8Array(await media.arrayBuffer()) });
  }
  const blob = makeZip([...entries, ...binary]);
  const updated = validateProject({
    ...project,
    exports: [
      ...project.exports,
      {
        id: crypto.randomUUID(),
        proofId,
        versionIds: [...new Set(items.map((item) => item.versionId))],
        at: now(),
        state: "download-prepared",
        kind: "proof-jpeg",
      },
    ],
    activity: [
      ...project.activity,
      activity(
        "Proof download prepared",
        `${items.length} exact approved JPEG versions. Browser download is not external delivery confirmation.`,
      ),
    ],
  });
  return { blob, project: await commitProject(updated) };
}
