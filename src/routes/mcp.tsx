import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { McpPage } from "@/components/marketing/McpPage";
import { useMarketingMotion } from "@/components/marketing/useMarketingMotion";
import { publicContentHead } from "@/lib/public-content";
import "@/components/marketing/marketing-page.css";
import "@/components/marketing/sky-entry.css";
import "@/components/marketing/public-details.css";
import "@/components/marketing/public-editorial.css";
import "@/components/marketing/mcp-page.css";

export const Route = createFileRoute("/mcp")({
  head: () =>
    publicContentHead(
      "foto MCP",
      "Connect FOTO to Claude, ChatGPT, Cursor, Grok, and Julius with one URL.",
      "/mcp",
    ),
  component: McpRoute,
});

function McpRoute() {
  const motion = useMarketingMotion();
  return (
    <div className="marketing-page" ref={motion}>
      <a className="marketing-skip" href="#main-content">
        Skip to content
      </a>
      <Nav landing />
      <main id="main-content" tabIndex={-1} className="marketing-public-page">
        <McpPage />
      </main>
      <MarketingFooter />
    </div>
  );
}
