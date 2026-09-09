import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  invoiceDraftInputSchema,
  invoiceSendInputSchema,
  pendingInvoiceReservation,
  performInvoiceSend,
  validateInvoiceSend,
  type InvoiceDraftInput,
} from "./earnings/invoice-send.server";
import {
  allowedInvoicePreviousStatuses,
  assertSupportedInvoiceCurrency,
  readCompleteFinanceRows,
} from "./earnings/finance-integrity.server";

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error("Profile could not be read.");
    if (data) return data;
    const { data: created, error: createError } = await supabase
      .from("profiles")
      .insert({ id: userId })
      .select("*")
      .single();
    if (createError) throw new Error("Profile could not be initialized.");
    return created;
  });

export const saveProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        full_name: z.string().max(200).optional(),
        studio_name: z.string().max(200).optional(),
      })
      .strict()
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("profiles").upsert({
      id: context.userId,
      ...(data.full_name !== undefined ? { full_name: data.full_name } : {}),
      ...(data.studio_name !== undefined ? { studio_name: data.studio_name } : {}),
      updated_at: new Date().toISOString(),
    });
    if (error) return { error: error.message };
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Clients                                                             */
/* ------------------------------------------------------------------ */

export const listClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return readCompleteFinanceRows(
      (from, to) =>
        context.supabase
          .from("clients")
          .select("*", { count: "exact" })
          .eq("user_id", context.userId)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      "Client records",
    );
  });

export const saveClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id?: string;
      name: string;
      org?: string;
      email?: string;
      phone?: string;
      notes?: string;
    }) => {
      if (!d.name?.trim()) throw new Error("Client name is required");
      return d;
    },
  )
  .handler(async ({ data, context }) => {
    const row = { ...data, user_id: context.userId };
    const { data: saved, error } = await context.supabase
      .from("clients")
      .upsert(row)
      .select("*")
      .single();
    if (error) return { error: error.message };
    return { client: saved };
  });

export const deleteClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("clients").delete().eq("id", data.id);
    return error ? { error: error.message } : { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Shoots                                                              */
/* ------------------------------------------------------------------ */

export const listShoots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return readCompleteFinanceRows(
      (from, to) =>
        context.supabase
          .from("shoots")
          .select("*", { count: "exact" })
          .eq("user_id", context.userId)
          .order("shoot_date", { ascending: false, nullsFirst: false })
          .order("id")
          .range(from, to),
      "Shoots",
    );
  });

export const saveShoot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id?: string;
      name: string;
      client_id?: string | null;
      shoot_date?: string | null;
      location?: string | null;
      status?: string;
      frames?: number;
      keepers?: number;
      work_minutes?: number;
    }) => {
      if (!d.name?.trim()) throw new Error("Shoot name is required");
      return d;
    },
  )
  .handler(async ({ data, context }) => {
    const { data: saved, error } = await context.supabase
      .from("shoots")
      .upsert({ ...data, user_id: context.userId })
      .select("*")
      .single();
    if (error) return { error: error.message };
    return { shoot: saved };
  });

/* ------------------------------------------------------------------ */
/* Transactions                                                        */
/* ------------------------------------------------------------------ */

export const listTransactions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return readCompleteFinanceRows(
      (from, to) =>
        context.supabase
          .from("transactions")
          .select("*", { count: "exact" })
          .eq("user_id", context.userId)
          .order("occurred_on", { ascending: false })
          .order("id")
          .range(from, to),
      "Transactions",
    );
  });

export const addTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      kind: "income" | "expense";
      category: string;
      description: string;
      amount: number;
      occurred_on?: string;
      shoot_id?: string | null;
      client_id?: string | null;
    }) => {
      if (!d.description?.trim()) throw new Error("Description is required");
      if (!Number.isFinite(d.amount) || d.amount <= 0) throw new Error("Amount must be positive");
      if (!d.shoot_id) throw new Error("Link this transaction to a shoot.");
      if (Math.abs(d.amount * 100 - Math.round(d.amount * 100)) > 1e-7 || d.amount > 9999999999.99)
        throw new Error("Use an exact amount with at most two decimal places.");
      return d;
    },
  )
  .handler(async ({ data, context }) => {
    const shoot = await context.supabase
      .from("shoots")
      .select("id,client_id")
      .eq("id", data.shoot_id!)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (shoot.error || !shoot.data)
      return { error: "Choose an owned shoot before recording this transaction." };
    if (data.client_id) {
      const client = await context.supabase
        .from("clients")
        .select("id")
        .eq("id", data.client_id)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (
        client.error ||
        !client.data ||
        (shoot.data.client_id && shoot.data.client_id !== data.client_id)
      )
        return { error: "The client and shoot do not match." };
    }
    const { data: saved, error } = await context.supabase
      .from("transactions")
      .insert({ ...data, user_id: context.userId, source: "manual" })
      .select("*")
      .single();
    if (error) return { error: error.message };
    return { transaction: saved };
  });

