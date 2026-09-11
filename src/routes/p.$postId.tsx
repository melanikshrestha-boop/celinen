import { createFileRoute } from "@tanstack/react-router";
import { readPortfolioStory } from "@/lib/business/publishing.functions";
import { publicStoryHead } from "@/lib/business/story-sharing";
import { PublicStory } from "@/components/business/PublicStory";
export const Route = createFileRoute("/p/$postId")({
  loader: ({ params }) => readPortfolioStory({ data: { id: params.postId } }),
  head: ({ loaderData, params }) => publicStoryHead(params.postId, loaderData),
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
  const { postId } = Route.useParams();
  return <PublicStory postId={postId} story={story} />;
}
