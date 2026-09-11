import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { GalleriesPage } from "@/components/marketing/GalleriesPage";
import { useMarketingMotion } from "@/components/marketing/useMarketingMotion";
import { publicContentHead } from "@/lib/public-content";
import "@/components/marketing/marketing-page.css";
import "@/components/marketing/sky-entry.css";
import "@/components/marketing/public-details.css";

export const Route = createFileRoute("/galleries")({
  head: () =>
    publicContentHead(
      "Galleries",
      "Send a keeper set the same night. Favourites, downloads, and a passcode. Originals stay with you.",
      "/galleries",
    ),
  component: GalleriesRoute,
});

function GalleriesRoute() {
  const motion = useMarketingMotion();
  return (
    <div className="marketing-page" ref={motion}>
      <a className="marketing-skip" href="#main-content">
        Skip to content
      </a>
      <Nav landing />
      <main id="main-content" tabIndex={-1} className="marketing-public-page">
        <GalleriesPage />
      </main>
      <MarketingFooter />
    </div>
  );
}
