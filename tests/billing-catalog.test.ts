import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { quoteForLookup } from "../src/lib/billing-catalog";

test("arena lookup keys are a $200 month and $1920 year Stripe price", () => {
  expect(quoteForLookup("arena_monthly")).toMatchObject({
    billing: "monthly",
    interval: "month",
    unitAmountCents: 20000,
  });
  expect(quoteForLookup("arena_yearly")).toMatchObject({
    billing: "yearly",
    interval: "year",
    unitAmountCents: 192000,
  });
  expect(quoteForLookup("hobby_monthly")?.unitAmountCents).toBe(2000);
  expect(quoteForLookup("missing_plan")).toBeNull();
  const checkout = readFileSync(
    new URL("../src/utils/payments.functions.ts", import.meta.url),
    "utf8",
  );
  expect(checkout).toContain("resolveOrCreatePrice");
  expect(checkout).toContain("quoteForLookup");
});
