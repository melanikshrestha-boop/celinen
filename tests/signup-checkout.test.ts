import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("signup opens Stripe without a homework form", () => {
  const source = readFileSync(new URL("../src/routes/signup.tsx", import.meta.url), "utf8");
  expect(source).toContain("StripeEmbeddedCheckout");
  expect(source).toContain("priceId={`${plan}_${billing}`}");
  expect(source).not.toContain("recordSignup");
  expect(source).not.toContain("Tell us where to send the account");
  expect(source).not.toContain("you@studio.com");
  expect(source).not.toContain("Continue to payment");
});
