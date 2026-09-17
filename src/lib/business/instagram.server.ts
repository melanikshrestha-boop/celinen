import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { businessDatabase } from "./database.server";

export const stateHash = (s: string) => createHash("sha256").update(s).digest("hex");

/** Instagram API with Instagram Login. Business and Creator accounts only: Meta
 * offers no API for personal accounts or for reading anyone's home feed.
 */
export const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_comments",
  "instagram_business_manage_insights",
] as const;
export type InstagramScope = (typeof INSTAGRAM_SCOPES)[number];
/** Latest version shown in Meta's Instagram Login examples (Sept 2026). */
const DEFAULT_API_VERSION = "v25.0";
const DAY = 86_400_000;

function apiVersion() {
  const version = process.env["INSTAGRAM_API_VERSION"] || DEFAULT_API_VERSION;
  if (!/^v\d+\.0$/.test(version)) throw new Error("Invalid Instagram API version.");
  return version;
}
function config() {
  const id = process.env["INSTAGRAM_APP_ID"],
    secret = process.env["INSTAGRAM_APP_SECRET"],
    origin = process.env["PUBLISH_ORIGIN"],
    key = process.env["SOCIAL_TOKEN_KEY"];
  if (!id || !secret || !origin || !key || !/^[a-fA-F0-9]{64}$/.test(key))
    throw new Error("Instagram needs its app connection configured in Celinen hosting settings.");
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("Instagram needs a secure, configured public website address.");
  return { id, secret, redirect: `${url.origin}/publish`, key: Buffer.from(key, "hex") };
}
export function instagramConfigured() {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}
export function sealToken(token: string, owner: string, key: Buffer) {
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(owner));
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), body]).toString("base64");
}
export function openToken(encrypted: string, owner: string, key: Buffer) {
  const bytes = Buffer.from(encrypted, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(owner));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
}

/** A Graph API failure, classified. `message` is always Celinen's own words:
 * upstream text can echo request data and is never shown or stored.
 */
export class InstagramApiError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 when no response arrived (network, timeout). */
    readonly status: number,
    readonly code: number | null,
    readonly subcode: number | null,
    readonly kind:
      | "rate-limit"
      | "publish-limit"
      | "auth"
      | "permission"
      | "not-ready"
      | "expired"
      | "media"
      | "rejected"
      | "unavailable",
  ) {
    super(message);
    this.name = "InstagramApiError";
  }
  /** Instagram answered and the answer means the request did nothing. */
  get definitive() {
    return this.status >= 400 && this.status < 500;
  }
}

function classify(status: number, body: unknown): InstagramApiError {
  const error =
    body && typeof body === "object" && "error" in body
      ? (body as { error?: { code?: unknown; error_subcode?: unknown } }).error
      : undefined;
  const code = typeof error?.code === "number" ? error.code : null;
  const subcode = typeof error?.error_subcode === "number" ? error.error_subcode : null;
  const make = (message: string, kind: InstagramApiError["kind"]) =>
    new InstagramApiError(message, status, code, subcode, kind);
  if (subcode === 2207042 || code === 9)
    return make(
      "Instagram's daily publishing limit for this account is reached. Try again later.",
      "publish-limit",
    );
  if (status === 429 || (code !== null && [4, 17, 32, 613].includes(code)))
    return make("Instagram is busy. Try again later.", "rate-limit");
  if (code === 190 || status === 401)
    return make("Instagram access expired. Reconnect Instagram.", "auth");
  if (code === 10 || (code !== null && code >= 200 && code < 300) || status === 403)
    return make(
      "Instagram did not grant this permission. Reconnect Instagram and allow it.",
      "permission",
    );
  if (subcode === 2207027) return make("Instagram is still preparing this post.", "not-ready");
  if (subcode === 2207008 || subcode === 2207020 || subcode === 2207006)
    return make("Instagram let this upload expire. Post again.", "expired");
  if (subcode === 2207052 || subcode === 2207003)
    return make("Instagram could not download the photos. Try again.", "media");
  if (subcode === 2207009)
    return make("Instagram rejected the photo shape. Use 4:5 or 1:1.", "media");
  if (subcode === 2207004 || subcode === 2207005)
    return make("Instagram rejected the photo file.", "media");
  if (subcode === 2207010) return make("The caption is too long for Instagram.", "media");
  if (status >= 500) return make("Instagram is unavailable right now. Try again.", "unavailable");
  return make(
    "Instagram did not accept this request. Check account permission and image requirements.",
    "rejected",
  );
}

