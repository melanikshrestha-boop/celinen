import { createFileRoute, Link } from "@tanstack/react-router";
import { LogoMark } from "@/components/lensos/Logo";
import { Footer } from "@/components/lensos/Footer";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { WaitlistForm } from "@/components/marketing/WaitlistForm";
import { BILLING_PLANS } from "@/lib/billing-catalog";
import { paymentsAreConfigured } from "@/lib/payments-available";
import { PRODUCT_NAME, PRODUCT_TITLE } from "@/lib/product";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: `Start a ${PRODUCT_TITLE} plan` },
      {
        name: "description",
        content:
          paymentsAreConfigured()
            ? `Create your ${PRODUCT_TITLE} account: pick a plan, save your email, and pay.`
            : `Join the ${PRODUCT_TITLE} waitlist. Paid checkout is not live yet.`,
      },
      { property: "og:title", content: `Start a ${PRODUCT_TITLE} plan` },
      {
        property: "og:description",
        content: paymentsAreConfigured()
          ? "Pick your tier, save your email, and start culling tonight."
          : "Paid checkout is not live. Join the waitlist for Hobby, Creator, or Arena.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (
    search: Record<string, unknown>,
  ): { plan: string; billing: "monthly" | "yearly"; email?: string } => ({
    plan: typeof search['plan'] === "string" ? (search['plan'] as string) : "starter",
    billing: search['billing'] === "monthly" ? "monthly" : "yearly",
    ...(typeof search['email'] === "string" && search['email']
      ? { email: search['email'] as string }
      : {}),
  }),
  component: SignupPage,
});

const PLANS = BILLING_PLANS;

function SignupPage() {
  const search = Route.useSearch();
  const plan = PLANS.some((p) => p.id === search.plan) ? search.plan : "starter";
  const billing = search.billing === "monthly" ? "monthly" : "yearly";
  const active = PLANS.find((p) => p.id === plan) ?? PLANS[1]!;
  const perUser = plan === "crew" || plan === "agency";
  const price = billing === "yearly" ? active.yearly : active.monthly;
  const origin = typeof window !== "undefined" ? window.location.origin : "";

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
          <div className="rounded-xl border border-border bg-card p-2">
            {paymentsAreConfigured() ? (
              <StripeEmbeddedCheckout
                priceId={`${plan}_${billing}`}
                customerEmail={search.email}
                returnUrl={`${origin}/signup?plan=${plan}&billing=${billing}`}
              />
            ) : (
              <WaitlistForm plan={plan} billing={billing} email={search.email} />
            )}
          </div>
        </section>

        <aside className="h-fit rounded-xl border border-border bg-card p-6">
          <p className="font-display text-[22px] font-semibold tracking-tight">{active.label}</p>
          <p className="mt-1 font-mono text-sm text-moss">
            USD {price}
            {perUser ? " / user" : ""} / mo · billed {billing}
          </p>
        </aside>
      </main>

      <Footer />
    </div>
  );
}
