import { useId } from "react";
import { PRODUCT_NAME } from "@/lib/product";
import {
  FEDERAL_ESTIMATED_DATES_2026,
  RETIREMENT_PATHWAYS,
  SELF_EMPLOYED_REFERENCE,
  TAX_RECORD_CHECKLIST,
  TAX_SOURCES,
} from "@/lib/self-employed-resources";

export function TaxReferenceDate() {
  return (
    <p className="finance-os__vs">
      U.S. federal reference · {SELF_EMPLOYED_REFERENCE.year} · Reviewed{" "}
      <time dateTime={SELF_EMPLOYED_REFERENCE.reviewedOn}>
        {SELF_EMPLOYED_REFERENCE.reviewedLabel}
      </time>
    </p>
  );
}

export function RetirementPathways() {
  return (
    <article className="finance-os__card finance-os__resource">
      <h2>Retirement pathways</h2>
      <TaxReferenceDate />
      <p>
        Compare the account rules here. {PRODUCT_NAME} does not open accounts, recommend investments
        or calculate your personal contribution limit.
      </p>
      <div className="finance-os__resource-grid">
        {RETIREMENT_PATHWAYS.map((plan) => (
          <details key={plan.id} className="finance-os__resource-detail">
            <summary>{plan.title}</summary>
            <p>{plan.audience}</p>
            <p>{plan.limit}</p>
            <p>{plan.details}</p>
            <a href={plan.source} target="_blank" rel="noreferrer">
              IRS: {plan.title} <span className="sr-only">(opens in a new tab)</span>↗
            </a>
          </details>
        ))}
      </div>
      <p className="finance-os__vs">
        Age-based catch-ups and plan-specific rules can change these ceilings. For 401(k)s, the 2026
        catch-up is USD 8,000 at age 50+, or USD 11,250 at ages 60–63—not both. Income, other plans
        and contribution type matter.
      </p>
      <a href={TAX_SOURCES.retirementLimits} target="_blank" rel="noreferrer">
        IRS 2026 plan limits <span className="sr-only">(opens in a new tab)</span>↗
      </a>
      {" · "}
      <a href={TAX_SOURCES.iraLimits} target="_blank" rel="noreferrer">
        IRS 2026 IRA and catch-up limits <span className="sr-only">(opens in a new tab)</span>↗
      </a>
    </article>
  );
}

export function FinanceTaxHub() {
  const checklistId = useId();
  return (
    <>
      <article className="finance-os__card finance-os__resource">
        <h2>Your self-employed tax hub</h2>
        <TaxReferenceDate />
        <p>
          For U.S. sole proprietors and many single-member LLCs. A corporation, partnership or tax
          election can require different returns. This is preparation guidance—not a return, tax
          calculation or filing service.
        </p>
        <div className="finance-os__resource-grid">
          <section>
            <h3>Schedule C</h3>
            <p>
              Report business income and allowable business expenses. Recorded cash flow is not
              automatically taxable profit.
            </p>
            <a href={TAX_SOURCES.scheduleC} target="_blank" rel="noreferrer">
              IRS Schedule C <span className="sr-only">(opens in a new tab)</span>↗
            </a>
          </section>
          <section>
            <h3>Schedule SE</h3>
            <p>
              Figure self-employment Social Security and Medicare tax. This is separate from income
              tax; other earnings can affect the calculation.
            </p>
            <a href={TAX_SOURCES.scheduleSE} target="_blank" rel="noreferrer">
              IRS Schedule SE <span className="sr-only">(opens in a new tab)</span>↗
            </a>
          </section>
          <section>
            <h3>Form 1040-ES</h3>
            <p>
              Work out estimated payments using the whole return, including other income,
              deductions, credits and withholding.
            </p>
            <a href={TAX_SOURCES.estimates} target="_blank" rel="noreferrer">
              IRS Form 1040-ES <span className="sr-only">(opens in a new tab)</span>↗
            </a>
          </section>
        </div>
      </article>
      <article className="finance-os__card finance-os__resource">
        <h2>2026 estimated-payment calendar</h2>
        <p className="finance-os__vs">
          Standard federal calendar-year dates—not four equal calendar quarters. Disaster relief and
          special rules can change your dates. Payment status is not tracked here.
        </p>
        <dl>
          {FEDERAL_ESTIMATED_DATES_2026.map((period) => (
            <div className="finance-os__stat" key={period.date}>
              <dt>{period.period}</dt>
              <dd>
                <time dateTime={period.date}>{period.label}</time>
              </dd>
            </div>
          ))}
        </dl>
        <details className="finance-os__resource-detail">
          <summary>Do I need estimated payments?</summary>
          <p>
            Generally, estimated payments may be required if you expect to owe at least USD 1,000
            after withholding and credits. The usual underpayment benchmarks compare 90% of
            current-year tax with 100% of prior-year tax, or 110% for certain higher-income
            taxpayers. Eligibility and timely installments matter; this is not your payment
            calculation.
          </p>
          <p>
            Seasonal shoots do not mean equal income each quarter. Ask about the annualized-income
            method and Form 2210 when income is uneven. Keep payment confirmations; the calendar
            does not mark anything as paid.
          </p>
        </details>
        <a href={TAX_SOURCES.estimatedGuide} target="_blank" rel="noreferrer">
          IRS estimated-payment rules and exceptions{" "}
          <span className="sr-only">(opens in a new tab)</span>↗
        </a>
      </article>
      <article className="finance-os__card finance-os__resource">
        <h2>Get your records ready</h2>
        <p id={`${checklistId}-note`} className="finance-os__vs">
          A personal checklist for this visit. Marks reset when you leave this desk; nothing is
          filed, uploaded or saved to your books.
        </p>
        <fieldset className="finance-os__checklist" aria-describedby={`${checklistId}-note`}>
          <legend className="sr-only">Tax preparation records</legend>
          {TAX_RECORD_CHECKLIST.map((item) => (
            <label key={item.id}>
              <input type="checkbox" />
              <span>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <a href={TAX_SOURCES.records} target="_blank" rel="noreferrer">
          IRS recordkeeping guide <span className="sr-only">(opens in a new tab)</span>↗
        </a>
      </article>
      <RetirementPathways />
      <article className="finance-os__card finance-os__resource">
        <h2>Deductions need context</h2>
        <p>
          Business costs must meet the applicable rules. Keep the business-use share and supporting
          receipts for software, rentals, insurance, supplies and travel. Equipment may need
          depreciation or a specific election; home-office and meals rules have additional
          conditions.
        </p>
        <p>
          Do not treat owner draws, personal income-tax payments or all retirement contributions as
          Schedule C expenses. A category in this ledger is a bookkeeping label, not an approved
          deduction.
        </p>
        <a href={TAX_SOURCES.deductions} target="_blank" rel="noreferrer">
          IRS Schedule C expense instructions <span className="sr-only">(opens in a new tab)</span>↗
        </a>
      </article>
      <article className="finance-os__card finance-os__resource">
        <h2>State, local and cross-border</h2>
        <p>
          Check where you live, operate and deliver. State estimated payments, sales tax on prints
          or digital images, business registrations and local taxes can differ from federal rules.
          Do not infer a tax jurisdiction from a shoot’s venue or the currency filter.
        </p>
        <a href={TAX_SOURCES.stateDirectory} target="_blank" rel="noreferrer">
          Find your state’s official tax guidance{" "}
          <span className="sr-only">(opens in a new tab)</span>↗
        </a>
      </article>
    </>
  );
}
