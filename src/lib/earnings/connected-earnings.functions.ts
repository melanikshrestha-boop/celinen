import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ConnectedEarningsSnapshot } from "./stripe-receipts";
import { readCompleteFinanceRows } from "./finance-integrity.server";

export const getConnectedEarningsSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ConnectedEarningsSnapshot> => {
    const { supabase, userId } = context;
    const base = {
      accountId: null,
      fetchedAt: new Date().toISOString(),
      complete: false,
      receipts: [],
      invoices: [],
      unmatchedCount: 0,
      warnings: [],
    };
    const profile = await supabase
      .from("profiles")
      .select("stripe_account_id,stripe_account_status")
      .eq("id", userId)
      .maybeSingle();
    if (profile.error)
      return {
        ...base,
        connection: "unavailable",
        warnings: ["The connected account could not be verified."],
      };
    const accountId = profile.data?.stripe_account_id;
    if (!accountId)
      return {
        ...base,
        connection: "not-connected",
        warnings: ["Connect the photographer's Stripe account to read client payments."],
      };
    try {
      const { platformStripe, verifyConnectedAccount } = await import("../stripe-connect.server");
      if (!(await verifyConnectedAccount(userId, accountId, profile.data?.stripe_account_status)))
        return {
          ...base,
          connection: "not-connected",
          warnings: [
            "Reconnect Stripe to verify account ownership. Existing records are unchanged.",
          ],
        };
      const [invoices, shoots, clients] = await Promise.all([
        readCompleteFinanceRows(
          (from, to) =>
            supabase
              .from("invoices")
              .select("id,user_id,stripe_invoice_id,shoot_id,client_id", { count: "exact" })
              .eq("user_id", userId)
              .order("id")
              .range(from, to),
          "Invoice links",
        ),
        readCompleteFinanceRows(
          (from, to) =>
            supabase
              .from("shoots")
              .select("id", { count: "exact" })
              .eq("user_id", userId)
              .order("id")
              .range(from, to),
          "Shoot links",
        ),
        readCompleteFinanceRows(
          (from, to) =>
            supabase
              .from("clients")
              .select("id,name", { count: "exact" })
              .eq("user_id", userId)
              .order("id")
              .range(from, to),
          "Client links",
        ),
      ]);
      const { readConnectedEarnings } = await import("./connected-earnings.server");
      return await readConnectedEarnings(
        {
          accountId,
          ownerId: userId,
          ownedInvoices: invoices,
          ownedShootIds: shoots.map((s) => s.id),
          clientNames: Object.fromEntries(clients.map((c) => [c.id, c.name])),
          bindingsComplete: true,
        },
        platformStripe(),
      );
    } catch {
      return {
        ...base,
        accountId,
        connection: "unavailable",
        warnings: [
          "Stripe could not be read. Existing records were not changed; no live connection is assumed.",
        ],
      };
    }
  });
