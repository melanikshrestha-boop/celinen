import { createFileRoute } from "@tanstack/react-router";
import { readPublicPortfolio } from "@/lib/business/publishing.functions";
import "@/components/business/business.css";
export const Route = createFileRoute("/photographer/$ownerId")({
  loader: ({ params }) => readPublicPortfolio({ data: { owner: params.ownerId } }),
  head: () => ({
    meta: [{ title: "Recent work — LensLabs" }, { name: "referrer", content: "no-referrer" }],
  }),
  errorComponent: () => (
    <main className="portfolio-story">
      <h1>Portfolio unavailable.</h1>
      <p>Please try again shortly.</p>
    </main>
  ),
  component: PortfolioIndex,
});
function PortfolioIndex() {
  const stories = Route.useLoaderData();
  return (
    <main className="portfolio-story">
      <h1>Recent work.</h1>
      <div className="grid gap-10 sm:grid-cols-2">
        {stories.map((story) => (
          <a key={story.id} href={`/p/${story.id}`}>
            <img src={story.image} alt={story.title} loading="eager" />
            <h2 className="text-xl font-medium">{story.title}</h2>
          </a>
        ))}
      </div>
      {!stories.length && <p>No public stories yet.</p>}
      <footer>
        Photography shared with LensLabs · <a href="/">Start your own portfolio ↗</a>
      </footer>
    </main>
  );
}
