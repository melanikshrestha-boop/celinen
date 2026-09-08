import { baseName, type Flag, type Shot, type Verdict } from "../imaging";

/** Photographer cull, not a client favorite. Favorites happen later on keepers only. */
export type CullFrame = Pick<Shot, "id" | "name" | "verdict" | "score" | "flags"> & {
  relativePath?: string | undefined;
  error?: string | undefined;
  file?: File | undefined;
  previewBlob?: Blob | undefined;
  isRaw?: boolean | undefined;
};

export const DELIVERY_KEEPER_LIMIT = 200;

export type BurstCullChange = { id: string; verdict: Verdict };

/**
 * Cull a burst: keep one frame, reject the other unreviewed frames.
 * Existing keep/reject decisions stay. Suggestions never overwrite a pick.
 */
export function applyBurstCull(
  frames: readonly CullFrame[],
  keepId: string,
  groupIds: readonly string[],
): BurstCullChange[] {
  if (!groupIds.includes(keepId))
    throw new Error("That photo is not in this burst. No picks were changed.");
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  const keeper = byId.get(keepId);
  if (!keeper || keeper.error)
    throw new Error("Reconnect the original before culling this burst. No picks were changed.");
  if (keeper.verdict !== "undecided") return [];

  const changes: BurstCullChange[] = [{ id: keepId, verdict: "keep" }];
  for (const id of groupIds) {
    if (id === keepId) continue;
    const frame = byId.get(id);
    if (!frame || frame.error || frame.verdict !== "undecided") continue;
    changes.push({ id, verdict: "reject" });
  }
  return changes;
}

export function cullReason(frame: CullFrame): string {
  if (frame.error) return "unreadable";
  if (frame.verdict === "keep") return "keep";
  const flags = new Set<Flag>(frame.flags);
  if (flags.has("blur") || flags.has("soft") || flags.has("face-soft")) return "blur";
  if (flags.has("eyes-closed")) return "blink";
  if (flags.has("duplicate")) return "duplicate";
  if (flags.has("underexposed") || flags.has("overexposed")) return "exposure";
  if (frame.verdict === "reject") return "reject";
  return "review";
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

/** Photographer decisions, not machine scores-as-stars. */
export function formatCullCsv(frames: readonly CullFrame[]): string {
  const lines = ["file,score,reason,decision"];
  for (const frame of frames) {
    const file = frame.relativePath || frame.name;
    const score = Number.isFinite(frame.score) ? String(frame.score) : "";
    lines.push(
      [csvCell(file), csvCell(score), csvCell(cullReason(frame)), csvCell(frame.verdict)].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function formatJobJson(
  job: string,
  source: string,
  frames: readonly CullFrame[],
  now = new Date().toISOString(),
): string {
  const title = job.trim();
  if (!title || title.length > 160) throw new Error("Name the job before writing job.json.");
  const keepers = frames.filter((frame) => frame.verdict === "keep" && !frame.error).length;
  const rejected = frames.filter((frame) => frame.verdict === "reject" && !frame.error).length;
  const review = frames.filter((frame) => frame.verdict === "undecided" || frame.error).length;
  return `${JSON.stringify(
    {
      format: 1,
      job: title,
      source,
      createdAt: now,
      files: frames.length,
      keepers,
      rejected,
      review,
      note: "Cull sheet only. Originals were not copied, moved, or modified.",
    },
    null,
    2,
  )}\n`;
}

export function keepersForDelivery(frames: readonly CullFrame[]): CullFrame[] {
  const keepers = frames.filter((frame) => frame.verdict === "keep" && !frame.error);
  if (!keepers.length)
    throw new Error(
      "Cull first. A client gallery is keepers only — not the card dump, and not client favorites.",
    );
  if (keepers.length > DELIVERY_KEEPER_LIMIT)
    throw new Error(
      `This release sends at most ${DELIVERY_KEEPER_LIMIT} keepers to a gallery. Finish the cull or split the delivery.`,
    );
  return keepers;
}

export function assertKeepersOnly(frames: readonly CullFrame[]): CullFrame[] {
  const keepers = keepersForDelivery(frames);
  if (keepers.length !== frames.length)
    throw new Error("Rejected and unreviewed frames cannot enter a client gallery.");
  return keepers;
}

/** Client galleries need a decodeable image. RAW keepers travel as their Studio preview JPEG. */
export function keeperPreviewFile(frame: CullFrame): File {
  if (frame.verdict !== "keep" || frame.error)
    throw new Error("Only keepers can be sent to a client gallery.");
  const file = frame.file;
  if (file && file.type.startsWith("image/") && frame.isRaw !== true) return file;
  if (frame.previewBlob)
    return new File([frame.previewBlob], `${baseName(frame.name)}.jpg`, { type: "image/jpeg" });
  throw new Error(
    `${frame.name}: reconnect a JPEG or wait for a preview before sending this keeper.`,
  );
}
