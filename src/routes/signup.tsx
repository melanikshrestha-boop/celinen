import { createFileRoute, Link } from "@tanstack/react-router";
import { LogoMark } from "@/components/lensos/Logo";
import { Footer } from "@/components/lensos/Footer";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { BILLING_PLANS } from "@/lib/billing-catalog";
import { paymentsAreLive } from "@/lib/payments-available";
import { PRODUCT_NAME, PRODUCT_TITLE } from "@/lib/product";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: `Start with ${PRODUCT_TITLE}` },
      {
        name: "description",
        content: paymentsAreLive()
          ? `Create your ${PRODUCT_TITLE} account: pick a plan, save your email, and pay.`
          : `Create your free ${PRODUCT_TITLE} account and open the studio.`,
      },
      { property: "og:title", content: `Start with ${PRODUCT_TITLE}` },
      {
        property: "og:description",
        content: paymentsAreLive()
          ? "Pick your tier, save your email, and start culling tonight."
          : "Sign in with Google and open the studio. Paid plans come later.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (
    search: Record<string, unknown>,
  ): { plan: string; billing: "monthly" | "yearly"; email?: string } => ({
    plan: typeof search["plan"] === "string" ? (search["plan"] as string) : "hobby",
    billing: search["billing"] === "monthly" ? "monthly" : "yearly",
    ...(typeof search["email"] === "string" && search["email"]
      ? { email: search["email"] as string }
      : {}),
  }),
  component: SignupPage,
});

const PLANS = BILLING_PLANS;

function SignupPage() {
  const search = Route.useSearch();
  const plan = PLANS.some((p) => p.id === search.plan) ? search.plan : "hobby";
  const billing = search.billing === "monthly" ? "monthly" : "yearly";
  const active = PLANS.find((p) => p.id === plan) ?? PLANS[1]!;
  const perUser = plan === "crew" || plan === "agency";
  const price = billing === "yearly" ? active.yearly : active.monthly;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const paymentsLive = paymentsAreLive();

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-ink">
      <PaymentTestModeBanner />

      <header className="mx-auto flex w-full max-w-[1240px] items-center justify-between px-6 py-5">
        <Link to="/" className="flex items-center gap-2">
          <LogoMark className="text-ink" />
          <span className="font-display text-[15px] font-semibold tracking-tight">{PRODUCT_NAME}</span>
        </Link>
        <Link to="/pricing" className="font-mono text-[11px] uppercase tracking-[0.16em] text-moss hover:text-ink">
          All plans
        </Link>
      </header>

      <main className="mx-auto grid w-full max-w-[1000px] flex-1 gap-8 px-6 pb-24 pt-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section>
          <div className="rounded-xl border border-border bg-card p-6">
            {paymentsLive ? (
              <StripeEmbeddedCheckout
                priceId={`${plan}_${billing}`}
                customerEmail={search.email}
                returnUrl={`${origin}/signup?plan=${plan}&billing=${billing}`}
              />
            ) : (
              <div className="space-y-4">
                <h1 className="font-display text-[28px] font-semibold tracking-tight">
                  Open {PRODUCT_NAME}
                </h1>
                <p className="text-sm text-moss">
                  Paid checkout isn’t live yet. Sign in and start in the studio — plans can wait.
                </p>
                <Link
                  to="/auth"
                  search={{ mode: "signup", next: "/studio" }}
                  className="inline-flex items-center justify-center rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-background"
                >
                  Continue with Google
                </Link>
              </div>
            )}
          </div>
        </section>

        <aside className="h-fit rounded-xl border border-border bg-card p-6">
          <p className="font-display text-[22px] font-semibold tracking-tight">{active.label}</p>
          <p className="mt-1 font-mono text-sm text-moss">
            USD {price}
            {perUser ? " / user" : ""} / mo · billed {billing}
          </p>
          {!paymentsLive ? (
            <p className="mt-4 text-xs text-moss">Pricing shown for reference. No charge until checkout is live.</p>
          ) : null}
        </aside>
      </main>

      <Footer />
    </div>
  );
}
