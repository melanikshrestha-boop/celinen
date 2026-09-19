import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { FakeNetwork, FakeSocialDatabase, fixtureMp4 } from "./social-connectors-fixtures";
import {
  connectionDeps,
  connectorConfigured,
  connectorStatus,
  disconnectSocialConnection,
  finishSocialConnection,
  markReconnect,
  providerScopes,
  socialSession,
  startSocialConnection,
  type ConnectionDeps,
} from "../src/lib/business/social-connections.server";
import {
  openProxyTicket,
  proxyTicket,
  verifyStoredMedia,
  mediaDeps,
} from "../src/lib/business/social-media.server";
import {
  PROVIDER_SECRETS,
  SOCIAL_PROVIDERS,
  SocialApiError,
  backoffMs,
  pngDimensions,
  probeMp4,
  validateUnit,
  xWeightedLength,
  type SocialProvider,
} from "../src/lib/social/connectors";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DAY = 86_400_000;
export const ENV: Record<string, string> = {
  SOCIAL_TOKEN_KEY: "0123456789abcdef".repeat(4),
  PUBLISH_ORIGIN: "https://lenslab.dev",
  SUPABASE_URL: "https://fixture.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-fixture",
  INSTAGRAM_APP_ID: "ig-id",
  INSTAGRAM_APP_SECRET: "ig-secret",
  FACEBOOK_APP_ID: "fb-id",
  FACEBOOK_APP_SECRET: "fb-secret",
  THREADS_APP_ID: "th-id",
  THREADS_APP_SECRET: "th-secret",
  LINKEDIN_CLIENT_ID: "li-id",
  LINKEDIN_CLIENT_SECRET: "li-secret",
  X_CLIENT_ID: "x-id",
  X_CLIENT_SECRET: "x-secret",
  TIKTOK_CLIENT_KEY: "tt-key",
  TIKTOK_CLIENT_SECRET: "tt-secret",
  GOOGLE_YOUTUBE_CLIENT_ID: "yt-id",
  GOOGLE_YOUTUBE_CLIENT_SECRET: "yt-secret",
};
const GENERIC: Exclude<SocialProvider, "instagram" | "facebook_page">[] = [
  "threads",
  "linkedin",
  "x",
  "tiktok",
  "youtube",
];

export function world(env: Record<string, string | undefined> = ENV) {
  const db = new FakeSocialDatabase();
  const net = new FakeNetwork();
  let clock = Date.parse("2026-09-18T12:00:00Z");
  db.now = () => clock;
  const deps: ConnectionDeps = connectionDeps({
    db: db as never,
    fetch: net.fetch,
    now: () => clock,
    sleep: async () => {},
    env,
    instagramSession: async () => {
      throw new Error("Connect Instagram first.");
    },
    facebookSession: async () => {
      throw new Error("Connect Facebook first.");
    },
  });
  return { db, net, deps, tick: (ms: number) => (clock += ms), clock: () => clock };
}

/** Runs the full OAuth round trip for a provider and returns the state/code used. */
export async function connect(
  w: ReturnType<typeof world>,
  provider: SocialProvider,
  owner = OWNER,
) {
  const url = new URL(await startSocialConnection(owner, provider, w.deps));
  const state = url.searchParams.get("state")!;
  const done = await finishSocialConnection(owner, provider, "auth-code", state, w.deps);
  return { url, state, done };
}

describe("configuration", () => {
  test("names exactly the missing Worker secrets, never their values", () => {
    expect(connectorConfigured("x", ENV)).toEqual({ configured: true, missing: [] });
    const { X_CLIENT_SECRET: _drop, ...without } = ENV;
    void _drop;
    expect(connectorConfigured("x", without)).toEqual({
      configured: false,
      missing: ["X_CLIENT_SECRET"],
    });
    expect(
      connectorConfigured("youtube", { ...ENV, PUBLISH_ORIGIN: "http://lenslab.dev" }).missing,
    ).toEqual(["PUBLISH_ORIGIN"]);
    expect(connectorConfigured("tiktok", {}).missing).toEqual([
      "TIKTOK_CLIENT_KEY",
      "TIKTOK_CLIENT_SECRET",
      "SOCIAL_TOKEN_KEY",
      "PUBLISH_ORIGIN",
    ]);
    for (const provider of SOCIAL_PROVIDERS) expect(PROVIDER_SECRETS[provider]).toHaveLength(2);
  });

  test("status reports each provider's own missing secrets and no connection", async () => {
    const { THREADS_APP_SECRET: _drop, ...env } = ENV;
    void _drop;
    const w = world(env);
    const status = await connectorStatus(OWNER, w.deps);
    const threads = status.find((row) => row.provider === "threads")!;
    expect(threads).toMatchObject({
      configured: false,
      missing: ["THREADS_APP_SECRET"],
      connection: null,
      redirect: "https://lenslab.dev/publish?connector=threads",
    });
    expect(status.find((row) => row.provider === "instagram")!.redirect).toBe(
      "https://lenslab.dev/publish",
    );
    expect(status.find((row) => row.provider === "x")!.configured).toBe(true);
    expect(JSON.stringify(status)).not.toContain("secret");
  });
});

