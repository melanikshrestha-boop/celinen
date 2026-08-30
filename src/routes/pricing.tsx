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
        content: "Starter, Pro and Studio plans for local AI photo culling. From $19/mo.",
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
    blurb: "Solo shooters, a few sessions a month.",
    features: [
      "5 shoots / month",
      "Auto-cull up to 200 shots",
      "Blur, exposure & dup flags",
      "Basic edit desk",
      "5 GB cloud backup",
    ],
    cta: "Start free 14 days",
    featured: false,
  },
  {
    name: "Pro",
    price: "$49",
    blurb: "Weddings, events, weekly volume.",
    features: [
      "Unlimited shoots",
      "Auto-cull up to 2,000 shots",
      "Full culling + ranked keepers",
      "Full edit desk + presets",
      "100 GB cloud backup",
      "RAW / TIFF export",
    ],
    cta: "Choose Pro",
    featured: true,
  },
  {
    name: "Studio",
    price: "$129",
    blurb: "Teams handing off to clients.",
    features: [
      "Everything in Pro",
      "5 seats + client review links",
      "Batch export & handoff",
      "Team presets & styles",
      "1 TB cloud backup",
      "Priority support",
    ],
    cta: "Talk to us",
    featured: false,
  },
];

const faqs = [
  ["What counts as a shoot?", "One import batch. A 300-frame wedding day is one shoot, not 300 credits."],
  ["Do my RAWs get uploaded?", "No. Lens OS reads the embedded full-size preview locally while you cull."],
  ["Can I cancel?", "Any time. Culled verdicts and edits stay exportable on the free tier."],
];

function PricingPage() {
  return (
    <div className="paper-tex min-h-screen w-full text-ink">
      <Nav />
      <section className="mx-auto max-w-[1240px] px-6 pb-24 pt-20">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-sun">
          Pricing · billed monthly
        </span>
        <h1 className="mt-3 font-display text-[clamp(2.5rem,6vw,4.5rem)] font-bold leading-[0.95] tracking-tight">
          Priced by shoot,
          <br />
          <span className="text-rust">not by photo.</span>
        </h1>

        <div className="mt-14 grid items-stretch gap-4 md:grid-cols-3">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`panel flex flex-col p-8 ${t.featured ? "glow-lime border-rust/40" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-moss">
                  {t.name}
                </span>
                {t.featured && (
                  <span className="rounded-full bg-rust px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-paper">
                    most picked
                  </span>
                )}
              </div>
              <div className="mt-4 font-display text-5xl font-bold">
                {t.price}
                <small className="font-mono text-base text-moss">/mo</small>
              </div>
              <p className="mt-2 text-sm text-moss">{t.blurb}</p>
              <ul className="mt-6 flex-1 space-y-3 font-mono text-[12px] text-ink/85">
                {t.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className="text-rust">·</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                to="/studio"
                className={`mt-8 block rounded-full py-3 text-center font-mono text-xs uppercase tracking-[0.12em] transition-transform hover:-translate-y-0.5 ${
                  t.featured
                    ? "bg-rust text-paper"
                    : "border border-input text-ink hover:border-rust hover:text-rust"
                }`}
              >
                {t.cta}
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-16">
          <h2 className="mb-5 font-display text-2xl font-bold tracking-tight">Common questions</h2>
          <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-3">
            {faqs.map(([q, a]) => (
              <div key={q} className="bg-paper2/70 p-6">
                <div className="font-display text-base font-bold text-sun">{q}</div>
                <p className="mt-2 text-sm leading-relaxed text-moss">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
}
