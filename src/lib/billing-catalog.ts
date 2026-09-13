/** Canonical Stripe lookup keys: `{plan}_{monthly|yearly}`. Amounts in USD. */

export type BillingCycle = "monthly" | "yearly";

export type PlanQuote = {
  id: string;
  label: string;
  monthly: number;
  yearly: number;
  perUser?: boolean;
};

export const BILLING_PLANS: readonly PlanQuote[] = [
  { id: "hobby", label: "Hobby", monthly: 20, yearly: 16 },
  { id: "creator", label: "Creator", monthly: 30, yearly: 24 },
  { id: "starter", label: "Individual · Starter", monthly: 20, yearly: 16 },
  { id: "sideline", label: "Individual · Sideline", monthly: 60, yearly: 48 },
  { id: "arena", label: "Individual · Arena", monthly: 200, yearly: 160 },
  { id: "crew", label: "Teams · Crew (per user)", monthly: 40, yearly: 32, perUser: true },
  { id: "agency", label: "Teams · Agency (per user)", monthly: 80, yearly: 64, perUser: true },
];

export function lookupKey(plan: string, billing: BillingCycle): string {
  return `${plan}_${billing}`;
}

export function quoteForLookup(key: string): {
  plan: PlanQuote;
  billing: BillingCycle;
  unitAmountCents: number;
  interval: "month" | "year";
  productName: string;
} | null {
  const idx = key.lastIndexOf("_");
  if (idx <= 0) return null;
  const planId = key.slice(0, idx);
  const billing = key.slice(idx + 1);
  if (billing !== "monthly" && billing !== "yearly") return null;
  const plan = BILLING_PLANS.find((row) => row.id === planId);
  if (!plan) return null;
  // Yearly Stripe price is the annual charge (monthly equivalent × 12).
  const unitAmountCents = (billing === "yearly" ? plan.yearly * 12 : plan.monthly) * 100;
  return {
    plan,
    billing,
    unitAmountCents,
    interval: billing === "yearly" ? "year" : "month",
    productName: `LensLabs ${plan.label}`,
  };
}
