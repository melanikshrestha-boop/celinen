import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ASSISTANT_MARKS,
  findPublicIntegration,
  INTEGRATION_MENU,
  PUBLIC_INTEGRATIONS,
} from "../src/lib/public-integrations";

test("public integrations match the add-channel sheet down to copy", () => {
  expect(PUBLIC_INTEGRATIONS.map((item) => item.id)).toEqual([
    "facebook",
    "instagram",
    "x",
    "linkedin",
    "pinterest",
    "bluesky",
    "threads",
    "youtube-shorts",
    "google-business",
    "tiktok",
    "mastodon",
    "dribbble",
    "kick",
    "twitch",
    "discord",
    "whop",
    "devto",
    "woocommerce",
  ]);
  expect(INTEGRATION_MENU).toContain("youtube-shorts");
  expect(INTEGRATION_MENU).toContain("google-business");
  expect(findPublicIntegration("youtube-shorts")?.copy).toContain("vertical video");
  expect(findPublicIntegration("google-business")?.copy).toContain("business profile");
  expect(ASSISTANT_MARKS.map((item) => item.id)).toEqual([
    "claude",
    "chatgpt",
    "grok",
    "cursor",
    "copilot",
    "gemini",
    "perplexity",
    "raycast",
    "n8n",
  ]);
  const nav = readFileSync(new URL("../src/components/Nav.tsx", import.meta.url), "utf8");
  expect(nav).toContain("IntegrationsMenu");
  const landing = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  // No invented traction: the landing page carries no user counts without a real data source.
  expect(landing).not.toContain("LivePhotographers");
  expect(landing).not.toContain("MarketingStats");
  expect(landing).toContain("PublishEverywhere");
  expect(landing).not.toContain("customers");
});
