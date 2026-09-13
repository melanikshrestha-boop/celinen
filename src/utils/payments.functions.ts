import { createServerFn } from "@tanstack/react-start";
import {
  type StripeEnv,
  createStripeClient,
  getStripeErrorMessage,
} from "@/lib/stripe.server";
import { quoteForLookup } from "@/lib/billing-catalog";

type CheckoutSessionResult = { url: string } | { error: string };

async function resolveOrCreatePrice(
  stripe: ReturnType<typeof createStripeClient>,
  lookup: string,
) {
  const listed = await stripe.prices.list({ lookup_keys: [lookup], limit: 1 });
  if (listed.data[0]) return listed.data[0];
  const quote = quoteForLookup(lookup);
  if (!quote) return undefined;
  const product = await stripe.products.create({
    name: quote.productName,
    metadata: { plan: quote.plan.id, billing: quote.billing },
  });
  try {
    return await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: quote.unitAmountCents,
      recurring: { interval: quote.interval },
      lookup_key: lookup,
      metadata: { plan: quote.plan.id, billing: quote.billing },
    });
  } catch (error) {
    // Two checkouts can race; the winner owns the lookup key.
    const again = await stripe.prices.list({ lookup_keys: [lookup], limit: 1 });
    if (again.data[0]) return again.data[0];
    throw error;
  }
}

async function resolveOrCreateCustomer(
  stripe: ReturnType<typeof createStripeClient>,
  options: { email?: string | undefined },
): Promise<string | undefined> {
  if (!options.email) return undefined;
  const existing = await stripe.customers.list({ email: options.email, limit: 1 });
  if (existing.data.length && existing.data[0]) return existing.data[0].id;
  const created = await stripe.customers.create({ email: options.email });
  return created.id;
}

/** Records the email + tier a visitor signed up with, before checkout. */
export const recordSignup = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string; plan: string; billing: string; studio?: string }) => {
    const email = (data.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address");
    if (!/^[a-z_]{2,32}$/.test(data.plan)) throw new Error("Invalid plan");
    return {
      email,
      plan: data.plan,
      billing: data.billing === "monthly" ? "monthly" : "yearly",
      studio: (data.studio ?? "").trim().slice(0, 120),
    };
  })
  .handler(async ({ data }): Promise<{ ok: true } | { error: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("signups").insert({
      email: data.email,
      plan: data.plan,
      billing: data.billing,
      studio: data.studio || null,
    });
    if (error) return { error: error.message };
    return { ok: true };
  });

export const createCheckoutSession = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      priceId: string;
      quantity?: number;
      customerEmail?: string;
      returnUrl: string;
      environment: StripeEnv;
    }) => {
      if (!/^[a-zA-Z0-9_-]+$/.test(data.priceId)) throw new Error("Invalid priceId");
      return data;
    },
  )
  .handler(async ({ data }): Promise<CheckoutSessionResult> => {
    try {
      const stripe = createStripeClient(data.environment);
      const stripePrice = await resolveOrCreatePrice(stripe, data.priceId);
      if (!stripePrice) throw new Error("Price not found");
      const isRecurring = stripePrice.type === "recurring";

      const customerId = await resolveOrCreateCustomer(stripe, { email: data.customerEmail });

      const origin = new URL(data.returnUrl).origin;
      const session = await stripe.checkout.sessions.create({
        line_items: [{ price: stripePrice.id, quantity: data.quantity || 1 }],
        mode: isRecurring ? "subscription" : "payment",
        success_url: `${origin}/workspace?checkout=success`,
        cancel_url: `${origin}/pricing`,
        allow_promotion_codes: true,
        billing_address_collection: "auto",
        ...(customerId
          ? { customer: customerId }
          : data.customerEmail
            ? { customer_email: data.customerEmail }
            : {}),
        metadata: { plan: data.priceId },
        ...(isRecurring ? { subscription_data: { metadata: { plan: data.priceId } } } : {}),
      });

      if (!session.url) throw new Error("Checkout did not return a URL");
      return { url: session.url };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });
