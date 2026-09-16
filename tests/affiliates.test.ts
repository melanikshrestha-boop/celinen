import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("affiliates page is the 30% program, not a home-page strip", () => {
  const page = readFileSync(
    new URL("../src/components/marketing/AffiliatesPage.tsx", import.meta.url),
    "utf8",
  );
  expect(page).toContain("Our 30% affiliate program.");
  expect(page).toContain("Earn recurring commission from your referrals");
  expect(page).toContain("20%");
  expect(page).toContain("PayPal");
  expect(page).toContain("60 days");
  expect(page).toContain("$6.00");
  expect(page).toContain("$9.00");
  expect(page).not.toContain("200K");
  expect(page).not.toContain("4,000");
  expect(page).not.toContain("getrewardful");
  const landing = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  expect(landing).not.toContain("AffiliatesLanding");
  const footer = readFileSync(
    new URL("../src/components/marketing/MarketingFooter.tsx", import.meta.url),
    "utf8",
  );
  expect(footer).toContain('to="/affiliates"');
  expect(footer).toContain('to="/legal/cookies"');
});
