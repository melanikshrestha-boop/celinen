import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { BrandMark } from "@/components/marketing/BrandMark";
import { useMarketingMotion } from "@/components/marketing/useMarketingMotion";
import { findPublicIntegration } from "@/lib/public-integrations";
import { publicContentHead } from "@/lib/public-content";
import "@/components/marketing/marketing-page.css";
import "@/components/marketing/sky-entry.css";
import "@/components/marketing/public-details.css";
import "@/components/marketing/integrations-page.css";

export const Route = createFileRoute("/integrations/$slug")({
  loader: ({ params }) => {
    const item = findPublicIntegration(params.slug);
    if (!item) throw notFound();
    return item;
  },
  head: ({ loaderData }) =>
    loaderData
      ? publicContentHead(loaderData.title, loaderData.copy, `/integrations/${loaderData.id}`)
      : { meta: [{ title: "Integration not found — celinen" }, { name: "robots", content: "noindex" }] },
  component: IntegrationDetailRoute,
});

function IntegrationDetailRoute() {
  const motion = useMarketingMotion();
  const item = Route.useLoaderData();
  const kind = item.group === "social" ? "Social" : item.group[0]!.toUpperCase() + item.group.slice(1);
  return (
    <div className="marketing-page" ref={motion}>
      <a className="marketing-skip" href="#main-content">
        Skip to content
      </a>
      <Nav landing />
      <main id="main-content" tabIndex={-1} className="marketing-public-page">
        <article className="foto-integrations__detail" data-reveal>
          <span className="foto-integrations__detail-mark" aria-hidden="true">
            <BrandMark id={item.id} />
          </span>
          <h1>{item.title}</h1>
          <small className="foto-integrations__detail-kind">{kind}</small>
          <p>{item.copy}</p>
          <div className="foto-integrations__detail-actions">
            <Link to="/publish">Connect {item.title}</Link>
            <Link to="/integrations">All integrations</Link>
          </div>
        </article>
      </main>
      <MarketingFooter />
    </div>
  );
}
