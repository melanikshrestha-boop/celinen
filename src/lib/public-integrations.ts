/** Public integrations catalog. Same networks as the Ocoya integrations sheet. */

export const INTEGRATION_GROUPS = [
  { id: "social", title: "Social networks" },
  { id: "streaming", title: "Streaming" },
  { id: "community", title: "Community" },
  { id: "blogging", title: "Blogging" },
  { id: "ecommerce", title: "Ecommerce" },
] as const;

export type IntegrationGroupId = (typeof INTEGRATION_GROUPS)[number]["id"];

export const PUBLIC_INTEGRATIONS = [
  {
    id: "facebook",
    title: "Facebook",
    group: "social",
    copy: "Publish to your Facebook Business Pages.",
  },
  {
    id: "instagram",
    title: "Instagram",
    group: "social",
    copy: "Feed, Reels and Stories on schedule.",
  },
  {
    id: "x",
    title: "X (Twitter)",
    group: "social",
    copy: "Schedule posts and full threads.",
  },
  {
    id: "linkedin",
    title: "LinkedIn",
    group: "social",
    copy: "Profiles, Pages and PDF carousels.",
  },
  {
    id: "pinterest",
    title: "Pinterest",
    group: "social",
    copy: "Schedule Pins to the right boards.",
  },
  {
    id: "bluesky",
    title: "Bluesky",
    group: "social",
    copy: "Publish to the decentralized network.",
  },
  {
    id: "threads",
    title: "Threads",
    group: "social",
    copy: "Text-first updates for your community.",
  },
  {
    id: "youtube-shorts",
    title: "YouTube Shorts",
    group: "social",
    copy: "Upload and schedule vertical video.",
  },
  {
    id: "google-business",
    title: "Google Business",
    group: "social",
    copy: "Post updates to your business profile.",
  },
  {
    id: "tiktok",
    title: "TikTok",
    group: "social",
    copy: "Schedule trending short-form video.",
  },
  {
    id: "mastodon",
    title: "Mastodon",
    group: "social",
    copy: "Publish to any server on the fediverse.",
  },
  {
    id: "dribbble",
    title: "Dribbble",
    group: "social",
    copy: "Publish shots with titles and tags.",
  },
  {
    id: "kick",
    title: "Kick",
    group: "streaming",
    copy: "Post to your channel chat on schedule.",
  },
  {
    id: "twitch",
    title: "Twitch",
    group: "streaming",
    copy: "Schedule messages to your channel chat.",
  },
  {
    id: "discord",
    title: "Discord",
    group: "community",
    copy: "Announcements for your server.",
  },
  {
    id: "whop",
    title: "Whop",
    group: "community",
    copy: "Schedule posts to your community forums.",
  },
  {
    id: "devto",
    title: "DEV.to",
    group: "blogging",
    copy: "Publish articles to your DEV profile.",
  },
  {
    id: "woocommerce",
    title: "WooCommerce",
    group: "ecommerce",
    copy: "New products become scheduled posts.",
  },
] as const;

export type PublicIntegrationId = (typeof PUBLIC_INTEGRATIONS)[number]["id"];
export type PublicIntegration = (typeof PUBLIC_INTEGRATIONS)[number];

/** Header dropdown order matches the Integrations sheet (2-col, left-to-right). */
export const INTEGRATION_MENU = [
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
  "discord",
  "mastodon",
  "dribbble",
  "kick",
  "twitch",
  "whop",
  "devto",
  "woocommerce",
] as const satisfies readonly PublicIntegrationId[];

export const ASSISTANT_MARKS = [
  { id: "claude", title: "Claude" },
  { id: "chatgpt", title: "ChatGPT" },
  { id: "grok", title: "Grok" },
  { id: "cursor", title: "Cursor" },
  { id: "copilot", title: "Copilot" },
  { id: "gemini", title: "Gemini" },
  { id: "perplexity", title: "Perplexity" },
  { id: "raycast", title: "Raycast" },
  { id: "n8n", title: "n8n" },
] as const;

export function findPublicIntegration(id: string) {
  return PUBLIC_INTEGRATIONS.find((item) => item.id === id);
}

export function integrationsInGroup(group: IntegrationGroupId) {
  return PUBLIC_INTEGRATIONS.filter((item) => item.group === group);
}

export function menuIntegrations() {
  return INTEGRATION_MENU.map((id) => findPublicIntegration(id)!);
}
