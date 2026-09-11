import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  COMPARE_ENTRIES,
  compareTally,
  compareTotals,
  findCompare,
} from "../src/lib/public-compare";

test("compare catalog is ten photography platforms and we win the first ten", () => {
  expect(COMPARE_ENTRIES.map((item) => item.id)).toEqual([
    "aftershoot",
    "imagen",
    "pixieset",
    "shootproof",
    "photo-mechanic",
    "lightroom",
    "capture-one",
    "cloudspot",
    "pic-time",
    "smugmug",
  ]);
  for (const item of COMPARE_ENTRIES) {
    const tally = compareTally(item.rows);
    expect(tally.us).toBeGreaterThan(tally.them);
    expect(tally.them).toBeGreaterThan(0);
    expect(item.sources).toContain("trademark");
    expect(JSON.stringify(item)).not.toMatch(/FaceFind-as-done|viral clip|YouTube Automation/i);
  }
  expect(findCompare("aftershoot")?.chooseThem.length).toBeGreaterThan(0);
  expect(compareTotals().them).toBeGreaterThan(10);
  const landing = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  expect(landing).toContain("CompareLanding");
  const page = readFileSync(
    new URL("../src/components/marketing/ComparePage.tsx", import.meta.url),
    "utf8",
  );
  expect(page).toContain("Written the way we would want to read it");
  expect(page).toContain("rows where they beat us marked as such");
  const footer = readFileSync(
    new URL("../src/components/marketing/MarketingFooter.tsx", import.meta.url),
    "utf8",
  );
  expect(footer).toContain('to="/compare"');
});
