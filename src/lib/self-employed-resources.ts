/** Reviewed U.S. federal reference content, not a filing or contribution engine. */
export const SELF_EMPLOYED_REFERENCE = {
  year: 2026,
  reviewedOn: "2026-09-10",
  reviewedLabel: "September 10, 2026",
} as const;

export const TAX_SOURCES = {
  taxCenter:
    "https://www.irs.gov/businesses/small-businesses-self-employed/self-employed-individuals-tax-center",
  scheduleC: "https://www.irs.gov/forms-pubs/about-schedule-c-form-1040",
  scheduleSE: "https://www.irs.gov/forms-pubs/about-schedule-se-form-1040",
  estimates: "https://www.irs.gov/forms-pubs/about-form-1040-es",
  estimatedGuide: "https://www.irs.gov/publications/p505",
  records:
    "https://www.irs.gov/businesses/small-businesses-self-employed/what-kind-of-records-should-i-keep",
  deductions: "https://www.irs.gov/instructions/i1040sc",
  solo: "https://www.irs.gov/retirement-plans/one-participant-401k-plans",
  retirementLimits:
    "https://www.irs.gov/retirement-plans/cola-increases-for-dollar-limitations-on-benefits-and-contributions",
  retirementGuide: "https://www.irs.gov/publications/p560",
  ira: "https://www.irs.gov/retirement-plans/traditional-and-roth-iras",
  iraLimits:
    "https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500",
  stateDirectory:
    "https://www.irs.gov/businesses/small-businesses-self-employed/state-government-websites",
} as const;

export const FEDERAL_ESTIMATED_DATES_2026 = [
  { period: "January 1 – March 31", date: "2026-04-15", label: "April 15, 2026" },
  { period: "April 1 – May 31", date: "2026-06-15", label: "June 15, 2026" },
  { period: "June 1 – August 31", date: "2026-09-15", label: "September 15, 2026" },
  { period: "September 1 – December 31", date: "2027-01-15", label: "January 15, 2027" },
] as const;

export const TAX_RECORD_CHECKLIST = [
  {
    id: "receipts",
    title: "Reconcile what came in",
    detail:
      "Match invoices, payment receipts, refunds and 1099 statements. A provider statement is not extra income to add again.",
  },
  {
    id: "expenses",
    title: "Attach the business purpose",
    detail:
      "Keep the payee, date, amount, receipt and proof of payment for each expense. Separate personal use.",
  },
  {
    id: "equipment",
    title: "Keep an equipment register",
    detail:
      "Record purchase cost, placed-in-service date, business-use share and disposals. Buying gear does not automatically make its full price deductible.",
  },
  {
    id: "travel",
    title: "Keep mileage and travel records",
    detail:
      "Log the date, destination, distance and business purpose; retain supporting travel receipts. Check the rate and method for the applicable dates.",
  },
  {
    id: "owner",
    title: "Separate owner money",
    detail:
      "Keep owner contributions, draws and personal estimated-tax payments separate from operating expenses.",
  },
  {
    id: "estimates",
    title: "Bring the whole tax picture",
    detail:
      "Collect the prior-year return, estimated-payment confirmations, other income and withholding, and retirement contribution records.",
  },
] as const;

export const RETIREMENT_PATHWAYS = [
  {
    id: "solo-401k",
    title: "Solo 401(k)",
    audience:
      "An owner-only business, or an owner and spouse; eligible employees change the rules.",
    limit:
      "2026 employee deferral: up to USD 24,500. Combined employee and employer ceiling: USD 72,000 before catch-ups, subject to earned income and plan rules.",
    details:
      "The employee limit is shared across your 401(k) plans. Self-employed employer contributions need a special calculation; gross revenue is not the contribution base. Review setup, election, deposit and Form 5500-EZ filing requirements with the provider.",
    source: TAX_SOURCES.solo,
  },
  {
    id: "sep-ira",
    title: "SEP IRA",
    audience:
      "Employer-funded retirement contributions, including eligible employees when required.",
    limit:
      "2026 ceiling: USD 72,000, also limited by compensation. A self-employed owner uses the IRS worksheet, not 25% of gross receipts.",
    details:
      "Eligible employees generally receive the same contribution percentage. Contributions can vary by year. Check eligibility, deadlines and the self-employed deduction calculation before choosing a contribution.",
    source: TAX_SOURCES.retirementGuide,
  },
  {
    id: "simple-ira",
    title: "SIMPLE IRA",
    audience: "A small-employer plan with employee deferrals and required employer contributions.",
    limit:
      "2026 standard employee deferral limit: USD 17,000. Certain eligible enhanced plans allow USD 18,100; eligibility and catch-ups differ.",
    details:
      "Generally for employers with 100 or fewer employees meeting the compensation test. Review required matching or nonelective contributions and restrictions on maintaining another plan. Do not assume the enhanced limit applies.",
    source: TAX_SOURCES.retirementGuide,
  },
  {
    id: "ira",
    title: "Traditional or Roth IRA",
    audience: "An individual retirement account, separate from an employer plan.",
    limit:
      "2026 combined Traditional and Roth contribution limit: USD 7,500, plus USD 1,100 at age 50 or older, subject to eligible compensation.",
    details:
      "Traditional IRA deductibility depends on income, filing status and workplace-plan coverage. Roth eligibility depends on income and filing status. The limit is shared across your IRAs, not a separate allowance for each account.",
    source: TAX_SOURCES.ira,
  },
] as const;
