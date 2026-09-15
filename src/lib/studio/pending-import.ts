/** Files chosen in Home chat (plus / drop) before Pick mounts. */
let queued: File[] = [];

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
