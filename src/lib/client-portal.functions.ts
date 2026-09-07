import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  clientClaimEmailMatches,
  escapeClientEmailPattern,
  isOwnedByStudio,
} from "@/lib/client-portal-ownership";

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
 * photographer's Stripe hosted invoice URL — creating and sending it on their
 * connected account if it does not exist yet.
 */
export const getInvoicePaymentLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { invoice_id: string }) => {
    if (!d.invoice_id) throw new Error("Missing invoice");
    return d;
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase;

    // RLS already scopes invoices to linked clients; re-read through it.
    const { data: invoice } = await sb
      .from("invoices")
      .select("id, amount, currency, description, status, hosted_invoice_url, client_id, user_id")
      .eq("id", data.invoice_id)
      .maybeSingle();
    if (!invoice) return { error: "Invoice not found" };
    if (invoice.status === "paid") return { error: "This invoice is already paid." };
    if (invoice.hosted_invoice_url) return { url: invoice.hosted_invoice_url };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Confirm the caller really owns this client record.
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id, name, org, email, auth_user_id")
      .eq("id", invoice.client_id ?? "")
      .maybeSingle();
    if (!client || client.auth_user_id !== context.userId) return { error: "Invoice not found" };

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("stripe_account_id, email")
      .eq("id", invoice.user_id)
      .maybeSingle();
    const account = profile?.stripe_account_id;
    if (!account) {
      return {
        error: "Your photographer hasn't switched on card payments yet — reply to their email to settle up.",
      };
    }

    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    const email = client.email || authUser?.user?.email;
    if (!email) return { error: "We need an email on your account before you can pay online." };

    try {
      const { platformStripe, stripeMessage } = await import("@/lib/stripe-connect.server");
      const stripe = platformStripe();
      const opts = { stripeAccount: account } as const;

      const found = await stripe.customers.list({ email, limit: 1 }, opts);
      const customer =
        found.data[0] ??
        (await stripe.customers.create({ email, name: client.org || client.name }, opts));

      const stripeInvoice = await stripe.invoices.create(
        {
          customer: customer.id,
          collection_method: "send_invoice",
          days_until_due: 7,
          metadata: { lenslabs_invoice_id: invoice.id, lenslabs_user_id: invoice.user_id },
          ...(invoice.description ? { description: invoice.description } : {}),
        },
        opts,
      );
      await stripe.invoiceItems.create(
        {
          customer: customer.id,
          invoice: stripeInvoice.id,
          amount: Math.round(Number(invoice.amount) * 100),
          currency: invoice.currency || "usd",
          description: invoice.description || "Photography services",
        },
        opts,
      );
      const finalized = await stripe.invoices.finalizeInvoice(stripeInvoice.id!, {}, opts);
      const url = finalized.hosted_invoice_url;
      if (!url) return { error: stripeMessage(new Error("Stripe did not return a payment page.")) };

      await supabaseAdmin
        .from("invoices")
        .update({
          status: invoice.status === "draft" ? "sent" : invoice.status,
          stripe_invoice_id: finalized.id,
          hosted_invoice_url: url,
          updated_at: new Date().toISOString(),
        })
        .eq("id", invoice.id);

      return { url };
    } catch (e) {
      const { stripeMessage } = await import("@/lib/stripe-connect.server");
      return { error: stripeMessage(e) };
    }
  });
