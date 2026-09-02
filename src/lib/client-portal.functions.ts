import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Client-side of the house: a signed-in client sees only the shoots, invoices
 * and galleries that belong to a client record matching their account.
 * Enforced in the database by public.my_client_ids() + RLS.
 */
export const getClientPortal = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;

    // Bind any client records created with this email to the account.
    await sb.rpc("claim_client_records" as never);

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
