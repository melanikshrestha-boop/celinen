import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { UseCasesPage } from "@/components/marketing/UseCasesPage";
import { useMarketingMotion } from "@/components/marketing/useMarketingMotion";
import { publicContentHead } from "@/lib/public-content";
import "@/components/marketing/marketing-page.css";
import "@/components/marketing/sky-entry.css";
import "@/components/marketing/public-details.css";

export const Route = createFileRoute("/use-cases")({
  head: () =>
    publicContentHead(
      "Use cases",
      "College football, high school sports, and wedding weekends. Same-night galleries. Connect socials and post feed, Stories, and highlights together.",
      "/use-cases",
    ),
  component: UseCasesRoute,
});

function UseCasesRoute() {
  const motion = useMarketingMotion();
  return (
    <div className="marketing-page" ref={motion}>
      <a className="marketing-skip" href="#main-content">
        Skip to content
      </a>
      <Nav landing />
      <main id="main-content" tabIndex={-1} className="marketing-public-page">
        <UseCasesPage />
      </main>
      <MarketingFooter />
    </div>
  );
}
