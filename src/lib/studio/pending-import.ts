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

export function takeDevelopImport(): File[] {
  const next = developQueued;
  developQueued = [];
  return next;
}

export function hasDevelopImport() {
  return developQueued.length > 0;
}
