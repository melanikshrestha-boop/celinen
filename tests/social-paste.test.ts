import { expect, test } from "bun:test";

const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
    clear: () => memory.clear(),
  },
});

import { readFileSync } from "node:fs";
import { SOCIAL_NETWORKS, connectAllSocials, connectSocial, disconnectSocial } from "../src/lib/social-accounts";
import {
  PASTE_SOCIAL_IDS,
  parseBlueskyHandle,
  parseDiscordWebhook,
  parseMastodonInstance,
  parsePasteSecret,
  readPasteSecrets,
  savePasteSecret,
} from "../src/lib/social-paste";
import { postPasteNetwork } from "../src/lib/social-paste-post";

test("paste fields reject tracking URLs and private hosts", () => {
  expect(parseBlueskyHandle("@melani.bsky.social")).toBe("melani.bsky.social");
  expect(() => parseBlueskyHandle("not a handle")).toThrow();
  expect(parseMastodonInstance("https://mastodon.social/home")).toBe("https://mastodon.social");
  expect(() => parseMastodonInstance("127.0.0.1")).toThrow();
  expect(() => parseMastodonInstance("http://evil.test@mastodon.social")).toThrow();
  expect(
    parseDiscordWebhook("https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz12"),
  ).toContain("/api/webhooks/123456789012345678/");
  expect(() => parseDiscordWebhook("https://evil.test/api/webhooks/1/abc")).toThrow();
  expect(() => parseDiscordWebhook("https://discord.com.evil.test/api/webhooks/1/abc")).toThrow();
});

test("paste secrets stay encrypted and connect-all does not fake Bluesky", async () => {
  const scope = "test-paste-scope";
  localStorage.clear();
  await savePasteSecret(
    scope,
    parsePasteSecret("bluesky", { handle: "melani.bsky.social", appPassword: "abcd-efgh-ijkl-mnop" }),
  );
  const packed = localStorage.getItem(`celinen.social.secrets.v1:${scope}`) ?? "";
  expect(packed.includes("melani")).toBe(false);
  expect(packed.includes("abcd-efgh")).toBe(false);
  expect((await readPasteSecrets(scope)).bluesky?.handle).toBe("melani.bsky.social");
  const all = await connectAllSocials(scope);
  expect(all.some((row) => row.id === "bluesky")).toBe(true);
  expect(all.some((row) => row.id === "discord")).toBe(false);
  expect(all).toHaveLength(SOCIAL_NETWORKS.length - (PASTE_SOCIAL_IDS.length - 1));
  await connectSocial(scope, "discord");
  await disconnectSocial(scope, "bluesky");
  expect((await readPasteSecrets(scope)).bluesky).toBeUndefined();
});

test("paste post talks to Bluesky session then createRecord, never retries", async () => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("createSession"))
      return new Response(JSON.stringify({ accessJwt: "jwt", did: "did:plc:test" }), { status: 200 });
    if (url.includes("createRecord")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { record?: { text?: string } };
      expect(body.record?.text).toContain("Gallery tonight");
      return new Response("{}", { status: 200 });
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  try {
    const result = await postPasteNetwork({
      secret: parsePasteSecret("bluesky", {
        handle: "melani.bsky.social",
        appPassword: "abcd-efgh-ijkl-mnop",
      }),
      caption: "Gallery tonight.",
    });
    expect(result).toEqual({ ok: true, network: "bluesky" });
    expect(calls).toEqual([
      "POST https://bsky.social/xrpc/com.atproto.server.createSession",
      "POST https://bsky.social/xrpc/com.atproto.repo.createRecord",
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test("dock asks for paste fields and publish uses the local bridge", () => {
  const dock = readFileSync(new URL("../src/components/dashboard/SocialDock.tsx", import.meta.url), "utf8");
  expect(dock).toContain("App password");
  expect(dock).toContain("Webhook");
  expect(dock).toContain("parsePasteSecret");
  expect(dock).not.toContain("OAuth");
  const accounts = readFileSync(
    new URL("../src/components/dashboard/SocialAccounts.tsx", import.meta.url),
    "utf8",
  );
  expect(accounts).toContain("publishPastePost");
  expect(accounts).toContain("createScheduledPost");
  expect(accounts).toContain("Posted to");
});