describe("OAuth: state, PKCE, sealed tokens", () => {
  test("X, TikTok and YouTube send an S256 challenge whose verifier only the server holds", async () => {
    const w = world();
    for (const provider of ["x", "tiktok", "youtube"] as const) {
      const url = new URL(await startSocialConnection(OWNER, provider, w.deps));
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      const challenge = url.searchParams.get("code_challenge")!;
      expect(challenge.length).toBeGreaterThan(40);
      const redirect = url.searchParams.get("redirect_uri");
      expect(redirect).toBe(`https://lenslab.dev/publish?connector=${provider}`);
      const state = url.searchParams.get("state")!;
      const row = w.db.rows("social_oauth_states").find((r) => r["provider"] === provider)!;
      expect(row["hash"]).not.toBe(state);
      expect(String(row["verifier"])).not.toContain(challenge);
      await finishSocialConnection(OWNER, provider, "code-1", state, w.deps);
      const exchange = w.net.calls.find(
        (call) => call.method === "POST" && /\/token\/?$/.test(call.path),
      )!;
      const verifier = exchange.form["code_verifier"]!;
      expect(createHash("sha256").update(verifier).digest("base64url")).toBe(challenge);
      w.net.calls.length = 0;
    }
    // X authenticates the token request as a confidential client.
    await startSocialConnection(OWNER, "x", w.deps);
  });

  test("state is single-use, owner-bound and expires; a stale link asks to connect again", async () => {
    const w = world();
    const url = new URL(await startSocialConnection(OWNER, "threads", w.deps));
    const state = url.searchParams.get("state")!;
    await expect(finishSocialConnection(OTHER, "threads", "c", state, w.deps)).rejects.toThrow(
      /expired or was already used/,
    );
    await finishSocialConnection(OWNER, "threads", "c", state, w.deps);
    await expect(finishSocialConnection(OWNER, "threads", "c", state, w.deps)).rejects.toThrow(
      /expired or was already used/,
    );
    const late = new URL(await startSocialConnection(OWNER, "linkedin", w.deps)).searchParams.get(
      "state",
    )!;
    w.tick(11 * 60_000);
    await expect(finishSocialConnection(OWNER, "linkedin", "c", late, w.deps)).rejects.toThrow(
      /expired/,
    );
  });

  test("every provider connects: account verified, scopes recorded, token sealed and never in the status", async () => {
    const w = world();
    const expected: Record<(typeof GENERIC)[number], [string, string]> = {
      threads: ["17841400000000099", "sideline.threads"],
      linkedin: ["AbCdEf123", "Melani S."],
      x: ["1234567890", "sideline"],
      tiktok: ["open-id-1", "Sideline"],
      youtube: ["UCfixture000000000000001", "Sideline Studio"],
    };
    for (const provider of GENERIC) {
      const { done } = await connect(w, provider);
      expect(done.accountName).toBe(expected[provider][1]);
      const row = w.db.rows("social_provider_connections").find((r) => r["provider"] === provider)!;
      expect(row["account_id"]).toBe(expected[provider][0]);
      expect(row["state"]).toBe("active");
      expect(String(row["credential"])).not.toMatch(/token|refresh/);
      expect(row["scopes"]).toEqual(
        expect.arrayContaining([...providerScopes(provider)].slice(0, 1)),
      );
      const session = await socialSession(OWNER, provider, w.deps);
      expect(session.accountId).toBe(expected[provider][0]);
      expect(session.token.length).toBeGreaterThan(4);
    }
    const status = await connectorStatus(OWNER, w.deps);
    expect(status.filter((row) => row.connection?.state === "active")).toHaveLength(5);
    expect(JSON.stringify(status)).not.toMatch(
      /x-token|li-token|th-long|tt-token|yt-token|refresh/,
    );
    // Threads recorded that it renews with its own access token; LinkedIn (no refresh token) cannot.
    expect(
      w.db.rows("social_provider_connections").find((r) => r["provider"] === "threads")!["meta"],
    ).toMatchObject({ canRefresh: true });
    expect(
      w.db.rows("social_provider_connections").find((r) => r["provider"] === "linkedin")!["meta"],
    ).toMatchObject({ canRefresh: false });
    // Another owner sees nothing.
    expect((await connectorStatus(OTHER, w.deps)).every((row) => row.connection === null)).toBe(
      true,
    );
  });

  test("a provider that refuses the code or the profile leaves nothing behind", async () => {
    const w = world();
    w.net.on("POST", /api\.x\.com\/2\/oauth2\/token/, () =>
      Response.json({ error: "invalid_request" }, { status: 400 }),
    );
    const state = new URL(await startSocialConnection(OWNER, "x", w.deps)).searchParams.get(
      "state",
    )!;
    await expect(finishSocialConnection(OWNER, "x", "bad", state, w.deps)).rejects.toThrow(
      /could not complete/,
    );
    expect(w.db.rows("social_provider_connections")).toHaveLength(0);
    w.net.on("GET", /youtube\/v3\/channels/, () => ({ items: [] }));
    const yt = new URL(await startSocialConnection(OWNER, "youtube", w.deps)).searchParams.get(
      "state",
    )!;
    await expect(finishSocialConnection(OWNER, "youtube", "c", yt, w.deps)).rejects.toThrow(
      /no YouTube channel/,
    );
  });

  test("disconnect removes Celinen's copy only", async () => {
    const w = world();
    await connect(w, "x");
    await disconnectSocialConnection(OWNER, "x", w.deps);
    expect(w.db.rows("social_provider_connections")).toHaveLength(0);
    await expect(socialSession(OWNER, "x", w.deps)).rejects.toThrow("Connect X first.");
  });
});

