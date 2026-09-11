import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { ComparePage } from "@/components/marketing/ComparePage";
import { useMarketingMotion } from "@/components/marketing/useMarketingMotion";
import { publicContentHead } from "@/lib/public-content";
import { PRODUCT_NAME } from "@/lib/product";
import "@/components/marketing/marketing-page.css";
import "@/components/marketing/sky-entry.css";
import "@/components/marketing/public-details.css";

export const Route = createFileRoute("/compare/")({
  head: () =>
    publicContentHead(
      "Compare",
      `How ${PRODUCT_NAME} compares with Aftershoot, Imagen, Pixieset, ShootProof, Photo Mechanic, Lightroom Classic, and the rest. Every claim checked against a page they publish.`,
      "/compare",
    ),
  component: CompareIndexRoute,
});

function CompareIndexRoute() {
  const motion = useMarketingMotion();
  return (
    <div className="marketing-page" ref={motion}>
      <a className="marketing-skip" href="#main-content">
        Skip to content
      </a>
      <Nav landing />
      <main id="main-content" tabIndex={-1} className="marketing-public-page">
        <ComparePage />
      </main>
      <MarketingFooter />
    </div>
  );
}
