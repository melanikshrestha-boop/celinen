import Stripe from "stripe";

/**
 * Direct Stripe client for the PLATFORM account.
 *
 * Stripe Connect Standard OAuth (`connect.stripe.com/oauth/*`) and connected
 * account calls (`Stripe-Account` header) are not proxied by the Lovable
 * connector gateway, so this path uses the photographer-platform's own
 * restricted/secret key stored as STRIPE_SECRET_KEY.
 */
export function platformStripe(): Stripe {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key, { apiVersion: "2026-03-25.dahlia" });
}

export function connectClientId(): string {
  const id = process.env["STRIPE_CONNECT_CLIENT_ID"];
  if (!id) throw new Error("STRIPE_CONNECT_CLIENT_ID is not configured");
  return id;
}

export const SITE_URL = "https://lenslab.dev";

export function connectRedirectUri() {
  return `${SITE_URL}/api/public/stripe/connect-callback`;
}

export function stripeMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { message?: string; raw?: { message?: string } };
    return e.raw?.message ?? e.message ?? "Stripe request failed";
  }
  return "Stripe request failed";
}
