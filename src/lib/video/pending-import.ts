/** Files chosen in Home chat before Video mounts. Bytes stay in memory. */
let queued: File[] = [];

export function queueVideoImport(files: readonly File[]) {
  queued = files.filter((file) => file.size > 0);
}

export function takeVideoImport(): File[] {
  const next = queued;
  queued = [];
  return next;
}

export function hasVideoImport() {
  return queued.length > 0;
}
