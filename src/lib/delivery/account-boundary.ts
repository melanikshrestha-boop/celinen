export type AccountRecord = { ownerId?: string | null; synced?: boolean };

/** Undefined is a legacy record, not permission to assign someone else's data. */
export function visibleToAccount(record: AccountRecord, ownerId: string | null) {
  if (record.synced && !record.ownerId) return false;
  if (record.ownerId === ownerId) return true;
  if (record.ownerId === null && !record.synced) return true; // Explicit device-local draft.
  return ownerId === null && record.ownerId === undefined && !record.synced;
}

export function assertSameAccount(expected: string | null, actual: string | null) {
  if (expected !== actual)
    throw new Error(
      "Account changed. Work is preserved; sign in to the original account to resume.",
    );
}

export function nextPreparedAt(jobs: { preparedAt?: number }[], now = Date.now()) {
  return Math.max(
    now,
    ...jobs.map((job) => (Number.isFinite(job.preparedAt) ? job.preparedAt! + 1 : 0)),
  );
}
