import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { FinanceTaxHub, TaxPreparationGuides } from "../src/components/earnings/FinanceTaxHub";
import {
  SELF_EMPLOYED_REFERENCE,
  TAX_PREPARATION_REFERENCE,
  TAX_PREPARATION_TOPICS,
  TAX_SOURCES,
} from "../src/lib/self-employed-resources";

test("the tax hub offers compact, closed preparation guidance for each requested topic", () => {
  const html = renderToStaticMarkup(createElement(FinanceTaxHub));
  expect(html).toContain("Tax questions, explained");
  for (const title of [
    "Self-employment tax",
    "Health insurance and HSA",
    "W-9 and contractor reporting",
    "Equipment and depreciation",
    "Mileage and vehicle costs",
    "Business meals",
    "Home office",
    "Qualified business income (QBI)",
  ])
    expect(html).toContain(`<summary>${title}</summary>`);
  expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
  expect(html).toContain("not personal tax advice");
  expect(html).toContain("Some linked forms and publications still show 2025 editions");
  expect(html).toContain('dateTime="2026-09-12"');
  expect(html).toContain('dateTime="2026-09-10"');
});

test("each preparation topic keeps its own verified IRS links inside native details", () => {
  const html = renderToStaticMarkup(createElement(TaxPreparationGuides));
  const details = html.match(/<details[\s\S]*?<\/details>/g) ?? [];
  expect(details).toHaveLength(8);
  expect(new Set(TAX_PREPARATION_TOPICS.map((topic) => topic.id)).size).toBe(8);
  for (const topic of TAX_PREPARATION_TOPICS) {
    const block = details.find((detail) => detail.includes(`<summary>${topic.title}</summary>`));
    expect(block).toBeDefined();
    expect(topic.detail.length).toBeGreaterThan(0);
    expect(topic.sources.length).toBeGreaterThan(0);
    for (const source of topic.sources) {
      const url = new URL(source.href);
      expect(url.protocol).toBe("https:");
      expect(url.hostname).toBe("www.irs.gov");
      expect(url.search).toBe("");
      expect(block).toContain(`href="${source.href}" target="_blank" rel="noreferrer"`);
      expect(block).toContain(source.label);
    }
    expect(block).toContain("(opens in a new tab)");
  }
  expect(TAX_SOURCES.mileage).toBe("https://www.irs.gov/tax-professionals/standard-mileage-rates");
  expect(TAX_SOURCES.hsa2026).toBe("https://www.irs.gov/irb/2026-02_IRB");
  expect(TAX_SOURCES.contractors).toBe("https://www.irs.gov/instructions/i1099mec");
});

test("preparation copy preserves applicability and 2026 qualifications without personal estimates", () => {
  const topics = Object.fromEntries(
    TAX_PREPARATION_TOPICS.map((topic) => [topic.id, topic.detail]),
  );
  for (const [id, phrases] of [
    ["self-employment-tax", ["92.35%", "net business profit—not gross collections", "other wages"]],
    [
      "health-insurance-hsa",
      [
        "Schedule 1",
        "not a Schedule C expense",
        "Medicare",
        "dependent-status",
        "Qualifying individual-market",
        "self-employment alone does not establish eligibility",
      ],
    ],
    [
      "contractor-reporting",
      [
        "2026",
        "USD 2,000 per recipient",
        "Payment-card",
        "qualifying third-party",
        "backup withholding",
        "not automatically tax-free",
        "keep taxpayer IDs out",
      ],
    ],
    [
      "equipment-depreciation",
      [
        "placed-in-service",
        "business-use share",
        "disposal",
        "does not automatically",
        "recapture",
      ],
    ],
    [
      "mileage",
      [
        "commuting",
        "actual trip date",
        "not one assumed rate for all of 2026",
        "do not count the same vehicle costs twice",
      ],
    ],
    [
      "business-meals",
      [
        "generally subject to a 50% limit, with exceptions",
        "entertainment",
        "does not establish deductibility",
      ],
    ],
    [
      "home-office",
      ["regularly and exclusively", "qualifying-use test", "different limits and exceptions"],
    ],
    [
      "qbi",
      [
        "may qualify",
        "up to 20%",
        "not gross collections",
        "continues in 2026",
        "does not determine eligibility",
      ],
    ],
  ] as const)
    for (const phrase of phrases) expect(topics[id]).toContain(phrase);
  expect(topics["contractor-reporting"]).not.toContain("USD 600");
  expect(topics["mileage"]).not.toMatch(/\d+(?:\.\d+)? (?:cents|per mile)/);
});

test("new reference dates do not relabel prior review and the guides never collect or save data", () => {
  expect(SELF_EMPLOYED_REFERENCE.reviewedOn).toBe("2026-09-10");
  expect(TAX_PREPARATION_REFERENCE).toEqual({
    year: 2026,
    reviewedOn: "2026-09-12",
    reviewedLabel: "September 12, 2026",
  });
  const html = renderToStaticMarkup(createElement(TaxPreparationGuides));
  expect(html).not.toMatch(/<(?:form|input|button|dialog|iframe)\b/);
  expect(html).not.toMatch(/File now|Connect bank|Tax paid|Your tax due|You qualify/);
  expect(html).toContain("no deduction or payment is calculated here");
  for (const path of [
    "../src/lib/self-employed-resources.ts",
    "../src/components/earnings/FinanceTaxHub.tsx",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    expect(source).not.toMatch(
      /localStorage|indexedDB|sessionStorage|createServerFn|useServerFn|fetch\s*\(|commitLocalFinanceState|addTransaction/,
    );
  }
});
