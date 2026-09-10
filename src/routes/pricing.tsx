import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { recordSignup } from "@/utils/payments.functions";
import { Fragment, useState } from "react";
import { Nav } from "@/components/Nav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { useAccount } from "@/components/account/AccountProvider";
import { publicEntry } from "@/lib/public-entry";
import { useMarketingMotion } from "@/components/marketing/useMarketingMotion";
import "@/components/marketing/marketing-page.css";
import "@/components/marketing/sky-entry.css";
import "@/components/marketing/pricing-page.css";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "FOTO Pricing — Plans for Photographers" },
      {
        name: "description",
        content:
          "Explore FOTO plans: Pro from USD 16 per month billed yearly, Teams per user, and custom Enterprise options. Compare pricing and choose your next step.",
      },
      { property: "og:title", content: "FOTO Pricing — Plans for Photographers" },
      {
        property: "og:description",
        content:
          "A free account entry, Pro and Teams plan options, and Enterprise enquiries for photographers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PricingPage,
});

type Cycle = "monthly" | "yearly";
type Audience = "personal" | "teams" | "enterprise";

/* Existing published plan amounts; presentation changes must not change billing. */
const PRO_STEPS = [
  { photos: "1,000 photos / mo", plan: "starter", monthly: 20, yearly: 16 },
  { photos: "5,000 photos / mo", plan: "sideline", monthly: 60, yearly: 48 },
  { photos: "25,000 photos / mo", plan: "arena", monthly: 200, yearly: 160 },
];

const TEAM_STEPS = [
  { photos: "5,000 photos / user / mo", plan: "crew", monthly: 40, yearly: 32 },
  { photos: "25,000 photos / user / mo", plan: "agency", monthly: 80, yearly: 64 },
];

/* Enterprise Business seat: USD 80 monthly, USD 64/mo when billed yearly. */
const BUSINESS = { monthly: 80, yearly: 64 };

/** Percent saved by paying the annual rate instead of the monthly rate. */
const savingsPct = (monthly: number, yearly: number) =>
  monthly > 0 ? Math.round(((monthly - yearly) / monthly) * 100) : 0;

/** USD saved over 12 months. */
const savingsPerYear = (monthly: number, yearly: number) => (monthly - yearly) * 12;

const FAQ: [string, string][] = [
  [
    "How should I compare the plans?",
    "Compare the listed photo volume, billing cycle, and whether the price is per user. Confirm the available capabilities and final charge at checkout before purchasing.",
  ],
  [
    "Do I have to leave my current editor?",
    "No. You can keep your existing editor. Check compatibility with your files and metadata before moving a workflow; matching controls does not guarantee identical pixels.",
  ],
  [
    "Is a reject a delete?",
    "Never. Rejects are soft — flagged and reversible, originals untouched.",
  ],
  [
    "How does annual pricing work?",
    "The annual option shows an equivalent monthly rate. The full annual amount is shown alongside it; the savings compare twelve months at the listed monthly rate.",
  ],
  [
    "What about team setup and integrations?",
    "Contact us with your requirements before purchasing. Identity providers, shared workflows, migration, and external integrations need to be confirmed for your setup.",
  ],
  [
    "Where can I check billing and refund terms?",
    "Review the terms and final amount shown at checkout. For a plan change, cancellation, or refund question, contact hello@lenslab.dev before proceeding.",
  ],
];

