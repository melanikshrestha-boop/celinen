import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { COMPARE_ENTRIES } from "../src/lib/public-compare";

test("landing footer lists celinen vs. every compared product", () => {
  const footer = readFileSync(
    new URL("../src/components/marketing/MarketingFooter.tsx", import.meta.url),
    "utf8",
  );
  expect(footer).toContain("Why {PRODUCT_NAME}");
  expect(footer).toContain("COMPARE_ENTRIES");
  expect(footer).toContain('to="/vs/$slug"');
  expect(COMPARE_ENTRIES.map((entry) => entry.name)).toContain("ShootProof");
  expect(COMPARE_ENTRIES.map((entry) => entry.name)).toContain("Pixieset");
});

test("vs pages are empty stubs", () => {
  const source = readFileSync(new URL("../src/routes/vs.$slug.tsx", import.meta.url), "utf8");
  expect(source).toContain('createFileRoute("/vs/$slug")');
  expect(source).toContain('className="marketing-public-page" />');
  expect(source).not.toContain("CompareDetail");
  expect(source).not.toContain("lede");
});
