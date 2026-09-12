import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "postcss";
import { FOTO_MCP_TOOLS, FOTO_MCP_URL, handleMcpRequest } from "../src/lib/foto-mcp";
import { McpPage } from "../src/components/marketing/McpPage";

async function rpc(method: string, params?: Record<string, unknown>, id: number | string = 1) {
  return handleMcpRequest(
    new Request("https://lenslab.dev/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    }),
  );
}

test("foto MCP connector initializes and lists photography tools", async () => {
  const started = await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  const body = (await started.json()) as { result: { serverInfo: { name: string } } };
  expect(started.headers.get("access-control-allow-origin")).toBe("*");
  expect(body.result.serverInfo.name).toBe("foto");
  const listed = await (await rpc("tools/list")).json();
  expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
    FOTO_MCP_TOOLS.map((tool) => tool.name),
  );
  const plans = await (
    await rpc("tools/call", { name: "foto_plans", arguments: {} })
  ).json();
  expect(plans.result.content[0].text).toContain("USD 20");
  expect(plans.result.content[0].text).not.toMatch(/viral|YouTube Automation/i);
  expect(FOTO_MCP_TOOLS.map((tool) => tool.name)).toContain("celinen_draft_post");
  const drafted = await (
    await rpc("tools/call", { name: "celinen_draft_post", arguments: { idea: "Gallery tonight" } })
  ).json();
  expect(drafted.result.content[0].text).toContain("Gallery tonight");
  expect(drafted.result.content[0].text).toContain("Nothing was published");
  const desk = await (
    await rpc("tools/call", { name: "celinen_open", arguments: { desk: "social" } })
  ).json();
  expect(desk.result.content[0].text).toContain("/publish");
});

test("mcp page is a Vugola-style connector with Grok and Julius", () => {
  const html = renderToStaticMarkup(createElement(McpPage));
  expect(html).toContain("The ");
  expect(html).toContain("foto");
  expect(html).toContain("MCP");
  expect(html).toContain(FOTO_MCP_URL);
  expect(html).toContain("Grok");
  expect(html).toContain("Julius");
  expect(html).toContain("Python (OpenAI)");
  expect(html).toContain("mcp-snippet__thumb");
  expect(html).toContain("Grok");
  const source = readFileSync(new URL("../src/components/marketing/McpPage.tsx", import.meta.url), "utf8");
  expect(source).toContain("onPointerMove={followSnippet}");
  expect(source).toContain("onPointerEnter={followSnippet}");
  expect(source).toContain("base_url=\"https://api.x.ai/v1\"");
  expect(source).toContain("grok-4.6");
  expect(source).toContain("server_url");
  expect(html).not.toContain("YouTube Automation");
  expect(html).not.toContain("video creators");
});

test("mcp styling stays public-scoped", () => {
  const css = readFileSync(new URL("../src/components/marketing/mcp-page.css", import.meta.url), "utf8");
  const stylesheet = parse(css);
  stylesheet.walkRules((rule) => {
    for (const selector of rule.selectors) expect(selector).toMatch(/^\.marketing-page \.mcp/);
  });
});