const COMPARE: { section: string; rows: string[][] }[] = [
  {
    section: "Plan outline",
    rows: [
      ["Listed photo volume / month", "Not quoted", "1k – 25k", "5k – 25k / user", "Discuss"],
      ["Billing unit", "Account entry", "Photographer", "User", "Custom"],
      ["Monthly and annual options", "Not applicable", "yes", "yes", "Discuss"],
    ],
  },
  {
    section: "Before you choose",
    rows: [
      ["Feature availability", "Check workspace", "Confirm", "Confirm", "Discuss"],
      [
        "External integrations",
        "Check compatibility",
        "Check compatibility",
        "Check compatibility",
        "Discuss",
      ],
      ["Custom migration or identity setup", "Contact us", "Contact us", "Contact us", "Discuss"],
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
      <span className="inline-flex justify-center" role="img" aria-label="Available">
        <Check />
      </span>
    );
  if (v === "no") return <span className="text-moss/45">—</span>;
  return <span className="text-moss">{v}</span>;
}

function PricingPage() {
  const account = useAccount();
  const freeEntry = publicEntry(account?.status);
  const [cycle, setCycle] = useState<Cycle>("yearly");
  const [audience, setAudience] = useState<Audience>("personal");
  const [proStep, setProStep] = useState(0);
  const [teamStep, setTeamStep] = useState(0);
  const [open, setOpen] = useState<number | null>(0);
  const motion = useMarketingMotion(audience);

  const yearly = cycle === "yearly";
  const pro = PRO_STEPS[proStep]!;
  const team = TEAM_STEPS[teamStep]!;
  const proPrice = yearly ? pro.yearly : pro.monthly;
  const teamPrice = yearly ? team.yearly : team.monthly;
  const active = audience === "teams" ? team : pro;
  const activePct = savingsPct(active.monthly, active.yearly);
  const activeSaved = savingsPerYear(active.monthly, active.yearly);

  return (
    <div ref={motion} className="marketing-page marketing-pricing">
      <a className="marketing-skip" href="#pricing-content">
        Skip to content
      </a>
      <Nav landing />
      <main id="pricing-content" tabIndex={-1} className="pricing-content">
        {/* hero */}
        <div className="pricing-intro text-center" data-reveal>
          <p className="pricing-eyebrow">A little more room to create</p>
          <h1 className="mx-auto font-display text-[clamp(2.2rem,5.4vw,3.6rem)] font-bold leading-[1.03] tracking-[-0.04em]">
            Find your next horizon.
          </h1>
          <p className="mx-auto mt-4 max-w-[560px] text-[15px] text-moss">
            Explore the workspace. Compare plans for your next shoot, a busy season, or a whole
            team.
          </p>

          {/* audience tabs */}
          <div className="pricing-audiences" role="group" aria-label="Plan audience">
            {(
              [
                ["personal", "Personal"],
                ["teams", "Teams"],
                ["enterprise", "Enterprise"],
              ] as [Audience, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={audience === id}
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
            <div className="pricing-billing">
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
                Save {activePct}% · USD {activeSaved}/yr
              </span>
            </div>
          )}
        </div>

        {/* plan cards */}
        <div className="pricing-plans" data-reveal>
          {audience === "enterprise" ? (
            <>
              <div className="flex flex-col rounded-2xl border border-border bg-card p-7">
                <span className="font-display text-sm font-semibold">Business</span>
                <p className="mt-1 text-[13px] text-moss">Studios running multiple shooters.</p>
                <div className="mt-4 font-display text-4xl font-bold tracking-[-0.03em]">
                  <span className="pricing-currency">USD</span> {BUSINESS.yearly}
                  <small className="ml-1 text-sm font-normal text-moss">/ user / mo</small>
                </div>
                <p className="mt-1 text-[12px] text-moss">
                  Billed yearly · USD {BUSINESS.yearly * 12} / user / yr · USD {BUSINESS.monthly} /
                  user monthly ·{" "}
                  <span className="text-rust">
                    save {savingsPct(BUSINESS.monthly, BUSINESS.yearly)}% (USD{" "}
                    {savingsPerYear(BUSINESS.monthly, BUSINESS.yearly)} / user / yr)
                  </span>
                </p>

                <Features
                  items={[
                    "Discuss your team workflow",
                    "Confirm shared workspace needs",
                    "Review approval requirements",
                    "Confirm billing and support options",
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
                <p className="mt-1 text-[12px] text-moss">
                  Scope and terms agreed before purchase.
                </p>
                <Features
                  items={[
                    "Discuss volume across studios",
                    "Review identity and seat requirements",
                    "Confirm gallery destinations",
                    "Discuss invoice / PO requirements",
                    "Define workflow support",
                  ]}
                />
                <a href="mailto:hello@lenslab.dev" className={`${ctaBase} bg-ink text-paper2`}>
                  Contact sales
                </a>
              </div>

              <div className="flex flex-col rounded-2xl border border-border bg-card p-7">
                <span className="font-display text-sm font-semibold">Onboarding</span>
                <p className="mt-1 text-[13px] text-moss">
                  A conversation about your existing workflow.
                </p>
                <div className="mt-4 font-display text-4xl font-bold tracking-[-0.03em]">
                  Let’s talk
                </div>
                <p className="mt-1 text-[12px] text-moss">
                  Confirm scope and availability with us.
                </p>
                <Features
                  items={[
                    "Review your current setup",
                    "Check file and metadata compatibility",
                    "Discuss team onboarding",
                    "Agree migration scope",
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
                <p className="mt-1 text-[13px] text-moss">Create an account and explore.</p>
                <div className="mt-4 font-display text-4xl font-bold tracking-[-0.03em]">
                  <span className="pricing-currency">USD</span> 0
                  <small className="ml-1 text-sm font-normal text-moss">to create an account</small>
                </div>
                <p className="mt-1 text-[12px] text-moss">No paid plan selected by this button.</p>
                <Features
                  items={[
                    "Your own workspace account",
                    "Explore the photography workflow",
                    "Check available tools before choosing a plan",
                  ]}
                />
                <Link
                  to={freeEntry.to}
                  search={freeEntry.search}
                  className={`${ctaBase} border border-input text-ink`}
                >
                  {account?.status === "in" ? "Open workspace" : "Create free account"}
                </Link>
              </div>

              {/* Pro / Teams — highlighted */}
              <div className="relative flex flex-col rounded-2xl border border-ink/25 bg-card p-7 shadow-[0_10px_40px_rgba(0,0,0,0.07)]">
                <span className="absolute -top-2.5 left-7 rounded-full bg-ink px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-paper2">
                  {audience === "teams" ? "Create together" : "Room to grow"}
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
                  <span className="pricing-currency">USD</span>{" "}
                  {audience === "teams" ? teamPrice : proPrice}
                  <small className="ml-1 text-sm font-normal text-moss">
                    {audience === "teams" ? "/ user / mo" : "/ mo"}
                  </small>
                </div>
                <p className="mt-1 text-[12px] text-moss">
                  {yearly ? (
                    <>
                      Billed yearly (USD {active.yearly * 12}
                      {audience === "teams" ? " / user" : ""} / yr) · USD {active.monthly} monthly ·{" "}
                      <span className="text-rust">
                        save {activePct}% (USD {activeSaved}
                        {audience === "teams" ? " / user" : ""} / yr)
                      </span>
                    </>
                  ) : (
                    <>
                      Billed monthly · switch to annual for USD {active.yearly} / mo and{" "}
                      <span className="text-rust">
                        save {activePct}% (USD {activeSaved}
                        {audience === "teams" ? " / user" : ""} / yr)
                      </span>
                    </>
                  )}
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
                        {s.photos} — USD {yearly ? s.yearly : s.monthly}/mo
                        {yearly ? ` (save ${savingsPct(s.monthly, s.yearly)}%)` : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <Features
                  items={
                    audience === "teams"
                      ? [
                          team.photos,
                          "Per-user plan pricing",
                          "Confirm shared workflow requirements",
                          "Check feature availability before purchase",
                        ]
                      : [
                          pro.photos,
                          "Monthly or annual billing options",
                          "Choose the volume that fits your work",
                          "Check feature availability before purchase",
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
                <p className="mt-1 text-[12px] text-moss">
                  Scope and terms agreed before purchase.
                </p>
                <Features
                  items={[
                    "Discuss volume across studios",
                    "Review identity and seat requirements",
                    "Confirm gallery destinations",
                    "Discuss invoice / PO requirements",
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

        {/* upgrade form */}
        <div id="upgrade" className="pricing-upgrade">
          <UpgradeForm cycle={cycle} audience={audience} proPlan={pro.plan} teamPlan={team.plan} />
        </div>

        {/* comparison table */}
        <div className="pricing-compare" data-reveal>
          <h2 className="text-center font-display text-[26px] font-bold tracking-[-0.03em]">
            At a glance
          </h2>
          <div
            className="pricing-table-scroll"
            role="region"
            aria-label="Plan comparison"
            tabIndex={0}
          >
            <table className="w-full min-w-[680px] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="w-[34%] px-5 py-4 font-mono text-[10px] uppercase tracking-[0.14em] text-moss">
                    Plan detail
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
        <div className="pricing-faq" data-reveal>
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
                  aria-controls={`pricing-answer-${i}`}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-medium"
                >
                  {q}
                  <span
                    className={`text-moss transition-transform ${open === i ? "rotate-45" : ""}`}
                  >
                    +
                  </span>
                </button>
                {open === i && (
                  <p id={`pricing-answer-${i}`} className="px-5 pb-4 text-[13.5px] text-moss">
                    {a}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* closing CTA */}
        <div className="pricing-closing" data-reveal>
          <img src="/images/foto-open-sky.webp" width={1672} height={941} alt="" loading="lazy" />
          <div>
            <p className="font-display text-xl font-semibold tracking-tight">
              Make room for your next great shot.
            </p>
            <p className="mt-1 text-[13.5px] text-moss">
              A workflow shaped around your photography.
            </p>
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
      </main>

      <MarketingFooter />
    </div>
  );
}

/** Saves the email, then hands off to checkout with the plan pre-selected. */
function UpgradeForm({
  cycle,
  audience,
  proPlan,
  teamPlan,
}: {
  cycle: Cycle;
  audience: Audience;
  proPlan: string;
  teamPlan: string;
}) {
  const navigate = useNavigate();
  const save = useServerFn(recordSignup);
  const [email, setEmail] = useState("");
  const [studio, setStudio] = useState("");
  const [plan, setPlan] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const suggested = audience === "teams" ? teamPlan : proPlan;
  const chosen = plan ?? suggested;
  const option = UPGRADE_PLANS.find((p) => p.id === chosen) ?? UPGRADE_PLANS[1]!;
  const price = cycle === "yearly" ? option.yearly : option.monthly;
  const saved = (option.monthly - option.yearly) * 12;
  const pct = Math.round(((option.monthly - option.yearly) / option.monthly) * 100);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!email.trim()) return setErr("We need an email to put the plan on.");
    setBusy(true);
    try {
      const res = await save({
        data: { email: email.trim().toLowerCase(), plan: chosen, billing: cycle, studio },
      });
      if ("error" in res && res.error) throw new Error(res.error);
      await navigate({
        to: "/signup",
        search: { plan: chosen, billing: cycle, email: email.trim().toLowerCase() },
      });
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not start checkout");
      setBusy(false);
    }
  };

  const field =
    "mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-[16px] text-ink outline-none focus:border-rust sm:py-2 sm:text-[14px]";

  return (
    <div className="mx-auto max-w-[720px] rounded-2xl border border-border bg-card p-6 sm:p-8">
      <h2 className="font-display text-[24px] font-bold tracking-[-0.03em]">Choose your plan</h2>
      <p className="mt-1.5 text-[13.5px] text-moss">
        Save your selection, then review the final amount and billing terms at checkout.
      </p>

      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-[12px] text-moss">
          Plan
          <select value={chosen} onChange={(e) => setPlan(e.target.value)} className={field}>
            {UPGRADE_PLANS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — USD {cycle === "yearly" ? p.yearly : p.monthly}/mo
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12px] text-moss">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@studio.com"
            className={field}
          />
        </label>
        <label className="text-[12px] text-moss sm:col-span-2">
          Studio name (optional)
          <input value={studio} onChange={(e) => setStudio(e.target.value)} className={field} />
        </label>

        <div className="rounded-xl border border-border bg-background px-4 py-3 text-[13px] sm:col-span-2">
          <span className="font-mono text-[15px]">USD {price}</span>
          <span className="text-moss">
            {option.perUser ? " / user" : ""} per month, billed {cycle}
          </span>
          {cycle === "yearly" ? (
            <span className="ml-2 text-rust">
              save {pct}% — USD {saved}
              {option.perUser ? " / user" : ""} a year vs USD {option.monthly}/mo
            </span>
          ) : (
            <span className="ml-2 text-moss">
              switch to yearly and save {pct}% (USD {saved}
              {option.perUser ? " / user" : ""} a year)
            </span>
          )}
        </div>

        {err && <p className="text-[13px] text-destructive sm:col-span-2">{err}</p>}

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-rust px-5 py-2.5 text-[14px] font-semibold text-paper2 hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Starting…" : "Continue to checkout"}
          </button>
        </div>
      </form>
    </div>
  );
}

const UPGRADE_PLANS = [
  { id: "hobby", label: "Hobby", monthly: 20, yearly: 16, perUser: false },
  { id: "starter", label: "Pro · 1,000 photos", monthly: 20, yearly: 16, perUser: false },
  { id: "sideline", label: "Pro · 5,000 photos", monthly: 60, yearly: 48, perUser: false },
  { id: "arena", label: "Pro · 25,000 photos", monthly: 200, yearly: 160, perUser: false },
  { id: "crew", label: "Teams · Crew", monthly: 40, yearly: 32, perUser: true },
  { id: "agency", label: "Teams · Agency", monthly: 80, yearly: 64, perUser: true },
];
