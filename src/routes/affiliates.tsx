import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { AffiliatesPage } from "@/components/marketing/AffiliatesPage";
import { useMarketingMotion } from "@/components/marketing/useMarketingMotion";
import { publicContentHead } from "@/lib/public-content";
import "@/components/marketing/marketing-page.css";
import "@/components/marketing/sky-entry.css";
import "@/components/marketing/public-details.css";

export const Route = createFileRoute("/affiliates")({
  head: () =>
    publicContentHead(
      "Affiliates",
      "Our 30% affiliate program. Earn recurring commission. Photographers you send get 20% off at checkout. 60-day cookie. PayPal.",
      "/affiliates",
    ),
  component: AffiliatesRoute,
});

function AffiliatesRoute() {
  const motion = useMarketingMotion();
  return (
    <div className="marketing-page" ref={motion}>
      <a className="marketing-skip" href="#main-content">
        Skip to content
      </a>
      <Nav landing />
      <main id="main-content" tabIndex={-1} className="marketing-public-page">
        <AffiliatesPage />
      </main>
      <MarketingFooter />
    </div>
  );
}
