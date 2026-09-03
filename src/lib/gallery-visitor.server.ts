import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Per-visitor gallery tokens.
 *
 * A gallery link alone no longer grants write access to favourites: the server
 * mints a signed token bound to one gallery + one anonymous visitor id, and
 * every favourite write is attributed to (and limited to) that visitor.
 */

function secret() {
  const s = process.env["GALLERY_VISITOR_SECRET"];
  if (!s) throw new Error("GALLERY_VISITOR_SECRET is not configured");
  return s;
}

function sign(galleryId: string, visitorId: string) {
  return createHmac("sha256", secret()).update(`${galleryId}.${visitorId}`).digest("base64url");
}

export function mintVisitorToken(galleryId: string) {
  const visitorId = randomBytes(12).toString("base64url");
  return `${visitorId}.${sign(galleryId, visitorId)}`;
}

/** Returns the visitor id when the token is valid for this gallery, else null. */
export function verifyVisitorToken(galleryId: string, token: string | undefined | null) {
  if (!token) return null;
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const visitorId = token.slice(0, idx);
  const given = token.slice(idx + 1);
  if (visitorId.length > 64 || given.length > 128) return null;

  const expected = sign(galleryId, visitorId);
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return visitorId;
}
