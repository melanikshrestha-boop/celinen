/** One connection model for every social provider.
 *
 * Instagram (`social_connections`) and Facebook (`facebook_social_connections`)
 * keep their existing modules and tables; this file presents them through the
 * same interface it gives Threads, LinkedIn, X, TikTok and YouTube, which live
 * in `social_provider_connections`.
 *
 * Security properties, all enforced here:
 *  - tokens are AES-256-GCM sealed with the owner id as associated data and
 *    are never returned to the page;
 *  - OAuth state is random, hashed at rest, single-use and expires in 10 minutes;
 *  - PKCE (S256) for X, TikTok and YouTube; the verifier is sealed at rest;
 *  - the redirect is derived from PUBLISH_ORIGIN, never from the request;
 *  - refresh runs under a row lease so two runners cannot burn a single-use
 *    refresh token against each other;
 *  - a refusal on refresh flips the row to `reconnect` with a plain reason.
 */
import { createHash, randomBytes } from "node:crypto";
import { businessDatabase } from "./database.server";
import {
  connectionScopes,
  instagramConnection,
  instagramSession,
  openToken,
  sealToken,
  stateHash,
  startInstagram,
  finishInstagram,
  type InstagramSession,
} from "./instagram.server";
import {
  disconnectFacebook,
  facebookPageSession,
  facebookStatus,
  finishFacebook,
  startFacebook,
  type FacebookPageSession,
} from "./facebook.server";
import {
  PROVIDER_LABEL,
  PROVIDER_SECRETS,
  SOCIAL_PROVIDERS,
  SocialApiError,
  connectorRedirect,
  type SocialProvider,
} from "../social/connectors";

export type Database = ReturnType<typeof businessDatabase>;
export type ConnectionDeps = {
  db: Database;
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Worker secrets. Tests pass their own; production reads process.env. */
  env: Record<string, string | undefined>;
  instagramSession: (owner: string) => Promise<InstagramSession>;
  facebookSession: (owner: string) => Promise<FacebookPageSession>;
};
export function connectionDeps(overrides: Partial<ConnectionDeps> = {}): ConnectionDeps {
  const db = overrides.db ?? businessDatabase();
  const request = overrides.fetch ?? fetch;
  const env = overrides.env ?? (process.env as Record<string, string | undefined>);
  return {
    db,
    fetch: request,
    now: overrides.now ?? Date.now,
    sleep: overrides.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    env,
    instagramSession:
      overrides.instagramSession ??
      ((owner) => {
        const key = env["SOCIAL_TOKEN_KEY"];
        return instagramSession(owner, {
          db,
          fetch: request,
          ...(key && /^[a-fA-F0-9]{64}$/.test(key) ? { key: Buffer.from(key, "hex") } : {}),
        });
      }),
    facebookSession: overrides.facebookSession ?? ((owner) => facebookPageSession(owner)),
  };
}

const TABLE = "social_provider_connections";
const STATES = "social_oauth_states";
const STATE_TTL_MS = 10 * 60_000;
const REFRESH_LEASE_MS = 60_000;
const DAY = 86_400_000;
const json = (response: Response) =>
  response
    .text()
    .then((text) => (text.length > 200_000 ? {} : (JSON.parse(text) as Record<string, unknown>)))
    .catch(() => ({}) as Record<string, unknown>);

export type ProviderConfig = {
  provider: SocialProvider;
  id: string;
  secret: string;
  origin: string;
  redirect: string;
  key: Buffer;
  env: Record<string, string | undefined>;
  /** The clock expiries are computed from: the runner's, so tests and retries agree. */
  now: number;
};

/** Which Worker secrets are present for a provider. Names only; never values. */
export function providerConfig(
  provider: SocialProvider,
  env: Record<string, string | undefined>,
  now: number = Date.now(),
): { ok: true; config: ProviderConfig } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const [idName, secretName] = PROVIDER_SECRETS[provider] as [string, string];
  const id = env[idName],
    secret = env[secretName],
    key = env["SOCIAL_TOKEN_KEY"],
    origin = env["PUBLISH_ORIGIN"];
  if (!id) missing.push(idName);
  if (!secret) missing.push(secretName);
  if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) missing.push("SOCIAL_TOKEN_KEY");
  let url: URL | null = null;
  try {
    url = origin ? new URL(origin) : null;
  } catch {
    url = null;
  }
  if (!url || url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash)
    missing.push("PUBLISH_ORIGIN");
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    config: {
      provider,
      id: id!,
      secret: secret!,
      origin: url!.origin,
      redirect: connectorRedirect(url!.origin, provider),
      key: Buffer.from(key!, "hex"),
      env,
      now,
    },
  };
}
export const connectorConfigured = (
  provider: SocialProvider,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
) => {
  const result = providerConfig(provider, env);
  return result.ok
    ? { configured: true, missing: [] as string[] }
    : { configured: false, missing: result.missing };
};

/** Tokens as a provider hands them out. `refresh` is null when the provider has none. */
export type TokenSet = {
  access: string;
  refresh: string | null;
  expiresAt: string | null;
  refreshExpiresAt: string | null;
  scopes: string[];
};
type Profile = {
  accountId: string;
  accountName: string;
  accountKind: string;
  meta: Record<string, unknown>;
};
type OAuthProvider = {
  scopes: readonly string[];
  scopeSeparator: "," | " ";
  pkce: boolean;
  /** Refresh once the token has less than this long left. */
  refreshLeadMs: number;
  /** Meta refuses to refresh tokens younger than a day. */
  minTokenAgeMs: number;
  authorize(config: ProviderConfig, state: string, challenge: string | null): string;
  exchange(
    config: ProviderConfig,
    code: string,
    verifier: string | null,
    request: typeof fetch,
  ): Promise<TokenSet>;
  /** Null: this provider cannot refresh; the owner reconnects at expiry. */
  refresh(
    config: ProviderConfig,
    tokens: TokenSet,
    request: typeof fetch,
  ): Promise<TokenSet | null>;
  profile(config: ProviderConfig, tokens: TokenSet, request: typeof fetch): Promise<Profile>;
};

