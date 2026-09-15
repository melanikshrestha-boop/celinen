/** Publishable Stripe key in this build. Live checkout needs pk_live_; pk_test_ is preview-only. */
export function paymentsPublishableKey(): string | undefined {
  const token = import.meta.env["VITE_PAYMENTS_CLIENT_TOKEN"] as string | undefined;
  return token?.startsWith("pk_") ? token : undefined;
}

export function paymentsAreConfigured(): boolean {
  return Boolean(paymentsPublishableKey());
}

export function paymentsAreLive(): boolean {
  return Boolean(paymentsPublishableKey()?.startsWith("pk_live_"));
}
