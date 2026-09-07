import {
  currencySchema,
  parsePrice,
  productSchema,
  type Currency,
  type PrintProduct,
} from "./model";

/** Bounded RFC-4180 parser, including BOM, CRLF, quoted commas/newlines and escaped quotes. */
export function parseCSV(source: string): string[][] {
  if (new TextEncoder().encode(source).length > 2_000_000)
    throw new Error("Use a CSV under 2 MB. Split larger exports first.");
  const rows: string[][] = [],
    row: string[] = [];
  let cell = "",
    quoted = false,
    closed = false;
  source = source.replace(/^\uFEFF/, "");
  const endCell = () => {
    row.push(cell);
    cell = "";
    closed = false;
    if (row.length > 150) throw new Error("Too many CSV columns.");
  };
  const endRow = () => {
    endCell();
    if (row.some((v) => v.trim())) rows.push([...row]);
    row.length = 0;
    if (rows.length > 2001) throw new Error("Use at most 2,000 CSV rows.");
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else cell += c;
    } else if (c === ",") endCell();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      endRow();
    } else if (c === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || c === '"')
        throw new Error("Invalid CSV quoting. Export the file again from Shopify.");
      cell += c;
    }
  }
  if (quoted) throw new Error("The CSV ends inside a quoted field.");
  if (cell || row.length || closed) endRow();
  return rows;
}
export type ImportPreview = {
  products: PrintProduct[];
  errors: string[];
  warnings: string[];
  imageRows: number;
};
export function previewShopify(source: string, currency: Currency): ImportPreview {
  currencySchema.parse(currency);
  const [header, ...rows] = parseCSV(source);
  if (!header) throw new Error("This CSV is empty.");
  const normalized = header.map((v) => v.trim().toLowerCase().replace(/\s/g, ""));
  if (new Set(normalized).size !== normalized.length)
    throw new Error("Duplicate CSV column names.");
  const index = (...names: string[]) => normalized.findIndex((v) => names.includes(v));
  const handleAt = index("handle", "urlhandle"),
    titleAt = index("title"),
    priceAt = index("variantprice", "price");
  if ([handleAt, titleAt, priceAt].some((n) => n < 0))
    throw new Error(
      "Use a Shopify product export with Handle (or URL handle), Title and Variant Price (or Price).",
    );
  const result: ImportPreview = {
    products: [],
    errors: [],
    warnings: [
      "Imports stay private drafts. Images are references only; orders, customers, tax rules, inventory, redirects and fulfillment mappings are not migrated.",
    ],
    imageRows: 0,
  };
  const parents = new Map<string, { title: string; description: string; image: string }>(),
    seen = new Set<string>();
  rows.forEach((row, position) => {
    const line = position + 2;
    if (row.length > header.length) {
      result.errors.push(`Row ${line}: too many columns.`);
      return;
    }
    const field = (...names: string[]) => {
      for (const name of names) {
        const value = row[normalized.indexOf(name)]?.trim();
        if (value) return value;
      }
      return "";
    };
    const handle = row[handleAt]?.trim() ?? "",
      title = row[titleAt]?.trim() ?? "";
    if (!handle || handle.length > 200) {
      result.errors.push(`Row ${line}: missing or overlong handle.`);
      return;
    }
    if (title)
      parents.set(handle, {
        title,
        description: field("body(html)", "description"),
        image: field("imagesrc", "productimageurl"),
      });
    const parent = parents.get(handle),
      price = row[priceAt]?.trim() ?? "";
    if (
      !price &&
      field("imagesrc", "productimageurl") &&
      !field("variantsku", "sku") &&
      !title &&
      !field("option1value")
    ) {
      result.imageRows++;
      return;
    }
    if (!parent) {
      result.errors.push(`Row ${line}: this variant has no preceding product title.`);
      return;
    }
    const options = [1, 2, 3].map((n) => field(`option${n}value`));
    const sourceKey = `shopify:${JSON.stringify([handle, ...options])}`;
    if (seen.has(sourceKey)) {
      result.errors.push(`Row ${line}: duplicate product variant. No rows were imported.`);
      return;
    }
    try {
      const product = productSchema.parse({
        id: crypto.randomUUID(),
        sourceKey,
        title: parent.title,
        description: parent.description,
        variant: options.filter(Boolean).join(" / "),
        sku: field("variantsku", "sku"),
        priceMinor: parsePrice(price, currency),
        currency,
        fulfillment: "undecided",
        imageReference: field("variantimage", "imagesrc", "productimageurl") || parent.image,
        archived: false,
        // Do not render imported HTML, images or execute formulas. Only selected text fields enter the draft.
      } satisfies PrintProduct);
      result.products.push(product);
      seen.add(sourceKey);
    } catch {
      result.errors.push(`Row ${line}: check the price, title and field lengths.`);
    }
  });
  if (result.products.length > 500)
    result.errors.push("Use at most 500 product variants per import.");
  return result;
}
