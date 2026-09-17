/** Files chosen in Home chat (plus / drop) before Pick mounts. */
let queued: File[] = [];
/** Keepers handed from Cull to Develop. */
let developQueued: File[] = [];

export function queueStudioImport(files: readonly File[]) {
  queued = files.filter((file) => file.size > 0);
}

export function takeStudioImport(): File[] {
  const next = queued;
  queued = [];
  return next;
}

export function hasStudioImport() {
  return queued.length > 0;
}

export function queueDevelopImport(files: readonly File[]) {
  developQueued = files.filter((file) => file.size > 0);
}

/** Safari File handles go stale after a route change. Snapshot bytes while the
 * click is still allowed to read disk, then Develop imports a real Blob. */
export async function snapshotPhotoFile(file: File): Promise<File> {
  const type = file.type || "application/octet-stream";
  const asFile = (bytes: ArrayBuffer) =>
    new File([bytes], file.name, { type, lastModified: file.lastModified });
  const ok = (bytes: ArrayBuffer) =>
    bytes instanceof ArrayBuffer && bytes.byteLength === file.size;
  try {
    const bytes = await file.arrayBuffer();
    if (ok(bytes)) return asFile(bytes);
  } catch {
    /* Safari I/O: try a slice copy. */
  }
  const bytes = await file.slice(0, file.size, type).arrayBuffer();
  if (!ok(bytes))
    throw new Error(`Could not read ${file.name}. Keep the folder open and import again.`);
  return asFile(bytes);
}

export async function snapshotPhotoFiles(files: readonly File[]): Promise<File[]> {
  const copies: File[] = [];
  for (const file of files.filter((item) => item.size > 0))
    copies.push(await snapshotPhotoFile(file));
  return copies;
}

export function takeDevelopImport(): File[] {
  const next = developQueued;
  developQueued = [];
  return next;
}

export function hasDevelopImport() {
  return developQueued.length > 0;
}
