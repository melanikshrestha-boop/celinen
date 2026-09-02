import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (data) return data;
    const { data: created } = await supabase
      .from("profiles")
      .insert({ id: userId })
      .select("*")
      .single();
    return created;
  });

export const saveProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { full_name?: string; studio_name?: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .upsert({ id: context.userId, ...data, updated_at: new Date().toISOString() });
    if (error) return { error: error.message };
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Clients                                                             */
/* ------------------------------------------------------------------ */

export const listClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("clients")
      .select("*")
      .order("created_at", { ascending: false });
    return data ?? [];
  });

export const saveClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { id?: string; name: string; org?: string; email?: string; phone?: string; notes?: string }) => {
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
    const { data } = await context.supabase
      .from("shoots")
      .select("*")
      .order("shoot_date", { ascending: false, nullsFirst: false });
    return data ?? [];
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
    const { data } = await context.supabase
      .from("transactions")
      .select("*")
      .order("occurred_on", { ascending: false });
    return data ?? [];
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
      return d;
    },
  )
  .handler(async ({ data, context }) => {
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
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const state = crypto.randomUUID().replace(/-/g, "");
      await supabaseAdmin.from("stripe_oauth_states").insert({ state, user_id: context.userId });
      const url = new URL("https://connect.stripe.com/oauth/authorize");
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", connectClientId());
      url.searchParams.set("scope", "read_write");
      url.searchParams.set("redirect_uri", connectRedirectUri());
      url.searchParams.set("state", state);
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

/** Pull charges + payouts from the connected Stripe account into transactions. */
export const syncStripe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("stripe_account_id")
      .eq("id", context.userId)
      .maybeSingle();
    const account = profile?.stripe_account_id;
    if (!account) return { error: "Connect your Stripe account first." };

    try {
      const { platformStripe } = await import("@/lib/stripe-connect.server");
      const stripe = platformStripe();

      const charges = await stripe.charges.list({ limit: 100 }, { stripeAccount: account });
      const rows = charges.data
        .filter((c) => c.status === "succeeded" && !c.refunded)
        .map((c) => ({
          user_id: context.userId,
          kind: "income" as const,
          category: "Event coverage",
          description: c.description || `Stripe charge ${c.id}`,
          amount: c.amount / 100,
          occurred_on: new Date(c.created * 1000).toISOString().slice(0, 10),
          source: "stripe",
          stripe_object_id: c.id,
        }));

      const payouts = await stripe.payouts.list({ limit: 100 }, { stripeAccount: account });
      const payoutRows = payouts.data.map((p) => ({
        user_id: context.userId,
        kind: "income" as const,
        category: "Payout (informational)",
        description: `Stripe payout to bank — ${p.status}`,
        amount: 0,
        occurred_on: new Date(p.created * 1000).toISOString().slice(0, 10),
        source: "stripe-payout",
        stripe_object_id: p.id,
      }));

      const all = [...rows, ...payoutRows.filter(() => false)]; // payouts are not income; kept out of the ledger
      if (all.length) {
        const { error } = await context.supabase
          .from("transactions")
          .upsert(all, { onConflict: "user_id,stripe_object_id", ignoreDuplicates: true });
        if (error) return { error: error.message };
      }
      return { imported: all.length, payouts: payouts.data.length };
    } catch (e) {
      const { stripeMessage } = await import("@/lib/stripe-connect.server");
      return { error: stripeMessage(e) };
    }
  });

/* ------------------------------------------------------------------ */
/* Invoices                                                            */
/* ------------------------------------------------------------------ */

export const listInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("invoices")
      .select("*")
      .order("created_at", { ascending: false });
    return data ?? [];
  });

export const createInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      client_id: string;
      shoot_id?: string | null;
      amount: number;
      description?: string;
      due_date?: string | null;
      send: boolean;
    }) => {
      if (!Number.isFinite(d.amount) || d.amount <= 0) throw new Error("Amount must be positive");
      return d;
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: client } = await supabase
      .from("clients")
      .select("*")
      .eq("id", data.client_id)
      .maybeSingle();
    if (!client) return { error: "Client not found" };

    const { data: invoice, error } = await supabase
      .from("invoices")
      .insert({
        user_id: userId,
        client_id: data.client_id,
        shoot_id: data.shoot_id ?? null,
        amount: data.amount,
        description: data.description ?? null,
        due_date: data.due_date ?? null,
        status: "draft",
      })
      .select("*")
      .single();
    if (error || !invoice) return { error: error?.message ?? "Could not create invoice" };
    if (!data.send) return { invoice };

    if (!client.email) return { invoice, error: "Client has no email — saved as draft." };

    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_account_id")
      .eq("id", userId)
      .maybeSingle();
    const account = profile?.stripe_account_id;
    if (!account) return { invoice, error: "Connect your Stripe account to send invoices." };

    try {
      const { platformStripe, stripeMessage } = await import("@/lib/stripe-connect.server");
      const stripe = platformStripe();
      const opts = { stripeAccount: account } as const;

      const customer = await stripe.customers.create(
        { email: client.email, name: client.org || client.name },
        opts,
      );
      const stripeInvoice = await stripe.invoices.create(
        {
          customer: customer.id,
          collection_method: "send_invoice",
          days_until_due: data.due_date
            ? Math.max(
                1,
                Math.ceil((new Date(data.due_date).getTime() - Date.now()) / 86_400_000),
              )
            : 14,
          metadata: { lenslabs_invoice_id: invoice.id, lenslabs_user_id: userId },
          description: data.description ?? undefined,
        },
        opts,
      );
      await stripe.invoiceItems.create(
        {
          customer: customer.id,
          invoice: stripeInvoice.id,
          amount: Math.round(data.amount * 100),
          currency: "usd",
          description: data.description || "Photography services",
        },
        opts,
      );
      const sent = await stripe.invoices.sendInvoice(stripeInvoice.id!, opts);

      const { data: updated } = await supabase
        .from("invoices")
        .update({
          status: "sent",
          stripe_invoice_id: sent.id,
          hosted_invoice_url: sent.hosted_invoice_url ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", invoice.id)
        .select("*")
        .single();

      return { invoice: updated ?? invoice };
    } catch (e) {
      const { stripeMessage } = await import("@/lib/stripe-connect.server");
      return { invoice, error: stripeMessage(e) };
    }
  });

export const markInvoicePaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("invoices")
      .update({ status: "paid", updated_at: new Date().toISOString() })
      .eq("id", data.id);
    return error ? { error: error.message } : { ok: true };
  });
