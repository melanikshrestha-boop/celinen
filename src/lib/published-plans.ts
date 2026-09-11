/** Published billing. Presentation may change; these amounts may not. */
export const PRO_STEPS = [
  {
    name: "Starter",
    photos: "1,000 photos / mo",
    credits: "1,000 photo credits / mo",
    plan: "starter",
    monthly: 20,
    yearly: 16,
  },
  {
    name: "Sideline",
    photos: "5,000 photos / mo",
    credits: "5,000 photo credits / mo",
    plan: "sideline",
    monthly: 60,
    yearly: 48,
  },
  {
    name: "Arena",
    photos: "25,000 photos / mo",
    credits: "25,000 photo credits / mo",
    plan: "arena",
    monthly: 200,
    yearly: 160,
  },
] as const;

export const TEAM_STEPS = [
  {
    photos: "5,000 photos / user / mo",
    credits: "5,000 photo credits / user / mo",
    plan: "crew",
    monthly: 40,
    yearly: 32,
  },
  {
    photos: "25,000 photos / user / mo",
    credits: "25,000 photo credits / user / mo",
    plan: "agency",
    monthly: 80,
    yearly: 64,
  },
] as const;

export const BUSINESS = { monthly: 80, yearly: 64 } as const;
