import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { ThemeToggle } from "@/components/lensos/Theme";
import { Footer } from "@/components/lensos/Footer";
import { LogoMark } from "@/components/lensos/Logo";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "LensLabs Pricing — Plans for Photographers" },
      {
        name: "description",
        content:
          "Simple LensLabs pricing: Free to try, Pro from $16/mo billed yearly, Teams per user, Enterprise custom. Pick, hand off to Adobe, send the gallery tonight.",
      },
      { property: "og:title", content: "LensLabs Pricing — Plans for Photographers" },
      {
        property: "og:description",
        content:
          "Free, Pro, Teams and Enterprise plans for sports, event and wedding shooters. Same-night turnaround.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PricingPage,
});

type Cycle = "monthly" | "yearly";
type Audience = "personal" | "teams" | "enterprise";

/* Usage tiers, priced like Lovable's credit ladder. */
const PRO_STEPS = [
  { photos: "1,000 photos / mo", plan: "starter", monthly: 20, yearly: 16 },
  { photos: "5,000 photos / mo", plan: "sideline", monthly: 60, yearly: 48 },
  { photos: "25,000 photos / mo", plan: "arena", monthly: 200, yearly: 160 },
];

const TEAM_STEPS = [
  { photos: "5,000 photos / user / mo", plan: "crew", monthly: 40, yearly: 32 },
  { photos: "25,000 photos / user / mo", plan: "agency", monthly: 80, yearly: 64 },
];

const FAQ: [string, string][] = [
  ["What counts as a photo?", "A frame ingested into a job during the billing period. Re-culling the same job never counts twice."],
  ["Do I have to leave Lightroom?", "No. LensLabs decides volume; keepers hand off to Lightroom and Photoshop with XMP intact. Craft stays where it is."],
  ["Is a reject a delete?", "Never. Rejects are soft — flagged and reversible, originals untouched."],
  ["Can I change plans later?", "Yes, up or down at any time. Changes are prorated on your next invoice."],
  ["What happens when I hit my limit?", "Culling pauses until the next cycle or you upgrade. Nothing is billed per extra photo without you choosing it."],
  ["Do you offer refunds?", "Cancel anytime and keep access until the end of the paid period. Email us within 14 days of a first charge and we'll sort it out."],
];

const COMPARE: { section: string; rows: string[][] }[] = [
  {
    section: "Culling",
    rows: [
      ["Photos per month", "100", "1k – 25k", "5k – 25k / user", "Pooled"],
      ["RAW + JPEG ingest", "yes", "yes", "yes", "yes"],
      ["Duplicate & stack sorting", "yes", "yes", "yes", "yes"],
      ["Needs-you queue", "no", "yes", "yes", "yes"],
    ],
  },
  {
    section: "Delivery",
    rows: [
      ["Lightroom / Photoshop handoff", "no", "yes", "yes", "yes"],
      ["Client galleries", "no", "yes", "yes", "yes"],
      ["Client favourites sync", "no", "yes", "yes", "yes"],
      ["Custom gallery destinations", "no", "no", "no", "yes"],
    ],
  },
  {
    section: "Team & billing",
    rows: [
      ["Shared event workspaces", "no", "no", "yes", "yes"],
      ["Centralized billing", "no", "no", "yes", "yes"],
      ["SSO & seat management", "no", "no", "no", "yes"],
      ["Invoice / PO billing", "no", "no", "no", "yes"],
    ],
  },
];