const seconds = (now: number, value: unknown, fallback: number | null) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0
    ? new Date(now + n * 1000).toISOString()
    : fallback === null
      ? null
      : new Date(now + fallback * 1000).toISOString();
};
/** Providers list granted scopes with commas (LinkedIn, TikTok) or spaces (X, Google); accept either. */
const scopesOf = (value: unknown, fallback: readonly string[]) =>
  typeof value === "string" && value.trim() ? value.split(/[,\s]+/).filter(Boolean) : [...fallback];
const basic = (config: ProviderConfig) =>
  `Basic ${Buffer.from(`${config.id}:${config.secret}`).toString("base64")}`;
const interrupted = (provider: SocialProvider) =>
  new SocialApiError(
    `${PROVIDER_LABEL[provider]} connection was interrupted. Connect again.`,
    "unavailable",
  );
const refused = (provider: SocialProvider) =>
  new SocialApiError(
    `${PROVIDER_LABEL[provider]} could not complete the connection. Connect again.`,
    "rejected",
    400,
  );

async function post(
  request: typeof fetch,
  url: string,
  body: URLSearchParams,
  headers: Record<string, string> = {},
) {
  return request(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      ...headers,
    },
    body,
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
}

/** Threads API with Threads Login.
 * https://developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions
 * https://developers.facebook.com/docs/threads/get-started/long-lived-tokens */
