import { useState, type FormEvent } from "react";
import { recordSignup } from "@/utils/payments.functions";
import { BILLING_PLANS, type BillingCycle } from "@/lib/billing-catalog";
import { PRODUCT_EMAIL, PRODUCT_TITLE } from "@/lib/product";

export function WaitlistForm({
  plan,
  billing,
  email: initialEmail = "",
}: {
  plan: string;
  billing: BillingCycle;
  email?: string;
}) {
  const quote = BILLING_PLANS.find((row) => row.id === plan);
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const mail = `mailto:${PRODUCT_EMAIL}?subject=${encodeURIComponent(`${PRODUCT_TITLE} waitlist`)}&body=${encodeURIComponent(email || "")}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await recordSignup({
        data: { email, plan, billing },
      });
      if (result && "error" in result && result.error) throw new Error(result.error);
      setDone(true);
    } catch {
      setError(`Couldn’t save that. Email ${PRODUCT_EMAIL} and we’ll add you.`);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p role="status">
        You’re on the list. Checkout isn’t live yet — we’ll email this address when{" "}
        {quote?.label ?? "your plan"} can be billed.
      </p>
    );
  }

  return (
    <form className="flex flex-col gap-3 p-4" onSubmit={submit}>
      <p>
        Paid checkout isn’t live. Join the waitlist for {quote?.label ?? "this plan"}.
      </p>
      <label htmlFor="waitlist-email" className="text-sm">
        Email
        <input
          id="waitlist-email"
          className="mt-1 w-full min-h-11 rounded-lg border border-input bg-background px-3"
          type="email"
          name="email"
          required
          autoComplete="email"
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@studio.com"
        />
      </label>
      <button
        type="submit"
        className="min-h-11 rounded-lg bg-ink px-4 text-sm text-paper2 disabled:opacity-60"
        disabled={busy}
      >
        {busy ? "Saving…" : "Join waitlist"}
      </button>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}{" "}
          <a href={mail}>{PRODUCT_EMAIL}</a>
        </p>
      ) : null}
    </form>
  );
}
