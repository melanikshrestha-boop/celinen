import "./home-product.css";
import { Link } from "@tanstack/react-router";

type Point = { label: string; included: boolean };

type HomePlan = {
  name: string;
  price: string;
  period?: string;
  billed: string;
  credits: string;
  blurb: string;
  points: readonly Point[];
  cta: string;
  to: "/signup" | "/auth";
  search: { plan?: string; billing?: string; mode?: string };
  popular?: boolean;
};

const FAQ: [string, string][] = [
  [
    "How does FOTO work?",
    "Import a shoot, pick the keepers, and send a gallery. Original files stay on your machine unless you publish.",
  ],
  [
    "Do I have to leave my current editor?",
    "No. Keep your editor. Check file and metadata compatibility before moving a workflow.",
  ],
  [
    "How do photo credits work?",
    "Each paid plan lists a monthly photo-credit volume. Confirm the amount at checkout before you pay.",
  ],
  [
    "Can I cancel my plan?",
    "Yes. Cancel before the next renewal. Unused credits do not convert to cash.",
  ],
  [
    "How much does FOTO cost?",
    "Hobby is USD 20 / month. Creator is USD 30 / month. Enterprise is set around your book.",
  ],
  [
    "Is a reject a delete?",
    "Never. Rejects are flagged and reversible. Originals stay untouched.",
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
    <div className="home-pricing__cards">
      {plans.map((plan) => (
        <article key={plan.name} className={plan.popular ? "is-popular" : undefined}>
          {plan.popular ? <p className="home-pricing__popular">Most Popular</p> : null}
          <h3>{plan.name}</h3>
          <p className="home-pricing__figure">
            {plan.price === "Custom" ? (
              <span className="pricing-figure">Custom</span>
            ) : (
              <>
                <span className="pricing-currency">USD</span>{" "}
                <span className="pricing-figure">{plan.price}</span>
                {plan.period ? <small className="pricing-period">{plan.period}</small> : null}
              </>
            )}
          </p>
          <p className="home-pricing__billed">{plan.billed}</p>
          <p className="home-pricing__credits">{plan.credits}</p>
          <p className="home-pricing__blurb">{plan.blurb}</p>
          <ul>
            {plan.points.map((point) => (
              <li key={point.label} className={point.included ? undefined : "is-out"}>
                <Mark included={point.included} />
                {point.label}
              </li>
            ))}
          </ul>
          <Link to={plan.to} search={plan.search}>
            {plan.cta}
          </Link>
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
  const billed = yearly ? "Billed yearly. Cancel anytime." : "Billed monthly. Cancel anytime.";
  const enterprise: HomePlan = {
    name: "Enterprise",
    price: "Custom",
    billed: "We’ll set this up around your book.",
    credits: "Volume that matches the work",
    blurb: "For studios running a full season.",
    points: FULL_POINTS,
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
        billed,
        credits: "5,000 photo credits/user/month",
        blurb: "For a small bench sharing one book.",
        points: HOBBY_POINTS,
        cta: "Choose Crew",
        to: "/signup",
        search: { plan: "crew", billing: yearly ? "yearly" : "monthly" },
      },
      {
        name: "Studio",
        price: String(studio),
        period: "/ user /month",
        billed,
        credits: "25,000 photo credits/user/month",
        blurb: "For teams shipping every week.",
        points: FULL_POINTS,
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
      billed,
      credits: "1,000 photo credits/month",
      blurb: "For solo photographers getting started.",
      points: HOBBY_POINTS,
      cta: "Choose Hobby",
      to: "/signup",
      search: { plan: "hobby", billing: yearly ? "yearly" : "monthly" },
    },
    {
      name: "Creator",
      price: String(creatorAmt),
      period: "/month",
      billed,
      credits: "5,000 photo credits/month",
      blurb: "For photographers shipping every week.",
      points: FULL_POINTS,
      cta: "Choose Creator",
      to: "/signup",
      search: { plan: "creator", billing: yearly ? "yearly" : "monthly" },
      popular: true,
    },
    enterprise,
  ];
}

const HOBBY_POINTS: readonly Point[] = [
  { label: "Import a shoot", included: true },
  { label: "Pick the keepers", included: true },
  { label: "Send a gallery", included: true },
  { label: "Originals stay local", included: true },
  { label: "Adobe when you want it", included: false },
  { label: "Priority support", included: false },
];

const FULL_POINTS: readonly Point[] = [
  { label: "Import a shoot", included: true },
  { label: "Pick the keepers", included: true },
  { label: "Send a gallery", included: true },
  { label: "Originals stay local", included: true },
  { label: "Adobe when you want it", included: true },
  { label: "Priority support", included: true },
];

export function HomePricing() {
  return (
    <section className="home-pricing" id="pricing" aria-labelledby="pricing-heading">
      <p className="home-pricing__eyebrow">Pricing</p>
      <h2 id="pricing-heading">
        Pricing that <em>scales</em>
      </h2>
      <PlanCardGrid plans={plansForAudience("personal", false)} />
      <div className="home-pricing__faq">
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
