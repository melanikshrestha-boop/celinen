import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EXAMPLE_SAVINGS,
  SAVINGS_FIELDS,
  estimateSavings,
  savingsDollars,
} from "../src/lib/savings-estimate";
import { SavingsSection } from "../src/components/marketing/SavingsSection";
import { WorkflowSection } from "../src/components/marketing/WorkflowSection";

describe("public savings calculator", () => {
  test("the example separates time value, canceled costs, and the LensLabs budget", () => {
    expect(estimateSavings({ ...EXAMPLE_SAVINGS }).result).toMatchObject({
      hoursPerWeek: 10,
      annualHours: 480,
      annualTimeValue: 24000,
      annualReplacedCost: 1440,
      annualLensBudget: 480,
      annualNetSoftware: 960,
      annualPotentialValue: 24960,
    });
  });

  test("all-zero inputs produce no claimed benefit", () => {
    const zero = Object.fromEntries(
      SAVINGS_FIELDS.map(({ key }) => [key, "0"]),
    ) as typeof EXAMPLE_SAVINGS;
    const { result } = estimateSavings(zero);
    expect(result?.annualHours).toBe(0);
    expect(result?.annualTimeValue).toBe(0);
    expect(result?.annualNetSoftware).toBe(0);
    expect(result?.annualPotentialValue).toBe(0);
  });

  test("negative net savings and negative totals are not hidden", () => {
    const { result } = estimateSavings({
      ...EXAMPLE_SAVINGS,
      hoursPerWeek: "0",
      replacedMonthlyCost: "0",
    });
    expect(result?.annualNetSoftware).toBe(-480);
    expect(result?.annualPotentialValue).toBe(-480);
    expect(savingsDollars(-480)).toBe("-$480");
  });

  test("no canceled tools means no invented savings on the existing stack", () => {
    expect(
      estimateSavings({ ...EXAMPLE_SAVINGS, replacedMonthlyCost: "0", lensMonthlyBudget: "0" })
        .result?.annualNetSoftware,
    ).toBe(0);
  });

  test("subscriptions count all twelve months even for seasonal work", () => {
    const { result } = estimateSavings({ ...EXAMPLE_SAVINGS, weeksPerYear: "0" });
    expect(result?.annualTimeValue).toBe(0);
    expect(result?.annualNetSoftware).toBe(960);
  });

  test("cent-level software budgets do not accumulate floating-point artifacts", () => {
    const { result } = estimateSavings({
      ...EXAMPLE_SAVINGS,
      replacedMonthlyCost: "40.30",
      lensMonthlyBudget: "40.10",
    });
    expect(result?.annualNetSoftware).toBe(2.4);
    expect(result?.annualPotentialValue).toBe(24002.4);
    expect(savingsDollars(24002.4)).toBe("$24,002.40");
  });

  for (const bad of ["", " ", "-1", "NaN", "Infinity", "1e3", "1,000", "words", "0.001"]) {
    test(`rejects invalid input ${JSON.stringify(bad)} in every field`, () => {
      for (const { key } of SAVINGS_FIELDS) {
        const estimate = estimateSavings({ ...EXAMPLE_SAVINGS, [key]: bad });
        expect(estimate.result).toBeNull();
        expect(estimate.errors[key]).toBeDefined();
      }
    });
  }

  test("validates each upper bound without losing the other field values", () => {
    for (const field of SAVINGS_FIELDS) {
      const valid = estimateSavings({ ...EXAMPLE_SAVINGS, [field.key]: String(field.max) });
      expect(valid.result).not.toBeNull();
      const invalid = estimateSavings({ ...EXAMPLE_SAVINGS, [field.key]: String(field.max + 1) });
      expect(invalid.result).toBeNull();
      expect(Object.keys(invalid.errors)).toEqual([field.key]);
    }
  });

  test("allows fractional hours and rates, but only whole working weeks", () => {
    const { result } = estimateSavings({
      ...EXAMPLE_SAVINGS,
      hoursPerWeek: "2.5",
      hourlyValue: "12.50",
    });
    expect(result?.annualHours).toBe(120);
    expect(result?.annualTimeValue).toBe(1500);
    expect(estimateSavings({ ...EXAMPLE_SAVINGS, weeksPerYear: "12.5" }).result).toBeNull();
  });

  test("1,000 varied scenarios reconcile to independent cent-based arithmetic", () => {
    for (let i = 0; i < 1000; i++) {
      const hours = (i % 337) / 2;
      const weeks = i % 53;
      const rate = (i * 13) % 10001;
      const canceledCents = (i * 371) % 10000000;
      const budgetCents = (i * 193) % 10000000;
      const draft = {
        hoursPerWeek: String(hours),
        hourlyValue: String(rate),
        weeksPerYear: String(weeks),
        replacedMonthlyCost: (canceledCents / 100).toFixed(2),
        lensMonthlyBudget: (budgetCents / 100).toFixed(2),
      };
      const { result, errors } = estimateSavings(draft);
      const expectedTime = Math.round(hours * weeks * rate * 100);
      const expectedCash = (canceledCents - budgetCents) * 12;
      expect(errors).toEqual({});
      expect(result?.annualTimeValue).toBe(expectedTime / 100);
      expect(result?.annualNetSoftware).toBe(expectedCash / 100);
      expect(result?.annualPotentialValue).toBe((expectedTime + expectedCash) / 100);
      expect(Number.isFinite(result?.annualPotentialValue)).toBe(true);
    }
  });
});

