import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { IntegrationsPage } from "@/components/marketing/IntegrationsPage";
import { useMarketingMotion } from "@/components/marketing/useMarketingMotion";
import { publicContentHead } from "@/lib/public-content";
import "@/components/marketing/marketing-page.css";
import "@/components/marketing/sky-entry.css";
import "@/components/marketing/public-details.css";

export const Route = createFileRoute("/integrations/")({
  head: () =>
    publicContentHead(
      "Integrations",
      "Connect Instagram, Facebook, X, LinkedIn, Pinterest, Bluesky, Threads, YouTube Shorts, Google Business, TikTok, and the rest. Encrypted login first. Then post.",
      "/integrations",
    ),
  component: IntegrationsRoute,
});

function IntegrationsRoute() {
  const motion = useMarketingMotion();
  return (
    <div className="marketing-page" ref={motion}>
      <a className="marketing-skip" href="#main-content">
        Skip to content
      </a>
      <Nav landing />
      <main id="main-content" tabIndex={-1} className="marketing-public-page">
        <IntegrationsPage />
      </main>
      <MarketingFooter />
    </div>
  );
}