const threads: OAuthProvider = {
  scopes: ["threads_basic", "threads_content_publish"],
  scopeSeparator: ",",
  pkce: false,
  refreshLeadMs: 45 * DAY,
  minTokenAgeMs: DAY,
  authorize: (config, state) =>
    `https://threads.net/oauth/authorize?${new URLSearchParams({
      client_id: config.id,
      redirect_uri: config.redirect,
      scope: threads.scopes.join(","),
      response_type: "code",
      state,
    })}`,
  async exchange(config, code, _verifier, request) {
    const short = await post(
      request,
      "https://graph.threads.net/oauth/access_token",
      new URLSearchParams({
        client_id: config.id,
        client_secret: config.secret,
        grant_type: "authorization_code",
        redirect_uri: config.redirect,
        code: code.replace(/#_$/, ""),
      }),
    ).catch(() => {
      throw interrupted("threads");
    });
    const shortBody = await json(short);
    if (!short.ok || typeof shortBody["access_token"] !== "string") throw refused("threads");
    const url = new URL("https://graph.threads.net/access_token");
    url.search = new URLSearchParams({
      grant_type: "th_exchange_token",
      client_secret: config.secret,
      access_token: shortBody["access_token"],
    }).toString();
    const long = await request(url, {
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    }).catch(() => {
      throw interrupted("threads");
    });
    const body = await json(long);
    if (!long.ok || typeof body["access_token"] !== "string") throw refused("threads");
    return {
      access: body["access_token"],
      refresh: null,
      expiresAt: seconds(config.now, body["expires_in"], (60 * DAY) / 1000),
      refreshExpiresAt: null,
      scopes: [...threads.scopes],
    };
  },
  async refresh(_config, tokens, request) {
    const url = new URL("https://graph.threads.net/refresh_access_token");
    url.search = new URLSearchParams({
      grant_type: "th_refresh_token",
      access_token: tokens.access,
    }).toString();
    const response = await request(url, { signal: AbortSignal.timeout(15_000), redirect: "error" });
    const body = await json(response);
    if (!response.ok || typeof body["access_token"] !== "string")
      throw new SocialApiError(
        "Threads access expired. Reconnect Threads.",
        "auth",
        response.status,
      );
    return {
      ...tokens,
      access: body["access_token"],
      expiresAt: seconds(config.now, body["expires_in"], (60 * DAY) / 1000),
    };
  },
  async profile(_config, tokens, request) {
    const response = await request("https://graph.threads.net/v1.0/me?fields=id,username", {
      headers: { Authorization: `Bearer ${tokens.access}` },
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    const body = await json(response);
    if (!response.ok || !/^\d+$/.test(String(body["id"])) || typeof body["username"] !== "string")
      throw new SocialApiError(
        "Threads account could not be verified.",
        "rejected",
        response.status,
      );
    return {
      accountId: String(body["id"]),
      accountName: body["username"],
      accountKind: "user",
      meta: {},
    };
  },
};

/** LinkedIn 3-legged OAuth; Posts API needs w_member_social. Organization posting
 * needs w_organization_social plus r_organization_admin to list the pages, and
 * those scopes are only granted to apps approved for the Community Management
 * API — so they are requested only when LINKEDIN_ORGANIZATION_SCOPES=true.
 * https://learn.microsoft.com/linkedin/shared/authentication/authorization-code-flow
 * https://learn.microsoft.com/linkedin/shared/authentication/programmatic-refresh-tokens */
export const LINKEDIN_VERSION = "202509";
const linkedin: OAuthProvider = {
  scopes: ["openid", "profile", "w_member_social"],
  scopeSeparator: " ",
  pkce: false,
  refreshLeadMs: 7 * DAY,
  minTokenAgeMs: 0,
  authorize: (config, state) =>
    `https://www.linkedin.com/oauth/v2/authorization?${new URLSearchParams({
      response_type: "code",
      client_id: config.id,
      redirect_uri: config.redirect,
      state,
      scope: linkedinScopes(config).join(" "),
    })}`,
  async exchange(config, code, _verifier, request) {
    const response = await post(
      request,
      "https://www.linkedin.com/oauth/v2/accessToken",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: config.id,
        client_secret: config.secret,
        redirect_uri: config.redirect,
      }),
    ).catch(() => {
      throw interrupted("linkedin");
    });
    const body = await json(response);
    if (!response.ok || typeof body["access_token"] !== "string") throw refused("linkedin");
    const now = config.now;
    return {
      access: body["access_token"],
      refresh: typeof body["refresh_token"] === "string" ? body["refresh_token"] : null,
      expiresAt: seconds(now, body["expires_in"], (60 * DAY) / 1000),
      refreshExpiresAt:
        typeof body["refresh_token"] === "string"
          ? seconds(now, body["refresh_token_expires_in"], (365 * DAY) / 1000)
          : null,
      scopes: scopesOf(body["scope"], linkedinScopes(config)),
    };
  },
  async refresh(config, tokens, request) {
    if (!tokens.refresh) return null;
    const response = await post(
      request,
      "https://www.linkedin.com/oauth/v2/accessToken",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh,
        client_id: config.id,
        client_secret: config.secret,
      }),
    );
    const body = await json(response);
    if (!response.ok || typeof body["access_token"] !== "string")
      throw new SocialApiError(
        "LinkedIn access expired. Reconnect LinkedIn.",
        "auth",
        response.status,
      );
    const now = config.now;
    return {
      access: body["access_token"],
      refresh: typeof body["refresh_token"] === "string" ? body["refresh_token"] : tokens.refresh,
      expiresAt: seconds(now, body["expires_in"], (60 * DAY) / 1000),
      refreshExpiresAt:
        typeof body["refresh_token_expires_in"] === "number"
          ? seconds(now, body["refresh_token_expires_in"], null)
          : tokens.refreshExpiresAt,
      scopes: tokens.scopes,
    };
  },
  async profile(_config, tokens, request) {
    const response = await request("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access}` },
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    const body = await json(response);
    if (!response.ok || typeof body["sub"] !== "string" || !body["sub"])
      throw new SocialApiError(
        "LinkedIn account could not be verified.",
        "rejected",
        response.status,
      );
    const meta: Record<string, unknown> = {};
    if (
      tokens.scopes.includes("w_organization_social") &&
      tokens.scopes.includes("r_organization_admin")
    ) {
      // Pages the member administers; a failure here only hides organization posting.
      const acls = await request(
        "https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&projection=(elements*(organization~(localizedName)))",
        {
          headers: {
            Authorization: `Bearer ${tokens.access}`,
            "LinkedIn-Version": LINKEDIN_VERSION,
            "X-Restli-Protocol-Version": "2.0.0",
          },
          signal: AbortSignal.timeout(15_000),
          redirect: "error",
        },
      ).catch(() => null);
      const listed = acls && acls.ok ? await json(acls) : null;
      const elements = Array.isArray(listed?.["elements"])
        ? (listed!["elements"] as Record<string, unknown>[])
        : [];
      meta["organizations"] = elements
        .map((row) => ({
          urn: String(row["organization"] ?? ""),
          name: String(
            (row["organization~"] as { localizedName?: unknown } | undefined)?.localizedName ?? "",
          ),
        }))
        .filter((row) => /^urn:li:organization:\d+$/.test(row.urn))
        .slice(0, 50);
    }
    return {
      accountId: body["sub"],
      accountName:
        typeof body["name"] === "string" && body["name"] ? body["name"] : "LinkedIn member",
      accountKind: "member",
      meta,
    };
  },
};
function linkedinScopes(config: ProviderConfig) {
  return config.env["LINKEDIN_ORGANIZATION_SCOPES"] === "true"
    ? [...linkedin.scopes, "w_organization_social", "r_organization_admin"]
    : [...linkedin.scopes];
}

/** X OAuth 2.0 with PKCE (confidential client: Basic auth on the token endpoint).
 * Refresh tokens are single-use, which is why refresh runs under a lease.
 * https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code */
