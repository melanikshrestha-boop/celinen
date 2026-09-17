import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("signup opens Stripe when payments are configured, otherwise Google auth into the studio", () => {
  const source = readFileSync(new URL("../src/routes/signup.tsx", import.meta.url), "utf8");
  expect(source).toContain("paymentsAreLive");
  expect(source).toContain("StripeEmbeddedCheckout");
  // Unpaid path: one Google-auth CTA into the studio. Never a waitlist, never a dead-checkout banner.
  expect(source).toMatch(/paymentsLive \?[\s\S]*<StripeEmbeddedCheckout[\s\S]*\) : \(/);
  expect(source).toContain('to="/auth"');
  expect(source).toContain('search={{ mode: "signup", next: "/studio" }}');
  expect(source).toContain("Continue with Google");
  expect(source).not.toContain("WaitlistForm");
  expect(source).not.toContain("checkout is not configured");
  expect(source).toContain("priceId={`${plan}_${billing}`}");
  expect(source).not.toContain("Tell us where to send the account");
  expect(source).not.toContain("Continue to payment");
  expect(source).not.toContain("tryiris");
  expect(source).not.toContain("LensLabs");
});
