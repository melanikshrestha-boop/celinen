const prefix = "connected:v1:";
const encoder = new TextEncoder();
export const oauthCookieName = (secure: boolean) =>
  secure ? "__Host-foto-stripe-oauth" : "foto-stripe-oauth-local";
export function matchesOAuthBrowser(
  cookieHeader: string | null,
  state: string,
  secure: boolean,
): boolean {
  if (!/^[a-f0-9]{32}$/.test(state)) return false;
  const name = oauthCookieName(secure);
  const values = (cookieHeader ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  return values.length === 1 && values[0] === `${name}=${state}`;
}
function message(ownerId: string, accountId: string): Uint8Array<ArrayBuffer> {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(ownerId) || !/^acct_[A-Za-z0-9]{1,100}$/.test(accountId))
    throw new Error("Invalid connected account binding.");
  return encoder.encode(JSON.stringify(["FOTO:Stripe:OAuth-account-owner:v1", ownerId, accountId]));
}
async function key(secret: string) {
  if (secret.length < 16) throw new Error("Connected account verification is not configured.");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
/** Only the OAuth callback may issue this proof after exchanging a single-use
 * server-owned state and authorization code. The profile remains user-readable
 * and writable; it is not itself an authority. Never expose the signing key. */
export async function createConnectedAccountProof(
  ownerId: string,
  accountId: string,
  secret: string,
): Promise<string> {
  const signed = await crypto.subtle.sign("HMAC", await key(secret), message(ownerId, accountId));
  return (
    prefix +
    Array.from(new Uint8Array(signed), (byte) => byte.toString(16).padStart(2, "0")).join("")
  );
}
export async function verifyConnectedAccountProof(
  ownerId: string,
  accountId: string,
  proof: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!proof || !/^connected:v1:[0-9a-f]{64}$/.test(proof)) return false;
  try {
    const bytes = Uint8Array.from(proof.slice(prefix.length).match(/../g)!, (pair) =>
      parseInt(pair, 16),
    );
    // Native WebCrypto MAC verification; never a JavaScript early-exit comparison.
    return await crypto.subtle.verify(
      "HMAC",
      await key(secret),
      bytes,
      message(ownerId, accountId),
    );
  } catch {
    return false;
  }
}