const x: OAuthProvider = {
  scopes: ["tweet.read", "tweet.write", "users.read", "offline.access", "media.write"],
  scopeSeparator: " ",
  pkce: true,
  refreshLeadMs: 10 * 60_000,
  minTokenAgeMs: 0,
  authorize: (config, state, challenge) =>
    `https://x.com/i/oauth2/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: config.id,
      redirect_uri: config.redirect,
      scope: x.scopes.join(" "),
      state,
      code_challenge: challenge ?? "",
      code_challenge_method: "S256",
    })}`,
  async exchange(config, code, verifier, request) {
    const response = await post(
      request,
      "https://api.x.com/2/oauth2/token",
      new URLSearchParams({
        code,
        grant_type: "authorization_code",
        client_id: config.id,
        redirect_uri: config.redirect,
        code_verifier: verifier ?? "",
      }),
      { Authorization: basic(config) },
    ).catch(() => {
      throw interrupted("x");
    });
    const body = await json(response);
    if (!response.ok || typeof body["access_token"] !== "string") throw refused("x");
    return {
      access: body["access_token"],
      refresh: typeof body["refresh_token"] === "string" ? body["refresh_token"] : null,
      expiresAt: seconds(config.now, body["expires_in"], 7200),
      refreshExpiresAt: null,
      scopes: scopesOf(body["scope"], x.scopes),
    };
  },
  async refresh(config, tokens, request) {
    if (!tokens.refresh) return null;
    const response = await post(
      request,
      "https://api.x.com/2/oauth2/token",
      new URLSearchParams({
        refresh_token: tokens.refresh,
        grant_type: "refresh_token",
        client_id: config.id,
      }),
      { Authorization: basic(config) },
    );
    const body = await json(response);
    if (!response.ok || typeof body["access_token"] !== "string")
      throw new SocialApiError("X access expired. Reconnect X.", "auth", response.status);
    return {
      access: body["access_token"],
      refresh: typeof body["refresh_token"] === "string" ? body["refresh_token"] : tokens.refresh,
      expiresAt: seconds(config.now, body["expires_in"], 7200),
      refreshExpiresAt: null,
      scopes: scopesOf(body["scope"], tokens.scopes),
    };
  },
  async profile(_config, tokens, request) {
    const response = await request("https://api.x.com/2/users/me", {
      headers: { Authorization: `Bearer ${tokens.access}` },
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    const body = await json(response);
    const data = body["data"] as { id?: unknown; username?: unknown } | undefined;
    if (
      !response.ok ||
      !data ||
      !/^\d+$/.test(String(data.id)) ||
      typeof data.username !== "string"
    )
      throw new SocialApiError("X account could not be verified.", "rejected", response.status);
    return {
      accountId: String(data.id),
      accountName: data.username,
      accountKind: "user",
      meta: {},
    };
  },
};

/** TikTok Login Kit (PKCE) + Content Posting API scopes.
 * https://developers.tiktok.com/doc/login-kit-web
 * https://developers.tiktok.com/doc/oauth-user-access-token-management */
const tiktok: OAuthProvider = {
  scopes: ["user.info.basic", "video.publish", "video.upload"],
  scopeSeparator: ",",
  pkce: true,
  refreshLeadMs: 60 * 60_000,
  minTokenAgeMs: 0,
  authorize: (config, state, challenge) =>
    `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({
      client_key: config.id,
      scope: tiktok.scopes.join(","),
      response_type: "code",
      redirect_uri: config.redirect,
      state,
      code_challenge: challenge ?? "",
      code_challenge_method: "S256",
    })}`,
  async exchange(config, code, verifier, request) {
    const response = await post(
      request,
      "https://open.tiktokapis.com/v2/oauth/token/",
      new URLSearchParams({
        client_key: config.id,
        client_secret: config.secret,
        code,
        grant_type: "authorization_code",
        redirect_uri: config.redirect,
        code_verifier: verifier ?? "",
      }),
    ).catch(() => {
      throw interrupted("tiktok");
    });
    const body = await json(response);
    if (
      !response.ok ||
      typeof body["access_token"] !== "string" ||
      typeof body["open_id"] !== "string"
    )
      throw refused("tiktok");
    const now = config.now;
    return {
      access: body["access_token"],
      refresh: typeof body["refresh_token"] === "string" ? body["refresh_token"] : null,
      expiresAt: seconds(now, body["expires_in"], 86_400),
      refreshExpiresAt: seconds(now, body["refresh_expires_in"], (365 * DAY) / 1000),
      scopes: scopesOf(body["scope"], tiktok.scopes),
    };
  },
  async refresh(config, tokens, request) {
    if (!tokens.refresh) return null;
    const response = await post(
      request,
      "https://open.tiktokapis.com/v2/oauth/token/",
      new URLSearchParams({
        client_key: config.id,
        client_secret: config.secret,
        grant_type: "refresh_token",
        refresh_token: tokens.refresh,
      }),
    );
    const body = await json(response);
    if (!response.ok || typeof body["access_token"] !== "string")
      throw new SocialApiError(
        "TikTok access expired. Reconnect TikTok.",
        "auth",
        response.status || 400,
      );
    const now = config.now;
    return {
      access: body["access_token"],
      refresh: typeof body["refresh_token"] === "string" ? body["refresh_token"] : tokens.refresh,
      expiresAt: seconds(now, body["expires_in"], 86_400),
      refreshExpiresAt: seconds(now, body["refresh_expires_in"], (365 * DAY) / 1000),
      scopes: scopesOf(body["scope"], tokens.scopes),
    };
  },
  async profile(_config, tokens, request) {
    const response = await request(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name",
      {
        headers: { Authorization: `Bearer ${tokens.access}` },
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      },
    );
    const body = await json(response);
    const user = (
      body["data"] as { user?: { open_id?: unknown; display_name?: unknown } } | undefined
    )?.user;
    if (!response.ok || !user || typeof user.open_id !== "string" || !user.open_id)
      throw new SocialApiError(
        "TikTok account could not be verified.",
        "rejected",
        response.status,
      );
    return {
      accountId: user.open_id,
      accountName:
        typeof user.display_name === "string" && user.display_name
          ? user.display_name
          : "TikTok creator",
      accountKind: "user",
      meta: {},
    };
  },
};

/** Google OAuth for the YouTube Data API. `access_type=offline` + `prompt=consent`
 * are what make Google hand out a refresh token; in Testing publishing status
 * that refresh token expires after 7 days.
 * https://developers.google.com/identity/protocols/oauth2/web-server
 * https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps */
const youtube: OAuthProvider = {
  scopes: [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
  ],
  scopeSeparator: " ",
  pkce: true,
  refreshLeadMs: 5 * 60_000,
  minTokenAgeMs: 0,
  authorize: (config, state, challenge) =>
    `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: config.id,
      redirect_uri: config.redirect,
      response_type: "code",
      scope: youtube.scopes.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
      code_challenge: challenge ?? "",
      code_challenge_method: "S256",
    })}`,
  async exchange(config, code, verifier, request) {
    const response = await post(
      request,
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        code,
        client_id: config.id,
        client_secret: config.secret,
        redirect_uri: config.redirect,
        grant_type: "authorization_code",
        code_verifier: verifier ?? "",
      }),
    ).catch(() => {
      throw interrupted("youtube");
    });
    const body = await json(response);
    if (!response.ok || typeof body["access_token"] !== "string") throw refused("youtube");
    return {
      access: body["access_token"],
      refresh: typeof body["refresh_token"] === "string" ? body["refresh_token"] : null,
      expiresAt: seconds(config.now, body["expires_in"], 3600),
      refreshExpiresAt: null,
      scopes: scopesOf(body["scope"], youtube.scopes),
    };
  },
  async refresh(config, tokens, request) {
    if (!tokens.refresh) return null;
    const response = await post(
      request,
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        client_id: config.id,
        client_secret: config.secret,
        refresh_token: tokens.refresh,
        grant_type: "refresh_token",
      }),
    );
    const body = await json(response);
    if (!response.ok || typeof body["access_token"] !== "string")
      throw new SocialApiError(
        "YouTube access expired. Reconnect YouTube.",
        "auth",
        response.status,
      );
    return {
      ...tokens,
      access: body["access_token"],
      expiresAt: seconds(config.now, body["expires_in"], 3600),
    };
  },
  async profile(_config, tokens, request) {
    const response = await request(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      {
        headers: { Authorization: `Bearer ${tokens.access}` },
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      },
    );
    const body = await json(response);
    const item = (Array.isArray(body["items"]) ? body["items"][0] : null) as {
      id?: unknown;
      snippet?: { title?: unknown };
    } | null;
    if (!response.ok || !item || typeof item.id !== "string" || !item.id)
      throw new SocialApiError(
        "This Google account has no YouTube channel. Create one on YouTube, then connect again.",
        "rejected",
        response.status,
      );
    return {
      accountId: item.id,
      accountName:
        typeof item.snippet?.title === "string" && item.snippet.title
          ? item.snippet.title
          : "YouTube channel",
      accountKind: "channel",
      meta: {},
    };
  },
};

