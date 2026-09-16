import { useState } from "react";
import "./home-product.css";
import { Link } from "@tanstack/react-router";

type Point = { label: string; included: boolean; accent?: boolean };

type HomePlan = {
  name: string;
  price: string;
  period?: string;
  billed: string;
  save?: string;
  points: readonly Point[];
  cta: string;
  to: "/signup" | "/auth";
  search: { plan?: string; billing?: string; mode?: string };
  popular?: boolean;
};

const FAQ: [string, string][] = [
  [
    "How does Celinen work?",
    "Import a shoot, pick the keepers, and send a gallery. Original files stay on your machine unless you publish.",
  ],
  [
    "Do I have to leave my current editor?",
    "No. Keep your editor. Check file and metadata compatibility before moving a workflow.",
  ],
  [
    "How do photo credits work?",
    "Each paid plan lists credits per month. Confirm the amount at checkout before you pay. Credits are not unlimited processing.",
  ],
  [
    "Is culling, galleries, or who-is-in-this-photo a separate product?",
    "No. Hobby, Creator, Arena, and Enterprise are one photography plan. Pick, send a gallery, and roster/jersey tags sit on every paid plan. Adobe and priority support sit on Creator, Arena, and Enterprise. We do not sell cull, edit, and retouch as three Aftershoot-style add-ons.",
  ],
  [
    "Can I cancel my plan?",
    "Yes. Cancel before the next renewal. Unused credits do not convert to cash.",
  ],
  [
    "How much does Celinen cost?",
    "Hobby is USD 20 / month. Creator is USD 30 / month. Arena is USD 200 / month. Enterprise is set around your book.",
  ],
  [
    "Is a reject a delete?",
    "Never. Rejects are flagged and reversible. Originals stay untouched.",
  ],
  [
    "Can I post to Instagram, TikTok, and the rest at the same time?",
    "Yes. Connect your socials in Connectors. One send can go to every connected app at once — the feed, Stories, and the specific highlights you pick. Each destination has to be connected and allowed before you post.",
  ],
];

function Mark({ included }: { included: boolean }) {
  return included ? (
    <span className="home-pricing__mark" aria-hidden="true">
      <svg viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="9" />
        <path d="M6 10.2 8.6 12.8 14 7.4" />
      </svg>
    </span>
  ) : (
    <span className="home-pricing__mark is-out" aria-hidden="true">
      <svg viewBox="0 0 20 20">
        <path d="M6.5 6.5 13.5 13.5M13.5 6.5 6.5 13.5" />
      </svg>
    </span>
  );
}

