/** Planning inputs, not measured Celinen results or quoted subscription prices. */
export const SAVINGS_FIELDS = [
  {
    key: "hoursPerWeek",
    label: "Hours you expect to save / week",
    max: 168,
    step: "0.5",
    unit: "hours",
  },
  { key: "hourlyValue", label: "Value of your time / hour", max: 10000, step: "1", unit: "USD" },
  { key: "weeksPerYear", label: "Working weeks / year", max: 52, step: "1", unit: "weeks" },
  {
    key: "replacedMonthlyCost",
    label: "Tools you could cancel / month",
    max: 100000,
    step: "0.01",
    unit: "USD",
  },
  {
    key: "lensMonthlyBudget",
    label: "Your Celinen budget / month",
    max: 100000,
    step: "0.01",
    unit: "USD",
  },
] as const;

export type SavingsField = (typeof SAVINGS_FIELDS)[number]["key"];
export type SavingsDraft = Record<SavingsField, string>;

export const EXAMPLE_SAVINGS: Readonly<SavingsDraft> = {
  hoursPerWeek: "10",
  hourlyValue: "50",
  weeksPerYear: "48",
  replacedMonthlyCost: "120",
  lensMonthlyBudget: "40",
};

const cents = (amount: number) => Math.round(amount * 100);

export function estimateSavings(draft: SavingsDraft) {
  const errors: Partial<Record<SavingsField, string>> = {};
  const values = {} as Record<SavingsField, number>;
  for (const field of SAVINGS_FIELDS) {
    const raw = draft[field.key].trim();
    const value = Number(raw);
    if (!/^\d+(?:\.\d{0,2})?$/.test(raw) || !Number.isFinite(value) || value > field.max) {
      errors[field.key] = `Enter a number from 0 to ${field.max.toLocaleString("en-US")}.`;
    } else if (field.key === "weeksPerYear" && !Number.isInteger(value)) {
      errors[field.key] = "Enter a whole number of weeks from 0 to 52.";
    }
    values[field.key] = value;
  }
  if (Object.keys(errors).length) return { errors, result: null };

  const annualHours = values.hoursPerWeek * values.weeksPerYear;
  const annualTimeValueCents = cents(annualHours * values.hourlyValue);
  const annualReplacedCostCents = cents(values.replacedMonthlyCost) * 12;
  const annualLensBudgetCents = cents(values.lensMonthlyBudget) * 12;
  // Negative cash savings must remain visible, not be silently clamped to zero.
  const annualNetSoftwareCents = annualReplacedCostCents - annualLensBudgetCents;
  return {
    errors,
    result: {
      ...values,
      annualHours,
      annualTimeValue: annualTimeValueCents / 100,
      annualReplacedCost: annualReplacedCostCents / 100,
      annualLensBudget: annualLensBudgetCents / 100,
      annualNetSoftware: annualNetSoftwareCents / 100,
      annualPotentialValue: (annualTimeValueCents + annualNetSoftwareCents) / 100,
    },
  };
}

export const savingsNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);

export const savingsDollars = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
