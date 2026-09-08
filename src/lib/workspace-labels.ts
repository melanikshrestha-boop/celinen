/** Presentation only: existing storage keys, IDs, and user-authored titles stay intact. */
export function shootDisplayTitle(record: { title: string; named?: boolean }) {
  return record.title;
}

export function projectDisplayTitle(record: { title: string; named?: boolean }) {
  return record.title;
}
