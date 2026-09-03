import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { LogoMark } from "@/components/lensos/Logo";
import { Footer } from "@/components/lensos/Footer";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { recordSignup } from "@/utils/payments.functions";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Start a LensLabs plan — sign up and check out" },
      {
        name: "description",
        content:
          "Create your LensLabs account: pick a plan, save your email, and pay. Same-night turnaround for sports, event and wedding shooters.",
      },
      { property: "og:title", content: "Start a LensLabs plan" },
      {
        property: "og:description",
        content: "Pick your tier, save your email, and start culling tonight.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    plan: typeof search['plan'] === "string" ? (search['plan'] as string) : "starter",
    billing: search['billing'] === "monthly" ? "monthly" : "yearly",
    email: typeof search['email'] === "string" ? (search['email'] as string) : "",
  }),
  component: SignupPage,
});

const PLANS = [
  { id: "hobby", label: "Hobby", monthly: 16, yearly: 16 },
  { id: "starter", label: "Individual · Starter", monthly: 20, yearly: 16 },
  { id: "sideline", label: "Individual · Sideline", monthly: 60, yearly: 48 },
  { id: "arena", label: "Individual · Arena", monthly: 200, yearly: 160 },
  { id: "crew", label: "Teams · Crew (per user)", monthly: 40, yearly: 32 },
  { id: "agency", label: "Teams · Agency (per user)", monthly: 80, yearly: 64 },
];

function SignupPage() {
  const search = Route.useSearch();
  const save = useServerFn(recordSignup);

  const [plan, setPlan] = useState(
    PLANS.some((p) => p.id === search.plan) ? search.plan : "starter",
  );
  const [billing, setBilling] = useState<"monthly" | "yearly">(
    search.billing === "monthly" ? "monthly" : "yearly",
  );
  const [email, setEmail] = useState("");
  const [studio, setStudio] = useState("");
  const [seats, setSeats] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<{ priceId: string; email: string; qty: number } | null>(
    null,
  );

  const active = PLANS.find((p) => p.id === plan)!;
  const perUser = plan === "crew" || plan === "agency";
  const price = billing === "yearly" ? active.yearly : active.monthly;

  const start = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await save({ data: { email, plan, billing, studio } });
      if ("error" in result) throw new Error(result.error);
      setCheckout({
        priceId: `${plan}_${billing}`,
        email: email.trim().toLowerCase(),
        qty: perUser ? Math.max(1, Math.min(50, seats)) : 1,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-ink">
      <PaymentTestModeBanner />

      <header className="mx-auto flex w-full max-w-[1240px] items-center justify-between px-6 py-5">
        <Link to="/" className="flex items-center gap-2">
          <LogoMark className="text-ink" />
          <span className="font-display text-[15px] font-semibold tracking-tight">LensLabs</span>
        </Link>
        <Link to="/pricing" className="font-mono text-[11px] uppercase tracking-[0.16em] text-moss hover:text-ink">
          ← All plans
        </Link>
      </header>

      <main className="mx-auto grid w-full max-w-[1000px] flex-1 gap-8 px-6 pb-24 pt-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section>
          <p className="eyebrow">
            Step {checkout ? "02" : "01"} <span className="rule-line" />
          </p>
          <h1 className="mt-4 font-display text-[clamp(2rem,4.5vw,3rem)] font-bold leading-[1.02] tracking-[-0.035em]">
            {checkout ? "Pay and start tonight." : "Tell us where to send the account."}
          </h1>

          {checkout ? (
            <div className="mt-8 rounded-xl border border-border bg-card p-2">
              <StripeEmbeddedCheckout
                priceId={checkout.priceId}
                quantity={checkout.qty}
                customerEmail={checkout.email}
                returnUrl={`${typeof window !== "undefined" ? window.location.origin : ""}/signup?plan=${plan}&billing=${billing}`}
              />
            </div>
          ) : (
            <form onSubmit={start} className="mt-8 space-y-5">
              <label className="block">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-moss">Email</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@studio.com"
                  className="mt-2 w-full rounded-lg border border-input bg-card px-4 py-3 text-sm outline-none focus:border-rust"
                />
              </label>

              <label className="block">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-moss">
                  Studio / team (optional)
                </span>
                <input
                  value={studio}
                  onChange={(e) => setStudio(e.target.value)}
                  placeholder="Okafor Sports Media"
                  className="mt-2 w-full rounded-lg border border-input bg-card px-4 py-3 text-sm outline-none focus:border-rust"
                />
              </label>

              <div>
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-moss">Plan</span>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {PLANS.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => setPlan(p.id)}
                      className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                        plan === p.id
                          ? "border-rust bg-rust/10 text-ink"
                          : "border-border text-moss hover:text-ink"
                      }`}
                    >
                      <span className="block">{p.label}</span>
                      <span className="font-mono text-[11px] text-moss">
                        ${billing === "yearly" ? p.yearly : p.monthly}/mo
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-6">
                <div>
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-moss">Billing</span>
                  <div className="mt-2 inline-flex rounded-lg border border-border p-1">
                    {(["monthly", "yearly"] as const).map((b) => (
                      <button
                        type="button"
                        key={b}
                        onClick={() => setBilling(b)}
                        className={`rounded-md px-3 py-1.5 text-sm capitalize ${
                          billing === b ? "bg-rust text-primary-foreground" : "text-moss"
                        }`}
                      >
                        {b}
                      </button>
                    ))}
                  </div>
                </div>

                {perUser && (
                  <label className="block">
                    <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-moss">Seats</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={seats}
                      onChange={(e) => setSeats(Number(e.target.value))}
                      className="mt-2 w-24 rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:border-rust"
                    />
                  </label>
                )}
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-rust px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Starting…" : "Continue to payment →"}
              </button>
            </form>
          )}
        </section>

        <aside className="h-fit rounded-xl border border-border bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-moss">Summary</p>
          <p className="mt-4 font-display text-[22px] font-semibold tracking-tight">{active.label}</p>
          <p className="mt-1 font-mono text-sm text-moss">
            ${price}
            {perUser ? " / user" : ""} / mo · billed {billing}
          </p>
          <ul className="mt-6 space-y-2 text-sm text-moss">
            <li>Import → Pick → Adobe → Send</li>
            <li>Lightroom plugin, XMP both directions</li>
            <li>Client gallery the same night</li>
            <li>Cancel anytime</li>
          </ul>
        </aside>
      </main>

      <Footer />
    </div>
  );
}