const OAUTH: Record<Exclude<SocialProvider, "instagram" | "facebook_page">, OAuthProvider> = {
  threads,
  linkedin,
  x,
  tiktok,
  youtube,
};
export type GenericProvider = keyof typeof OAUTH;
export const isGenericProvider = (provider: SocialProvider): provider is GenericProvider =>
  provider in OAUTH;
export const providerScopes = (provider: GenericProvider) => OAUTH[provider].scopes;

/** PKCE S256: verifier at rest is sealed; only its challenge leaves the server. */
const challengeOf = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

async function reserveState(
  owner: string,
  provider: GenericProvider,
  config: ProviderConfig,
  deps: ConnectionDeps,
) {
  const db = deps.db,
    now = deps.now();
  await db
    .from(STATES)
    .delete()
    .eq("owner_id", owner)
    .lt("expires_at", new Date(now).toISOString());
  const { count, error: countError } = await db
    .from(STATES)
    .select("hash", { count: "exact", head: true })
    .eq("owner_id", owner);
  if (countError || (count ?? 0) >= 5)
    throw new SocialApiError(
      "Too many connection attempts. Wait ten minutes and retry.",
      "rate-limit",
      429,
    );
  const state = randomBytes(32).toString("base64url");
  const verifier = OAUTH[provider].pkce ? randomBytes(48).toString("base64url") : null;
  const { error } = await db.from(STATES).insert({
    hash: stateHash(`${provider}:${state}`),
    owner_id: owner,
    expires_at: new Date(now + STATE_TTL_MS).toISOString(),
    provider,
    verifier: verifier ? sealToken(verifier, `${provider}:${owner}`, config.key) : null,
  });
  if (error)
    throw new SocialApiError(
      `${PROVIDER_LABEL[provider]} connection storage is unavailable. Apply the social connectors migration.`,
      "config",
    );
  return { state, verifier };
}

/** Returns the provider's authorization URL for the signed-in owner. */
export async function startSocialConnection(
  owner: string,
  provider: SocialProvider,
  deps: ConnectionDeps = connectionDeps(),
): Promise<string> {
  if (provider === "instagram") return startInstagram(owner);
  if (provider === "facebook_page") return startFacebook(owner);
  const ready = providerConfig(provider, deps.env, deps.now());
  if (!ready.ok)
    throw new SocialApiError(
      `${PROVIDER_LABEL[provider]} is missing ${ready.missing.join(", ")} in Celinen hosting settings.`,
      "config",
    );
  const { state, verifier } = await reserveState(owner, provider, ready.config, deps);
  return OAUTH[provider].authorize(ready.config, state, verifier ? challengeOf(verifier) : null);
}