describe("token refresh", () => {
  test("X refreshes once under a lease when two runners need the token at the same time", async () => {
    const w = world();
    await connect(w, "x");
    w.tick(2 * 60 * 60_000 - 5 * 60_000); // 5 minutes left of a 2-hour token
    let refreshes = 0;
    w.net.on("POST", /api\.x\.com\/2\/oauth2\/token/, () => {
      refreshes++;
      return {
        token_type: "bearer",
        expires_in: 7200,
        access_token: "x-token-fresh",
        refresh_token: "x-refresh-fresh",
      };
    });
    const [a, b] = await Promise.all([
      socialSession(OWNER, "x", w.deps),
      socialSession(OWNER, "x", w.deps),
    ]);
    expect(refreshes).toBe(1);
    expect(a.token).toBe("x-token-fresh");
    expect(b.token).toBe("x-token-fresh");
    const row = w.db.rows("social_provider_connections")[0]!;
    expect(row["refresh_lease"]).toBeNull();
    expect(String(row["credential"])).not.toContain("x-token-fresh");
    // The refreshed token is what the next session opens, and nothing refreshes again.
    expect((await socialSession(OWNER, "x", w.deps)).token).toBe("x-token-fresh");
    expect(refreshes).toBe(1);
  });

  test("a refusal on refresh flips the connection to reconnect with a plain reason", async () => {
    const w = world();
    await connect(w, "youtube");
    w.tick(3600_000);
    w.net.on("POST", /oauth2\.googleapis\.com\/token/, (call) =>
      call.form["grant_type"] === "refresh_token"
        ? Response.json({ error: "invalid_grant" }, { status: 400 })
        : { access_token: "yt-token-3", expires_in: 3599, refresh_token: "yt-refresh-3" },
    );
    await expect(socialSession(OWNER, "youtube", w.deps)).rejects.toThrow(
      "YouTube access expired. Reconnect YouTube.",
    );
    const status = (await connectorStatus(OWNER, w.deps)).find(
      (row) => row.provider === "youtube",
    )!;
    expect(status.connection).toMatchObject({
      state: "reconnect",
      reason: "YouTube access expired. Reconnect YouTube.",
    });
    w.net.calls.length = 0;
    await expect(socialSession(OWNER, "youtube", w.deps)).rejects.toThrow(/Reconnect YouTube/);
    expect(w.net.calls).toHaveLength(0);
    // Connecting again clears it.
    await connect(w, "youtube");
    expect(
      (await connectorStatus(OWNER, w.deps)).find((row) => row.provider === "youtube")!.connection
        ?.state,
    ).toBe("active");
  });

  test("a provider outage during refresh keeps a still-valid token and tries again next time", async () => {
    const w = world();
    await connect(w, "tiktok");
    w.tick(DAY - 30 * 60_000);
    w.net.on(
      "POST",
      /open\.tiktokapis\.com\/v2\/oauth\/token/,
      () => new Response("bad gateway", { status: 502 }),
    );
    expect((await socialSession(OWNER, "tiktok", w.deps)).token).toBe("tt-token");
    expect(w.db.rows("social_provider_connections")[0]!["refresh_lease"]).toBeNull();
    w.tick(31 * 60_000);
    await expect(socialSession(OWNER, "tiktok", w.deps)).rejects.toThrow(/did not renew access/);
  });

  test("LinkedIn without a refresh token needs a reconnect at expiry; Threads renews after a day", async () => {
    const w = world();
    await connect(w, "linkedin");
    w.tick(61 * DAY);
    await expect(socialSession(OWNER, "linkedin", w.deps)).rejects.toThrow(
      "LinkedIn access expired. Reconnect LinkedIn.",
    );
    expect(
      (await connectorStatus(OWNER, w.deps)).find((row) => row.provider === "linkedin")!.connection
        ?.state,
    ).toBe("reconnect");
    await connect(w, "threads");
    w.tick(20 * DAY);
    await socialSession(OWNER, "threads", w.deps);
    expect(w.net.count("GET", /refresh_access_token/)).toBe(1);
    const status = (await connectorStatus(OWNER, w.deps)).find(
      (row) => row.provider === "threads",
    )!;
    expect(status.connection?.state).toBe("active");
  });

  test("markReconnect is what publishers call on a revoked token", async () => {
    const w = world();
    await connect(w, "x");
    await markReconnect(OWNER, "x", "X access expired. Reconnect X.", w.deps);
    await expect(socialSession(OWNER, "x", w.deps)).rejects.toThrow(SocialApiError);
  });
});

