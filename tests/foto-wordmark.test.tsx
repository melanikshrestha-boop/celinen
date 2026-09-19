import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { FotoWordmark } from "../src/components/marketing/FotoWordmark";

test("foto wordmark is a lens lockup, not typed display type", () => {
  const html = renderToStaticMarkup(<FotoWordmark className="marketing-footer__mark" />);
  expect(html).toContain("celinen-wordmark");
  expect(html).toContain('class="celinen-wordmark marketing-footer__mark"');
  expect(html.match(/<circle /g)).toHaveLength(4);
  expect(html).toContain("rotate(60 16 16)");
  expect(html).not.toContain("C52 10 26 8 22 30");
  expect(html).not.toContain("M250 40v80");
  expect(html).not.toContain("M250 66v54");
  expect(html).toContain("M50 32v88");
  expect(html).toContain("M242 32v88");
  expect(html).toContain("M30 72h48");
  expect(html).toContain("M225 50h34");
  expect(html).not.toContain(">foto<");
});

test("marketing footer is a dark x.ai-style directory", () => {
  const css = readFileSync(
    new URL("../src/components/marketing/public-details.css", import.meta.url),
    "utf8",
  );
  const footer = css.match(
    /\.marketing-page \.marketing-footer\.marketing-footer--directory\s*\{[^}]+\}/,
  )?.[0];
  expect(footer).toContain("background: #0b0b0c");
  expect(footer).not.toContain("background: #fff");
  expect(css).not.toContain(".marketing-footer__giant");
  expect(css).toContain(".marketing-footer__shell");
  expect(css).toContain(".marketing-footer__brand");
  const directory = css.match(
    /\.marketing-page \.marketing-footer\.marketing-footer--directory nav\.marketing-footer__directory\s*\{[^}]+\}/,
  )?.[0];
  expect(directory).toContain("grid-template-columns: repeat(5, minmax(0, 1fr))");
  expect(directory).not.toContain("1120px");
  expect(css).not.toContain(".marketing-footer__intro");
});

test("marketing footer has five link columns, a brand rail, and no Careers", () => {
  const src = readFileSync(
    new URL("../src/components/marketing/MarketingFooter.tsx", import.meta.url),
    "utf8",
  );
  expect(src).not.toContain("marketing-footer__intro");
  expect(src).not.toContain("marketing-footer__name");
  expect(src).not.toContain("marketing-footer__pitch");
  expect(src).not.toContain("marketing-footer__giant");
  expect(src).toContain("marketing-footer__brand");
  expect(src.match(/marketing-footer__column/g)?.length).toBe(5);
  for (const heading of ["Products", "Solutions", "Developers", "Company", "Legal"]) {
    expect(src).toContain(`title="${heading}"`);
  }
  expect(src).not.toMatch(/Career/i);
  expect(src).toContain('to="/contact-sales"');
});