describe("public, accessible estimate presentation", () => {
  const markup = () =>
    renderToStaticMarkup(
      <SavingsSection>
        <a href="/auth?mode=signup">Get started</a>
      </SavingsSection>,
    );

  test("example and earnings limitations are visible, not hidden in the formula", () => {
    const html = markup().split('<details class="marketing-value__math"')[0]!;
    expect(html).toContain("Illustrative example · not measured results");
    expect(html).toContain("Time value is not cash income");
    expect(html).toContain("No sign-in needed");
    expect(html).toContain("USD\u00a024,960");
    expect(html).toContain("USD\u00a024,000");
    expect(html).toContain("USD\u00a0960");
    expect(html).not.toContain("guaranteed savings");
  });

  test("all five inputs have labels, boundaries, and accessible error state", () => {
    const html = markup();
    for (const { key, max } of SAVINGS_FIELDS) {
      expect(html).toContain(`for="savings-${key}"`);
      expect(html).toContain(`id="savings-${key}"`);
      expect(html).toContain(`max="${max}"`);
    }
    expect(html.match(/aria-invalid="false"/g)).toHaveLength(5);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('class="marketing-value__calculator"');
    expect(html).toContain("Reset example");
    expect(html).toContain("h ×");
    expect(html).not.toContain("See the calculation");
  });

  test("savings inputs and totals are not boxed into capsules", () => {
    const value = readFileSync(
      new URL("../src/components/marketing/marketing-value.css", import.meta.url),
      "utf8",
    );
    const sky = readFileSync(
      new URL("../src/components/marketing/sky-entry.css", import.meta.url),
      "utf8",
    );
    expect(value).toMatch(
      /\.marketing-value__field input \{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*border-radius:\s*0;/,
    );
    expect(value).not.toMatch(/border-bottom:\s*1px/);
    expect(value).toMatch(
      /\.marketing-value__metric \{[^}]*border-radius:\s*0;[^}]*background:\s*transparent;/,
    );
    expect(value).not.toContain("color-scheme: dark");
    expect(sky).toMatch(
      /\.marketing-page \.marketing-value__field input \{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*border-radius:\s*0;/,
    );
    expect(sky).not.toMatch(/\.marketing-value__field input \{[^}]*border-radius:\s*13px/);
    expect(sky).not.toMatch(/border-bottom:\s*1px solid #a3b4bd/);
    expect(sky).not.toContain("#e5f2ff");
    expect(sky).not.toContain("#e9f5dd");
  });

  test("workflow has all five stages and no unbuilt AI retouching claim", () => {
    const html = renderToStaticMarkup(<WorkflowSection />);
    for (const title of ["Import", "Cull", "Edit", "Finish", "Deliver"])
      expect(html).toContain(title);
    expect(html.match(/aria-roledescription="slide"/g)).toHaveLength(5);
    expect(html).toContain("Advanced retouching stays in your editor");
    expect(html).toContain("Publishing requires a connected account");
    expect(html).not.toContain("30+ factors");
    expect(html).toContain('aria-label="Next workflow steps"');
  });
});
