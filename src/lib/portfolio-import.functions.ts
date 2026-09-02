import { createServerFn } from "@tanstack/react-start";

/**
 * Clone an existing photographer site (Pixieset, Squarespace, Format, Wix, Zenfolio,
 * SmugMug, plain HTML…) into an editable LensLabs portfolio.
 *
 * Server-side fetch + light HTML scrape: title, tagline/bio, gallery images,
 * section headings and the site's dominant accent colour when it declares one.
 */

export interface ImportedPhoto {
  url: string;
  title: string;
  story: string;
}

export interface ImportedSite {
  source: string;
  platform: string;
  name: string;
  bio: string;
  handle: string;
  accent: string | null;
  photos: ImportedPhoto[];
  headings: string[];
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

function meta(html: string, key: string) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["']`,
    "i",
  );
  const alt = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["']`,
    "i",
  );
  const m = html.match(re) ?? html.match(alt);
  return m?.[1] ? decode(m[1]) : "";
}

function detectPlatform(html: string, host: string) {
  const h = html.toLowerCase();
  if (host.includes("pixieset") || h.includes("pixieset")) return "Pixieset";
  if (h.includes("squarespace")) return "Squarespace";
  if (h.includes("format.com") || h.includes("data-format")) return "Format";
  if (h.includes("wix.com") || h.includes("wixstatic")) return "Wix";
  if (h.includes("smugmug")) return "SmugMug";
  if (h.includes("zenfolio")) return "Zenfolio";
  if (h.includes("wp-content")) return "WordPress";
  if (h.includes("shopify")) return "Shopify";
  return "Website";
}

const BAD = /(sprite|logo|icon|favicon|avatar|badge|pixel|blank|placeholder|1x1|loading)/i;

function collectImages(html: string, base: URL): string[] {
  const out: string[] = [];
  const push = (raw: string | undefined) => {
    if (!raw) return;
    let u = decode(raw).split(/\s+/)[0];
    if (!u || u.startsWith("data:")) return;
    try {
      u = new URL(u, base).toString();
    } catch {
      return;
    }
    if (BAD.test(u)) return;
    if (!/\.(jpe?g|png|webp|avif)(\?|$)/i.test(u) && !/(image|photo|media)/i.test(u)) return;
    if (!out.includes(u)) out.push(u);
  };

  const og = meta(html, "og:image");
  if (og) push(og);

  for (const m of html.matchAll(/<img[^>]+>/gi)) {
    const tag = m[0];
    const srcset = tag.match(/(?:data-srcset|srcset)=["']([^"']+)["']/i);
    if (srcset) {
      const best = (srcset[1] ?? "").split(",").pop();
      push(best?.trim());
      continue;
    }
    const src = tag.match(/(?:data-src|data-image|src)=["']([^"']+)["']/i);
    push(src?.[1]);
  }

  for (const m of html.matchAll(/background-image:\s*url\((['"]?)([^'")]+)\1\)/gi)) push(m[2]);

  return out.slice(0, 60);
}

function collectHeadings(html: string) {
  const out: string[] = [];
  for (const m of html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)) {
    const text = decode((m[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
    if (text.length > 1 && text.length < 80 && !out.includes(text)) out.push(text);
  }
  return out.slice(0, 12);
}

function accentColor(html: string) {
  const counts = new Map<string, number>();
  for (const m of html.matchAll(/#([0-9a-f]{6})\b/gi)) {
    const hex = `#${(m[1] ?? "").toLowerCase()}`;
    if (/^#(f{6}|0{6}|fff.*|000.*)$/.test(hex)) continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 2 ? best[0] : null;
}

const titleCase = (s: string) =>
  s
    .replace(/[-_]+/g, " ")
    .replace(/\.\w+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const importPortfolio = createServerFn({ method: "POST" })
  .inputValidator((data: { url: string }) => {
    const raw = String(data?.url ?? "").trim();
    if (!raw) throw new Error("Paste the address of your current site.");
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let parsed: URL;
    try {
      parsed = new URL(withProto);
    } catch {
      throw new Error("That does not look like a web address.");
    }
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("Only http(s) links work.");
    if (/^(localhost|127\.|10\.|192\.168\.|0\.)/i.test(parsed.hostname))
      throw new Error("Private addresses cannot be imported.");
    return { url: parsed.toString() };
  })
  .handler(async ({ data }): Promise<ImportedSite> => {
    const res = await fetch(data.url, {
      headers: { "user-agent": UA, accept: "text/html,*/*" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`That site answered ${res.status}.`);
    const html = (await res.text()).slice(0, 2_000_000);
    const base = new URL(res.url || data.url);

    const rawTitle =
      meta(html, "og:site_name") ||
      meta(html, "og:title") ||
      decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") ||
      base.hostname;

    const name = titleCase(rawTitle.split(/[|—–·-]/)[0] || base.hostname).slice(0, 60);
    const bio =
      meta(html, "og:description") || meta(html, "description") || "";

    const images = collectImages(html, base);

    return {
      source: base.toString(),
      platform: detectPlatform(html, base.hostname),
      name,
      bio: bio.slice(0, 240),
      handle: (base.hostname.replace(/^www\./, "").split(".")[0] ?? "studio").slice(0, 32),
      accent: accentColor(html),
      headings: collectHeadings(html),
      photos: images.map((url, i) => ({
        url,
        title: titleCase(decodeURIComponent(url.split("/").pop() ?? `Frame ${i + 1}`)).slice(0, 60),
        story: "",
      })),
    };
  });
