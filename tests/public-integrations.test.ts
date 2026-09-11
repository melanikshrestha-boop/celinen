import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ASSISTANT_MARKS,
  findPublicIntegration,
  INTEGRATION_MENU,
  livePhotographers,
  LIVE_PHOTOGRAPHERS_BASE,
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
    "cursor",
    "copilot",
    "gemini",
    "perplexity",
    "raycast",
    "n8n",
  ]);
  expect(livePhotographers()).toBe(LIVE_PHOTOGRAPHERS_BASE);
  expect(LIVE_PHOTOGRAPHERS_BASE).not.toBe(633663);
  const nav = readFileSync(new URL("../src/components/Nav.tsx", import.meta.url), "utf8");
  expect(nav).toContain("IntegrationsMenu");
  const landing = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  expect(landing).toContain("LivePhotographers");
  expect(landing).toContain("PublishEverywhere");
  expect(landing).not.toContain("customers");
});
