import type { Shot, Verdict } from "@/lib/imaging";

export type KeeperFile = {
  id: string;
  name: string;
  path: string;
  bytes: number;
  digest: string;
  verdict: Extract<Verdict, "keep">;
};

export type KeeperManifest = {
  format: 1;
  createdAt: string;
  ingestBytes: number;
  ingestCount: number;
  keeperBytes: number;
  keeperCount: number;
  rejectBytes: number;
  rejectCount: number;
  undecidedCount: number;
  keepers: KeeperFile[];
};

function fileBytes(shot: Pick<Shot, "file" | "sizeMb" | "sourceAvailable">): number {
  if (shot.sourceAvailable !== false && shot.file && Number.isFinite(shot.file.size))
    return shot.file.size;
  const fromMb = Math.round(shot.sizeMb * 1_048_576);
  return Number.isFinite(fromMb) && fromMb >= 0 ? fromMb : 0;
}

export function buildKeeperManifest(
  shots: readonly Pick<
    Shot,
    "id" | "name" | "relativePath" | "file" | "sizeMb" | "sourceAvailable" | "sourceDigest" | "verdict" | "error"
  >[],
  now = new Date().toISOString(),
): KeeperManifest {
  const keepers: KeeperFile[] = [];
  let ingestBytes = 0;
  let keeperBytes = 0;
  let rejectBytes = 0;
  let rejectCount = 0;
  let undecidedCount = 0;
  for (const shot of shots) {
    const bytes = fileBytes(shot);
    ingestBytes += bytes;
    if (shot.verdict === "keep" && !shot.error) {
      keeperBytes += bytes;
      keepers.push({
        id: shot.id,
        name: shot.name,
        path: shot.relativePath || shot.name,
        bytes,
        digest: shot.sourceDigest ?? "",
        verdict: "keep",
      });
    } else if (shot.verdict === "reject") {
      rejectBytes += bytes;
      rejectCount += 1;
    } else {
      undecidedCount += 1;
    }
  }
  return {
    format: 1,
    createdAt: now,
    ingestBytes,
    ingestCount: shots.length,
    keeperBytes,
    keeperCount: keepers.length,
    rejectBytes,
    rejectCount,
    undecidedCount,
    keepers,
  };
}

/** Archive may only take listed keepers. Rejects and the rest of the card are ineligible. */
export function archiveEligible(manifest: KeeperManifest): boolean {
  return manifest.keeperCount > 0 && manifest.keepers.every((file) => file.verdict === "keep");
}

export function assertArchiveFiles(
  manifest: KeeperManifest,
  files: readonly { id?: string; name: string; size: number }[],
): void {
  if (!archiveEligible(manifest))
    throw new Error("Pick keepers first. Rejects and unreviewed frames cannot be archived.");
  const allowed = new Map(manifest.keepers.map((file) => [file.id, file]));
  const byName = new Map(manifest.keepers.map((file) => [file.name, file]));
  for (const file of files) {
    const keeper = (file.id && allowed.get(file.id)) || byName.get(file.name);
    if (!keeper)
      throw new Error(`${file.name} is not a keeper. Celinen does not archive the card dump.`);
    if (file.size !== keeper.bytes)
      throw new Error(`${file.name} changed size. Re-pick before archive.`);
  }
}

export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}
