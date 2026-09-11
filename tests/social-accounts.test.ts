import { expect, test } from "bun:test";

const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    clear: () => memory.clear(),
  },
});
import { readFileSync } from "node:fs";
import {
  SOCIAL_NETWORKS,
  connectSocial,
  disconnectSocial,
  isSocialConnected,
  readSocialLinks,
  shownSocials,
} from "../src/lib/social-accounts";

test("social catalog includes the popular networks from the picker", () => {
  expect(SOCIAL_NETWORKS.map((item) => item.id)).toEqual([
    "instagram",
    "x",
    "linkedin",
    "pinterest",
    "bluesky",
    "threads",
    "tiktok",
    "youtube",
    "google-business",
    "mastodon",
    "discord",
    "woocommerce",
  ]);
  const page = readFileSync(
    new URL("../src/components/dashboard/SocialAccounts.tsx", import.meta.url),
    "utf8",
  );
  expect(page).toContain("What should we post?");
  expect(page).not.toContain("Good work deserves to be seen");
  expect(page).not.toContain("Ocoya");
  const dock = readFileSync(
    new URL("../src/components/dashboard/SocialDock.tsx", import.meta.url),
    "utf8",
  );
  expect(dock).toContain("social-picker__check");
  expect(dock).not.toContain("Connect account");
});

test("connections persist encrypted and shown chips stay short", async () => {
  const scope = "test-social-scope";
  localStorage.clear();
  expect(await readSocialLinks(scope)).toEqual([]);
  const linked = await connectSocial(scope, "instagram");
  expect(isSocialConnected(linked, "instagram")).toBe(true);
  const packed = localStorage.getItem(`celinen.social.links.v1:${scope}`) ?? "";
  expect(packed.includes("instagram")).toBe(false);
  expect(packed.includes(".")).toBe(true);
  await connectSocial(scope, "pinterest");
  await connectSocial(scope, "tiktok");
  await connectSocial(scope, "x");
  await connectSocial(scope, "linkedin");
  const rows = await readSocialLinks(scope);
  expect(shownSocials(rows)).toHaveLength(4);
  const next = await disconnectSocial(scope, "instagram");
  expect(isSocialConnected(next, "instagram")).toBe(false);
});