export const deleteTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("transactions").delete().eq("id", data.id);
    return error ? { error: error.message } : { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Stripe Connect (Standard OAuth)                                     */
/* ------------------------------------------------------------------ */

export const startStripeConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { connectClientId, connectRedirectUri } = await import("@/lib/stripe-connect.server");
      const { setCookie } = await import("@tanstack/react-start/server");
      const { oauthCookieName } = await import("./earnings/connection-proof.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const state = crypto.randomUUID().replace(/-/g, "");
      const saved = await supabaseAdmin
        .from("stripe_oauth_states")
        .insert({ state, user_id: context.userId });
      if (saved.error) throw new Error("Stripe connection state could not be saved.");
      const url = new URL("https://connect.stripe.com/oauth/authorize");
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", connectClientId());
      url.searchParams.set("scope", "read_write");
      url.searchParams.set("redirect_uri", connectRedirectUri());
      url.searchParams.set("state", state);
      const secure = new URL(connectRedirectUri()).protocol === "https:";
      setCookie(oauthCookieName(secure), state, {
        httpOnly: true,
        secure,
        sameSite: "lax",
        path: "/",
        maxAge: 900,
      });
      return { url: url.toString() };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Could not start Stripe connect" };
    }
  });

export const disconnectStripe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ stripe_account_id: null, stripe_account_status: "disconnected" })
      .eq("id", context.userId);
    return error ? { error: error.message } : { ok: true };
  });

/** Legacy import is disabled: canonical provider reads preserve old ledger rows. */
export const syncStripe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({
    error:
      "Use Refresh payments in Earnings. Stripe is now reconciled as read-only receipts; old ledger imports are not repeated.",
  }));

/* ------------------------------------------------------------------ */
/* Invoices                                                            */
/* ------------------------------------------------------------------ */

export const listInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return readCompleteFinanceRows(
      (from, to) =>
        context.supabase
          .from("invoices")
          .select("*", { count: "exact" })
          .eq("user_id", context.userId)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      "Invoices",
    );
  });

