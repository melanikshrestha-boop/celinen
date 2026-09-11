import { createServerFn } from "@tanstack/react-start";
import {
  hasNonemptyUploadObject,
  isBoundGuestUpload,
  isCanonicalUuid,
  parseReservedUploadPath,
  safeUploadFilename,
  sameUploadBinding,
  uploadFilename,
  uploadNote,
  validShootToken,
} from "@/lib/upload-security";

/**
 * Guest shoot app — no account required.
 * A booking creates a private, unguessable access token. That token is the
 * client's key to their shoot space: reference uploads, status, and the
 * delivered gallery link. Everything is validated server-side against the
 * token; nothing is trusted from the browser.
 */

const SIGNED_TTL = 60 * 60 * 6;

function newToken() {
  return `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().slice(0, 8)}`;
}

const clean = (s?: string | null, max = 400) => (s ?? "").trim().slice(0, max) || null;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function bookingFor(token: unknown) {
  if (!validShootToken(token)) return null;
  const sb = await admin();
  const { data, error } = await sb
    .from("booking_requests")
    .select("*")
    .eq("access_token", token)
    .maybeSingle();
  return error || !data || !isCanonicalUuid(data.id) ? null : data;
}

export const createShootRequest = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      name: string;
      email: string;
      shoot_type: string;
      preferred_date: string;
      location?: string;
      budget?: number | null;
      message?: string;
    }) => {
      if (!d.name?.trim()) throw new Error("Add your name");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email?.trim() ?? ""))
        throw new Error("Add a valid email");
      if (!d.preferred_date) throw new Error("Pick a date");
      if (!d.shoot_type?.trim()) throw new Error("Pick a shoot type");
      return d;
    },
  )
  .handler(async ({ data }) => {
    const sb = await admin();
    const token = newToken();
    const { data: row, error } = await sb
      .from("booking_requests")
      .insert({
        requester_email: data.email.trim().toLowerCase().slice(0, 200),
        requester_name: clean(data.name, 120),
        shoot_type: clean(data.shoot_type, 60) ?? "portrait",
        preferred_date: data.preferred_date,
        location: clean(data.location, 200),
        budget: typeof data.budget === "number" && data.budget > 0 ? data.budget : null,
        message: clean(data.message, 2000),
        status: "new",
        access_token: token,
      })
      .select("id")
      .single();

    if (error) return { error: error.message };
    return { id: row.id, token };
  });

export const getShootSpace = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => ({ token: d?.token }))
  .handler(async ({ data }) => {
    const booking = await bookingFor(data.token);
    if (!booking) return { error: "not_found" as const };
    const sb = await admin();

    const { data: uploads, error: uploadsError } = await sb
      .from("client_uploads")
      .select(
        "id, filename, storage_path, note, created_at, client_id, user_id, booking_id, uploader_email",
      )
      .eq("booking_id", booking.id)
      .order("created_at", { ascending: false });

    const visibleUploads = uploadsError ? [] : (uploads ?? []);
    const allowed = visibleUploads.flatMap((u, i) => (isBoundGuestUpload(u, booking) ? [i] : []));
    const paths = allowed.map((i) => visibleUploads[i]!.storage_path);
    const { data: signed, error: signError } = paths.length
      ? await sb.storage.from("deliveries").createSignedUrls(paths, SIGNED_TTL)
      : { data: [], error: null };
    const signedUploads = visibleUploads.map((u) => ({ ...u, url: null as string | null }));
    if (!signError)
      allowed.forEach((index, i) => {
        const signedRow = signed?.[i];
        if (signedRow && !signedRow.error && signedRow.path === visibleUploads[index]!.storage_path)
          signedUploads[index]!.url = signedRow.signedUrl || null;
      });

    let gallery: { slug: string; title: string; photo_count: number } | null = null;
    if (booking.gallery_id) {
      const { data: g } = await sb
        .from("galleries")
        .select("slug, title, status")
        .eq("id", booking.gallery_id)
        .maybeSingle();
      if (g && g.status === "live") {
        const { count } = await sb
          .from("gallery_photos")
          .select("id", { count: "exact", head: true })
          .eq("gallery_id", booking.gallery_id);
        gallery = { slug: g.slug, title: g.title, photo_count: count ?? 0 };
      }
    }

    return {
      booking: {
        id: booking.id,
        name: booking.requester_name,
        email: booking.requester_email,
        shoot_type: booking.shoot_type,
        preferred_date: booking.preferred_date,
        location: booking.location,
        budget: booking.budget,
        message: booking.message,
        status: booking.status,
        created_at: booking.created_at,
      },
      uploads: signedUploads,
      gallery,
    };
  });

