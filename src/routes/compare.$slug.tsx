import { createFileRoute, notFound } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { CompareDetail } from "@/components/marketing/CompareDetail";
import { useMarketingMotion } from "@/components/marketing/useMarketingMotion";
import { findCompare } from "@/lib/public-compare";
import { publicContentHead } from "@/lib/public-content";
import { PRODUCT_NAME } from "@/lib/product";
import "@/components/marketing/marketing-page.css";
import "@/components/marketing/sky-entry.css";
import "@/components/marketing/public-details.css";

export const Route = createFileRoute("/compare/$slug")({
  loader: ({ params }) => {
    const item = findCompare(params.slug);
    if (!item) throw notFound();
    return item;
  },
  head: ({ loaderData }) =>
    loaderData
      ? publicContentHead(
          `${PRODUCT_NAME} vs ${loaderData.name}`,
          loaderData.verdict,
          `/compare/${loaderData.id}`,
        )
      : { meta: [{ title: "Comparison not found — celinen" }, { name: "robots", content: "noindex" }] },
  component: CompareDetailRoute,
});

function CompareDetailRoute() {
  const motion = useMarketingMotion();
  const item = Route.useLoaderData();
  return (
    <div className="marketing-page" ref={motion}>
      <a className="marketing-skip" href="#main-content">
        Skip to content
      </a>
      <Nav landing />
      <main id="main-content" tabIndex={-1} className="marketing-public-page">
        <CompareDetail item={item} />
      </main>
      <MarketingFooter />
    </div>
  );
}
