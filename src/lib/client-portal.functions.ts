import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  clientClaimEmailMatches,
  escapeClientEmailPattern,
  isOwnedByStudio,
} from "@/lib/client-portal-ownership";
import {
  canReadClientUpload,
  canReadGuestUpload,
  hasNonemptyUploadObject,
  isSelectedUploadClient,
  isVerifiedUploadUser,
  parseReservedUploadPath,
  safeUploadFilename,
  sameUploadBinding,
  uploadClientId,
  uploadFilename,
  uploadNote,
  type UploadBooking,
  type UploadClient,
} from "@/lib/upload-security";

/**
 * Bind client records to an account only when the account's email is confirmed,
 * so an unverified sign-up on a guessed client email cannot read their data.
 */
async function linkClientRecords(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  const user = data?.user;
  if (error || !user?.email || !user.email_confirmed_at) return 0;

  const { data: candidates, error: lookupError } = await supabaseAdmin
    .from("clients")
    .select("id, email")
    .is("auth_user_id", null)
    .ilike("email", escapeClientEmailPattern(user.email));
  if (lookupError) throw new Error("Could not verify your client records. Try again.");

  let linked = 0;
  for (const candidate of candidates ?? []) {
    // PostgREST treats '*' as a wildcard alias even after SQL LIKE escaping.
    // The pattern is only a lookup hint; literal email equality authorizes a claim.
    if (!clientClaimEmailMatches(user.email, candidate.email)) continue;
    const { data: row, error: claimError } = await supabaseAdmin
      .from("clients")
      .update({ auth_user_id: userId })
      .eq("id", candidate.id)
      .eq("email", candidate.email)
      .is("auth_user_id", null)
      .select("id")
      .maybeSingle();
    if (claimError) throw new Error("Could not link your verified client records. Try again.");
    if (row) linked++;
  }
  return linked;
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
      .eq("auth_user_id", context.userId)
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
        .select(
          "id, description, amount, currency, status, due_date, hosted_invoice_url, client_id",
        )
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
  .inputValidator((d: { filename: string; client_id?: string | null }) => ({
    filename: uploadFilename(d?.filename),
    client_id: uploadClientId(d?.client_id),
  }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: auth, error: authError } = await supabaseAdmin.auth.admin.getUserById(
      context.userId,
    );
    if (authError || !isVerifiedUploadUser(auth?.user, context.userId))
      return { error: "Verify your email before uploading" };
    if (data.client_id) {
      const { data: client, error } = await supabaseAdmin
        .from("clients")
        .select("id, user_id, auth_user_id")
        .eq("id", data.client_id)
        .maybeSingle();
      if (error || !isSelectedUploadClient(client, data.client_id, auth.user.id))
        return { error: "Client destination is not available" };
    }
    const path = `client-uploads/${auth.user.id}/${crypto.randomUUID()}-${safeUploadFilename(data.filename)}`;
    const { data: signed, error } = await supabaseAdmin.storage
      .from("deliveries")
      .createSignedUploadUrl(path);
    if (error || !signed) return { error: error?.message ?? "Could not start upload" };
    return { path, token: signed.token, signedUrl: signed.signedUrl, client_id: data.client_id };
  });

