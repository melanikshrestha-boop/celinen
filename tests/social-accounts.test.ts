import { expect, test } from "bun:test";

const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    clear: () => memory.clear(),
  },
});
import { readFileSync } from "node:fs";
import {
  MAIL_NETWORKS,
  SOCIAL_NETWORKS,
  connectAllSocials,
  connectMail,
  connectSocial,
  disconnectMail,
  disconnectSocial,
  isMailConnected,
  isSocialConnected,
  readMailLinks,
  readSocialLinks,
  shownSocials,
} from "../src/lib/social-accounts";

test("social catalog includes the popular networks from the picker", () => {
  expect(SOCIAL_NETWORKS.map((item) => item.id)).toEqual([
    "instagram",
    "facebook",
    "x",
    "linkedin",
    "pinterest",
    "bluesky",
    "threads",
    "tiktok",
    "youtube-shorts",
    "google-business",
    "mastodon",
    "discord",
    "woocommerce",
  ]);
  const page = readFileSync(
    new URL("../src/components/dashboard/SocialAccounts.tsx", import.meta.url),
    "utf8",
  );
  expect(page).toContain("social-board__places");
  expect(page).toContain("SOCIAL_NETWORKS.map");
  expect(page).toContain("Caption");
  expect(page).toContain("onHapticPress");
  expect(page).toContain("Post to all");
  expect(page).toContain("Connect all socials");
  expect(page).toContain("publishPastePost");
  expect(page).not.toContain("What should we post?");
  expect(page).not.toContain("Generate inside");
  expect(page).not.toContain("Create a campaign");
  expect(page).not.toContain("Good work deserves to be seen");
  expect(page).not.toContain("Ocoya");
  expect(page).not.toContain("Planner");
  expect(page).not.toContain("Campaigns");
  const dock = readFileSync(
    new URL("../src/components/dashboard/SocialDock.tsx", import.meta.url),
    "utf8",
  );
  expect(dock).toContain("social-picker__check");
  expect(dock).toContain("Connect all");
  expect(dock).toContain("onDoubleClick");
  expect(dock).toContain("Double-click to disconnect");
  expect(dock).toContain("MAIL_NETWORKS");
  expect(dock).toContain("gmail");
  expect(dock).toContain("App password");
  expect(dock).toContain("Webhook");
  expect(MAIL_NETWORKS[0]).toEqual({ id: "gmail", title: "Gmail", kind: "Mail" });
  expect(dock).not.toContain("Connect account");
  expect(SOCIAL_NETWORKS.map((item) => item.id)).not.toContain("gmail");
  expect(MAIL_NETWORKS.map((item) => item.id)).toEqual(["gmail"]);
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
  const all = await connectAllSocials(scope);
  expect(all.some((row) => row.id === "instagram")).toBe(true);
  expect(all.some((row) => row.id === "bluesky")).toBe(false);
  expect(all).toHaveLength(SOCIAL_NETWORKS.length - 3);
});

test("gmail is a separate encrypted mail link, not a social network", async () => {
  const scope = "test-mail-scope";
  localStorage.clear();
  expect(await readMailLinks(scope)).toEqual([]);
  const linked = await connectMail(scope, "gmail");
  expect(isMailConnected(linked, "gmail")).toBe(true);
  const packed = localStorage.getItem(`celinen.mail.links.v1:${scope}`) ?? "";
  expect(packed.includes("gmail")).toBe(false);
  expect(packed.includes(".")).toBe(true);
  expect(localStorage.getItem(`celinen.social.links.v1:${scope}`)).toBe(null);
  expect(await readSocialLinks(scope)).toEqual([]);
  const next = await disconnectMail(scope, "gmail");
  expect(isMailConnected(next, "gmail")).toBe(false);
});
