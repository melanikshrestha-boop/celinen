import { z } from "zod";

/** File-only migration planning. Never executes HTML, fetches assets, or writes a site. */
export const PORTFOLIO_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const PORTFOLIO_IMPORT_MAX_COLLECTIONS = 1000;

export function normalizePortfolioSourceUrl(input: string): string {
  const value = input.trim();
  // eslint-disable-next-line no-control-regex -- Reject raw URL control characters before normalization.
  if (!value || value.length > 2048 || /[\u0000-\u001f\u007f\\]/.test(input) || value.includes(" "))
    throw new Error("Enter a public website address, without spaces or control characters.");
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
  } catch {
    throw new Error("Enter a valid website address.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new Error("Use HTTPS without a password, username, or custom port.");
  const host = url.hostname.toLowerCase();
  if (
    !/^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}$/.test(host) ||
    /\.(?:localhost|local|internal|test|invalid|example|onion)$/.test(host)
  )
    throw new Error("Use a public website domain, not a local address or IP address.");
  // Queries/fragments can contain private gallery credentials. Provenance needs neither.
  url.search = "";
  url.hash = "";
  return url.href;
}

const sourceUrlSchema = z
  .string()
  .max(2048)
  .transform((value, ctx) => {
    try {
      return normalizePortfolioSourceUrl(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Unsupported source website address." });
      return z.NEVER;
    }
  });
const text = (max: number) => z.string().max(max);
export const portfolioContentSchema = z
  .object({
    name: text(120),
    bio: text(1000),
    hero: text(200),
    nav: z.array(text(80)).max(8),
  })
  .strict();
export type PortfolioImportContent = z.infer<typeof portfolioContentSchema>;
export const portfolioImportSchema = z
  .object({
    format: z.literal("foto-portfolio-migration"),
    version: z.literal(1),
    source: z
      .object({
        kind: z.enum(["saved-html", "pixieset-folder-csv"]),
        fileName: text(255),
        url: sourceUrlSchema.nullable(),
      })
      .strict(),
    content: portfolioContentSchema,
    collections: z
      .array(z.object({ name: text(200), url: sourceUrlSchema.nullable() }).strict())
      .max(PORTFOLIO_IMPORT_MAX_COLLECTIONS),
    warnings: z.array(text(300)).max(12),
  })
  .strict();
export type PortfolioImportPlan = z.infer<typeof portfolioImportSchema>;
const emptyContent = (): PortfolioImportContent => ({ name: "", bio: "", hero: "", nav: [] });
function checkSize(value: string) {
  if (
    value.length > PORTFOLIO_IMPORT_MAX_BYTES ||
    new TextEncoder().encode(value).byteLength > PORTFOLIO_IMPORT_MAX_BYTES
  )
    throw new Error("Choose a file no larger than 2 MiB.");
  if (!value.trim()) throw new Error("That file is empty.");
}

function plain(value: string, max: number): string {
  return (
    value
      .replace(/<[^<>]*>/g, " ")
      .replace(
        /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi,
        (match, dec: string, hex: string, name: string) => {
          if (dec || hex) {
            const code = Number.parseInt(dec || hex, dec ? 10 : 16);
            return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
              ? String.fromCodePoint(code)
              : "";
          }
          return (
            (
              { amp: "&", quot: '"', apos: "'", nbsp: " ", lt: "<", gt: ">" } as Record<
                string,
                string
              >
            )[name.toLowerCase()] ?? match
          );
        },
      )
      // eslint-disable-next-line no-control-regex -- Strip non-display control characters from imported text.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max)
  );
}

function parseHtml(html: string): PortfolioImportContent {
  // No DOM/iframe: even inert-document image loads differ between browsers.
  const safe = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|template|noscript)\b[^<>]{0,8192}>[\s\S]*?(?:<\/\1\s*>|$)/gi, "");
  const element = (source: string, tag: string) => {
    const open = new RegExp(`<${tag}\\b[^<>]{0,8192}>`, "i").exec(source);
    if (!open) return "";
    const start = open.index + open[0].length;
    const rest = source.slice(start);
    const end = new RegExp(`</${tag}\\s*>`, "i").exec(rest);
    return end ? rest.slice(0, end.index) : "";
  };
  const meta = new Map<string, string>();
  for (const tag of safe.matchAll(/<meta\b[^<>]{0,8192}>/gi)) {
    const attrs = new Map<string, string>();
    for (const attr of tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
      attrs.set(attr[1]!.toLowerCase(), attr[2] ?? attr[3] ?? "");
    const key = attrs.get("property") ?? attrs.get("name");
    if (key && attrs.has("content")) meta.set(key.toLowerCase(), attrs.get("content")!);
  }
  const title = meta.get("og:site_name") || element(safe, "title");
  const hero = element(safe, "h1");
  let navHtml = element(safe, "nav");
  const labels: string[] = [];
  // Each iteration consumes a closing anchor, with at most eight output labels.
  for (let i = 0; i < 64 && labels.length < 8; i++) {
    const end = /<\/a\s*>/i.exec(navHtml);
    if (!end) break;
    const label = plain(element(navHtml.slice(0, end.index + end[0].length), "a"), 80);
    if (label && !labels.includes(label)) labels.push(label);
    navHtml = navHtml.slice(end.index + end[0].length);
  }
  const nav = labels;
  const content = {
    name: plain(title, 120),
    bio: plain(meta.get("description") || meta.get("og:description") || "", 1000),
    hero: plain(hero, 200),
    nav,
  };
  if (!content.name && !content.bio && !content.hero && !content.nav.length)
    throw new Error(
      "No supported page text found. Save the page as HTML, or copy its text into the editor.",
    );
  return content;
}

