const clientToken = import.meta.env["VITE_PAYMENTS_CLIENT_TOKEN"] as string | undefined;

/** Only surface payment mode when Stripe is actually wired. Never show a dead-checkout warning. */
export function PaymentTestModeBanner() {
  if (!clientToken) return null;
  if (clientToken.startsWith("pk_test_")) {
    return (
      <div className="w-full border-b border-rust/40 bg-rust/10 px-4 py-2 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-rust">
        Test mode — payments in the preview are not real charges.
      </div>
    );
  }
  return null;
}
