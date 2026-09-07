import { z } from "zod";

export const currencySchema = z.enum(["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "JPY"]);
export type Currency = z.infer<typeof currencySchema>;
export function requireSameOwner(actual: string, expected: string) {
  if (!expected || actual !== expected)
    throw new Error("Your account changed. Reopen this tool before saving or sending anything.");
}
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    // Reject invisible control characters while preserving Unicode, tabs and newlines.
    // eslint-disable-next-line no-control-regex
    .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/, "Remove control characters.");
export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .refine((v) => {
    const labels = v.split(".");
    return (
      labels.length >= 2 &&
      labels.every((p) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p)) &&
      /^[a-z]{2,63}$/.test(labels.at(-1)!)
    );
  }, "Enter a domain only, such as yourstudio.com, without https:// or a path.");
export function parsePrice(value: string, currency: Currency): number {
  const digits = currency === "JPY" ? 0 : 2;
  if (!(digits ? /^\d{1,7}(?:\.\d{1,2})?$/ : /^\d{1,7}$/).test(value.trim()))
    throw new Error(
      `Use a positive ${currency} price${digits ? " with up to two decimal places" : " without decimals"}.`,
    );
  const [whole, fraction = ""] = value.trim().split(".");
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0"));
  if (minor <= 0 || minor > 100_000_000) throw new Error("Price is outside the supported range.");
  return minor;
}
export function money(minor: number, currency: Currency) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    minor / (currency === "JPY" ? 1 : 100),
  );
}
export const productSchema = z
  .object({
    id: z.string().uuid(),
    sourceKey: text(600).min(1),
    title: text(200).min(1),
    description: text(6000),
    variant: text(300),
    sku: text(120),
    priceMinor: z.number().int().positive().max(100_000_000),
    currency: currencySchema,
    fulfillment: z.enum(["undecided", "self", "lab"]),
    // References only. Import never fetches remote images or takes ownership of their rights.
    imageReference: text(2000),
    archived: z.boolean(),
  })
  .strict();
export type PrintProduct = z.infer<typeof productSchema>;
export const shopSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    name: text(100).min(1),
    domains: z.array(domainSchema).max(20),
    products: z.array(productSchema).max(500),
  })
  .strict()
  .superRefine((s, ctx) => {
    for (const key of ["id", "sourceKey"] as const)
      if (new Set(s.products.map((p) => p[key])).size !== s.products.length)
        ctx.addIssue({ code: "custom", message: `Duplicate product ${key}.` });
    if (new Set(s.domains).size !== s.domains.length)
      ctx.addIssue({ code: "custom", message: "Duplicate domain." });
  });
export type Shop = z.infer<typeof shopSchema>;
export const emptyShop = (): Shop => ({
  revision: 0,
  name: "My print shop",
  domains: [],
  products: [],
});
export function mergeImport(shop: Shop, products: PrintProduct[]) {
  const seen = new Set(shop.products.map((p) => p.sourceKey));
  let skipped = 0;
  const additions = products.filter((p) => {
    if (seen.has(p.sourceKey)) {
      skipped++;
      return false;
    }
    seen.add(p.sourceKey);
    return true;
  });
  return {
    shop: shopSchema.parse({ ...shop, products: [...shop.products, ...additions] }),
    added: additions.length,
    skipped,
  };
}
export const photographerSchema = z
  .object({
    displayName: text(100).min(1),
    bio: text(1600),
    city: text(100),
    country: text(100),
    specialties: z.array(text(60).min(1)).min(1).max(10),
    languages: text(200),
    available: z.boolean(),
    visible: z.boolean(),
  })
  .strict();
export type Photographer = z.infer<typeof photographerSchema>;
export const emptyPhotographer = (): Photographer => ({
  displayName: "",
  bio: "",
  city: "",
  country: "",
  specialties: [],
  languages: "",
  available: true,
  visible: false,
});
export type DirectoryEntry = Photographer & {
  owner: string;
  reviewCount: number;
  rating: number | null;
  score: number;
};
/** Conservative lower bound: no stars without verified reviews; small samples cannot dominate. */
export function reputation(ratings: number[]) {
  const valid = ratings.filter((r) => Number.isInteger(r) && r >= 1 && r <= 5);
  if (!valid.length) return { reviewCount: 0, rating: null, score: 0 };
  const n = valid.length,
    p = valid.filter((r) => r >= 4).length / n,
    z = 1.96;
  const score =
    (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) /
    (1 + (z * z) / n);
  return { reviewCount: n, rating: valid.reduce((a, b) => a + b, 0) / n, score };
}
export const inquirySchema = z
  .object({
    id: z.string().uuid(),
    recipient: z.string().uuid(),
    kind: z.enum(["booking", "collaboration"]),
    message: text(2000).min(20),
  })
  .strict();
export type Inquiry = z.infer<typeof inquirySchema> & {
  sender: string;
  senderName: string;
  recipientName: string;
  createdAt: string;
  status: "pending" | "accepted" | "declined" | "withdrawn";
};
