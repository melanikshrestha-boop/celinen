export type WebResult = { title: string; url: string; description: string; domain: string };
export function safeWebUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      !url.hostname.includes(".") ||
      /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/i.test(url.hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname) ||
      url.hostname.endsWith(".local")
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
export function normalizeWebResults(value: unknown): WebResult[] {
  const response = value as {
    web?: { results?: Array<{ title?: unknown; url?: unknown; description?: unknown }> };
  } | null;
  const rows = response?.web?.results;
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  return rows
    .slice(0, 20)
    .flatMap((row) => {
      const url = safeWebUrl(row?.url);
      if (!url || seen.has(url) || typeof row.title !== "string") return [];
      seen.add(url);
      // Render as text, never provider HTML or executable markup.
      const plain = (text: string) => text.replace(/<[^>]*>/g, "").slice(0, 2000);
      return [
        {
          url,
          title: plain(row.title).slice(0, 250),
          description: typeof row.description === "string" ? plain(row.description) : "",
          domain: new URL(url).hostname,
        },
      ];
    })
    .slice(0, 10);
}
export const externalSearchHref = (query: string) =>
  `https://www.google.com/search?q=${encodeURIComponent(query.trim().slice(0, 500))}`;