export const recordClientUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { storage_path: string; filename: string; note?: string; client_id?: string | null }) => ({
      storage_path: d?.storage_path,
      filename: uploadFilename(d?.filename),
      note: uploadNote(d?.note),
      client_id: uploadClientId(d?.client_id),
    }),
  )
  .handler(async ({ data, context }) => {
    const path = parseReservedUploadPath(data.storage_path);
    if (
      !path ||
      path.kind !== "client-uploads" ||
      path.ownerId !== context.userId ||
      path.filename !== safeUploadFilename(data.filename)
    )
      return { error: "Bad upload path" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: auth, error: authError } = await supabaseAdmin.auth.admin.getUserById(
      context.userId,
    );
    if (authError || !isVerifiedUploadUser(auth?.user, context.userId))
      return { error: "Verify your email before uploading" };
    let client: UploadClient | null = null;
    if (data.client_id) {
      const result = await supabaseAdmin
        .from("clients")
        .select("id, user_id, auth_user_id")
        .eq("id", data.client_id)
        .maybeSingle();
      if (result.error || !isSelectedUploadClient(result.data, data.client_id, auth.user.id))
        return { error: "Client destination is not available" };
      client = result.data;
    }
    const row = {
      client_id: client?.id ?? null,
      user_id: client?.user_id ?? null,
      booking_id: null,
      uploader_email: auth.user.email,
      storage_path: data.storage_path,
      filename: data.filename,
      note: data.note,
    };
    // Reserved namespaces cannot be written directly by authenticated storage
    // clients. A completed object plus its exact account key proves this upload,
    // without pretending the signed URL is a one-time reservation.
    const { data: object, error: objectError } = await supabaseAdmin.storage
      .from("deliveries")
      .info(data.storage_path);
    if (objectError || !hasNonemptyUploadObject(object, data.storage_path))
      return { error: "Upload is not complete. Retry after the file finishes uploading." };
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("client_uploads")
      .select("storage_path, filename, client_id, user_id, booking_id, uploader_email")
      .eq("storage_path", data.storage_path);
    if (lookupError) return { error: "Could not verify this upload. Retry to finish saving it." };
    if (existing?.length)
      return existing.every((item) => sameUploadBinding(item, row))
        ? { ok: true }
        : { error: "Upload is already assigned to a different destination" };
    const { error } = await supabaseAdmin.from("client_uploads").insert(row);
    return error ? { error: error.message } : { ok: true };
  });

export const listClientUploads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error: rowsError } = await context.supabase
      .from("client_uploads")
      .select(
        "id, filename, storage_path, note, created_at, client_id, user_id, booking_id, uploader_email",
      )
      .order("created_at", { ascending: false });
    if (rowsError || !data?.length) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const output = data.map((u) => ({ ...u, url: null as string | null }));
    const { data: auth, error: authError } = await supabaseAdmin.auth.admin.getUserById(
      context.userId,
    );
    if (authError || !isVerifiedUploadUser(auth?.user, context.userId)) return output;
    const clients = new Map<string, UploadClient | null>();
    const bookings = new Map<string, UploadBooking | null>();
    const getClient = async (id: string | null) => {
      if (!id) return null;
      if (!clients.has(id)) {
        const result = await supabaseAdmin
          .from("clients")
          .select("id, user_id, auth_user_id")
          .eq("id", id)
          .maybeSingle();
        clients.set(id, result.error ? null : result.data);
      }
      return clients.get(id) ?? null;
    };
    const allowed: number[] = [];
    for (const [index, row] of data.entries()) {
      const path = parseReservedUploadPath(row.storage_path);
      if (!path) continue;
      if (path.kind === "client-uploads") {
        if (canReadClientUpload(row, auth.user, await getClient(row.client_id)))
          allowed.push(index);
      } else if (row.booking_id === path.ownerId) {
        if (!bookings.has(row.booking_id)) {
          const result = await supabaseAdmin
            .from("booking_requests")
            .select("id, client_id, user_id, requester_email")
            .eq("id", row.booking_id)
            .maybeSingle();
          bookings.set(row.booking_id, result.error ? null : result.data);
        }
        const booking = bookings.get(row.booking_id);
        if (
          booking &&
          canReadGuestUpload(row, auth.user, booking, await getClient(booking.client_id))
        )
          allowed.push(index);
      }
    }
    if (!allowed.length) return output;
    const { data: signed, error } = await supabaseAdmin.storage.from("deliveries").createSignedUrls(
      allowed.map((index) => data[index]!.storage_path),
      60 * 60 * 6,
    );
    if (!error)
      allowed.forEach((index, i) => {
        const signedRow = signed?.[i];
        if (signedRow && !signedRow.error && signedRow.path === data[index]!.storage_path)
          output[index]!.url = signedRow.signedUrl || null;
      });
    return output;
  });

/* ---------------- guest shoot requests (photographer side) ---------------- */

/**
 * Photographer inbox: only requests assigned to this authenticated studio.
 * Unassigned guest intake stays private until verified studio routing exists;
 * signing in is not permission to view or claim another person's request.
 */