/** Bounded RFC 4180-style CSV parser. Strict malformed-input rejection; no evaluation. */
function csvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false,
    closed = false;
  const cell = () => {
    if (row.length >= 64) throw new Error("The CSV has too many columns.");
    row.push(value);
    value = "";
    closed = false;
  };
  const finish = () => {
    cell();
    if (row.some((v) => v.trim())) rows.push(row);
    row = [];
    if (rows.length > PORTFOLIO_IMPORT_MAX_COLLECTIONS + 1)
      throw new Error("Import at most 1,000 collections per file.");
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        value += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else value += c;
    } else if (c === ",") cell();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      finish();
    } else if (c === '"' && value === "" && !closed) quoted = true;
    else if (closed || c === '"')
      throw new Error(
        "Malformed CSV quoting. Export the file again without editing its structure.",
      );
    else value += c;
    if (value.length > 8192) throw new Error("The CSV contains an oversized cell.");
  }
  if (quoted) throw new Error("The CSV ends inside a quoted cell.");
  if (value || closed || row.length) finish();
  return rows;
}

export function parsePortfolioImport(
  input: string,
  options: { fileName: string; sourceUrl?: string },
): PortfolioImportPlan {
  checkSize(input);
  const clean = input.replace(/^\uFEFF/, "");
  const sourceUrl = options.sourceUrl?.trim()
    ? normalizePortfolioSourceUrl(options.sourceUrl)
    : null;
  if (/\.json$/i.test(options.fileName)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(clean);
    } catch {
      throw new Error("That is not valid JSON.");
    }
    const result = portfolioImportSchema.safeParse(parsed);
    if (!result.success)
      throw new Error(
        "Choose a Celinen migration-plan JSON, version 1. Other JSON exports are not supported.",
      );
    if (sourceUrl && sourceUrl !== result.data.source.url)
      throw new Error(
        "The source URL does not match this plan. Clear it or use the plan's original website address.",
      );
    return result.data;
  }
  const plan: PortfolioImportPlan = {
    format: "foto-portfolio-migration",
    version: 1,
    source: { kind: "saved-html", fileName: options.fileName.slice(0, 255), url: sourceUrl },
    content: emptyContent(),
    collections: [],
    warnings: [],
  };
  if (/\.html?$/i.test(options.fileName)) {
    plan.content = parseHtml(clean);
    plan.warnings = [
      "Text extraction is approximate and covers one saved page only.",
      "Photos, video, styling, fonts, forms, navigation destinations and scripts are not imported.",
    ];
  } else if (/\.csv$/i.test(options.fileName)) {
    plan.source.kind = "pixieset-folder-csv";
    const rows = csvRows(clean);
    const headers = rows.shift()?.map((v) => v.trim().toLowerCase()) ?? [];
    if (
      new Set(headers).size !== headers.length ||
      !headers.includes("collection name") ||
      !headers.includes("collection url")
    )
      throw new Error(
        "Choose a Pixieset folder-information CSV with Collection Name and Collection URL columns.",
      );
    const nameIndex = headers.indexOf("collection name"),
      urlIndex = headers.indexOf("collection url");
    let skippedUrls = 0;
    for (const row of rows) {
      if (row.length !== headers.length)
        throw new Error("A CSV row has the wrong number of columns. Export the file again.");
      const name = plain(row[nameIndex] ?? "", 200);
      if (!name) throw new Error("Each collection needs a name. No rows were applied.");
      let url: string | null = null;
      if (row[urlIndex]?.trim()) {
        try {
          url = normalizePortfolioSourceUrl(row[urlIndex]!);
        } catch {
          skippedUrls++;
        }
      }
      plan.collections.push({ name, url });
    }
    if (!plan.collections.length) throw new Error("This CSV contains no collections.");
    plan.warnings = [
      "Collection names and credential-free links only. No photos, videos, albums or Celinen galleries are created.",
      "All contact details, passwords, PINs and other columns are discarded. Keep your original export private.",
    ];
    if (skippedUrls)
      plan.warnings.push(`${skippedUrls} unsafe or unsupported collection links were omitted.`);
  } else
    throw new Error(
      "Choose saved HTML (.html), Pixieset folder CSV (.csv), or a Celinen migration plan (.json). ZIP, XML and full-site backups are not supported.",
    );
  return portfolioImportSchema.parse(plan);
}

/** Merge at apply time, not file-read time, so edits made during review win. */
export function fillEmptyPortfolioFields<T extends PortfolioImportContent>(
  current: T,
  proposed: PortfolioImportContent,
): T {
  const content = portfolioContentSchema.parse(proposed);
  return {
    ...current,
    name: current.name.trim() ? current.name : content.name,
    bio: current.bio.trim() ? current.bio : content.bio,
    hero: current.hero.trim() ? current.hero : content.hero,
    nav: current.nav.length ? current.nav : content.nav,
  };
}
export function serializePortfolioImport(plan: PortfolioImportPlan): string {
  const value = JSON.stringify(portfolioImportSchema.parse(plan), null, 2);
  checkSize(value);
  return value;
}
