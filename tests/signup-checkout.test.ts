import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("signup opens Stripe when payments are configured, otherwise waitlist", () => {
  const source = readFileSync(new URL("../src/routes/signup.tsx", import.meta.url), "utf8");
  expect(source).toContain("paymentsAreConfigured");
  expect(source).toContain("StripeEmbeddedCheckout");
  expect(source).toContain("WaitlistForm");
  expect(source).toContain("priceId={`${plan}_${billing}`}");
  expect(source).not.toContain("Tell us where to send the account");
  expect(source).not.toContain("Continue to payment");
  expect(source).not.toContain("tryiris");
  expect(source).not.toContain("LensLabs");
});