export const listInboxBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("booking_requests")
      .select(
        "id, requester_name, requester_email, shoot_type, preferred_date, status, gallery_id, user_id",
      )
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error("Could not load your studio's requests. Try again.");
    return (data ?? []).filter((booking) => isOwnedByStudio(context.userId, booking));
  });

/** Link a delivered gallery to a shoot request so the client's link shows it. */
export const attachGalleryToBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { booking_id: string; gallery_id: string | null }) => {
    if (typeof d.booking_id !== "string" || !d.booking_id.trim()) {
      throw new Error("Missing request");
    }
    if (d.gallery_id !== null && (typeof d.gallery_id !== "string" || !d.gallery_id.trim())) {
      throw new Error("Missing gallery");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    if (data.gallery_id) {
      const { data: gallery, error } = await context.supabase
        .from("galleries")
        .select("id, user_id")
        .eq("id", data.gallery_id)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (error) return { error: "Could not verify gallery ownership. Try again." };
      if (!isOwnedByStudio(context.userId, gallery)) return { error: "Gallery not found" };
    }

    // Ownership is part of the write predicate itself, not just a prior read.
    // Never assign user_id here: guest intake cannot be claimed by guessed ID.
    const { data: booking, error } = await context.supabase
      .from("booking_requests")
      .update({
        gallery_id: data.gallery_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.booking_id)
      .eq("user_id", context.userId)
      .select("id, user_id")
      .maybeSingle();
    if (error) return { error: "Could not update your studio's request. Try again." };
    if (!isOwnedByStudio(context.userId, booking)) return { error: "Request not found" };
    return { ok: true };
  });

/* ---------------- invoice payment (client side) ---------------- */

/**
 * A signed-in client asks to pay one of their own invoices. We verify the
 * invoice belongs to a client record linked to this account, then return the
 * photographer's already-issued Stripe hosted invoice URL. Reading this link
 * never creates, finalizes or sends another invoice.
 */
export const getInvoicePaymentLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { invoice_id: string }) => {
    if (!d.invoice_id) throw new Error("Missing invoice");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { data: invoice, error } = await context.supabase
      .from("invoices")
      .select("id,status,hosted_invoice_url,client_id,user_id,stripe_invoice_id")
      .eq("id", data.invoice_id)
      .maybeSingle();
    if (error || !invoice) return { error: "Invoice not found" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const client = await supabaseAdmin
      .from("clients")
      .select("id,auth_user_id,user_id")
      .eq("id", invoice.client_id ?? "")
      .eq("user_id", invoice.user_id)
      .maybeSingle();
    if (client.error || !client.data || client.data.auth_user_id !== context.userId)
      return { error: "Invoice not found" };
    if (invoice.status === "paid") return { error: "This invoice is already paid." };
    if (
      invoice.status !== "sent" ||
      !invoice.stripe_invoice_id?.startsWith("in_") ||
      !invoice.hosted_invoice_url ||
      !/^https:\/\/invoice\.stripe\.com\//.test(invoice.hosted_invoice_url)
    )
      return {
        error: "Your photographer must issue this invoice before a payment page is available.",
      };
    try {
      const profile = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id,stripe_account_status")
        .eq("id", invoice.user_id)
        .maybeSingle();
      const { platformStripe, verifyConnectedAccount } =
        await import("@/lib/stripe-connect.server");
      const account = profile.data?.stripe_account_id;
      if (
        profile.error ||
        !account ||
        !(await verifyConnectedAccount(
          invoice.user_id,
          account,
          profile.data?.stripe_account_status,
        ))
      )
        return { error: "Your photographer must reconnect Stripe to verify this payment page." };
      const current = await platformStripe().invoices.retrieve(
        invoice.stripe_invoice_id,
        {},
        { stripeAccount: account, timeout: 8000, maxNetworkRetries: 0 },
      );
      const { verifiedInvoicePaymentUrl } = await import("./earnings/invoice-send.server");
      // Read back the current provider URL. Never create/finalize/send an invoice
      // merely because a client asks to view its payment page.
      return {
        url: verifiedInvoicePaymentUrl(current, {
          stripeId: invoice.stripe_invoice_id,
          localId: invoice.id,
          ownerId: invoice.user_id,
        }),
      };
    } catch {
      return { error: "The payment page could not be verified. No payment was made." };
    }
  });
