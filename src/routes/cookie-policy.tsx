import { createFileRoute } from "@tanstack/react-router";
import { CookiePolicyPage } from "@/components/marketing/CookiePolicy";
import { publicContentHead } from "@/lib/public-content";

export const Route = createFileRoute("/cookie-policy")({
  head: () =>
    publicContentHead(
      "Cookie Policy",
      "How celinen uses cookies, including the consent cookie. Effective September 10, 2026.",
      "/cookie-policy",
    ),
  component: CookiePolicyPage,
});
