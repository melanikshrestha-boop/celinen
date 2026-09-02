import { createServerFn } from "@tanstack/react-start";

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

async function bookingFor(token: string) {
  if (!token || token.length < 24) return null;
  const sb = await admin();
  const { data } = await sb
    .from("booking_requests")
    .select("*")
    .eq("access_token", token)
    .maybeSingle();
  return data ?? null;
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
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email?.trim() ?? "")) throw new Error("Add a valid email");
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
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const booking = await bookingFor(data.token);
    if (!booking) return { error: "not_found" as const };
    const sb = await admin();

    const { data: uploads } = await sb
      .from("client_uploads")
      .select("id, filename, storage_path, note, created_at")
      .eq("booking_id", booking.id)
      .order("created_at", { ascending: false });

    const paths = (uploads ?? []).map((u) => u.storage_path);
    const { data: signed } = paths.length
      ? await sb.storage.from("deliveries").createSignedUrls(paths, SIGNED_TTL)
      : { data: [] };

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
      uploads: (uploads ?? []).map((u, i) => ({ ...u, url: signed?.[i]?.signedUrl ?? null })),
      gallery,
    };
  });

export const createShootUploadUrl = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; filename: string }) => {
    if (!d.filename?.trim()) throw new Error("Missing file name");
    return d;
  })
  .handler(async ({ data }) => {
    const booking = await bookingFor(data.token);
    if (!booking) return { error: "Link is no longer valid" };
    const sb = await admin();
    const safe = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
    const path = `shoot-refs/${booking.id}/${crypto.randomUUID()}-${safe}`;
    const { data: signed, error } = await sb.storage
      .from("deliveries")
      .createSignedUploadUrl(path);
    if (error || !signed) return { error: error?.message ?? "Could not start upload" };
    return { path, token: signed.token, signedUrl: signed.signedUrl };
  });

export const recordShootUpload = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; storage_path: string; filename: string; note?: string }) => d)
  .handler(async ({ data }) => {
    const booking = await bookingFor(data.token);
    if (!booking) return { error: "Link is no longer valid" };
    if (!data.storage_path.startsWith(`shoot-refs/${booking.id}/`))
      return { error: "Bad upload path" };
    const sb = await admin();
    const { error } = await sb.from("client_uploads").insert({
      booking_id: booking.id,
      client_id: booking.client_id,
      user_id: booking.user_id,
      uploader_email: booking.requester_email,
      storage_path: data.storage_path,
      filename: clean(data.filename, 200) ?? "upload",
      note: clean(data.note, 500),
    });
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
    const merged = `${booking.message ? `${booking.message}\n\n` : ""}[${stamp}] ${note}`.slice(-4000);
    const { error } = await sb
      .from("booking_requests")
      .update({ message: merged, updated_at: new Date().toISOString() })
      .eq("id", booking.id);
    return error ? { error: error.message } : { ok: true, message: merged };
  });