type FinanceContext = { supabase: SupabaseClient<Database>; userId: string };
async function saveOwnedInvoice(data: InvoiceDraftInput, context: FinanceContext) {
  const { supabase, userId } = context;
  const [client, shoot] = await Promise.all([
    supabase
      .from("clients")
      .select("id")
      .eq("id", data.client_id)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("shoots")
      .select("id,client_id")
      .eq("id", data.shoot_id)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (client.error || shoot.error || !client.data || !shoot.data)
    return { error: "Choose an owned client and shoot." };
  if (shoot.data.client_id && shoot.data.client_id !== data.client_id)
    return { error: "The shoot belongs to a different client." };
  const existing = data.id
    ? await supabase
        .from("invoices")
        .select("*")
        .eq("id", data.id)
        .eq("user_id", userId)
        .maybeSingle()
    : null;
  if (existing?.error) return { error: "The draft could not be verified." };
  if (existing?.data) {
    try {
      assertSupportedInvoiceCurrency(existing.data.currency);
    } catch (error) {
      return { error: (error as Error).message };
    }
  }
  const fields = {
    client_id: data.client_id,
    shoot_id: data.shoot_id,
    amount: data.amount,
    currency: "usd",
    description: data.description,
    due_date: data.due_date ?? null,
    updated_at: new Date().toISOString(),
  };
  if (existing?.data) {
    if (
      existing.data.status !== "draft" ||
      existing.data.stripe_invoice_id ||
      !data.expected_updated_at ||
      existing.data.updated_at !== data.expected_updated_at
    )
      return {
        error: "This invoice changed or has an issued/send reservation. Refresh before editing.",
      };
    const saved = await supabase
      .from("invoices")
      .update(fields)
      .eq("id", data.id!)
      .eq("user_id", userId)
      .eq("status", "draft")
      .eq("currency", "usd")
      .is("stripe_invoice_id", null)
      .eq("updated_at", data.expected_updated_at)
      .select("*")
      .maybeSingle();
    if (saved.error || !saved.data)
      return { error: "The draft changed while saving. Refresh and try again." };
    return { invoice: saved.data };
  }
  const saved = await supabase
    .from("invoices")
    .insert({ ...fields, id: data.id ?? crypto.randomUUID(), user_id: userId, status: "draft" })
    .select("*")
    .single();
  if (saved.error) return { error: "The invoice draft could not be saved." };
  return { invoice: saved.data };
}

export const saveInvoiceDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => invoiceDraftInputSchema.parse(data))
  .handler(async ({ data, context }) => saveOwnedInvoice(data, context));

async function sendOwnedInvoice(id: string, expectedUpdatedAt: string, context: FinanceContext) {
  const { supabase, userId } = context;
  const found = await supabase
    .from("invoices")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (found.error || !found.data) return { error: "Invoice not found." };
  const invoice = found.data;
  try {
    assertSupportedInvoiceCurrency(invoice.currency);
  } catch (error) {
    return { error: (error as Error).message };
  }
  if (invoice.updated_at !== expectedUpdatedAt)
    return { error: "This invoice changed. Refresh and review it before sending." };
  if (invoice.status !== "draft")
    return {
      error: "Only the existing draft can be sent; issued invoices are not resent automatically.",
    };
  if (!invoice.shoot_id || !invoice.client_id)
    return { error: "Link the invoice to an owned shoot and client before sending." };
  const [client, shoot, profile] = await Promise.all([
    supabase
      .from("clients")
      .select("*")
      .eq("id", invoice.client_id)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("shoots")
      .select("id,client_id")
      .eq("id", invoice.shoot_id)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("stripe_account_id,stripe_account_status")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  if (client.error || shoot.error || profile.error || !client.data || !shoot.data)
    return { error: "The invoice's owner, client or shoot could not be verified." };
  if (!client.data.email || (shoot.data.client_id && shoot.data.client_id !== client.data.id))
    return { error: "A matching client with an email is required." };
  const account = profile.data?.stripe_account_id;
  if (!account) return { error: "Connect your photographer Stripe account to send invoices." };
  try {
    const { platformStripe, verifyConnectedAccount } = await import("./stripe-connect.server");
    if (!(await verifyConnectedAccount(userId, account, profile.data?.stripe_account_status)))
      return {
        error: "Reconnect Stripe to verify account ownership before sending. No invoice was sent.",
      };
    const stripe = platformStripe();
    const now = Date.now(),
      reservation = invoice.stripe_invoice_id ?? pendingInvoiceReservation(invoice.id, now);
    const sendInput = {
      id,
      ownerId: userId,
      shootId: invoice.shoot_id,
      accountId: account,
      amount: Number(invoice.amount),
      currency: invoice.currency,
      description: invoice.description || "Photography services",
      dueDate: invoice.due_date,
      email: client.data.email,
      clientName: client.data.org || client.data.name,
      stripeInvoiceId: reservation,
    };
    validateInvoiceSend(sendInput, now);
    if (!invoice.stripe_invoice_id) {
      const claim = await supabase
        .from("invoices")
        .update({ stripe_invoice_id: reservation, updated_at: new Date(now).toISOString() })
        .eq("id", id)
        .eq("user_id", userId)
        .eq("status", "draft")
        .eq("currency", "usd")
        .eq("updated_at", expectedUpdatedAt)
        .is("stripe_invoice_id", null)
        .select("id")
        .maybeSingle();
      if (claim.error || !claim.data)
        return { error: "Another send or edit is in progress. Refresh the invoice." };
    }
    const result = await performInvoiceSend(
      sendInput,
      stripe,
      async (stripeId) => {
        const saved = await supabase
          .from("invoices")
          .update({ stripe_invoice_id: stripeId, updated_at: new Date().toISOString() })
          .eq("id", id)
          .eq("user_id", userId)
          .eq("stripe_invoice_id", reservation)
          .select("id")
          .maybeSingle();
        if (saved.error || !saved.data)
          throw new Error(
            "Stripe created the draft but its local link could not be saved. Refresh to reconcile before retrying.",
          );
      },
      now,
    );
    const remote = result.invoice;
    const saved = await supabase
      .from("invoices")
      .update({
        status: remote.status === "paid" ? "paid" : "sent",
        stripe_invoice_id: remote.id,
        hosted_invoice_url: remote.hosted_invoice_url ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", userId)
      .eq("stripe_invoice_id", remote.id)
      .in("status", allowedInvoicePreviousStatuses(remote.status === "paid" ? "paid" : "sent"))
      .select("*")
      .maybeSingle();
    if (saved.error || !saved.data)
      return {
        error:
          "Stripe accepted the request but local confirmation failed. Refresh before retrying.",
      };
    return {
      invoice: saved.data,
      delivery: result.delivery,
      notice:
        result.delivery === "test-no-email"
          ? "Stripe test mode accepted the invoice; no email was sent."
          : result.delivery === "already-paid"
            ? "Stripe confirms this invoice is already paid."
            : "Stripe accepted the send request. This is not proof of email delivery.",
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Invoice send failed. No success is assumed; refresh before retrying.",
    };
  }
}
export const sendInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => invoiceSendInputSchema.parse(data))
  .handler(async ({ data, context }) =>
    sendOwnedInvoice(data.id, data.expected_updated_at, context),
  );

/** Legacy caller compatibility; new UI saves a draft then explicitly sends its stable ID. */
export const createInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      client_id: string;
      shoot_id?: string | null;
      amount: number;
      description?: string;
      due_date?: string | null;
      send: boolean;
      id?: string;
    }) => {
      const { send, ...draft } = data;
      if (typeof send !== "boolean") throw new Error("Choose whether to send this invoice.");
      return { ...invoiceDraftInputSchema.parse(draft), send };
    },
  )
  .handler(async ({ data, context }) => {
    const { send, ...draft } = data;
    const saved = await saveOwnedInvoice(draft, context);
    if (!send || !("invoice" in saved) || !saved.invoice) return saved;
    return sendOwnedInvoice(saved.invoice.id, saved.invoice.updated_at, context);
  });

export const markInvoicePaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async () => ({
    error:
      "Invoice payment status requires a verified provider receipt. Record an actual manual payment separately.",
  }));
