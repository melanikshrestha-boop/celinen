/** Unassigned intake is never shared or claimable by an arbitrary signed-in studio. */
export function isOwnedByStudio(
  userId: string | null | undefined,
  record: { user_id: string | null } | null | undefined,
): boolean {
  return typeof userId === "string" && userId.trim().length > 0 && record?.user_id === userId;
}

/** Escape PostgreSQL LIKE metacharacters; never add surrounding wildcards. */
export function escapeClientEmailPattern(email: string): string {
  return email.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * A case-insensitive literal check is still required after candidate lookup:
 * PostgREST also interprets '*' as a LIKE wildcard alias. Do not normalize
 * dots, plus tags, spaces, or any other characters into another address.
 */
export function clientClaimEmailMatches(
  verifiedEmail: string,
  clientEmail: string | null | undefined,
): clientEmail is string {
  return (
    verifiedEmail.trim().length > 0 &&
    typeof clientEmail === "string" &&
    verifiedEmail.toLowerCase() === clientEmail.toLowerCase()
  );
}
