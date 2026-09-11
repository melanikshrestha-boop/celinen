import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { DocsReference } from "@/components/marketing/DocsReference";
import { useMarketingMotion } from "@/components/marketing/useMarketingMotion";
import { publicContentHead } from "@/lib/public-content";
import "@/components/marketing/marketing-page.css";
import "@/components/marketing/sky-entry.css";
import "@/components/marketing/public-details.css";
import "@/components/marketing/public-editorial.css";
import "@/components/marketing/docs-reference.css";

export const Route = createFileRoute("/docs")({
  head: () =>
    publicContentHead(
      "Docs",
      "celinen API reference: pick keepers, send a gallery, connect MCP. Photography tools for people and assistants.",
      "/docs",
    ),
  component: DocsPage,
});

function DocsPage() {
  const motion = useMarketingMotion();
  return (
    <div className="marketing-page" ref={motion}>
      <a className="marketing-skip" href="#main-content">
        Skip to content
      </a>
      <Nav landing />
      <main id="main-content" tabIndex={-1} className="marketing-public-page">
        <DocsReference />
      </main>
      <MarketingFooter />
    </div>
  );
}