/** Consumes the state once, exchanges the code, verifies the account, seals the tokens. */
export async function finishSocialConnection(
  owner: string,
  provider: SocialProvider,
  code: string,
  state: string,
  deps: ConnectionDeps = connectionDeps(),
): Promise<{ accountName: string }> {
  if (provider === "instagram") {
    const done = await finishInstagram(owner, code, state, { db: deps.db, fetch: deps.fetch });
    return { accountName: `@${done.username}` };
  }
  if (provider === "facebook_page") {
    await finishFacebook(owner, code, state);
    return { accountName: "Facebook Page" };
  }
  const ready = providerConfig(provider, deps.env, deps.now());
  if (!ready.ok)
    throw new SocialApiError(
      `${PROVIDER_LABEL[provider]} is missing ${ready.missing.join(", ")} in Celinen hosting settings.`,
      "config",
    );
  const config = ready.config;
  const consumed = await deps.db
    .from(STATES)
    .delete()
    .eq("hash", stateHash(`${provider}:${state}`))
    .eq("owner_id", owner)
    .gt("expires_at", new Date(deps.now()).toISOString())
    .select("hash,verifier")
    .maybeSingle();
  if (consumed.error || !consumed.data)
    throw new SocialApiError(
      `This connection link expired or was already used. Connect ${PROVIDER_LABEL[provider]} again.`,
      "rejected",
      400,
    );
  const sealedVerifier = (consumed.data as { verifier?: string | null }).verifier ?? null;
  if (OAUTH[provider].pkce && !sealedVerifier)
    throw new SocialApiError(`Connect ${PROVIDER_LABEL[provider]} again.`, "rejected", 400);
  const verifier = sealedVerifier
    ? openToken(sealedVerifier, `${provider}:${owner}`, config.key)
    : null;
  const tokens = await OAUTH[provider].exchange(config, code, verifier, deps.fetch);
  const profile = await OAUTH[provider].profile(config, tokens, deps.fetch);
  const now = deps.now();
  const existing = await deps.db
    .from(TABLE)
    .select("id")
    .eq("owner_id", owner)
    .eq("provider", provider)
    .maybeSingle();
  const row = {
    id: (existing.data as { id?: string } | null)?.id ?? crypto.randomUUID(),
    owner_id: owner,
    provider,
    account_id: profile.accountId,
    account_name: profile.accountName.slice(0, 300),
    account_kind: profile.accountKind,
    credential: sealToken(
      JSON.stringify({ access: tokens.access, refresh: tokens.refresh }),
      `${provider}:${owner}`,
      config.key,
    ),
    expires_at: tokens.expiresAt,
    refresh_expires_at: tokens.refreshExpiresAt,
    scopes: tokens.scopes,
    state: "active",
    state_reason: null,
    refresh_lease: null,
    refresh_lease_until: null,
    token_refreshed_at: new Date(now).toISOString(),
    // Threads renews with the access token itself; the others need a refresh token.
    meta: { ...profile.meta, canRefresh: provider === "threads" || !!tokens.refresh },
    updated_at: new Date(now).toISOString(),
  };
  const saved = await deps.db.from(TABLE).upsert(row, { onConflict: "owner_id,provider" });
  if (saved.error)
    throw new SocialApiError(
      `${PROVIDER_LABEL[provider]} connected but could not be saved. Apply the social connectors migration, then reconnect.`,
      "config",
    );
  return { accountName: profile.accountName };
}

type ConnectionRow = {
  id: string;
  owner_id: string;
  provider: GenericProvider;
  account_id: string;
  account_name: string;
  account_kind: string;
  credential: string;
  expires_at: string | null;
  refresh_expires_at: string | null;
  scopes: string[] | null;
  state: "active" | "reconnect";
  state_reason: string | null;
  refresh_lease: string | null;
  refresh_lease_until: string | null;
  token_refreshed_at: string | null;
  meta: Record<string, unknown> | null;
};

async function readRow(owner: string, provider: GenericProvider, db: Database) {
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("owner_id", owner)
    .eq("provider", provider)
    .maybeSingle();
  if (error)
    throw new SocialApiError(
      `${PROVIDER_LABEL[provider]} connection storage is unavailable. Apply the social connectors migration.`,
      "config",
    );
  return (data as ConnectionRow | null) ?? null;
}

/** Flips a connection to `reconnect` with a plain reason. Idempotent. */
export async function markReconnect(
  owner: string,
  provider: SocialProvider,
  reason: string,
  deps: ConnectionDeps = connectionDeps(),
) {
  if (!isGenericProvider(provider)) return; // Instagram/Facebook show expiry from their own rows.
  await deps.db
    .from(TABLE)
    .update({
      state: "reconnect",
      state_reason: reason.slice(0, 500),
      updated_at: new Date(deps.now()).toISOString(),
    })
    .eq("owner_id", owner)
    .eq("provider", provider);
}

export type SocialSession = {
  provider: SocialProvider;
  connectionId: string | null;
  accountId: string;
  accountName: string;
  accountKind: string;
  token: string;
  scopes: string[];
  meta: Record<string, unknown>;
  expiresAt: string | null;
};

const openCredential = (row: ConnectionRow, owner: string, key: Buffer): TokenSet => {
  const parsed = JSON.parse(openToken(row.credential, `${row.provider}:${owner}`, key)) as {
    access?: unknown;
    refresh?: unknown;
  };
  if (typeof parsed.access !== "string")
    throw new SocialApiError("Stored access is unreadable. Reconnect.", "auth", 401);
  return {
    access: parsed.access,
    refresh: typeof parsed.refresh === "string" ? parsed.refresh : null,
    expiresAt: row.expires_at,
    refreshExpiresAt: row.refresh_expires_at,
    scopes: row.scopes ?? [],
  };
};

function refreshDue(row: ConnectionRow, spec: OAuthProvider, now: number) {
  if (!row.expires_at) return false;
  const expires = Date.parse(row.expires_at);
  const refreshed = Date.parse(row.token_refreshed_at ?? "");
  const age = Number.isFinite(refreshed) ? now - refreshed : Infinity;
  return expires - now < spec.refreshLeadMs && age >= spec.minTokenAgeMs;
}

/** The only way a server path obtains a provider token: bound to the signed-in
 * owner, refreshed under a lease when due, never returned to the page. */
