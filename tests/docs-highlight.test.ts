import { describe, expect, test } from "bun:test";
import { highlightDocsCode } from "../src/lib/docs-highlight";

describe("docs code colors", () => {
  test("paints JSON keys, strings, numbers, and curl the way a Dark+ editor would", () => {
    const html = highlightDocsCode(`curl https://lenslab.dev/api/mcp \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc": "2.0", "id": 1, "name": "foto_plans"}'`);
    expect(html).toContain('class="docs-tok-kw">curl<');
    expect(html).toContain('class="docs-tok-flag">-H<');
    expect(html).toContain('class="docs-tok-key">"jsonrpc"<');
    expect(html).toContain('class="docs-tok-str">"2.0"<');
    expect(html).toContain("foto_plans");
    expect(html).toContain('class="docs-tok-num">1<');
    expect(html).not.toContain("<script");
  });

  test("escapes markup inside snippets", () => {
    expect(highlightDocsCode(`api_key="<secret>"`)).toContain("&lt;secret&gt;");
  });
});
