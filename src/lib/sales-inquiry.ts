export const SALES_PRODUCTS = ["Celinen", "Heavenly", "Both", "Enterprise", "Other"] as const;
export const SALES_HEADCOUNT = ["1–10", "11–50", "51–200", "201–1,000", "1,000+"] as const;

export type SalesProduct = (typeof SALES_PRODUCTS)[number];
export type SalesHeadcount = (typeof SALES_HEADCOUNT)[number];

export type SalesInquiryDraft = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  jobTitle?: string;
  company: string;
  website?: string;
  product: string;
  headcount: string;
  usage?: string;
  needs: string;
  fax?: string;
};

export type SalesInquiry = SalesInquiryDraft & {
  id: string;
  receivedAt: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX = {
  firstName: 80,
  lastName: 80,
  email: 160,
  phone: 40,
  jobTitle: 80,
  company: 120,
  website: 200,
  usage: 240,
  needs: 2000,
} as const;

function trim(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function validateSalesInquiry(draft: SalesInquiryDraft): string | null {
  if (!trim(draft.firstName, MAX.firstName)) return "First name is required.";
  if (!trim(draft.lastName, MAX.lastName)) return "Last name is required.";
  const email = trim(draft.email, MAX.email);
  if (!EMAIL.test(email)) return "Work email is required.";
  if (!trim(draft.company, MAX.company)) return "Company name is required.";
  if (!SALES_PRODUCTS.includes(draft.product as SalesProduct)) return "Pick a product.";
  if (!SALES_HEADCOUNT.includes(draft.headcount as SalesHeadcount)) return "Pick a company size.";
  if (!trim(draft.needs, MAX.needs)) return "Say what you need.";
  return null;
}

export function normalizeSalesInquiry(draft: SalesInquiryDraft, id: string): SalesInquiry {
  return {
    id,
    receivedAt: new Date().toISOString(),
    firstName: trim(draft.firstName, MAX.firstName),
    lastName: trim(draft.lastName, MAX.lastName),
    email: trim(draft.email, MAX.email),
    phone: trim(draft.phone, MAX.phone) || undefined,
    jobTitle: trim(draft.jobTitle, MAX.jobTitle) || undefined,
    company: trim(draft.company, MAX.company),
    website: trim(draft.website, MAX.website) || undefined,
    product: draft.product,
    headcount: draft.headcount,
    usage: trim(draft.usage, MAX.usage) || undefined,
    needs: trim(draft.needs, MAX.needs),
  };
}
