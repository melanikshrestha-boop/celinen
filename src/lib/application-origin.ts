/** Public origin only. Never place credentials in VITE_* configuration. */
export const PRODUCTION_ORIGIN = "https://lenslab.dev";
export function applicationOrigin(configured?: string) {
  if (!configured) return PRODUCTION_ORIGIN;
  const url = new URL(configured);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !/^[a-z0-9.:[\]-]+$/i.test(url.hostname) ||
    (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))
  )
    throw new Error(
      "Application origin must be HTTPS, or an HTTP loopback origin, without a path or credentials.",
    );
  return url.origin;
}
export const APPLICATION_ORIGIN = applicationOrigin(import.meta.env?.["VITE_APP_ORIGIN"]);
export function applicationUrl(path: string, origin = APPLICATION_ORIGIN) {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    Array.from(path).some(
      (char) => char === "\\" || char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127,
    )
  )
    throw new Error("Use an application-relative path.");
  const base = applicationOrigin(origin);
  const url = new URL(path, base);
  if (url.origin !== base) throw new Error("Application URL changed origin.");
  return url.href;
}