export type InstagramFetch = typeof fetch;
type GraphResult = Record<string, unknown> & {
  id?: unknown;
  user_id?: unknown;
  username?: unknown;
  status_code?: unknown;
  permalink?: unknown;
  account_type?: unknown;
  data?: unknown;
  paging?: unknown;
  success?: unknown;
};

/** One Graph call. Bearer auth only: tokens never appear in URLs or logs. */
export async function instagramCall(
  path: string,
  token: string,
  options: {
    method?: "GET" | "POST" | "DELETE";
    body?: URLSearchParams;
    fetch?: InstagramFetch;
    timeoutMs?: number;
  } = {},
): Promise<GraphResult> {
  // Callers build paths from validated numeric ids and encoded parameters only.
  if (!/^[a-zA-Z0-9_/?=&,%.-]+$/.test(path) || path.includes(".."))
    throw new Error("Invalid Instagram request.");
  const method = options.method ?? (options.body ? "POST" : "GET");
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(
      `https://graph.instagram.com/${apiVersion()}/${path}`,
      {
        method,
        headers: { Authorization: `Bearer ${token}` },
        ...(options.body ? { body: options.body } : {}),
        signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
        redirect: "error",
      },
    );
  } catch {
    throw new InstagramApiError(
      "Instagram did not answer. Try again.",
      0,
      null,
      null,
      "unavailable",
    );
  }
  if (!response.ok) throw classify(response.status, await response.json().catch(() => null));
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object")
    throw new InstagramApiError(
      "Instagram returned an unreadable answer.",
      0,
      null,
      null,
      "unavailable",
    );
  return payload as GraphResult;
}

/** Positional form kept for the delivery publishing and Stories paths. */
export function instagramRequest(
  path: string,
  token: string,
  body?: URLSearchParams,
  request: InstagramFetch = fetch,
) {
  return instagramCall(path, token, { ...(body ? { body } : {}), fetch: request });
}

export async function startInstagram(owner: string) {
  const c = config(),
    db = businessDatabase(),
    state = randomBytes(32).toString("base64url");
  await db
    .from("social_oauth_states")
    .delete()
    .eq("owner_id", owner)
    .lt("expires_at", new Date().toISOString());
  const { count, error: countError } = await db
    .from("social_oauth_states")
    .select("hash", { count: "exact", head: true })
    .eq("owner_id", owner);
  if (countError || (count ?? 0) >= 5)
    throw new Error("Too many connection attempts. Wait ten minutes and retry.");
  const { error } = await db.from("social_oauth_states").insert({
    hash: stateHash(state),
    owner_id: owner,
    expires_at: new Date(Date.now() + 600000).toISOString(),
  });
  if (error) throw new Error("Instagram connection storage is unavailable.");
  return instagramAuthorizeUrl(c.id, c.redirect, state);
}
export function instagramAuthorizeUrl(clientId: string, redirect: string, state: string) {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: INSTAGRAM_SCOPES.join(","),
    state,
    enable_fb_login: "0",
    // Lets a photographer with two accounts choose which one to connect.
    force_reauth: "true",
  });
  return `https://www.instagram.com/oauth/authorize?${query}`;
}

