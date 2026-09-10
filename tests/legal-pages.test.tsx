import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";

mock.module("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children?: ReactNode }) =>
    createElement("a", { href: to }, children),
  useRouterState: () => ({ location: { pathname: "/privacy" } }),
}));
mock.module("@/components/account/AccountProvider", () => ({
  useAccount: () => ({ status: "out" }),
}));
mock.module("@/components/marketing/useMarketingMotion", () => ({
  useMarketingMotion: () => () => {},
}));
mock.module("@/components/marketing/CookieConsent", () => ({
  CookieConsent: () => null,
}));
mock.module("@/components/Nav", () => ({
  Nav: () => createElement("nav"),
}));
mock.module("@/components/marketing/MarketingFooter", () => ({
  MarketingFooter: () => createElement("footer"),
}));

const { PrivacyPage, TermsPage } = await import("../src/components/marketing/LegalPage");

test("privacy policy covers photographers in Europe without clip-farm copy", () => {
  const html = renderToStaticMarkup(<PrivacyPage />);
  expect(html).toContain("Privacy Policy");
  expect(html).toContain("GDPR");
  expect(html).toContain("EEA");
  expect(html).toContain("foto_consent");
  expect(html).toContain("hello@lenslab.dev");
  expect(html).not.toContain("viral");
  expect(html).not.toContain("TikTok");
});

test("terms keep published photo-credit amounts and photographer ownership", () => {
  const html = renderToStaticMarkup(<TermsPage />);
  expect(html).toContain("Terms of Service");
  expect(html).toContain("USD 16");
  expect(html).toContain("1,000 photo credits");
  expect(html).toContain("You keep ownership of your photographs");
  expect(html).toContain("Protect the security of your account, password");
  expect(html).toContain("You are responsible for activity on your account");
  expect(html).toContain("/privacy");
  expect(html).not.toContain("viral clip");
  expect(html).not.toContain("Vugola");
  expect(html).not.toContain("South Dakota");
});