describe("platform limits and media contracts", () => {
  test("validateUnit refuses what each platform documents refusing, in plain English", () => {
    const jpeg = {
      kind: "image" as const,
      mime: "image/jpeg" as const,
      bytes: 500_000,
      sha256: "a".repeat(64),
      width: 1080,
      height: 1350,
    };
    expect(validateUnit("instagram", "post", "hi", null, [jpeg])).toBeNull();
    expect(validateUnit("instagram", "post", "hi", null, [])).toMatch(/needs a photo or video/);
    expect(
      validateUnit("instagram", "post", "hi", null, [{ ...jpeg, width: 1080, height: 1920 }]),
    ).toMatch(/photo shape/);
    expect(
      validateUnit("instagram", "story", "", null, [{ ...jpeg, width: 1080, height: 1920 }]),
    ).toBeNull();
    expect(validateUnit("instagram", "story", "", null, [jpeg])).toMatch(/9:16/);
    expect(validateUnit("threads", "post", "x".repeat(501), null, [])).toMatch(/500 characters/);
    expect(validateUnit("x", "post", "y".repeat(281), null, [])).toMatch(/280 characters/);
    expect(xWeightedLength("look https://lenslab.dev/a/very/long/path/that/goes/on")).toBe(28);
    expect(validateUnit("x", "post", "", null, [])).toMatch(/caption/);
    expect(validateUnit("x", "post", "five", null, [jpeg, jpeg, jpeg, jpeg, jpeg])).toMatch(
      /4 photos/,
    );
    expect(validateUnit("linkedin", "post", "hi", null, [jpeg])).toBeNull();
    expect(validateUnit("youtube", "video", "desc", null, [])).toMatch(/needs a title/);
    const video = {
      kind: "video" as const,
      mime: "video/mp4" as const,
      bytes: 10_000_000,
      sha256: "b".repeat(64),
      width: 1080,
      height: 1920,
      durationMs: 30_000,
    };
    expect(validateUnit("youtube", "video", "desc", "Clip", [video])).toBeNull();
    expect(validateUnit("youtube", "post", "desc", "Clip", [video])).toMatch(
      /cannot take this kind/,
    );
    expect(validateUnit("instagram", "reel", "", null, [video])).toBeNull();
    expect(validateUnit("instagram", "reel", "", null, [{ ...video, durationMs: 1000 }])).toMatch(
      /at least 3 seconds/,
    );
    expect(validateUnit("x", "post", "clip", null, [{ ...video, durationMs: 150_000 }])).toMatch(
      /under 2 minutes/,
    );
    expect(validateUnit("tiktok", "video", "clip", null, [video])).toBeNull();
    expect(
      validateUnit("facebook_page", "video", "clip", null, [
        { ...video, bytes: 2 * 1024 * 1024 * 1024 },
      ]),
    ).toMatch(/under 1024 MB/);
  });

  test("retry backoff grows and honours a provider's own reset time", () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(300_000);
    expect(backoffMs(9)).toBe(3_600_000);
    expect(backoffMs(1, new SocialApiError("later", "quota", 429, 2 * 3_600_000))).toBe(7_200_000);
  });

  test("probeMp4 reads duration and the video track's size through ranged reads, moov before or after mdat", async () => {
    for (const moovFirst of [false, true]) {
      const bytes = fixtureMp4({
        durationMs: 12_345,
        width: 720,
        height: 1280,
        mdatBytes: 5000,
        moovFirst,
      });
      const reads: number[] = [];
      const probe = await probeMp4(async (offset, length) => {
        reads.push(length);
        return bytes.subarray(offset, offset + length);
      }, bytes.byteLength);
      expect(probe).toMatchObject({ durationMs: 12_345, width: 720, height: 1280, brand: "isom" });
      // The 5000-byte mdat is skipped, never read.
      expect(Math.max(...reads)).toBeLessThan(5000);
    }
    expect(
      await probeMp4(async (o, l) => new Uint8Array(l).fill(0x89).subarray(0, l), 64),
    ).toBeNull();
    expect(
      pngDimensions(
        new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 4, 56,
          0, 0, 7, 128,
        ]),
      ),
    ).toEqual({ width: 1080, height: 1920 });
  });

  test("a stored video is verified by size, MP4 facts and a streaming hash without loading it whole", async () => {
    const w = world();
    const bytes = fixtureMp4({ durationMs: 5000, width: 1080, height: 1920, mdatBytes: 3000 });
    w.db.upload("publishing-video-v1", `${OWNER}/social/g/0.mp4`, bytes, "video/mp4");
    const deps = mediaDeps({
      db: w.db as never,
      env: ENV,
      now: w.clock,
      readRange: w.db.readRange,
      objectInfo: w.db.objectInfo,
    });
    const item = {
      kind: "video" as const,
      mime: "video/mp4" as const,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      width: 1080,
      height: 1920,
      durationMs: 5000,
      bucket: "publishing-video-v1",
      path: `${OWNER}/social/g/0.mp4`,
    };
    await verifyStoredMedia(deps, item);
    await expect(verifyStoredMedia(deps, { ...item, sha256: "0".repeat(64) })).rejects.toThrow(
      /does not match/,
    );
    await expect(verifyStoredMedia(deps, { ...item, durationMs: 9000 })).rejects.toThrow(
      /does not match/,
    );
    await expect(
      verifyStoredMedia(deps, { ...item, path: `${OWNER}/social/g/9.mp4` }),
    ).rejects.toThrow(/not finished uploading/);
  });

  test("proxy tickets are HMAC-bound to one object and expire; tampering yields nothing", () => {
    const now = Date.parse("2026-09-18T12:00:00Z");
    const item = { bucket: "publishing-media-v1", path: `${OWNER}/social/${OTHER}/0.jpg` };
    const ticket = proxyTicket(ENV, item, now);
    expect(openProxyTicket(ENV, ticket, now + 60_000)).toEqual(item);
    expect(openProxyTicket(ENV, ticket, now + 16 * 60_000)).toBeNull();
    expect(openProxyTicket(ENV, ticket.slice(0, -2) + "zz", now)).toBeNull();
    expect(openProxyTicket({ ...ENV, SOCIAL_TOKEN_KEY: "f".repeat(64) }, ticket, now)).toBeNull();
    const [body] = ticket.split(".");
    expect(
      openProxyTicket(ENV, `${body}.${ticket.split(".")[1]!.replace(/./, "A")}`, now),
    ).toBeNull();
  });
});
