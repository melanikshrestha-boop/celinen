import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  EXAMPLE_SAVINGS,
  SAVINGS_FIELDS,
  estimateSavings,
  savingsNumber,
  type SavingsDraft,
  type SavingsField,
} from "@/lib/savings-estimate";
import "./marketing-value.css";

// Currency presentation only: keep the estimate's original amounts and cent precision.
const savingsDollars = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    currencyDisplay: "code",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);

function nudgeValue(raw: string, delta: number, max: number, step: number) {
  const current = Number(raw);
  const base = Number.isFinite(current) ? current : 0;
  const next = Math.min(max, Math.max(0, Math.round((base + delta) / step) * step));
  if (step >= 1) return String(Math.round(next));
  return String(Number(next.toFixed(2)));
}

export function SavingsSection({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<SavingsDraft>({ ...EXAMPLE_SAVINGS });
  const [pulse, setPulse] = useState<"time" | "money" | null>(null);
  const { result, errors } = estimateSavings(draft);
  const isExample = SAVINGS_FIELDS.every(({ key }) => draft[key] === EXAMPLE_SAVINGS[key]);
  const dollars = result ? savingsDollars(result.annualPotentialValue) : "—";
  const prev = useRef({ hours: "", value: "" });

  useEffect(() => {
    const hours = result ? String(result.hoursPerWeek) : "";
    const value = result ? String(result.annualPotentialValue) : "";
    if (prev.current.hours && hours !== prev.current.hours) setPulse("time");
    else if (prev.current.value && value !== prev.current.value) setPulse("money");
    prev.current = { hours, value };
    if (!hours && !value) return;
    const timer = window.setTimeout(() => setPulse(null), 700);
    return () => window.clearTimeout(timer);
  }, [result]);

  const setField = (key: SavingsField, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const timeShare =
    result && result.annualPotentialValue !== 0
      ? Math.min(
          100,
          Math.max(0, (result.annualTimeValue / Math.abs(result.annualPotentialValue)) * 100),
        )
      : 0;

  return (
    <section className="marketing-value" id="savings" aria-labelledby="savings-heading">
      <div className="marketing-value__intro" data-reveal>
        <p className="marketing-value__eyebrow">Your time, in perspective</p>
        <h2 id="savings-heading">What could you get back?</h2>
        <p className="marketing-value__lead">
          Put a value on a lighter workload. Adjust the example to reflect your own time and costs.
        </p>
        <div className="marketing-value__cta">{children}</div>
        <p className="marketing-value__note">No sign-in needed to use this calculator.</p>

        <div className="marketing-value__calculator">
          <p className="marketing-value__note" id="savings-input-help">
            Start with this example, then use your own numbers. All amounts are USD.
          </p>
          <div className="marketing-value__fields">
            {SAVINGS_FIELDS.map((field) => {
              const step = Number(field.step);
              return (
                <div className="marketing-value__field" key={field.key}>
                  <label htmlFor={`savings-${field.key}`}>{field.label}</label>
                  <div className="marketing-value__dial">
                    <button
                      type="button"
                      className="marketing-value__nudge"
                      aria-label={`Decrease ${field.label}`}
                      onClick={() => setField(field.key, nudgeValue(draft[field.key], -step, field.max, step))}
                    >
                      −
                    </button>
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
                      onChange={(event) => setField(field.key, event.target.value)}
                    />
                    <button
                      type="button"
                      className="marketing-value__nudge"
                      aria-label={`Increase ${field.label}`}
                      onClick={() => setField(field.key, nudgeValue(draft[field.key], step, field.max, step))}
                    >
                      +
                    </button>
                  </div>
                  {errors[field.key] && (
                    <span className="marketing-value__error" id={`savings-${field.key}-error`}>
                      {errors[field.key]}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="marketing-value__calculator-footer">
            <button type="button" onClick={() => setDraft({ ...EXAMPLE_SAVINGS })}>
              Reset example
            </button>
            <a href="/pricing">Check plan pricing →</a>
          </div>
        </div>
      </div>

      <div className="marketing-value__results" aria-label="Estimated time and value" data-reveal>
        <p className="marketing-value__estimate-label">
          {isExample
            ? "Illustrative example · not measured results"
            : "Your estimate · not guaranteed results"}
        </p>
        <div
          className={
            pulse === "time"
              ? "marketing-value__metric marketing-value__metric--time is-pulse"
              : "marketing-value__metric marketing-value__metric--time"
          }
        >
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
        <div
          className={
            pulse === "money"
              ? "marketing-value__metric marketing-value__metric--money is-pulse"
              : "marketing-value__metric marketing-value__metric--money"
          }
        >
          <p className="marketing-value__number" data-long={dollars.length > 9}>
            {dollars}
          </p>
          <p className="marketing-value__period">Potential value / year</p>
          {result ? (
            <div
              className="marketing-value__mix"
              aria-hidden="true"
              style={{ ["--time-share" as string]: `${timeShare}%` }}
            />
          ) : null}
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
        {result ? (
          <p className="marketing-value__formula">
            {savingsNumber(result.hoursPerWeek)} h × {result.weeksPerYear} wk ×{" "}
            {savingsDollars(result.hourlyValue)}
            <span> → {savingsDollars(result.annualTimeValue)}</span>
            <br />
            ({savingsDollars(result.replacedMonthlyCost)} − {savingsDollars(result.lensMonthlyBudget)})
            × 12
            <span> → {savingsDollars(result.annualNetSoftware)}</span>
          </p>
        ) : null}
        <p className="marketing-value__disclaimer">
          A planning estimate, not an earnings promise. Time value is not cash income. Only count
          tools you can actually cancel; your LensLabs budget is an input, not a price quote.
        </p>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {result
            ? `Estimated ${savingsNumber(result.hoursPerWeek)} hours per week. Annual time value ${savingsDollars(result.annualTimeValue)}; net software savings ${savingsDollars(result.annualNetSoftware)}. Combined potential value ${dollars}.`
            : "Enter valid values in all five fields to calculate an estimate."}
        </p>
      </div>
    </section>
  );
}