/** Meta documents `{data:[{...}]}`; flat responses are also seen. Accept both. */
export function readShortToken(payload: unknown) {
  const short =
    payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data[0]
      : payload;
  if (!short || typeof short !== "object") return null;
  const { access_token: token, permissions } = short as {
    access_token?: unknown;
    permissions?: unknown;
  };
  if (typeof token !== "string" || !token) return null;
  const listed = Array.isArray(permissions)
    ? permissions
    : typeof permissions === "string"
      ? permissions.split(",")
      : null;
  const scopes = listed
    ? INSTAGRAM_SCOPES.filter((scope) => listed.some((entry) => String(entry).trim() === scope))
    : null;
  return { token, scopes };
}

export async function finishInstagram(
  owner: string,
  code: string,
  state: string,
  deps: { fetch?: InstagramFetch; db?: ReturnType<typeof businessDatabase> } = {},
) {
  const c = config(),
    db = deps.db ?? businessDatabase(),
    request = deps.fetch ?? fetch;
  const { data: consumed, error } = await db
    .from("social_oauth_states")
    .delete()
    .eq("hash", stateHash(state))
    .eq("owner_id", owner)
    .gt("expires_at", new Date().toISOString())
    .select("hash")
    .maybeSingle();
  if (error || !consumed)
    throw new Error("This connection link expired or was already used. Connect Instagram again.");
  const response = await request("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: c.id,
      client_secret: c.secret,
      grant_type: "authorization_code",
      redirect_uri: c.redirect,
      // Instagram appends "#_" to the redirect; a browser drops it, a pasted URL may not.
      code: code.replace(/#_$/, ""),
    }),
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  }).catch(() => {
    throw new Error("Instagram connection was interrupted. Please reconnect.");
  });
  if (!response.ok) throw new Error("Instagram could not complete the connection. Connect again.");
  const short = readShortToken(await response.json().catch(() => null));
  if (!short) throw new Error("Instagram did not grant access.");
  if (short.scopes && !short.scopes.includes("instagram_business_basic"))
    throw new Error("Instagram did not grant basic account access. Connect again and allow it.");
  const tokenUrl = new URL("https://graph.instagram.com/access_token");
  tokenUrl.search = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: c.secret,
    access_token: short.token,
  }).toString();
  const exchange = await request(tokenUrl, {
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  }).catch(() => {
    throw new Error("Instagram connection was interrupted. Please reconnect.");
  });
  if (!exchange.ok)
    throw new Error("Instagram could not save a lasting connection. Please reconnect.");
  const long = await exchange.json().catch(() => null);
  if (
    !long ||
    typeof long.access_token !== "string" ||
    typeof long.expires_in !== "number" ||
    long.expires_in < 60
  )
    throw new Error("Instagram returned invalid access.");
  const profile = await instagramCall(
    "me?fields=user_id,username,account_type",
    long.access_token,
    {
      fetch: request,
    },
  );
  if (!/^\d+$/.test(String(profile.user_id)) || typeof profile.username !== "string")
    throw new Error("Instagram account could not be verified.");
  const now = Date.now();
  const saved = await db.from("social_connections").upsert({
    owner_id: owner,
    account_id: String(profile.user_id),
    username: profile.username,
    credential: sealToken(long.access_token, owner, c.key),
    expires_at: new Date(now + Math.min(long.expires_in, 5184000) * 1000).toISOString(),
    // When Instagram does not list permissions, what was requested is what the dialog granted.
    scopes: short.scopes ?? [...INSTAGRAM_SCOPES],
    account_type: typeof profile.account_type === "string" ? profile.account_type : null,
    token_refreshed_at: new Date(now).toISOString(),
  });
  if (saved.error)
    throw new Error(
      "Instagram connected but could not be saved. Apply the Instagram account migration, then reconnect.",
    );
  return { username: profile.username };
}

export type InstagramConnectionRow = {
  account_id: string;
  username: string;
  credential: string;
  expires_at: string;
  /** Present once migration 0024 is applied; older rows read as no extra scopes. */
  scopes?: string[] | null;
  account_type?: string | null;
  token_refreshed_at?: string | null;
};

