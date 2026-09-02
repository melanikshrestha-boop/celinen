import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Bind client records to an account only when the account's email is confirmed,
 * so an unverified sign-up on a guessed client email cannot read their data.
 */
async function linkClientRecords(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  const user = data?.user;
  if (error || !user?.email || !user.email_confirmed_at) return 0;

  const { data: rows } = await supabaseAdmin
    .from("clients")
    .update({ auth_user_id: userId })
    .is("auth_user_id", null)
    .ilike("email", user.email)
    .select("id");
  return rows?.length ?? 0;
}


/**
 * Client-side of the house: a signed-in client sees only the shoots, invoices
 * and galleries whose client record is linked to their account (clients.auth_user_id).
 * Linking happens below and requires a *confirmed* account email, so an
 * unverified sign-up on a guessed address cannot claim someone's records.
 */
export const getClientPortal = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;

    await linkClientRecords(context.userId);


    const { data: clients } = await sb
      .from("clients")
      .select("id, name, org, email, phone")
      .order("created_at", { ascending: true });

    const ids = (clients ?? []).map((c) => c.id);
    if (ids.length === 0) {
      return { clients: [], shoots: [], invoices: [], galleries: [] };
    }

    const [shoots, invoices, galleries] = await Promise.all([
      sb
        .from("shoots")
        .select("id, name, shoot_date, location, status, frames, keepers, client_id")
        .in("client_id", ids)
        .order("shoot_date", { ascending: false }),
      sb
        .from("invoices")
        .select("id, description, amount, currency, status, due_date, hosted_invoice_url, client_id")
        .in("client_id", ids)
        .order("created_at", { ascending: false }),
      sb
        .from("galleries")
        .select("id, slug, title, status, expires_at, client_id")
        .in("client_id", ids)
        .eq("status", "live")
        .order("created_at", { ascending: false }),
    ]);

    return {
      clients: clients ?? [],
      shoots: shoots.data ?? [],
      invoices: invoices.data ?? [],
      galleries: galleries.data ?? [],
    };
  });

/* ---------------- booking ---------------- */

export const createBookingRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      shoot_type: string;
      preferred_date: string;
      location?: string;
      budget?: number | null;
      message?: string;
      name?: string;
    }) => {
      if (!d.preferred_date) throw new Error("Pick a date for your shoot");
      if (!d.shoot_type?.trim()) throw new Error("Tell us what kind of shoot it is");
      return d;
    },
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email ?? "";
    const { data: client } = await context.supabase
      .from("clients")
      .select("id, user_id, name")
      .limit(1)
      .maybeSingle();

    const { data: row, error } = await context.supabase
      .from("booking_requests")
      .insert({
        user_id: client?.user_id ?? null,
        client_id: client?.id ?? null,
        requester_email: email,
        requester_name: data.name?.trim() || client?.name || null,
        shoot_type: data.shoot_type.trim(),
        preferred_date: data.preferred_date,
        location: data.location?.trim() || null,
        budget: data.budget ?? null,
        message: data.message?.trim() || null,
        status: "new",
      })
      .select("*")
      .single();

    if (error) return { error: error.message };
    return { booking: row };
  });

export const listBookingRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("booking_requests")
      .select("*")
      .order("created_at", { ascending: false });
    return data ?? [];
  });

/** Photographer-side: accept / decline a request. */
export const setBookingStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; status: "new" | "confirmed" | "declined" }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("booking_requests")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    return error ? { error: error.message } : { ok: true };
  });

/* ---------------- client uploads ---------------- */

export const createClientUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { filename: string }) => {
    if (!d.filename?.trim()) throw new Error("Missing file name");
    return d;
  })
  .handler(async ({ data, context }) => {
    const safe = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
    const path = `client-uploads/${context.userId}/${crypto.randomUUID()}-${safe}`;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from("deliveries")
      .createSignedUploadUrl(path);
    if (error || !signed) return { error: error?.message ?? "Could not start upload" };
    return { path, token: signed.token, signedUrl: signed.signedUrl };
  });

export const recordClientUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { storage_path: string; filename: string; note?: string }) => d)
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email ?? "";
    const { data: client } = await context.supabase
      .from("clients")
      .select("id, user_id")
      .limit(1)
      .maybeSingle();

    const { error } = await context.supabase.from("client_uploads").insert({
      client_id: client?.id ?? null,
      user_id: client?.user_id ?? null,
      uploader_email: email,
      storage_path: data.storage_path,
      filename: data.filename,
      note: data.note?.trim() || null,
    });
    return error ? { error: error.message } : { ok: true };
  });

export const listClientUploads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("client_uploads")
      .select("id, filename, storage_path, note, created_at")
      .order("created_at", { ascending: false });
    if (!data?.length) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed } = await supabaseAdmin.storage
      .from("deliveries")
      .createSignedUrls(
        data.map((u) => u.storage_path),
        60 * 60 * 6,
      );
    return data.map((u, i) => ({ ...u, url: signed?.[i]?.signedUrl ?? null }));
  });

/* ---------------- guest shoot requests (photographer side) ---------------- */

/**
 * Photographer inbox: their own requests plus guest requests that no studio has
 * claimed yet. Guests book without an account, so those rows start unowned.
 */
export const listInboxBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("booking_requests")
      .select("id, requester_name, requester_email, shoot_type, preferred_date, status, gallery_id, user_id")
      .or(`user_id.eq.${context.userId},user_id.is.null`)
      .order("created_at", { ascending: false })
      .limit(100);
    return data ?? [];
  });

/** Link a delivered gallery to a shoot request so the client's link shows it. */
export const attachGalleryToBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { booking_id: string; gallery_id: string | null }) => d)
  .handler(async ({ data, context }) => {
    if (data.gallery_id) {
      const { data: gallery } = await context.supabase
        .from("galleries")
        .select("id")
        .eq("id", data.gallery_id)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (!gallery) return { error: "Gallery not found" };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: booking } = await supabaseAdmin
      .from("booking_requests")
      .select("id, user_id")
      .eq("id", data.booking_id)
      .maybeSingle();
    if (!booking) return { error: "Request not found" };
    if (booking.user_id && booking.user_id !== context.userId) return { error: "Not your request" };

    const { error } = await supabaseAdmin
      .from("booking_requests")
      .update({
        gallery_id: data.gallery_id,
        user_id: context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.booking_id);
    return error ? { error: error.message } : { ok: true };
  });
