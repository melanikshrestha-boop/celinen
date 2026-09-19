import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { SalesContact } from "@/components/marketing/SalesContact";
import { useMarketingMotion } from "@/components/marketing/useMarketingMotion";
import { publicContentHead } from "@/lib/public-content";
import "@/components/marketing/marketing-page.css";
import "@/components/marketing/sky-entry.css";
import "@/components/marketing/public-details.css";

const description = "Talk to LensLab about Celinen or Heavenly for your studio.";

export const Route = createFileRoute("/contact-sales")({
  head: () => publicContentHead("Contact sales", description, "/contact-sales"),
  component: ContactSalesPage,
});

export function ContactSalesPage() {
  const motion = useMarketingMotion("Contact sales");
  return (
    <div className="marketing-page marketing-page--sales" ref={motion}>
      <a className="marketing-skip" href="#main-content">
        Skip to content
      </a>
      <Nav landing />
      <main id="main-content" tabIndex={-1}>
        <SalesContact />
      </main>
      <MarketingFooter />
    </div>
  );
}
