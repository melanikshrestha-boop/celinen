import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  EXAMPLE_SAVINGS,
  SAVINGS_FIELDS,
  estimateSavings,
  savingsDollars,
  savingsNumber,
  type SavingsDraft,
} from "@/lib/savings-estimate";
import "./marketing-value.css";

export function SavingsSection({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<SavingsDraft>({ ...EXAMPLE_SAVINGS });
  const { result, errors } = estimateSavings(draft);
  const isExample = SAVINGS_FIELDS.every(({ key }) => draft[key] === EXAMPLE_SAVINGS[key]);
  const dollars = result ? savingsDollars(result.annualPotentialValue) : "—";

  return (
    <section className="marketing-value" id="savings" aria-labelledby="savings-heading">
      <div className="marketing-value__intro">
        <p className="marketing-value__eyebrow">Your time, in perspective</p>
        <h2 id="savings-heading">What could you get back?</h2>
        <p className="marketing-value__lead">
          Put a value on a lighter workload. Adjust the example to reflect your own time and costs.
        </p>
        <div className="marketing-value__cta">{children}</div>
        <p className="marketing-value__note">No sign-in needed to use this calculator.</p>

        <details className="marketing-value__calculator" open>
          <summary>
            Make it yours <ChevronDown size={16} aria-hidden="true" />
          </summary>
          <p className="marketing-value__note" id="savings-input-help">
            Start with this example, then use your own numbers. All amounts are USD.
          </p>
          <div className="marketing-value__fields">
            {SAVINGS_FIELDS.map((field) => (
              <div className="marketing-value__field" key={field.key}>
                <label htmlFor={`savings-${field.key}`}>{field.label}</label>
                <input
                  id={`savings-${field.key}`}
                  name={field.key}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={field.max}
                  step={field.step}
                  value={draft[field.key]}
                  aria-invalid={Boolean(errors[field.key])}
                  aria-describedby={
                    errors[field.key] ? `savings-${field.key}-error` : "savings-input-help"
                  }
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                />
                {errors[field.key] && (
                  <span className="marketing-value__error" id={`savings-${field.key}-error`}>
                    {errors[field.key]}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="marketing-value__calculator-footer">
            <Button variant="ghost" type="button" onClick={() => setDraft({ ...EXAMPLE_SAVINGS })}>
              Reset example
            </Button>
            <a href="/pricing">Check plan pricing →</a>
          </div>
        </details>
      </div>

      <div className="marketing-value__results" aria-label="Estimated time and value">
        <p className="marketing-value__estimate-label">
          {isExample
            ? "Illustrative example · not measured results"
            : "Your estimate · not guaranteed results"}
        </p>
        <div className="marketing-value__metric marketing-value__metric--time">
          <p className="marketing-value__number">
            {result ? savingsNumber(result.hoursPerWeek) : "—"} <span>hours</span>
          </p>
          <p className="marketing-value__period">Potential time back / week</p>
          <p className="marketing-value__explanation">
            Across culling, editing and delivery.
            <br />
            {result
              ? `${savingsNumber(result.annualHours)} hours over your ${result.weeksPerYear}-week year.`
              : "Complete the inputs to see your estimate."}
          </p>
        </div>
        <div className="marketing-value__metric marketing-value__metric--money">
          <p className="marketing-value__number" data-long={dollars.length > 9}>
            {dollars}
          </p>
          <p className="marketing-value__period">Potential value / year</p>
          <div className="marketing-value__explanation">
            <p>Time valued at your rate, plus net software savings.</p>
            {result && (
              <dl className="marketing-value__breakdown">
                <div>
                  <dt>Value of your time</dt>
                  <dd>{savingsDollars(result.annualTimeValue)}</dd>
                </div>
                <div>
                  <dt>
                    {result.annualNetSoftware < 0
                      ? "Additional software cost"
                      : "Net software savings"}
                  </dt>
                  <dd>{savingsDollars(result.annualNetSoftware)}</dd>
                </div>
              </dl>
            )}
          </div>
        </div>
        <p className="marketing-value__disclaimer">
          A planning estimate, not an earnings promise. Time value is not cash income. Only count
          tools you can actually cancel; your LensLabs budget is an input, not a price quote.
        </p>
        <details className="marketing-value__math">
          <summary>See the calculation</summary>
          {result ? (
            <div>
              <p>
                {savingsNumber(result.hoursPerWeek)} hours × {result.weeksPerYear} weeks ×{" "}
                {savingsDollars(result.hourlyValue)}/hour = {savingsDollars(result.annualTimeValue)}{" "}
                in time value.
              </p>
              <p>
                ({savingsDollars(result.replacedMonthlyCost)} in canceled tools −{" "}
                {savingsDollars(result.lensMonthlyBudget)} LensLabs budget) × 12 months ={" "}
                {savingsDollars(result.annualNetSoftware)} net software savings.
              </p>
              <p>
                Combined annual value: {savingsDollars(result.annualPotentialValue)}. Software is
                budgeted for all 12 months, even if you work fewer weeks.
              </p>
            </div>
          ) : (
            <p>Complete the inputs to see the calculation.</p>
          )}
        </details>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {result
            ? `Estimated ${savingsNumber(result.hoursPerWeek)} hours per week. Annual time value ${savingsDollars(result.annualTimeValue)}; net software savings ${savingsDollars(result.annualNetSoftware)}. Combined potential value ${dollars}.`
            : "Enter valid values in all five fields to calculate an estimate."}
        </p>
      </div>
    </section>
  );
}