export function PlanCardGrid({ plans }: { plans: readonly HomePlan[] }) {
  return (
    <div className="home-pricing__cards" data-count={plans.length}>
      {plans.map((plan) => (
        <article
          key={plan.name}
          className={plan.popular ? "is-popular" : undefined}
          data-reveal
        >
          {plan.popular ? <p className="home-pricing__popular">Most Popular</p> : null}
          <h3>{plan.name}</h3>
          <p className="home-pricing__figure">
            {plan.price === "Custom" ? (
              <span className="pricing-figure">Custom</span>
            ) : (
              <>
                <span className="pricing-figure" key={plan.price}>
                  ${plan.price}
                </span>
                {plan.period ? <small className="pricing-period">{plan.period}</small> : null}
              </>
            )}
          </p>
          <p className="home-pricing__billed">
            {plan.billed}
            {plan.save ? <span className="home-pricing__save">{plan.save}</span> : null}
          </p>
          <Link
            to={plan.to}
            search={plan.search}
            className={plan.popular ? "home-pricing__shine" : undefined}
          >
            {plan.cta}
          </Link>
          <ul>
            {plan.points.map((point) => (
              <li
                key={point.label}
                className={point.accent ? "is-credits" : point.included ? undefined : "is-out"}
              >
                <Mark included={point.included} />
                {point.label}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

export function plansForAudience(
  audience: "personal" | "teams" | "enterprise",
  yearly: boolean,
): HomePlan[] {
  const hobbyAmt = yearly ? 16 : 20;
  const creatorAmt = yearly ? 24 : 30;
  const arenaAmt = yearly ? 160 : 200;
  const billedFor = (monthlyRate: number, yearlyRate: number) =>
    yearly
      ? {
          billed: `Billed yearly at $${yearlyRate * 12}`,
          save: `Save $${(monthlyRate - yearlyRate) * 12}`,
        }
      : { billed: "Billed monthly" };
  const enterprise: HomePlan = {
    name: "Enterprise",
    price: "Custom",
    billed: "We’ll set this up around your book.",
    points: [{ label: "Custom credits/month", included: true, accent: true }, ...FULL_POINTS],
    cta: "Choose Enterprise",
    to: "/auth",
    search: { mode: "signup" },
  };
  if (audience === "enterprise") return [enterprise];
  if (audience === "teams") {
    const crew = yearly ? 32 : 40;
    const studio = yearly ? 64 : 80;
    return [
      {
        name: "Crew",
        price: String(crew),
        period: "/ user /month",
        ...billedFor(40, 32),
        points: [{ label: "5,000 credits/month", included: true, accent: true }, ...HOBBY_POINTS],
        cta: "Choose Crew",
        to: "/signup",
        search: { plan: "crew", billing: yearly ? "yearly" : "monthly" },
      },
      {
        name: "Studio",
        price: String(studio),
        period: "/ user /month",
        ...billedFor(80, 64),
        points: [{ label: "25,000 credits/month", included: true, accent: true }, ...FULL_POINTS],
        cta: "Choose Studio",
        to: "/signup",
        search: { plan: "agency", billing: yearly ? "yearly" : "monthly" },
        popular: true,
      },
      enterprise,
    ];
  }
  return [
    {
      name: "Hobby",
      price: String(hobbyAmt),
      period: "/month",
      ...billedFor(20, 16),
      points: [{ label: "1,000 credits/month", included: true, accent: true }, ...HOBBY_POINTS],
      cta: "Choose Hobby",
      to: "/signup",
      search: { plan: "hobby", billing: yearly ? "yearly" : "monthly" },
    },
    {
      name: "Creator",
      price: String(creatorAmt),
      period: "/month",
      ...billedFor(30, 24),
      points: [{ label: "5,000 credits/month", included: true, accent: true }, ...FULL_POINTS],
      cta: "Choose Creator",
      to: "/signup",
      search: { plan: "creator", billing: yearly ? "yearly" : "monthly" },
      popular: true,
    },
    {
      name: "Arena",
      price: String(arenaAmt),
      period: "/month",
      ...billedFor(200, 160),
      points: [{ label: "25,000 credits/month", included: true, accent: true }, ...FULL_POINTS],
      cta: "Choose Arena",
      to: "/signup",
      search: { plan: "arena", billing: yearly ? "yearly" : "monthly" },
    },
    enterprise,
  ];
}

const HOBBY_POINTS: readonly Point[] = [
  { label: "Import a shoot", included: true },
  { label: "Smart Cull suggestions", included: true },
  { label: "Send a gallery", included: true },
  { label: "Passcode, favourites, downloads", included: true },
  { label: "Roster + jersey / bib tags", included: true },
  { label: "Find my photos", included: true },
  { label: "Originals stay local", included: true },
  { label: "Looks you save", included: true },
  { label: "Adobe when you want it", included: false },
  { label: "Priority support", included: false },
  { label: "REST API", included: false },
  { label: "MCP", included: false },
];

const FULL_POINTS: readonly Point[] = [
  { label: "Import a shoot", included: true },
  { label: "Smart Cull suggestions", included: true },
  { label: "Send a gallery", included: true },
  { label: "Passcode, favourites, downloads", included: true },
  { label: "Roster + jersey / bib tags", included: true },
  { label: "Find my photos", included: true },
  { label: "Originals stay local", included: true },
  { label: "Looks you save", included: true },
  { label: "Adobe when you want it", included: true },
  { label: "Priority support", included: true },
  { label: "REST API", included: true },
  { label: "MCP", included: true },
];

export function HomePricing() {
  const [yearly, setYearly] = useState(false);
  return (
    <section className="home-pricing" id="pricing" aria-labelledby="pricing-heading">
      <div data-reveal>
        <h2 id="pricing-heading">
          Pricing that <em>scales with you</em>
        </h2>
        <p className="home-pricing__lede">
          Choose a monthly or annual plan. Access starts after payment. Cancel anytime.
        </p>
      </div>
      <div className="home-pricing__cycle" data-reveal>
        <div className="home-pricing__seg" role="group" aria-label="Billing">
          <button type="button" aria-pressed={!yearly} onClick={() => setYearly(false)}>
            Monthly
          </button>
          <button type="button" aria-pressed={yearly} onClick={() => setYearly(true)}>
            Yearly
          </button>
        </div>
        <span className="home-pricing__off">20% off</span>
      </div>
      <PlanCardGrid plans={plansForAudience("personal", yearly)} />
      <p className="home-pricing__note" data-reveal>
        Pick, gallery, and who-is-in-this-photo sit on every paid plan. Credits are monthly, not
        unlimited. <Link to="/docs">REST API</Link> and <Link to="/mcp">MCP</Link> sit on Creator,
        Arena, and Enterprise.
      </p>
      <div className="home-pricing__faq" data-reveal>
        <p className="home-pricing__eyebrow">Questions</p>
        <h3>
          Frequently <em>asked</em>
        </h3>
        {FAQ.map(([question, answer]) => (
          <details key={question}>
            <summary>{question}</summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
