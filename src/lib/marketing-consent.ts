export const CONSENT_COOKIE = "foto_consent";
export type Consent = "accepted" | "rejected";

export function consentFromCookie(header: string | null | undefined): Consent | null {
  const match = (header ?? "").match(/(?:^|;\s*)foto_consent=(accepted|rejected)(?:;|$)/);
  return match ? (match[1] as Consent) : null;
}

export function consentCookie(value: Consent): string {
  return `${CONSENT_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
