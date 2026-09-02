import { createFileRoute } from "@tanstack/react-router";

/**
 * Stripe webhook for CONNECTED accounts (Connect endpoint).
 * Handles invoice.paid and charge.succeeded — keeps invoices and the
 * ledger in sync with the photographer's own Stripe account.
 */

async function verify(request: Request): Promise<any> {
  const secret = process.env["STRIPE_CONNECT_WEBHOOK_SECRET"];
  if (!secret) throw new Error("STRIPE_CONNECT_WEBHOOK_SECRET is not configured");
  const signature = request.headers.get("stripe-signature");
  const body = await request.text();
  if (!signature || !body) throw new Error("Missing signature or body");

  let timestamp: string | undefined;
  const v1: string[] = [];
  for (const part of signature.split(",")) {
    const [k, v] = part.split("=", 2);
    if (k === "t") timestamp = v;
    if (k === "v1" && v) v1.push(v);
  }
  if (!timestamp || v1.length === 0) throw new Error("Invalid signature format");
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) throw new Error("Timestamp too old");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const expected = [...new Uint8Array(signed)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!v1.includes(expected)) throw new Error("Invalid webhook signature");
  return JSON.parse(body);
}

export const Route = createFileRoute("/api/public/stripe/connect-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let event: any;
        try {
          event = await verify(request);
        } catch (e) {
          console.error("Stripe connect webhook rejected:", e);
          return new Response("Invalid", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const account: string | undefined = event.account;
        const object = event.data?.object ?? {};

        // Resolve the photographer from the connected account id.
        let userId: string | null = object?.metadata?.lenslabs_user_id ?? null;
        if (!userId && account) {
          const { data } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("stripe_account_id", account)
            .maybeSingle();
          userId = (data?.id as string) ?? null;
        }

        try {
          if (event.type === "invoice.paid") {
            if (object.id) {
              await supabaseAdmin
                .from("invoices")
                .update({ status: "paid", updated_at: new Date().toISOString() })
                .eq("stripe_invoice_id", object.id);
            }
            if (userId) {
              await supabaseAdmin.from("transactions").upsert(
                {
                  user_id: userId,
                  kind: "income",
                  category: "Event coverage",
                  description: object.description || `Invoice ${object.number ?? object.id} paid`,
                  amount: (object.amount_paid ?? 0) / 100,
                  occurred_on: new Date((object.created ?? Date.now() / 1000) * 1000)
                    .toISOString()
                    .slice(0, 10),
                  source: "stripe",
                  stripe_object_id: object.id,
                },
                { onConflict: "user_id,stripe_object_id", ignoreDuplicates: true },
              );
            }
          } else if (event.type === "charge.succeeded" && userId) {
            await supabaseAdmin.from("transactions").upsert(
              {
                user_id: userId,
                kind: "income",
                category: "Event coverage",
                description: object.description || `Stripe charge ${object.id}`,
                amount: (object.amount ?? 0) / 100,
                occurred_on: new Date((object.created ?? Date.now() / 1000) * 1000)
                  .toISOString()
                  .slice(0, 10),
                source: "stripe",
                stripe_object_id: object.id,
              },
              { onConflict: "user_id,stripe_object_id", ignoreDuplicates: true },
            );
          }
        } catch (e) {
          console.error("Stripe connect webhook handling failed", e);
        }

        return Response.json({ received: true });
      },
    },
  },
});
