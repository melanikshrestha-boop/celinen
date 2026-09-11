import { createFileRoute } from "@tanstack/react-router";
import { CookiePolicyPage } from "@/components/marketing/CookiePolicy";
import { publicContentHead } from "@/lib/public-content";

export const Route = createFileRoute("/legal_/cookies")({
  head: () =>
    publicContentHead(
      "Cookie Policy",
      "How celinen uses cookies, including the consent cookie and the 60-day affiliate cookie. Effective September 10, 2026.",
      "/legal/cookies",
    ),
  component: CookiePolicyPage,
});
