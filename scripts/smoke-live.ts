/**
 * Read-only smoke test of the public entry points on a deployed site.
 *
 *   bun scripts/smoke-live.ts [base-url] [--payments-live]
 *
 * Defaults to https://lenslab.dev. Sends only GET requests with a browser User-Agent,
 * because Cloudflare Bot Fight answers 403 to bare clients on some paths.
 * Pass --payments-live once Stripe is configured: /signup then hosts checkout
 * instead of the free "Continue with Google" entry.
 */
const args = process.argv.slice(2);
const paymentsLive = args.includes("--payments-live");
const unknown = args.filter((arg) => arg.startsWith("--") && arg !== "--payments-live");
if (unknown.length) throw new Error(`Unknown option ${unknown.join(", ")}.`);
const base = new URL(args.find((arg) => !arg.startsWith("--")) ?? "https://lenslab.dev");
if (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1")
  throw new Error("Use an https base URL (http is accepted for localhost only).");

const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};
const TIMEOUT_MS = 15_000;

function get(path: string, redirect: "manual" | "follow") {
  return fetch(new URL(path, base), {
    headers: HEADERS,
    redirect,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** A same-site redirect whose target path (and, when given, query) matches. */
async function redirects(path: string, toPath: string, query: Record<string, string> = {}) {
  const response = await get(path, "manual");
  if (response.status === 404) throw new Error(`${path} is 404.`);
  if (![301, 302, 307, 308].includes(response.status))
    throw new Error(`${path} answered ${response.status}, expected a redirect to ${toPath}.`);
  const target = new URL(response.headers.get("location") ?? "", base);
  if (target.origin !== base.origin || target.pathname !== toPath)
    throw new Error(`${path} redirects to ${target.href}, expected ${toPath}.`);
  for (const [key, value] of Object.entries(query))
    if (target.searchParams.get(key) !== value)
      throw new Error(`${path} redirects to ${target.href}, expected ${key}=${value}.`);
  return `${response.status} → ${target.pathname}${target.search}`;
}

const checks: [string, () => Promise<string>][] = [
  ["/checkout is not 404", () => redirects("/checkout?plan=pro", "/signup", { plan: "pro" })],
  [
    "/api/health is ok",
    async () => {
      const response = await get("/api/health", "follow");
      if (response.status !== 200) throw new Error(`/api/health answered ${response.status}.`);
      const body = (await response.json()) as { ok?: unknown; git_sha?: unknown };
      if (
        body.ok !== true ||
        typeof body.git_sha !== "string" ||
        !/^[a-f0-9]{40}$/.test(body.git_sha)
      )
        throw new Error(`/api/health body is ${JSON.stringify(body)}.`);
      return body.git_sha.slice(0, 12);
    },
  ],
  [
    paymentsLive ? "/signup loads" : "/signup offers Continue with Google",
    async () => {
      const response = await get("/signup", "follow");
      if (response.status !== 200) throw new Error(`/signup answered ${response.status}.`);
      const html = await response.text();
      if (html.includes("Production checkout is not configured"))
        throw new Error("/signup shows the unconfigured-checkout banner.");
      if (!paymentsLive && !html.includes("Continue with Google"))
        throw new Error('/signup HTML lacks "Continue with Google".');
      return `${html.length} bytes`;
    },
  ],
  ["/login → /auth", () => redirects("/login", "/auth", { mode: "signin" })],
  ["/signin → /auth", () => redirects("/signin", "/auth", { mode: "signin" })],
  ["/sign-in → /auth", () => redirects("/sign-in", "/auth", { mode: "signin" })],
  ["/register → /auth sign-up", () => redirects("/register", "/auth", { mode: "signup" })],
  ["/waitlist → /signup", () => redirects("/waitlist", "/signup")],
];

let failed = 0;
for (const [name, check] of checks) {
  try {
    console.log(`ok    ${name} (${await check()})`);
  } catch (error) {
    failed++;
    console.error(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
if (failed) {
  console.error(`${failed} of ${checks.length} smoke checks failed against ${base.origin}.`);
  process.exit(1);
}
console.log(`All ${checks.length} smoke checks passed against ${base.origin}.`);