function Check() {
  return (
    <svg viewBox="0 0 16 16" className="mt-[3px] h-3.5 w-3.5 shrink-0 text-rust" aria-hidden="true">
      <path
        d="M3 8.4 6.2 11.6 13 4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Features({ items }: { items: string[] }) {
  return (
    <ul className="mt-6 flex-1 space-y-2.5 text-[13.5px] text-moss">
      {items.map((f) => (
        <li key={f} className="flex gap-2.5">
          <Check />
          <span>{f}</span>
        </li>
      ))}
    </ul>
  );
}

const ctaBase =
  "mt-7 block rounded-xl py-2.5 text-center text-sm font-medium transition-opacity hover:opacity-85";

function Cell({ v }: { v: string }) {
  if (v === "yes")
    return (
      <span className="inline-flex justify-center">
        <Check />
      </span>
    );
  if (v === "no") return <span className="text-moss/45">—</span>;
  return <span className="text-moss">{v}</span>;
}

function PricingPage() {
  const [cycle, setCycle] = useState<Cycle>("yearly");
  const [audience, setAudience] = useState<Audience>("personal");
  const [proStep, setProStep] = useState(0);
  const [teamStep, setTeamStep] = useState(0);
  const [open, setOpen] = useState<number | null>(0);

  const yearly = cycle === "yearly";
  const pro = PRO_STEPS[proStep]!;
  const team = TEAM_STEPS[teamStep]!;
  const proPrice = yearly ? pro.yearly : pro.monthly;
  const teamPrice = yearly ? team.yearly : team.monthly;

  return (
    <div className="flex min-h-screen w-full flex-col text-ink">
      <div className="sticky top-4 z-50 px-4">
        <header className="mx-auto flex w-full max-w-[1240px] items-center justify-between rounded-2xl border border-border bg-card/90 px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] backdrop-blur">
          <Link to="/" className="flex items-center gap-2">
            <LogoMark className="text-ink" />
            <span className="font-display text-[15px] font-semibold tracking-tight">LensLabs</span>
          </Link>

          <nav className="hidden items-center gap-1 text-sm text-moss sm:flex">
            <Link to="/" className="rounded-lg px-3 py-1.5 hover:bg-muted hover:text-ink">
              Product
            </Link>
            <span className="rounded-lg bg-muted px-3 py-1.5 text-ink">Pricing</span>
            <Link to="/community" className="rounded-lg px-3 py-1.5 hover:bg-muted hover:text-ink">
              Community
            </Link>
            <a href="#enterprise" className="rounded-lg px-3 py-1.5 hover:bg-muted hover:text-ink">
              Contact sales
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              to="/signup"
              search={{ plan: "starter", billing: cycle }}
              className="rounded-xl bg-ink px-4 py-2 text-sm font-medium text-paper2 transition-opacity hover:opacity-85"
            >
              Get started
            </Link>
          </div>
        </header>
      </div>

      <section className="mx-auto w-full max-w-[1240px] flex-1 px-6 pb-24 pt-16">
        {/* hero */}
        <div className="text-center">
          <h1 className="mx-auto font-display text-[clamp(2.2rem,5.4vw,3.6rem)] font-bold leading-[1.03] tracking-[-0.04em]">
            Pricing that scales with your season
          </h1>
          <p className="mx-auto mt-4 max-w-[560px] text-[15px] text-moss">
            Start free. Upgrade when the shoots stack up. Every plan culls, hands off to Adobe and
            sends the gallery the same night.
          </p>

          {/* audience tabs */}
          <div className="mt-9 inline-flex rounded-xl border border-input p-1">
            {(
              [
                ["personal", "Personal"],
                ["teams", "Teams"],
                ["enterprise", "Enterprise"],
              ] as [Audience, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setAudience(id)}
                className={`rounded-lg px-4 py-1.5 text-[13px] transition-colors ${
                  audience === id ? "bg-ink text-paper2" : "text-moss hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* billing toggle */}
          {audience !== "enterprise" && (
            <div className="mt-5 flex items-center justify-center gap-3 text-[13px]">
              <button
                onClick={() => setCycle("monthly")}
                className={yearly ? "text-moss hover:text-ink" : "text-ink"}
              >
                Monthly
              </button>
              <button
                role="switch"
                aria-checked={yearly}
                aria-label="Toggle annual billing"
                onClick={() => setCycle(yearly ? "monthly" : "yearly")}
                className={`relative h-6 w-11 rounded-full border border-input transition-colors ${
                  yearly ? "bg-ink" : "bg-muted"
                }`}
              >
                <span
                  className={`absolute top-[3px] h-4 w-4 rounded-full bg-paper2 transition-all ${
                    yearly ? "left-[25px]" : "left-[3px]"
                  }`}
                />
              </button>
              <button
                onClick={() => setCycle("yearly")}
                className={yearly ? "text-ink" : "text-moss hover:text-ink"}
              >
                Annual
              </button>
              <span className="rounded-full border border-rust/40 bg-rust/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-rust">
                Save 20%
              </span>
            </div>
          )}
        </div>

        {/* plan cards */}
        <div className="mt-12 grid items-stretch gap-4 text-left lg:grid-cols-3">
          {audience === "enterprise" ? (
            <>
              <div className="flex flex-col rounded-2xl border border-border bg-card p-7">
                <span className="font-display text-sm font-semibold">Business</span>
                <p className="mt-1 text-[13px] text-moss">Studios running multiple shooters.</p>
                <div className="mt-4 font-display text-4xl font-bold tracking-[-0.03em]">
                  $64
                  <small className="ml-1 text-sm font-normal text-moss">/ user / mo</small>
                </div>
                <p className="mt-1 text-[12px] text-moss">Billed yearly.</p>
                <Features
                  items={[
                    "Everything in Teams",
                    "Shared event workspaces",
                    "Approval gate before send",
                    "Centralized billing",
                    "Priority support",
                  ]}
                />
                <Link
                  to="/signup"
                  search={{ plan: "agency", billing: "yearly" }}
                  className={`${ctaBase} border border-input text-ink`}
                >
                  Get Business
                </Link>
              </div>

              <div
                id="enterprise"
                className="flex flex-col rounded-2xl border border-ink/25 bg-card p-7 shadow-[0_10px_40px_rgba(0,0,0,0.07)]"
              >
                <span className="font-display text-sm font-semibold">Enterprise</span>
                <p className="mt-1 text-[13px] text-moss">League and agency volume.</p>
                <div className="mt-4 font-display text-4xl font-bold tracking-[-0.03em]">
                  Custom
                </div>
                <p className="mt-1 text-[12px] text-moss">Invoiced to your terms.</p>
                <Features
                  items={[
                    "Everything in Business",
                    "Pooled usage across studios",
                    "SSO and seat management",
                    "Custom gallery destinations",
                    "Invoice / PO billing",
                    "Dedicated workflow support",
                  ]}
                />
                <a href="mailto:hello@lenslab.dev" className={`${ctaBase} bg-ink text-paper2`}>
                  Contact sales
                </a>
              </div>

              <div className="flex flex-col rounded-2xl border border-border bg-card p-7">
                <span className="font-display text-sm font-semibold">Onboarding</span>
                <p className="mt-1 text-[13px] text-moss">We migrate your existing workflow.</p>
                <div className="mt-4 font-display text-4xl font-bold tracking-[-0.03em]">
                  Included
                </div>
                <p className="mt-1 text-[12px] text-moss">With any annual Enterprise plan.</p>
                <Features
                  items={[
                    "Lightroom preset and catalog import",
                    "Bridge install across machines",
                    "Team training session",
                    "Named workflow contact",
                  ]}
                />
                <a
                  href="mailto:hello@lenslab.dev"
                  className={`${ctaBase} border border-input text-ink`}
                >
                  Talk to us
                </a>
              </div>
            </>
          ) : (
            <>
              {/* Free */}
              <div className="flex flex-col rounded-2xl border border-border bg-card p-7">
                <span className="font-display text-sm font-semibold">Free</span>
                <p className="mt-1 text-[13px] text-moss">Try the cull on a real shoot.</p>
                <div className="mt-4 font-display text-4xl font-bold tracking-[-0.03em]">
                  $0
                  <small className="ml-1 text-sm font-normal text-moss">/ mo</small>
                </div>
                <p className="mt-1 text-[12px] text-moss">100 photos per month.</p>
                <Features
                  items={[
                    "100 photos per month",
                    "RAW and JPEG ingest",
                    "Duplicate and stack sorting",
                    "Basic keeper recommendations",
                    "Public community access",
                  ]}
                />
                <Link
                  to="/signup"
                  search={{ plan: "hobby", billing: cycle }}
                  className={`${ctaBase} border border-input text-ink`}
                >
                  Start free
                </Link>
              </div>

              {/* Pro / Teams — highlighted */}
              <div className="relative flex flex-col rounded-2xl border border-ink/25 bg-card p-7 shadow-[0_10px_40px_rgba(0,0,0,0.07)]">
                <span className="absolute -top-2.5 left-7 rounded-full bg-ink px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-paper2">
                  Most popular
                </span>
                <span className="font-display text-sm font-semibold">
                  {audience === "teams" ? "Teams" : "Pro"}
                </span>
                <p className="mt-1 text-[13px] text-moss">
                  {audience === "teams"
                    ? "Second shooter, editor, one bill."
                    : "One shooter working a real schedule."}
                </p>
                <div className="mt-4 font-display text-4xl font-bold tracking-[-0.03em]">
                  ${audience === "teams" ? teamPrice : proPrice}
                  <small className="ml-1 text-sm font-normal text-moss">
                    {audience === "teams" ? "/ user / mo" : "/ mo"}
                  </small>
                </div>
                <p className="mt-1 text-[12px] text-moss">
                  {yearly
                    ? `Billed yearly · $${audience === "teams" ? team.monthly : pro.monthly} monthly`
                    : "Billed monthly"}
                </p>

                {/* usage selector */}
                <label className="mt-4 block">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-moss">
                    Usage
                  </span>
                  <select
                    value={audience === "teams" ? teamStep : proStep}
                    onChange={(e) =>
                      audience === "teams"
                        ? setTeamStep(Number(e.target.value))
                        : setProStep(Number(e.target.value))
                    }
                    className="mt-1.5 w-full rounded-xl border border-input bg-card px-3 py-2 text-[13.5px] text-ink outline-none focus:border-rust"
                  >
                    {(audience === "teams" ? TEAM_STEPS : PRO_STEPS).map((s, i) => (
                      <option key={s.plan} value={i}>
                        {s.photos}
                      </option>
                    ))}
                  </select>
                </label>

                <Features
                  items={
                    audience === "teams"
                      ? [
                          "Everything in Pro, plus:",
                          "Shared event workspaces",
                          "Centralized team billing",
                          "Approval gate before send",
                          "Per-seat culling limits",
                        ]
                      : [
                          "Everything in Free, plus:",
                          "Lightroom and Photoshop handoff with XMP",
                          "Client galleries and same-night send",
                          "Client favourites synced back to the job",
                          "Needs-you queue for story frames",
                          "Parking-lot review while ingest continues",
                        ]
                  }
                />
                <Link
                  to="/signup"
                  search={{
                    plan: audience === "teams" ? team.plan : pro.plan,
                    billing: cycle,
                  }}
                  className={`${ctaBase} bg-ink text-paper2`}
                >
                  {audience === "teams" ? "Get Teams" : "Get Pro"}
                </Link>
              </div>

              {/* Enterprise teaser */}
              <div className="flex flex-col rounded-2xl border border-border bg-card p-7">
                <span className="font-display text-sm font-semibold">Enterprise</span>
                <p className="mt-1 text-[13px] text-moss">Studio and league volume.</p>
                <div className="mt-4 font-display text-4xl font-bold tracking-[-0.03em]">
                  Custom
                </div>
                <p className="mt-1 text-[12px] text-moss">Invoiced to your terms.</p>
                <Features
                  items={[
                    "Everything in Teams, plus:",
                    "Pooled usage across studios",
                    "SSO and seat management",
                    "Custom gallery destinations",
                    "Invoice / PO billing",
                    "Dedicated workflow support",
                  ]}
                />
                <button
                  onClick={() => setAudience("enterprise")}
                  className={`${ctaBase} w-full border border-input text-ink`}
                >
                  Contact sales
                </button>
              </div>
            </>
          )}
        </div>

        {/* comparison table */}
        <div className="mt-20">
          <h2 className="text-center font-display text-[26px] font-bold tracking-[-0.03em]">
            Compare plans
          </h2>
          <div className="mt-7 overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-[680px] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="w-[34%] px-5 py-4 font-mono text-[10px] uppercase tracking-[0.14em] text-moss">
                    Feature
                  </th>
                  {["Free", "Pro", "Teams", "Enterprise"].map((h) => (
                    <th key={h} className="px-5 py-4 text-center font-display text-[13px]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE.map((group) => (
                  <Fragment key={group.section}>
                    <tr className="border-b border-border bg-muted/50">
                      <td
                        colSpan={5}
                        className="px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-moss"
                      >
                        {group.section}
                      </td>
                    </tr>
                    {group.rows.map((row) => (
                      <tr key={row[0]} className="border-b border-border last:border-0">
                        <td className="px-5 py-3">{row[0]}</td>
                        {(row.slice(1) as string[]).map((v, i) => (
                          <td key={i} className="px-5 py-3 text-center">
                            <Cell v={v} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* FAQ accordion */}
        <div className="mt-20 grid gap-8 md:grid-cols-[280px_minmax(0,1fr)]">
          <div>
            <h2 className="font-display text-[26px] font-bold tracking-[-0.03em]">
              Frequently asked
            </h2>
            <p className="mt-2 text-[13.5px] text-moss">
              Still unsure?{" "}
              <a href="mailto:hello@lenslab.dev" className="text-rust hover:underline">
                Email us
              </a>
              .
            </p>
          </div>
          <div className="divide-y divide-border rounded-2xl border border-border bg-card">
            {FAQ.map(([q, a], i) => (
              <div key={q}>
                <button
                  onClick={() => setOpen(open === i ? null : i)}
                  aria-expanded={open === i}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-medium"
                >
                  {q}
                  <span className={`text-moss transition-transform ${open === i ? "rotate-45" : ""}`}>
                    +
                  </span>
                </button>
                {open === i && <p className="px-5 pb-4 text-[13.5px] text-moss">{a}</p>}
              </div>
            ))}
          </div>
        </div>

        {/* closing CTA */}
        <div className="mt-20 flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-card p-8">
          <div>
            <p className="font-display text-xl font-semibold tracking-tight">
              Your turnaround date is tonight.
            </p>
            <p className="mt-1 text-[13.5px] text-moss">Import, pick, hand off, send.</p>
          </div>
          <div className="ml-auto flex gap-2">
            <Link
              to="/signup"
              search={{ plan: "starter", billing: cycle }}
              className="rounded-xl bg-ink px-4 py-2 text-sm font-medium text-paper2 hover:opacity-85"
            >
              Get started
            </Link>
            <a
              href="mailto:hello@lenslab.dev"
              className="rounded-xl border border-input px-4 py-2 text-sm font-medium hover:opacity-85"
            >
              Contact sales
            </a>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
