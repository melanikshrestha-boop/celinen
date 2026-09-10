import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { BlogIndex } from "@/components/marketing/BlogIndex";
import { useMarketingMotion } from "@/components/marketing/useMarketingMotion";
import { publicContentHead } from "@/lib/public-content";
import "@/components/marketing/marketing-page.css";
import "@/components/marketing/sky-entry.css";
import "@/components/marketing/public-details.css";
import "@/components/marketing/public-editorial.css";

export const Route = createFileRoute("/blog/")({
  head: () => publicContentHead("The foto blog", "Notes on editing, delivery, and the work.", "/blog"),
  component: BlogPage,
});

export function BlogPage() {
  const motion = useMarketingMotion();
  return (
    <div className="marketing-page" ref={motion}>
      <a className="marketing-skip" href="#main-content">
        Skip to content
      </a>
      <Nav landing />
      <main id="main-content" tabIndex={-1} className="marketing-public-page">
        <BlogIndex />
      </main>
      <MarketingFooter />
    </div>
  );
}
