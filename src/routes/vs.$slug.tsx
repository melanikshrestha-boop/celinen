import { createFileRoute, notFound } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { useMarketingMotion } from "@/components/marketing/useMarketingMotion";
import { findCompare } from "@/lib/public-compare";
import { PRODUCT_NAME } from "@/lib/product";
import "@/components/marketing/marketing-page.css";
import "@/components/marketing/sky-entry.css";
import "@/components/marketing/public-details.css";

export const Route = createFileRoute("/vs/$slug")({
  loader: ({ params }) => {
    const item = findCompare(params.slug);
    if (!item) throw notFound();
    return { slug: item.id, name: item.name };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${PRODUCT_NAME} vs. ${loaderData.name}`
          : "Comparison — celinen",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VsStubRoute,
});

function VsStubRoute() {
  const motion = useMarketingMotion();
  return (
    <div className="marketing-page" ref={motion}>
      <a className="marketing-skip" href="#main-content">
        Skip to content
      </a>
      <Nav landing />
      <main id="main-content" tabIndex={-1} className="marketing-public-page" />
      <MarketingFooter />
    </div>
  );
}
