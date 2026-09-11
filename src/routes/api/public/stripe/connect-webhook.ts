import { createFileRoute } from "@tanstack/react-router";
import {
  handleConnectedInvoiceEvent,
  verifyConnectedEvent,
} from "@/lib/earnings/stripe-webhook.server";
import { allowedInvoicePreviousStatuses } from "@/lib/earnings/finance-integrity.server";

/**
 * Stripe webhook for CONNECTED accounts (Connect endpoint).
 * Mirrors verified invoice states only. Cash receipts are read once from
 * connected charges; this never creates duplicate legacy ledger income.
 */

async function verify(request: Request) {
  if (Number(request.headers.get("content-length")) > 2 * 1024 * 1024) throw new Error("Too large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2 * 1024 * 1024) {
      await reader.cancel();
      throw new Error("Too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return verifyConnectedEvent(
    new TextDecoder("utf8", { fatal: true }).decode(bytes),
    request.headers.get("stripe-signature"),
    process.env["STRIPE_CONNECT_WEBHOOK_SECRET"] ?? "",
  );
}

export const Route = createFileRoute("/api/public/stripe/connect-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let event;
        try {
          event = await verify(request);
        } catch {
          return new Response("Invalid", { status: 400 });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { platformStripe, verifyConnectedAccount } =
            await import("@/lib/stripe-connect.server");
          const result = await handleConnectedInvoiceEvent(event, {
            async resolveOwner(account) {
              const { data, error } = await supabaseAdmin
                .from("profiles")
                .select("id,stripe_account_status")
                .eq("stripe_account_id", account)
                .like("stripe_account_status", "connected:v1:%")
                .limit(101);
              if (error || !data || data.length > 100)
                throw new Error("Connected owner lookup failed.");
              const verified = [];
              for (const candidate of data)
                if (
                  await verifyConnectedAccount(
                    candidate.id,
                    account,
                    candidate.stripe_account_status,
                  )
                )
                  verified.push(candidate.id);
              if (verified.length > 1) throw new Error("Connected owner is ambiguous.");
              return verified[0] ?? null;
            },
            async retrieveInvoice(id, account) {
              return platformStripe().invoices.retrieve(
                id,
                {},
                { stripeAccount: account, timeout: 8000, maxNetworkRetries: 0 },
              );
            },
            async saveInvoice(owner, invoice) {
              const { error } = await supabaseAdmin
                .from("invoices")
                .update({
                  status: invoice.status,
                  hosted_invoice_url: invoice.hostedInvoiceUrl,
                  updated_at: new Date().toISOString(),
                })
                .eq("user_id", owner)
                .eq("stripe_invoice_id", invoice.id)
                .in("status", allowedInvoicePreviousStatuses(invoice.status));
              if (error) throw new Error("Invoice status could not be stored.");
            },
          });
          return Response.json({ received: true, result });
        } catch {
          // Failed durable work must be retried, never falsely acknowledged.
          return new Response("Retry later", { status: 500 });
        }
      },
    },
  },
});