export async function instagramConnection(
  owner: string,
  db: ReturnType<typeof businessDatabase> = businessDatabase(),
): Promise<InstagramConnectionRow | null> {
  // `*` reads the same before and after the column migration.
  const { data, error } = await db
    .from("social_connections")
    .select("*")
    .eq("owner_id", owner)
    .maybeSingle();
  if (error) throw new Error("Instagram connection storage is unavailable.");
  return (data as InstagramConnectionRow | null) ?? null;
}

export const connectionScopes = (row: InstagramConnectionRow): InstagramScope[] =>
  // A pre-migration row was connected with the two publishing scopes only.
  row.scopes
    ? INSTAGRAM_SCOPES.filter((scope) => row.scopes!.includes(scope))
    : ["instagram_business_basic", "instagram_business_content_publish"];

/** Refresh when the token is past its first day (Meta's minimum age) and has
 * used a quarter of its 60 days. Any request that needs the token keeps it alive.
 */
export function refreshDue(row: InstagramConnectionRow, now: number) {
  const expires = Date.parse(row.expires_at);
  const refreshed = Date.parse(row.token_refreshed_at ?? "");
  const age = Number.isFinite(refreshed) ? now - refreshed : now - (expires - 60 * DAY);
  return expires > now && age >= DAY && expires - now < 45 * DAY;
}

export type InstagramSession = {
  owner: string;
  accountId: string;
  username: string;
  accountType: string | null;
  scopes: InstagramScope[];
  token: string;
  expiresAt: string;
};

export type InstagramSessionDeps = {
  db?: ReturnType<typeof businessDatabase>;
  fetch?: InstagramFetch;
  now?: () => number;
  key?: Buffer;
};

/** The only way a server path obtains an Instagram token: bound to the signed-in
 * owner (the AES-GCM associated data), refreshed when due, never returned to the page.
 */
export async function instagramSession(
  owner: string,
  deps: InstagramSessionDeps = {},
): Promise<InstagramSession> {
  const db = deps.db ?? businessDatabase(),
    now = deps.now?.() ?? Date.now(),
    key = deps.key ?? config().key;
  const row = await instagramConnection(owner, db);
  if (!row) throw new Error("Connect Instagram first.");
  if (Date.parse(row.expires_at) < now + 60000)
    throw new Error("Instagram access expired. Reconnect Instagram.");
  let token = openToken(row.credential, owner, key);
  let expiresAt = row.expires_at;
  if (refreshDue(row, now)) {
    const url = new URL("https://graph.instagram.com/refresh_access_token");
    url.search = new URLSearchParams({
      grant_type: "ig_refresh_token",
      access_token: token,
    }).toString();
    try {
      const response = await (deps.fetch ?? fetch)(url, {
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
      const body = response.ok ? await response.json().catch(() => null) : null;
      if (body && typeof body.access_token === "string" && typeof body.expires_in === "number") {
        const next = {
          credential: sealToken(body.access_token, owner, key),
          expires_at: new Date(now + Math.min(body.expires_in, 5184000) * 1000).toISOString(),
          token_refreshed_at: new Date(now).toISOString(),
        };
        // Compare-and-swap: a concurrent refresh already stored an equally valid token.
        const stored = await db
          .from("social_connections")
          .update(next)
          .eq("owner_id", owner)
          .eq("credential", row.credential)
          .select("owner_id")
          .maybeSingle();
        if (!stored.error && stored.data) {
          token = body.access_token;
          expiresAt = next.expires_at;
        }
      }
    } catch {
      // The current token is still valid; the next request tries again.
    }
  }
  return {
    owner,
    accountId: row.account_id,
    username: row.username,
    accountType: row.account_type ?? null,
    scopes: connectionScopes(row),
    token,
    expiresAt,
  };
}

export function requireScope(session: InstagramSession, scope: InstagramScope, action: string) {
  if (!session.scopes.includes(scope)) throw new Error(`Reconnect Instagram and allow ${action}.`);
}

export async function instagramCredential(owner: string, accountId: string) {
  const session = await instagramSession(owner).catch(() => null);
  if (!session || session.accountId !== accountId)
    throw new Error("Reconnect the original Instagram account before publishing this draft.");
  return session.token;
}
