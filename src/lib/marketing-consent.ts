export const CONSENT_COOKIE = "celinen_consent";
/** Legacy cookie name; still accepted on read so returning visitors keep their choice. */
export const LEGACY_CONSENT_COOKIE = "foto_consent";
export type Consent = "accepted" | "rejected";

export function consentFromCookie(header: string | null | undefined): Consent | null {
  const raw = header ?? "";
  const read = (name: string) => {
    const match = raw.match(new RegExp(`(?:^|;\\s*)${name}=(accepted|rejected)(?:;|$)`));
    return match ? (match[1] as Consent) : null;
  };
  // Prefer the new cookie when both are present.
  return read(CONSENT_COOKIE) ?? read(LEGACY_CONSENT_COOKIE);
}

export function consentCookie(value: Consent): string {
  return `${CONSENT_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
