import { makeZip, type ZipEntry } from "../zip";
import {
  createDeadlinePlan,
  deadlinePrefix,
  prepareDeadlineExport,
  type DeadlineRenderer,
} from "./deadline-export";
import { formatCullCsv, formatJobJson, keepersForDelivery } from "./cull-decision";
import type { Shot } from "../imaging";

export function jobFolderName(job: string, at = new Date()): string {
  const day = at.toISOString().slice(0, 10);
  const slug = deadlinePrefix(job);
  return `${day}_${slug}`;
}

/**
 * One download a photographer can hand to Lightroom, a lab, or a client ZIP:
 * cull decisions, job metadata, and 2048px proof JPEGs of keepers only.
 * Originals are not inside the archive.
 */
export async function createKeeperPackage(
  shots: readonly Shot[],
  job: string,
  source = "studio",
  options: {
    signal?: AbortSignal;
    render?: DeadlineRenderer;
    onProgress?: (done: number, total: number) => void;
    now?: string;
  } = {},
): Promise<{ blob: Blob; filename: string; keepers: number; files: string[] }> {
  const title = job.trim() || "Untitled shoot";
  const keepers = keepersForDelivery(shots);
  const plan = createDeadlinePlan(shots, {
    count: keepers.length,
    longestEdge: 2048,
    quality: 0.92,
    prefix: "proof",
    caption: "",
    copyright: "",
  });
  const current = () => shots;
  const attempt = await prepareDeadlineExport(plan, current, {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.render ? { render: options.render } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
  if (attempt.cancelled)
    throw new Error("Keeper package cancelled. Originals were not copied.");
  if (attempt.failures.length || attempt.images.length !== plan.frames.length)
    throw new Error(
      attempt.failures[0]?.message ??
        "Every keeper must render before the package can download. Originals are unchanged.",
    );
  const byId = new Map(attempt.images.map((image) => [image.id, image]));
  const files: string[] = ["cull.csv", "job.json"];
  const entries: ZipEntry[] = [
    { path: "cull.csv", text: formatCullCsv(shots) },
    {
      path: "job.json",
      text: formatJobJson(title, source, shots, options.now),
    },
  ];
  for (const frame of plan.frames) {
    const image = byId.get(frame.id);
    if (!image) throw new Error("A keeper is missing from the proof set. Originals are unchanged.");
    const path = `proof/${frame.filename}`;
    files.push(path);
    entries.push({ path, bytes: new Uint8Array(await image.blob.arrayBuffer()) });
  }
  return {
    blob: makeZip(entries),
    filename: `${jobFolderName(title, options.now ? new Date(options.now) : new Date())}-keepers.zip`,
    keepers: keepers.length,
    files,
  };
}

function uniqueZipName(used: Set<string>, name: string) {
  const safe = name.replace(/[/\\]/g, "-") || "keeper";
  if (!used.has(safe)) {
    used.add(safe);
    return safe;
  }
  const dot = safe.lastIndexOf(".");
  const base = dot >= 0 ? safe.slice(0, dot) : safe;
  const ext = dot >= 0 ? safe.slice(dot) : "";
  let i = 2;
  let candidate = `${base}-${i}${ext}`;
  while (used.has(candidate)) {
    i += 1;
    candidate = `${base}-${i}${ext}`;
  }
  used.add(candidate);
  return candidate;
}

/**
 * One ZIP of original keeper files from this session (JPEG/RAW as imported).
 * After a reload, originals may be gone — reconnect the folder first.
 */
export async function createOriginalKeeperZip(
  shots: readonly Shot[],
  job: string,
): Promise<{ blob: Blob; filename: string; keepers: number }> {
  const title = job.trim() || "Untitled shoot";
  const keepers = shots.filter((shot) => shot.verdict === "keep" && !shot.error);
  if (!keepers.length) throw new Error("Mark keepers with K first.");
  const disconnected = keepers.filter((shot) => shot.sourceAvailable === false).length;
  if (disconnected)
    throw new Error(
      `${disconnected} keeper${disconnected === 1 ? " needs" : "s need"} the source folder reconnected before ZIP.`,
    );
  const used = new Set<string>();
  const entries: ZipEntry[] = [];
  for (const shot of keepers) {
    const file = shot.file;
    if (!file?.size)
      throw new Error(
        `${shot.name}: original is not in this session. Re-import the folder, then ZIP.`,
      );
    entries.push({
      path: uniqueZipName(used, shot.name || file.name || "keeper"),
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  }
  return {
    blob: makeZip(entries),
    filename: `${jobFolderName(title)}-keepers.zip`,
    keepers: entries.length,
  };
}
