import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { Nav } from "@/components/Nav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { useAccount } from "@/components/account/AccountProvider";
import { publicEntry } from "@/lib/public-entry";
import { BUSINESS, PRO_STEPS, TEAM_STEPS } from "@/lib/published-plans";
import {
  PlanCardGrid,
  PRICING_LEDE,
  plansForAudience,
} from "@/components/marketing/HomePricing";

import { useMarketingMotion } from "@/components/marketing/useMarketingMotion";
import "@/components/marketing/marketing-page.css";
import "@/components/marketing/sky-entry.css";
import "@/components/marketing/pricing-page.css";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Celinen Pricing — Plans for Photographers" },
      {
        name: "description",
        content:
          "Explore Celinen plans: Hobby from USD 16 per month billed yearly, Creator, Arena, and custom Enterprise. Compare pricing and choose your next step.",
      },
      { property: "og:title", content: "Celinen Pricing — Plans for Photographers" },
      {
        property: "og:description",
        content:
          "A free account entry, Hobby, Creator, and Arena plans, and Enterprise enquiries for photographers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PricingPage,
});

type Cycle = "monthly" | "yearly";
type Audience = "personal" | "teams" | "enterprise";
const AUDIENCES: Audience[] = ["personal", "teams", "enterprise"];

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
  [
    "Can I post to all my socials at once?",
    "Connect Instagram, TikTok, YouTube, X, and the rest in Connectors. One send can go to every connected app — feed, Stories, and the specific highlights you pick. Each app has to be connected and allowed first.",
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
    <svg viewBox="0 0 16 16" className="pricing-check" aria-hidden="true">
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
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [audience, setAudience] = useState<Audience>("personal");
  const [proStep, setProStep] = useState(0);
  const [teamStep, setTeamStep] = useState(0);
  const [open, setOpen] = useState<number | null>(0);
  /* Motion must not re-run when the audience pill follows the cursor. */
  const motion = useMarketingMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const audienceRef = useRef(audience);
  const liveRef = useRef(false);
  const slideRef = useRef(0);
  audienceRef.current = audience;

  const paintThumb = (slide: number, live: boolean) => {
    slideRef.current = slide;
    liveRef.current = live;
    trackRef.current?.classList.toggle("is-live", live);
    if (thumbRef.current) thumbRef.current.style.transform = `translate3d(${slide * 100}%, 0, 0)`;
  };

  useLayoutEffect(() => {
    paintThumb(liveRef.current ? slideRef.current : AUDIENCES.indexOf(audience), liveRef.current);
  }, [audience]);

  const yearly = cycle === "yearly";
  const pro = PRO_STEPS[proStep]!;
  const team = TEAM_STEPS[teamStep]!;
  const proPrice = yearly ? pro.yearly : pro.monthly;
  const teamPrice = yearly ? team.yearly : team.monthly;
  const active = audience === "teams" ? team : pro;
  const activePct = savingsPct(active.monthly, active.yearly);
  const activeSaved = savingsPerYear(active.monthly, active.yearly);

  /* Whole pill is hot: thumb follows cursor X 1:1; plan still maps to three bands. Touch still clicks. */
  const followAudience = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const pad = 5;
    const inner = Math.max(1, box.width - pad * 2);
    const u = (event.clientX - box.left - pad) / inner;
    /* Thumb center tracks the pointer; clamp so the chip stays inside the track. */
    const slide = Math.min(2, Math.max(0, u * AUDIENCES.length - 0.5));
    paintThumb(slide, true);
    const t = (event.clientX - box.left) / box.width;
    const next = AUDIENCES[Math.min(2, Math.max(0, Math.floor(t * AUDIENCES.length)))];
    if (next) setAudience((current) => (current === next ? current : next));
  };

  const releaseAudience = () => {
    paintThumb(AUDIENCES.indexOf(audienceRef.current), false);
  };

  return (
    <div ref={motion} className="marketing-page marketing-pricing">
      <a className="marketing-skip" href="#pricing-content">
        Skip to content
      </a>
      <Nav landing />
      <main id="pricing-content" tabIndex={-1} className="pricing-content">
        {/* hero */}
        <div className="pricing-intro text-center" data-reveal>
          <h1>
            Pricing that <em>scales with you</em>
          </h1>
          <p>{PRICING_LEDE}</p>

          {/* audience tabs — follow the cursor; click still works for keyboard/touch */}
          <div
            ref={trackRef}
            className="pricing-audiences"
            role="group"
            aria-label="Plan audience"
            onPointerMove={followAudience}
            onPointerEnter={followAudience}
            onPointerLeave={releaseAudience}
            onPointerCancel={releaseAudience}
          >
            <span className="pricing-audiences__thumb" ref={thumbRef} aria-hidden="true" />
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
                data-audience={id}
                aria-pressed={audience === id}
                onClick={() => setAudience(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* billing toggle */}
          {audience !== "enterprise" && (
            <div className="pricing-billing">
              <div className="pricing-billing__cycle" role="group" aria-label="Billing">
                <button
                  type="button"
                  aria-pressed={!yearly}
                  onClick={() => setCycle("monthly")}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  aria-pressed={yearly}
                  onClick={() => setCycle("yearly")}
                >
                  Yearly
                </button>
              </div>
              {yearly ? (
                <p className="pricing-billing__save">
                  Save {activePct}%. ${activeSaved} a year
                </p>
              ) : null}
            </div>
          )}
        </div>

        {/* Visible cards match home. Hidden block keeps checkout/test links. */}
        <div className="home-pricing" data-reveal>
          <PlanCardGrid plans={plansForAudience(audience, yearly)} />
          {audience !== "enterprise" && (
            <p className="pricing-free">
              <Link to={freeEntry.to} search={freeEntry.search}>
                {account?.status === "in" ? "Dashboard" : "Create free account"}
              </Link>
            </p>
          )}
        </div>
        <div className="pricing-plans" hidden>
          {audience === "enterprise" ? (
            <>
              <div className="flex flex-col rounded-2xl border border-border bg-card p-7">
                <span className="font-display text-sm font-semibold">Business</span>
                <p className="mt-1 text-[13px] text-moss">Studios running multiple shooters.</p>
                <div className="pricing-amount mt-4 font-display text-4xl font-bold tracking-[-0.03em]">
                  <span className="pricing-currency">USD</span>
                  <span className="pricing-figure">{BUSINESS.yearly}</span>
                  <small className="pricing-period">/ user / mo</small>
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
                <div className="pricing-amount mt-4 font-display text-4xl font-bold tracking-[-0.03em]">
                  <span className="pricing-currency">USD</span>
                  <span className="pricing-figure">0</span>
                  <small className="pricing-period">to create an account</small>
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
                  {account?.status === "in" ? "Dashboard" : "Create free account"}
                </Link>
              </div>

              {/* Pro / Teams — highlighted */}
              <div className="relative flex flex-col rounded-2xl border border-ink/25 bg-card p-7 shadow-[0_10px_40px_rgba(0,0,0,0.07)]">
                <span className="pricing-popular">Most popular</span>
                <span className="font-display text-sm font-semibold">
                  {audience === "teams" ? "Teams" : "Pro"}
                </span>
                <p className="mt-1 text-[13px] text-moss">
                  {audience === "teams"
                    ? "Second shooter, editor, one bill."
                    : "One shooter working a real schedule."}
                </p>
                <div className="pricing-amount mt-4 font-display text-4xl font-bold tracking-[-0.03em]">
                  <span className="pricing-currency">USD</span>
                  <span className="pricing-figure">
                    {audience === "teams" ? teamPrice : proPrice}
                  </span>
                  <small className="pricing-period">
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
                  {audience === "teams" ? "Choose Teams" : "Choose Pro"}
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
          <img src="/images/celinen-open-sky.webp" width={1672} height={941} alt="" loading="lazy" />
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
              search={{ plan: "hobby", billing: cycle }}
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

