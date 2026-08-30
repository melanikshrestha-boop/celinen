import { createFileRoute, Link } from "@tanstack/react-router";
import { Footer, Nav } from "@/components/Nav";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Lens OS Pricing — Plans for Working Photographers" },
      {
        name: "description",
        content:
          "Lens OS culling plans from $19/mo. Auto-cull RAW shoots, flag blur and duplicates, and develop keepers — priced by shoot volume.",
      },
      { property: "og:title", content: "Lens OS Pricing — Plans for Working Photographers" },
      {
        property: "og:description",
        content: "Starter, Pro and Studio plans for AI photo culling. From $19/mo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PricingPage,
});

const tiers = [
  {
    name: "Starter",
    price: "$19",
    features: [
      "5 shoots / month",
      "Auto-cull up to 200 shots",
      "Blur, exposure & dup flags",
      "Basic edit desk",
      "5 GB cloud backup",
    ],
    cta: "Start free 14 days",
  },
  {
    name: "Pro",
    price: "$49",
    features: [
      "Unlimited shoots",
      "Auto-cull up to 2,000 shots",
      "Full culling + ranked keepers",
      "Full edit desk + presets",
      "100 GB cloud backup",
      "RAW / TIFF export",
    ],
    cta: "Choose Pro",
  },
  {
    name: "Studio",
    price: "$129",
    features: [
      "Everything in Pro",
      "5 seats + client review links",
      "Batch export & handoff",
      "Team presets & styles",
      "1 TB cloud backup",
      "Priority support",
    ],
    cta: "Talk to us",
  },
];

function PricingPage() {
  return (
    <div className="paper-tex min-h-screen w-full text-ink">
      <Nav />
      <section className="mx-auto max-w-[1240px] px-6 pb-24 pt-16">
        <div className="mb-12 text-center">
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-rust">
            Pricing · billed monthly
          </span>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight md:text-5xl">
            Pick your darkroom
          </h1>
        </div>
        <div className="grid items-start gap-6 md:grid-cols-3">
          <PlanCard tier={tiers[0]!} tone="paper" />
          <div className="relative -mt-4 md:-mt-8">
            <span className="tape left-1/2 top-2 -translate-x-1/2 rotate-3" />
            <div className="torn wig-b bg-ink p-8 text-paper2 shadow-2xl">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-sun">Pro</span>
                <span className="rounded-full bg-sun px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink">
                  most picked
                </span>
              </div>
              <div className="mt-3 font-display text-5xl font-semibold">
                $49<small className="font-mono text-base text-sun">/mo</small>
              </div>
              <ul className="mt-6 space-y-3 font-mono text-[12px] text-paper2/85">
                {tiers[1]!.features.map((f) => (
                  <li key={f}>· {f}</li>
                ))}
              </ul>
              <Link
                to="/studio"
                className="mt-7 block rounded-full bg-rust py-3 text-center font-mono text-xs uppercase tracking-[0.12em] text-paper2 transition-colors hover:bg-paper2 hover:text-ink"
              >
                Choose Pro
              </Link>
            </div>
          </div>
          <PlanCard tier={tiers[2]!} tone="mist" />
        </div>

        <div className="mt-16">
          <h2 className="mb-5 font-display text-2xl font-semibold tracking-tight">
            What counts as a shoot?
          </h2>
          <div className="grid gap-4 font-mono text-[12px] text-ink/80 md:grid-cols-3">
            <p className="torn bg-paper2 p-5 shadow">
              · A shoot is one import batch. A 300-frame wedding day is one shoot, not 300 credits.
            </p>
            <p className="torn bg-paper2 p-5 shadow">
              · RAW files are read locally — Lens OS pulls the embedded full-size preview, so nothing
              is uploaded while you cull.
            </p>
            <p className="torn bg-paper2 p-5 shadow">
              · Cancel any time. Culled verdicts and edits stay exportable on the free tier.
            </p>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
}

function PlanCard({
  tier,
  tone,
}: {
  tier: (typeof tiers)[number];
  tone: "paper" | "mist";
}) {
  return (
    <div
      className={`torn wig-a p-7 shadow-lg ${tone === "paper" ? "bg-paper2" : "bg-mist/50"}`}
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-moss">{tier.name}</div>
      <div className="mt-3 font-display text-5xl font-semibold">
        {tier.price}
        <small className="font-mono text-base text-moss">/mo</small>
      </div>
      <ul className="mt-6 space-y-3 font-mono text-[12px] text-ink/80">
        {tier.features.map((f) => (
          <li key={f}>· {f}</li>
        ))}
      </ul>
      <Link
        to="/studio"
        className="mt-7 block rounded-full border border-input py-3 text-center font-mono text-xs uppercase tracking-[0.12em] transition-colors hover:bg-ink hover:text-paper2"
      >
        {tier.cta}
      </Link>
    </div>
  );
}
