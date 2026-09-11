import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "postcss";
import { DocsReference } from "../src/components/marketing/DocsReference";
import { FOTO_MCP_URL } from "../src/lib/foto-mcp";

test("docs match the Vugola API-reference chrome without clip-farm endpoints", () => {
  const html = renderToStaticMarkup(createElement(DocsReference));
  expect(html).toContain("Documentation");
  expect(html).toContain("API Reference");
  expect(html).toContain("celinen");
  expect(html).not.toContain("Celinen");
  expect(html).toContain("Get an API key");
  expect(html).toContain("Install the MCP server");
  expect(html).toContain('class="marketing-action marketing-action--primary"');
  expect(html).not.toContain("docs-ref__btn--solid");
  expect(html).not.toContain("docs-ref__btn--ghost");
  expect(html).toContain("MCP on GitHub");
  expect(html).toContain("Rate limits &amp; plans");
  expect(html).toContain('id="errors"');
  expect(html).toContain("insufficient_credits");
  expect(html).toContain('id="clipping"');
  expect(html).toContain("picking");
  expect(html).toContain(FOTO_MCP_URL);
  expect(html).toContain("foto_workflow");
  expect(html).toContain("docs-tok-key");
  expect(html).toContain("docs-tok-str");
  expect(html).toContain("docs-tok-kw");
  expect(html).not.toContain("YouTube Automation");
  expect(html).not.toContain("viral");
  expect(html).not.toContain("caption_style");
  expect(html).not.toContain("Jump to section");
});

test("docs styling stays public-scoped", () => {
  const css = readFileSync(
    new URL("../src/components/marketing/docs-reference.css", import.meta.url),
    "utf8",
  );
  const stylesheet = parse(css);
  stylesheet.walkRules((rule) => {
    for (const selector of rule.selectors) expect(selector).toMatch(/^\.marketing-page \.docs-ref/);
  });
  expect(css).toContain(".docs-ref__actions a:visited");
  expect(css).toContain("background: #4d6fff");
  expect(css).not.toContain("docs-ref__btn--solid");
  expect(css).not.toContain("background: #0a0a0a");
  expect(css).not.toMatch(/border-(?:top|bottom):\s*1px/);
  expect(css).toContain("font-size: 13.5px");
  expect(css).toContain("box-shadow: none");
  expect(css).toContain(".docs-tok-key");
  expect(css).toContain("#7dcfff");
  expect(css).toContain("#9ece6a");
  expect(css).toContain("#bb9af7");
});
