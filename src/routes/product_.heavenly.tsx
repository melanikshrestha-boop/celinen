import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { PublicEntryCta } from "@/components/PublicEntryCta";
import { publicContentHead } from "@/lib/public-content";
import { useMarketingMotion } from "@/components/marketing/useMarketingMotion";
import "@/components/marketing/marketing-page.css";
import "@/components/marketing/sky-entry.css";
import "@/components/marketing/heavenly-page.css";

const description = "Heavenly is the LensLab video agent.";

export const Route = createFileRoute("/product_/heavenly")({
  head: () => publicContentHead("Heavenly", description, "/product/heavenly"),
  component: HeavenlyProductPage,
});

export function HeavenlyProductPage() {
  const motion = useMarketingMotion("Heavenly");
  return (
    <div className="heavenly-page" ref={motion}>
      <a className="marketing-skip" href="#main-content">
        Skip to content
      </a>
      <Nav landing />
      <main id="main-content" tabIndex={-1} className="heavenly-main">
        <section className="heavenly-hero" aria-labelledby="heavenly-heading">
          <h1 id="heavenly-heading">Heavenly</h1>
          <p>Video agent</p>
          <PublicEntryCta
            className="marketing-action"
            next="/video"
            guestLabel={
              <>
                Open
                <span aria-hidden="true">→</span>
              </>
            }
            memberLabel={
              <>
                Open
                <span aria-hidden="true">→</span>
              </>
            }
          />
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
