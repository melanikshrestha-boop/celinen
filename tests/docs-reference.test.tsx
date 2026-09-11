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
  expect(css).toContain("background: #000");
  expect(css).toContain("scrollbar-color: #9a9a9a #000");
  expect(css).toContain("::-webkit-scrollbar-thumb");
  expect(css).toContain("#f3f3f3");
  expect(css).toContain("#d7b3ff");
  expect(css).toContain("#c6f07a");
  expect(css).toContain("#9ae8ff");
  expect(css).not.toContain("#1a1b26");
  expect(css).not.toContain("#c0caf5");
  expect(css).toContain("13.5rem minmax(0, 1fr)");
  expect(css).toContain("9.5rem minmax(0, 1fr)");
  expect(css).not.toMatch(/@media \(max-width: 800px\)[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});