export const createShootUploadUrl = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; filename: string }) => ({
    token: d?.token,
    filename: uploadFilename(d?.filename),
  }))
  .handler(async ({ data }) => {
    const booking = await bookingFor(data.token);
    if (!booking) return { error: "Link is no longer valid" };
    const sb = await admin();
    const path = `shoot-refs/${booking.id}/${crypto.randomUUID()}-${safeUploadFilename(data.filename)}`;
    const { data: signed, error } = await sb.storage.from("deliveries").createSignedUploadUrl(path);
    if (error || !signed) return { error: error?.message ?? "Could not start upload" };
    return { path, token: signed.token, signedUrl: signed.signedUrl };
  });

export const recordShootUpload = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { token: string; storage_path: string; filename: string; note?: string }) => ({
      token: d?.token,
      storage_path: d?.storage_path,
      filename: uploadFilename(d?.filename),
      note: uploadNote(d?.note),
    }),
  )
  .handler(async ({ data }) => {
    const booking = await bookingFor(data.token);
    if (!booking) return { error: "Link is no longer valid" };
    const path = parseReservedUploadPath(data.storage_path);
    if (
      !path ||
      path.kind !== "shoot-refs" ||
      path.ownerId !== booking.id ||
      path.filename !== safeUploadFilename(data.filename)
    )
      return { error: "Bad upload path" };
    const sb = await admin();
    const row = {
      booking_id: booking.id,
      client_id: booking.client_id,
      user_id: booking.user_id,
      uploader_email: booking.requester_email,
      storage_path: data.storage_path,
      filename: data.filename,
      note: data.note,
    };
    if (!isBoundGuestUpload(row, booking)) return { error: "Upload destination is not available" };
    const { data: object, error: objectError } = await sb.storage
      .from("deliveries")
      .info(data.storage_path);
    if (objectError || !hasNonemptyUploadObject(object, data.storage_path))
      return { error: "Upload is not complete. Retry after the file finishes uploading." };
    const { data: existing, error: lookupError } = await sb
      .from("client_uploads")
      .select("storage_path, filename, client_id, user_id, booking_id, uploader_email")
      .eq("storage_path", data.storage_path);
    if (lookupError) return { error: "Could not verify this upload. Retry to finish saving it." };
    if (existing?.length)
      return existing.every((item) => sameUploadBinding(item, row))
        ? { ok: true }
        : { error: "Upload is already assigned to a different destination" };
    const { error } = await sb.from("client_uploads").insert(row);
    return error ? { error: error.message } : { ok: true };
  });

export const addShootNote = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; message: string }) => d)
  .handler(async ({ data }) => {
    const booking = await bookingFor(data.token);
    if (!booking) return { error: "Link is no longer valid" };
    const note = clean(data.message, 2000);
    if (!note) return { error: "Write something first" };
    const sb = await admin();
    const stamp = new Date().toISOString().slice(0, 10);
    const merged = `${booking.message ? `${booking.message}\n\n` : ""}[${stamp}] ${note}`.slice(
      -4000,
    );
    const { error } = await sb
      .from("booking_requests")
      .update({ message: merged, updated_at: new Date().toISOString() })
      .eq("id", booking.id);
    return error ? { error: error.message } : { ok: true, message: merged };
  });
