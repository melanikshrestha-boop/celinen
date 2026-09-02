import { createServerFn } from "@tanstack/react-start";

/**
 * Clone an existing photographer site (Pixieset, Squarespace, Format, Wix, Zenfolio,
 * SmugMug, plain HTML…) into an editable LensLabs portfolio.
 *
 * The scrape captures enough to *look like* the original: palette (background, ink,
 * accent), heading/body typefaces, nav links, hero heading + tagline, gallery images
 * and section headings.
 */

export interface ImportedPhoto {
  url: string;
  title: string;
  story: string;
}

export interface ImportedTheme {
  bg: string;
  ink: string;
  accent: string | null;
  headingFont: string;
  bodyFont: string;
  serif: boolean;
  uppercaseNav: boolean;
  layout: "grid" | "stack" | "masonry";
}

export interface ImportedSite {
  source: string;
  platform: string;
  name: string;
  bio: string;
  handle: string;
  accent: string | null;
  hero: string;
  heroImage: string | null;
  nav: string[];
  theme: ImportedTheme;
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

const strip = (s: string) => decode(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));

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
    const text = strip(m[1] ?? "");
    if (text.length > 1 && text.length < 80 && !out.includes(text)) out.push(text);
  }
  return out.slice(0, 12);
}

function collectNav(html: string) {
  const out: string[] = [];
  const navBlocks = [...html.matchAll(/<nav[^>]*>([\s\S]{0,4000}?)<\/nav>/gi)].map((m) => m[1] ?? "");
  const scope = navBlocks.join(" ") || html.slice(0, 20000);
  for (const m of scope.matchAll(/<a[^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    const text = strip(m[1] ?? "");
    if (!text || text.length > 24) continue;
    if (/^(skip|menu|close|cart|0)$/i.test(text)) continue;
    if (!out.some((t) => t.toLowerCase() === text.toLowerCase())) out.push(text);
  }
  return out.slice(0, 7);
}

/** Most-declared colours, ignoring pure black/white so we still learn the palette. */
function paletteFrom(html: string) {
  const counts = new Map<string, number>();
  const bump = (hex: string) => counts.set(hex, (counts.get(hex) ?? 0) + 1);

  for (const m of html.matchAll(/#([0-9a-fA-F]{6})\b/g)) bump(`#${(m[1] ?? "").toLowerCase()}`);
  for (const m of html.matchAll(/#([0-9a-fA-F]{3})\b/g)) {
    const h = (m[1] ?? "").toLowerCase();
    bump(`#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`);
  }
  for (const m of html.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
    const hex =
      "#" +
      [m[1], m[2], m[3]]
        .map((v) => Number(v).toString(16).padStart(2, "0"))
        .join("");
    bump(hex);
  }
  return counts;
}

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

const chroma = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return Math.max(r, g, b) - Math.min(r, g, b);
};

function readTheme(html: string): ImportedTheme {
  const counts = paletteFrom(html);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);

  const bodyBg = html.match(/body[^{]*\{[^}]*background(?:-color)?:\s*([^;}]+)/i)?.[1] ?? "";
  const bodyHex = bodyBg.match(/#([0-9a-fA-F]{6})/)?.[0]?.toLowerCase() ?? null;

  const light = ranked.filter((h) => lum(h) > 0.85);
  const dark = ranked.filter((h) => lum(h) < 0.22);
  const darkSite =
    (bodyHex ? lum(bodyHex) < 0.4 : false) ||
    (dark.length > 0 && light.length === 0) ||
    /background(?:-color)?:\s*(#0|#1|black|rgb\(\s*[0-2]?\d\s*,)/i.test(html);

  const bg = bodyHex ?? (darkSite ? (dark[0] ?? "#0e0e10") : (light[0] ?? "#ffffff"));
  const ink = darkSite ? "#f5f5f4" : (dark[0] ?? "#141414");
  const accent = ranked.find((h) => chroma(h) > 40 && lum(h) > 0.15 && lum(h) < 0.85) ?? null;

  const fonts = [...html.matchAll(/font-family:\s*([^;}"']+)/gi)]
    .map((m) => (m[1] ?? "").split(",")[0]!.replace(/["']/g, "").trim())
    .filter((f) => f && !/^(inherit|initial|var|-apple|system-ui|sans-serif|serif)$/i.test(f));
  const linkFonts = [...html.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^&"'>]+)/gi)].map(
    (m) => decodeURIComponent(m[1] ?? "").split(":")[0]!.replace(/\+/g, " "),
  );

  const uniq = [...new Set([...linkFonts, ...fonts])];
  const headingFont = uniq[0] ?? "";
  const bodyFont = uniq[1] ?? uniq[0] ?? "";
  const serif = /serif|garamond|playfair|didot|georgia|baskerville|canela|times/i.test(
    `${headingFont} ${html.slice(0, 4000)}`,
  );

  const gridHits = (html.match(/grid-template-columns|columns-|masonry/gi) ?? []).length;
  const layout: ImportedTheme["layout"] =
    /masonry/i.test(html) ? "masonry" : gridHits > 3 ? "grid" : "stack";

  const uppercaseNav = /text-transform:\s*uppercase/i.test(html);

  return { bg, ink, accent, headingFont, bodyFont, serif, uppercaseNav, layout };
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
      strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") ||
      base.hostname;

    const name = titleCase(rawTitle.split(/[|—–·-]/)[0] || base.hostname).slice(0, 60);
    const bio = meta(html, "og:description") || meta(html, "description") || "";

    const images = collectImages(html, base);
    const headings = collectHeadings(html);
    const theme = readTheme(html);
    const h1 = strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");

    return {
      source: base.toString(),
      platform: detectPlatform(html, base.hostname),
      name,
      bio: bio.slice(0, 240),
      handle: (base.hostname.replace(/^www\./, "").split(".")[0] ?? "studio").slice(0, 32),
      accent: theme.accent,
      hero: (h1 || headings[0] || name).slice(0, 90),
      heroImage: images[0] ?? null,
      nav: collectNav(html),
      theme,
      headings,
      photos: images.map((url, i) => ({
        url,
        title: titleCase(decodeURIComponent(url.split("/").pop() ?? `Frame ${i + 1}`)).slice(0, 60),
        story: "",
      })),
    };
  });
