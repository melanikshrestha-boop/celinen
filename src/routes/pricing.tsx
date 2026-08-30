import { createFileRoute, Link } from "@tanstack/react-router";
import { Footer, Nav } from "@/components/Nav";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Lens OS Pricing — Plans for Photographers" },
      {
        name: "description",
        content:
          "Lens OS plans from $19/mo. Priced by shoot volume, not per photo. Cull, flag and develop full RAW shoots locally.",
      },
      { property: "og:title", content: "Lens OS Pricing — Plans for Photographers" },
      {
        property: "og:description",
        content: "Starter, Pro and Studio plans. From $19/mo.",
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
    features: ["5 shoots / month", "200 shots per cull", "Basic develop tools"],
    cta: "Start free",
    featured: false,
  },
  {
    name: "Pro",
    price: "$49",
    features: ["Unlimited shoots", "2,000 shots per cull", "Full develop + presets"],
    cta: "Choose Pro",
    featured: true,
  },
  {
    name: "Studio",
    price: "$129",
    features: ["Everything in Pro", "5 seats + review links", "Batch export"],
    cta: "Talk to us",
    featured: false,
  },
];

function PricingPage() {
  return (
    <div className="flex min-h-screen w-full flex-col text-ink">
      <Nav />
      <section className="mx-auto w-full max-w-[1000px] flex-1 px-6 pb-24 pt-20">
        <h1 className="font-display text-[clamp(2rem,5vw,3.25rem)] font-medium tracking-tight">
          Priced by shoot.
        </h1>

        <div className="mt-12 grid items-stretch gap-4 md:grid-cols-3">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`panel flex flex-col p-7 ${t.featured ? "border-ink/30" : ""}`}
            >
              <span className="text-sm text-moss">{t.name}</span>
              <div className="mt-3 font-display text-4xl font-medium tracking-tight">
                {t.price}
                <small className="ml-1 text-sm font-normal text-moss">/mo</small>
              </div>
              <ul className="mt-6 flex-1 space-y-2 text-sm text-moss">
                {t.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <Link
                to="/studio"
                className={`mt-8 block rounded-md py-2.5 text-center text-sm transition-opacity hover:opacity-85 ${
                  t.featured ? "bg-ink text-paper" : "border border-input text-ink"
                }`}
              >
                {t.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>
      <Footer />
    </div>
  );
}
