import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { FotoWordmark } from "../src/components/marketing/FotoWordmark";

test("foto wordmark is a lens lockup, not typed display type", () => {
  const html = renderToStaticMarkup(<FotoWordmark className="marketing-footer__mark" />);
  expect(html).toContain("foto-wordmark");
  expect(html).toContain('class="foto-wordmark marketing-footer__mark"');
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

test("marketing footer branding is white with a fading giant wordmark", () => {
  const css = readFileSync(
    new URL("../src/components/marketing/public-details.css", import.meta.url),
    "utf8",
  );
  const footer = css.match(
    /\.marketing-page \.marketing-footer\.marketing-footer--directory\s*\{[^}]+\}/,
  )?.[0];
  expect(footer).toContain("background: #fff");
  expect(footer).not.toContain("#0a0a0a");
  expect(css).toContain(".marketing-footer__giant");
  const legal = css.match(/\.marketing-footer__legal\s*\{[^}]+\}/)?.[0];
  expect(legal).toContain("width: calc(100% + 80px)");
  expect(legal).toContain("margin: 48px -40px 0");
  expect(legal).not.toContain("1120px");
  expect(css).toContain("background-clip: text");
  expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
  expect(css).toContain("max-height: 0.86em");
  expect(css).not.toContain("max-height: 0.52em");
  expect(css).not.toContain(".marketing-footer__intro");
});

test("marketing footer has four equal columns and no leftover brand block", () => {
  const src = readFileSync(
    new URL("../src/components/marketing/MarketingFooter.tsx", import.meta.url),
    "utf8",
  );
  expect(src).not.toContain("marketing-footer__intro");
  expect(src).not.toContain("marketing-footer__name");
  expect(src).not.toContain("marketing-footer__pitch");
  expect(src.match(/marketing-footer__column/g)?.length).toBe(4);
});
