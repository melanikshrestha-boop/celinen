import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";

if (process.env["FOTO_LEGAL_PAGES_TEST_PROCESS"] !== "1") {
  test("legal page presentation keeps its router and account mocks in an isolated process", () => {
    const run = Bun.spawnSync([process.execPath, "test", fileURLToPath(import.meta.url)], {
      env: { ...process.env, FOTO_LEGAL_PAGES_TEST_PROCESS: "1" },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20_000,
    });
    expect(run.exitCode, new TextDecoder().decode(run.stderr)).toBe(0);
  });
} else {
  // Disposable process: partial public-page mocks must not replace account/router
  // exports consumed by workspace SSR tests in the parent Bun suite.
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
  const { CookiePolicyPage } = await import("../src/components/marketing/CookiePolicy");

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

  test("legal docs are single-spaced OpenAI Sans, including title and code", () => {
    const css = readFileSync(
      new URL("../src/components/marketing/public-details.css", import.meta.url),
      "utf8",
    );
    const legal = css.slice(css.indexOf("/* Legal pages"));
    expect(legal).toContain(".marketing-page .legal-doc {");
    expect(legal).toContain("line-height: 1.3");
    expect(legal).toContain("font-family: var(--font-sans)");
    expect(legal).toContain(".marketing-page .legal-doc code {");
    expect(legal).toContain("font-family: inherit");
    expect(legal).not.toContain("line-height: 1.7");
    expect(css).toContain(
      ".marketing-page .marketing-public-page:has(.legal-doc) .marketing-public-page__intro h1",
    );
  });

  test("cookie policy is a named Celinen page effective September 10", () => {
    const html = renderToStaticMarkup(<CookiePolicyPage />);
    expect(html).toContain("Cookie Policy");
    expect(html).toContain("September 10, 2026");
    expect(html).toContain("celinen");
    expect(html).not.toContain("Celinen");
    expect(html).toContain("1. What are cookies");
    expect(html).toContain("4. The cookies we set");
    expect(html).toContain("5. Third-party cookies");
    expect(html).toContain("9. Contact us");
    expect(html).toContain("Account related cookies");
    expect(html).toContain("Login related cookies");
    expect(html).toContain("60 days");
    expect(html).toContain("consent cookie");
    expect(html).toContain("hello@lenslab.dev");
    expect(html).toContain("/privacy");
    expect(html).toContain("/affiliates");
    expect(html).not.toContain("Google Analytics");
    expect(html).not.toContain("Buffer, Hootsuite, Shopify");
    expect(html).not.toContain("foto_consent");
    expect(html).not.toContain("FOTO");
    expect(html).not.toContain("Vugola");
    expect(html).not.toContain("Vugola LLC");
    expect(html).not.toContain("South Dakota");
  });
}
