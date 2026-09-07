import { createFileRoute } from "@tanstack/react-router";
import { readPortfolioStory } from "@/lib/business/publishing.functions";
import "@/components/business/business.css";
export const Route = createFileRoute("/p/$postId")({
  loader: ({ params }) => readPortfolioStory({ data: { id: params.postId } }),
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.title ?? "Portfolio"} — LensLabs` },
      { name: "referrer", content: "no-referrer" },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: () => (
    <main className="portfolio-story">
      <h1>This story isn’t available.</h1>
      <p>It may have been unpublished. Contact the photographer for an updated link.</p>
    </main>
  ),
  component: Story,
});
function Story() {
  const story = Route.useLoaderData();
  return (
    <main className="portfolio-story">
      <a href={story.portfolioUrl} className="text-sm text-moss">
        ← All work
      </a>
      <h1>{story.title}</h1>
      <p>{story.caption}</p>
      <div>
        {story.images.map((url, i) => (
          <img key={i} src={url} alt={`${story.title} — photograph ${i + 1}`} loading="eager" />
        ))}
      </div>
      <footer>
        Photography shared with LensLabs · <a href="/">Create your own story ↗</a>
      </footer>
    </main>
  );
}