export async function socialSession(
  owner: string,
  provider: SocialProvider,
  deps: ConnectionDeps = connectionDeps(),
): Promise<SocialSession> {
  if (provider === "instagram") {
    const session = await deps.instagramSession(owner);
    return {
      provider,
      connectionId: null,
      accountId: session.accountId,
      accountName: `@${session.username}`,
      accountKind: session.accountType?.toLowerCase() ?? "user",
      token: session.token,
      scopes: session.scopes,
      meta: {},
      expiresAt: session.expiresAt,
    };
  }
  if (provider === "facebook_page") {
    const page = await deps.facebookSession(owner);
    return {
      provider,
      connectionId: null,
      accountId: page.pageId,
      accountName: page.pageName,
      accountKind: "page",
      token: page.token,
      scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
      meta: {},
      expiresAt: null,
    };
  }
  const ready = providerConfig(provider, deps.env, deps.now());
  if (!ready.ok)
    throw new SocialApiError(
      `${PROVIDER_LABEL[provider]} is missing ${ready.missing.join(", ")} in Celinen hosting settings.`,
      "config",
    );
  const spec = OAUTH[provider];
  const label = PROVIDER_LABEL[provider];
  let row = await readRow(owner, provider, deps.db);
  if (!row) throw new SocialApiError(`Connect ${label} first.`, "auth", 401);
  if (row.state === "reconnect")
    throw new SocialApiError(
      row.state_reason || `${label} access expired. Reconnect ${label}.`,
      "auth",
      401,
    );
  const now = deps.now();
  let tokens = openCredential(row, owner, ready.config.key);
  const valid = (r: ConnectionRow, at: number) =>
    !r.expires_at || Date.parse(r.expires_at) > at + 30_000;

  if (refreshDue(row, spec, now)) {
    if (!tokens.refresh && provider !== "threads") {
      if (!valid(row, now)) {
        await markReconnect(owner, provider, `${label} access expired. Reconnect ${label}.`, deps);
        throw new SocialApiError(`${label} access expired. Reconnect ${label}.`, "auth", 401);
      }
    } else if (row.refresh_expires_at && Date.parse(row.refresh_expires_at) <= now) {
      await markReconnect(owner, provider, `${label} access expired. Reconnect ${label}.`, deps);
      throw new SocialApiError(`${label} access expired. Reconnect ${label}.`, "auth", 401);
    } else {
      const lease = crypto.randomUUID();
      const claimed = await deps.db
        .from(TABLE)
        .update({
          refresh_lease: lease,
          refresh_lease_until: new Date(now + REFRESH_LEASE_MS).toISOString(),
        })
        .eq("id", row.id)
        .eq("owner_id", owner)
        .or(`refresh_lease.is.null,refresh_lease_until.lt.${new Date(now).toISOString()}`)
        .select("id")
        .maybeSingle();
      if (!claimed.error && claimed.data) {
        try {
          const next = await spec.refresh(ready.config, tokens, deps.fetch);
          if (next) {
            const stamp = new Date(deps.now()).toISOString();
            const stored = await deps.db
              .from(TABLE)
              .update({
                credential: sealToken(
                  JSON.stringify({ access: next.access, refresh: next.refresh }),
                  `${provider}:${owner}`,
                  ready.config.key,
                ),
                expires_at: next.expiresAt,
                refresh_expires_at: next.refreshExpiresAt,
                scopes: next.scopes,
                token_refreshed_at: stamp,
                updated_at: stamp,
                refresh_lease: null,
                refresh_lease_until: null,
              })
              .eq("id", row.id)
              .eq("refresh_lease", lease)
              .select("id")
              .maybeSingle();
            if (stored.error || !stored.data)
              throw new SocialApiError(
                `Could not save refreshed ${label} access. Try again.`,
                "unavailable",
              );
            tokens = next;
            row = {
              ...row,
              expires_at: next.expiresAt,
              scopes: next.scopes,
              token_refreshed_at: stamp,
            };
          }
        } catch (error) {
          await deps.db
            .from(TABLE)
            .update({ refresh_lease: null, refresh_lease_until: null })
            .eq("id", row.id)
            .eq("refresh_lease", lease);
          if (error instanceof SocialApiError && error.kind === "auth" && error.definitive) {
            await markReconnect(owner, provider, error.message, deps);
            throw error;
          }
          // No answer or a 5xx: the current token may still work; the next run tries again.
          if (!valid(row, now))
            throw new SocialApiError(
              `${label} did not renew access. Try again shortly.`,
              "unavailable",
            );
        }
      } else {
        // Another runner holds the refresh; wait for its result rather than racing it.
        for (let attempt = 0; attempt < 3; attempt++) {
          await deps.sleep(1000);
          const fresh = await readRow(owner, provider, deps.db);
          if (!fresh) throw new SocialApiError(`Connect ${label} first.`, "auth", 401);
          if (fresh.state === "reconnect")
            throw new SocialApiError(fresh.state_reason || `Reconnect ${label}.`, "auth", 401);
          if (fresh.token_refreshed_at !== row.token_refreshed_at) {
            row = fresh;
            tokens = openCredential(fresh, owner, ready.config.key);
            break;
          }
          if (!fresh.refresh_lease) break;
        }
        if (!valid(row, deps.now()))
          throw new SocialApiError(
            `${label} is renewing access. Try again shortly.`,
            "unavailable",
          );
      }
    }
  } else if (!valid(row, now)) {
    await markReconnect(owner, provider, `${label} access expired. Reconnect ${label}.`, deps);
    throw new SocialApiError(`${label} access expired. Reconnect ${label}.`, "auth", 401);
  }
  return {
    provider,
    connectionId: row.id,
    accountId: row.account_id,
    accountName: row.account_name,
    accountKind: row.account_kind,
    token: tokens.access,
    scopes: row.scopes ?? [],
    meta: row.meta ?? {},
    expiresAt: row.expires_at,
  };
}

