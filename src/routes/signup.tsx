import { createFileRoute, Link } from "@tanstack/react-router";
import { LogoMark } from "@/components/lensos/Logo";
import { Footer } from "@/components/lensos/Footer";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";

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

const PLANS = [
  { id: "hobby", label: "Hobby", monthly: 20, yearly: 16 },
  { id: "creator", label: "Creator", monthly: 30, yearly: 24 },
  { id: "starter", label: "Individual · Starter", monthly: 20, yearly: 16 },
  { id: "sideline", label: "Individual · Sideline", monthly: 60, yearly: 48 },
  { id: "arena", label: "Individual · Arena", monthly: 200, yearly: 160 },
  { id: "crew", label: "Teams · Crew (per user)", monthly: 40, yearly: 32 },
  { id: "agency", label: "Teams · Agency (per user)", monthly: 80, yearly: 64 },
];

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
          <span className="font-display text-[15px] font-semibold tracking-tight">LensLabs</span>
        </Link>
        <Link to="/pricing" className="font-mono text-[11px] uppercase tracking-[0.16em] text-moss hover:text-ink">
          All plans
        </Link>
      </header>

      <main className="mx-auto grid w-full max-w-[1000px] flex-1 gap-8 px-6 pb-24 pt-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section>
          <div className="rounded-xl border border-border bg-card p-2">
            <StripeEmbeddedCheckout
              priceId={`${plan}_${billing}`}
              customerEmail={search.email}
              returnUrl={`${origin}/signup?plan=${plan}&billing=${billing}`}
            />
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
