import type { Database } from "@/integrations/supabase/types";

type Tables = Database["public"]["Tables"];
export type UploadBinding = Pick<
  Tables["client_uploads"]["Row"],
  "storage_path" | "filename" | "client_id" | "user_id" | "booking_id" | "uploader_email"
>;
export type UploadClient = Pick<Tables["clients"]["Row"], "id" | "user_id" | "auth_user_id">;
export type UploadBooking = Pick<
  Tables["booking_requests"]["Row"],
  "id" | "client_id" | "user_id" | "requester_email"
>;
export type VerifiedUploadUser = { id: string; email: string; email_confirmed_at: string };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const uuidPattern = new RegExp(`^${UUID}$`);
const reservedPattern = new RegExp(
  `^(client-uploads|shoot-refs)/(${UUID})/(${UUID})-([A-Za-z0-9._-]{1,80})$`,
);
export const isCanonicalUuid = (value: unknown): value is string =>
  typeof value === "string" && uuidPattern.exec(value)?.[0] === value;

/** Never normalize a supplied storage key: reject aliases, traversal and encoding. */
export function parseReservedUploadPath(value: unknown) {
  if (typeof value !== "string" || value.length > 180) return null;
  const match = reservedPattern.exec(value);
  if (!match || match[0] !== value) return null;
  return {
    kind: match[1] as "client-uploads" | "shoot-refs",
    ownerId: match[2]!,
    filename: match[4]!,
  };
}

export function uploadFilename(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 200 ||
    /[\\/]/.test(value) ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    [".", ".."].includes(value.trim())
  ) {
    throw new Error("Add a valid file name (up to 200 characters)");
  }
  return value.trim();
}
export const safeUploadFilename = (filename: string) =>
  filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
export function uploadNote(value: unknown) {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > 500)
    throw new Error("Keep the upload note under 500 characters");
  return value.trim() || null;
}
export function uploadClientId(value: unknown) {
  if (value == null) return null;
  if (!isCanonicalUuid(value)) throw new Error("Choose a valid client destination");
  return value;
}
export const validShootToken = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{24,200}$/.exec(value)?.[0] === value;

export function isVerifiedUploadUser(
  value: unknown,
  expectedId: string,
): value is VerifiedUploadUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Partial<VerifiedUploadUser>;
  return (
    isCanonicalUuid(expectedId) &&
    user.id === expectedId &&
    typeof user.email === "string" &&
    !!user.email &&
    user.email === user.email.trim() &&
    typeof user.email_confirmed_at === "string" &&
    !!user.email_confirmed_at
  );
}

export function hasNonemptyUploadObject(value: unknown, path: string): boolean {
  if (!value || typeof value !== "object") return false;
  const object = value as { name?: unknown; bucketId?: unknown; size?: unknown };
  return (
    object.name === path &&
    object.bucketId === "deliveries" &&
    typeof object.size === "number" &&
    Number.isSafeInteger(object.size) &&
    object.size > 0
  );
}

const sameEmail = (a: string, b: string) =>
  !!a && !!b && a === a.trim() && b === b.trim() && a.toLowerCase() === b.toLowerCase();
export function isSelectedUploadClient(
  client: UploadClient | null,
  clientId: string,
  uploaderId: string,
) {
  return (
    !!client &&
    client.id === clientId &&
    client.auth_user_id === uploaderId &&
    isCanonicalUuid(client.id) &&
    isCanonicalUuid(client.user_id)
  );
}

/** Authorization is rechecked even for rows exposed by an older, permissive RLS policy. */
export function canReadClientUpload(
  row: UploadBinding,
  viewer: VerifiedUploadUser,
  client: UploadClient | null,
) {
  const path = parseReservedUploadPath(row.storage_path);
  if (!path || path.kind !== "client-uploads" || row.booking_id !== null) return false;
  if (row.client_id === null) {
    return (
      row.user_id === null &&
      path.ownerId === viewer.id &&
      sameEmail(row.uploader_email, viewer.email)
    );
  }
  if (
    !client ||
    !isSelectedUploadClient(client, row.client_id, path.ownerId) ||
    row.user_id !== client.user_id
  )
    return false;
  return (
    viewer.id === client.user_id ||
    (viewer.id === path.ownerId && sameEmail(row.uploader_email, viewer.email))
  );
}

export function isBoundGuestUpload(row: UploadBinding, booking: UploadBooking) {
  const path = parseReservedUploadPath(row.storage_path);
  return (
    !!path &&
    path.kind === "shoot-refs" &&
    path.ownerId === booking.id &&
    isCanonicalUuid(booking.id) &&
    row.booking_id === booking.id &&
    row.client_id === booking.client_id &&
    row.user_id === booking.user_id &&
    (booking.user_id === null || isCanonicalUuid(booking.user_id)) &&
    (booking.client_id === null ||
      (isCanonicalUuid(booking.client_id) && isCanonicalUuid(booking.user_id))) &&
    sameEmail(row.uploader_email, booking.requester_email)
  );
}

export function canReadGuestUpload(
  row: UploadBinding,
  viewer: VerifiedUploadUser,
  booking: UploadBooking,
  client: UploadClient | null,
) {
  if (!isBoundGuestUpload(row, booking)) return false;
  if (
    booking.client_id !== null &&
    (!client || client.id !== booking.client_id || client.user_id !== booking.user_id)
  )
    return false;
  return (
    viewer.id === booking.user_id ||
    viewer.id === client?.auth_user_id ||
    sameEmail(viewer.email, booking.requester_email)
  );
}

export function sameUploadBinding(a: UploadBinding, b: UploadBinding) {
  return (
    a.storage_path === b.storage_path &&
    a.client_id === b.client_id &&
    a.user_id === b.user_id &&
    a.booking_id === b.booking_id &&
    sameEmail(a.uploader_email, b.uploader_email)
  );
}
