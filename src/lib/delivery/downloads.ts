import { hashBlob } from "@/lib/projects/archive";
import { makeZip } from "@/lib/zip";
import { safeDeliveryFilename, type DeliveryVersion } from "./workflow";

export const BATCH_BYTES = 80 * 1024 * 1024;
export const BATCH_FILES = 30;
export function downloadBatches(versions: DeliveryVersion[], kind: "phone" | "full") {
  const batches: { versions: DeliveryVersion[]; bytes: number }[] = [];
  const seen = new Set<string>();
  for (const version of versions) {
    if (seen.has(version.id)) throw new Error("Duplicate version in download.");
    seen.add(version.id);
    const bytes = version.variants[kind].bytes;
    if (
      !Number.isSafeInteger(bytes) ||
      bytes <= 0 ||
      bytes > BATCH_BYTES ||
      !/^[a-f0-9]{64}$/.test(version.variants[kind].sha256)
    )
      throw new Error("This final has not been released with valid download metadata.");
    let batch = batches.at(-1);
    if (!batch || batch.bytes + bytes > BATCH_BYTES || batch.versions.length >= BATCH_FILES) {
      batch = { versions: [], bytes: 0 };
      batches.push(batch);
    }
    batch.versions.push(version);
    batch.bytes += bytes;
  }
  return batches;
}
export async function checkedDownload(
  url: string,
  version: DeliveryVersion,
  kind: "phone" | "full",
  signal?: AbortSignal,
) {
  const response = await fetch(url, {
    referrerPolicy: "no-referrer",
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`${version.filename}: download interrupted. Please retry.`);
  const blob = await response.blob();
  if (
    blob.size !== version.variants[kind].bytes ||
    (await hashBlob(blob)) !== version.variants[kind].sha256
  )
    throw new Error(
      `${version.filename}: file integrity check failed. No incomplete download was offered.`,
    );
  return blob;
}
export async function downloadBatch(
  versions: DeliveryVersion[],
  kind: "phone" | "full",
  sign: (versionId: string) => Promise<string>,
  progress: (count: number) => void,
  signal: AbortSignal,
) {
  if (!versions.length || downloadBatches(versions, kind).length !== 1)
    throw new Error("Choose one bounded download part.");
  const entries: { path: string; bytes: Uint8Array }[] = [];
  for (const [index, version] of versions.entries()) {
    signal.throwIfAborted();
    // Sign each file immediately before fetching; slow downloads cannot age every URL at once.
    const blob = await checkedDownload(await sign(version.id), version, kind, signal);
    entries.push({
      path: `${String(index + 1).padStart(3, "0")}-${safeDeliveryFilename(version.filename).replace(/\.jpg$/i, "")}-v${version.number}.jpg`,
      bytes: new Uint8Array(await blob.arrayBuffer()),
    });
    progress(index + 1);
  }
  signal.throwIfAborted();
  return makeZip(entries);
}
export function offerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
