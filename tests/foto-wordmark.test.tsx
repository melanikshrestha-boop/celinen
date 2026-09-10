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

test("marketing footer branding is white with blue mark", () => {
  const css = readFileSync(
    new URL("../src/components/marketing/public-details.css", import.meta.url),
    "utf8",
  );
  const footer = css.match(
    /\.marketing-page \.marketing-footer\.marketing-footer--directory\s*\{[^}]+\}/,
  )?.[0];
  expect(footer).toContain("background: #fff");
  expect(footer).not.toContain("#0a0a0a");
  expect(css).toContain(".marketing-footer__mark");
  expect(css).toContain("color: #007eb8");
});
