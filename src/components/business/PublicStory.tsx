import { creatorInquiryPath } from "@/lib/business/story-sharing";
import { StoryShare } from "./StoryShare";
import "./story-sharing.css";
import "./business.css";

type Story = {
  title: string;
  caption: string;
  portfolioUrl: string;
  images: string[];
  creator: { owner: string; displayName: string; available: boolean } | null;
};

export function PublicStory({ postId, story }: { postId: string; story: Story }) {
  return (
    <main className="portfolio-story">
      <a href={story.portfolioUrl} className="text-sm text-moss">
        ← All work
      </a>
      <h1>{story.title}</h1>
      <div className="story-byline">
        {story.creator && <a href={story.portfolioUrl}>Work by {story.creator.displayName}</a>}
        <StoryShare id={postId} title={story.title} creator={story.creator?.displayName} />
      </div>
      <p>{story.caption}</p>
      <div>
        {story.images.map((url, i) => (
          <img
            key={i}
            src={url}
            alt={`${story.title} — photograph ${i + 1}`}
            loading={i ? "lazy" : "eager"}
          />
        ))}
      </div>
      <footer>
        {story.creator && (
          <div className="story-creator-cta">
            <div>
              <strong>{story.creator.displayName}</strong>
              <p>More work. Your next project.</p>
            </div>
            {story.creator.available ? (
              <a className="story-inquiry" href={creatorInquiryPath(story.creator.owner)}>
                Work with this creator →
              </a>
            ) : (
              <a href={story.portfolioUrl}>View portfolio →</a>
            )}
          </div>
        )}
        <div className="story-platform-credit">
          Shared with LensLabs ·{" "}
          <a href="/auth?next=%2Fpublish&mode=signup">Create your own photo story →</a>
        </div>
      </footer>
    </main>
  );
}