/** Remembers provider facts (rate-limit headers, creator options) for the page. */
export async function rememberConnectionMeta(
  session: SocialSession,
  patch: Record<string, unknown>,
  deps: ConnectionDeps = connectionDeps(),
) {
  if (!session.connectionId) return;
  const meta = { ...session.meta, ...patch };
  if (JSON.stringify(meta).length > 20_000) return;
  await deps.db
    .from(TABLE)
    .update({ meta, updated_at: new Date(deps.now()).toISOString() })
    .eq("id", session.connectionId);
}

export async function disconnectSocialConnection(
  owner: string,
  provider: SocialProvider,
  deps: ConnectionDeps = connectionDeps(),
) {
  if (provider === "instagram") {
    const { error } = await deps.db.from("social_connections").delete().eq("owner_id", owner);
    if (error) throw new Error("Could not disconnect Instagram. Retry.");
    return { disconnected: true };
  }
  if (provider === "facebook_page") return disconnectFacebook(owner);
  const { error } = await deps.db
    .from(TABLE)
    .delete()
    .eq("owner_id", owner)
    .eq("provider", provider);
  if (error) throw new Error(`Could not disconnect ${PROVIDER_LABEL[provider]}. Retry.`);
  // Disconnect removes Celinen's copy only; revoke the app in the provider's settings to revoke the grant.
  return { disconnected: true };
}

export type ConnectorStatus = {
  provider: SocialProvider;
  label: string;
  configured: boolean;
  /** Worker secret names that are absent. Empty when configured. */
  missing: string[];
  /** The exact callback to register in the developer portal. */
  redirect: string | null;
  connection: null | {
    accountName: string;
    accountKind: string;
    state: "active" | "reconnect";
    reason: string | null;
    expiresAt: string | null;
    scopes: string[];
    /** LinkedIn organizations / Facebook Pages the owner may post as. */
    targets: { id: string; name: string; selected?: boolean }[];
  };
};

/** What the Social accounts page shows per provider: exactly which secret is
 * missing, or the account and whether it needs reconnecting. */
export async function connectorStatus(
  owner: string,
  deps: ConnectionDeps = connectionDeps(),
): Promise<ConnectorStatus[]> {
  const now = deps.now();
  const origin = (() => {
    try {
      const url = new URL(deps.env["PUBLISH_ORIGIN"] ?? "");
      return url.protocol === "https:" ? url.origin : null;
    } catch {
      return null;
    }
  })();
  const out: ConnectorStatus[] = [];
  for (const provider of SOCIAL_PROVIDERS) {
    const ready = providerConfig(provider, deps.env, deps.now());
    const base: ConnectorStatus = {
      provider,
      label: PROVIDER_LABEL[provider],
      configured: ready.ok,
      missing: ready.ok ? [] : ready.missing,
      redirect: origin ? connectorRedirect(origin, provider) : null,
      connection: null,
    };
    try {
      if (provider === "instagram") {
        const row = await instagramConnection(owner, deps.db);
        if (row) {
          const active = Date.parse(row.expires_at) > now + 60_000;
          base.connection = {
            accountName: `@${row.username}`,
            accountKind: row.account_type?.toLowerCase() ?? "user",
            state: active ? "active" : "reconnect",
            reason: active ? null : "Instagram access expired. Reconnect Instagram.",
            expiresAt: row.expires_at,
            scopes: connectionScopes(row),
            targets: [],
          };
        }
      } else if (provider === "facebook_page") {
        const status = ready.ok ? await facebookStatus(owner) : null;
        if (status && status.pages.length) {
          const selected = status.pages.find((page) => page.id === status.selected);
          base.connection = {
            accountName: selected?.name ?? "Choose a Page",
            accountKind: "page",
            state: status.active ? "active" : "reconnect",
            reason: status.active
              ? null
              : status.selected
                ? "Facebook access expired. Reconnect Facebook."
                : "Choose a Facebook Page.",
            expiresAt: null,
            scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
            targets: status.pages.map((page) => ({
              id: page.id,
              name: page.name,
              selected: page.id === status.selected,
            })),
          };
        }
      } else {
        const row = await readRow(owner, provider, deps.db);
        if (row) {
          // Expired access still counts as connected when a live refresh token can renew it.
          const canRefresh =
            row.meta?.["canRefresh"] === true &&
            (!row.refresh_expires_at || Date.parse(row.refresh_expires_at) > now);
          const expired = !!row.expires_at && Date.parse(row.expires_at) <= now && !canRefresh;
          const state: "active" | "reconnect" =
            row.state === "reconnect" || expired ? "reconnect" : "active";
          const organizations = Array.isArray(row.meta?.["organizations"])
            ? (row.meta!["organizations"] as { urn: string; name: string }[])
            : [];
          base.connection = {
            accountName: row.account_name,
            accountKind: row.account_kind,
            state,
            reason:
              state === "active"
                ? null
                : row.state_reason ||
                  `${PROVIDER_LABEL[provider]} access expired. Reconnect ${PROVIDER_LABEL[provider]}.`,
            expiresAt: row.expires_at,
            scopes: row.scopes ?? [],
            targets: organizations.map((org) => ({ id: org.urn, name: org.name })),
          };
        }
      }
    } catch {
      // Storage or key trouble reads as "not connected" rather than failing the page.
      base.connection = null;
    }
    out.push(base);
  }
  return out;
}
