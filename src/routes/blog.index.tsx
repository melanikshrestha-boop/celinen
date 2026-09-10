import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicPage } from "@/components/marketing/PublicPage";
import { fotoArticles, publicContentHead, publicDateLabel } from "@/lib/public-content";
import "@/components/marketing/public-editorial.css";

const description =
  "Small, practical notes on editing, delivery, and the work around a photograph.";

export const Route = createFileRoute("/blog/")({
  head: () => publicContentHead("Field notes", description, "/blog"),
  component: BlogPage,
});

export function BlogPage() {
  return (
    <PublicPage eyebrow="Blog" title="Field notes." description={description}>
      <div className="public-editorial">
        <div className="public-editorial__articles">
          {fotoArticles.map((article) => (
            <article key={article.slug} data-reveal>
              <span className="public-editorial__label">{article.category}</span>
              <h2>
                <Link to="/blog/$slug" params={{ slug: article.slug }}>
                  {article.title} <span aria-hidden="true">↗</span>
                </Link>
              </h2>
              <p>{article.description}</p>
              <time dateTime={article.published}>{publicDateLabel(article.published)}</time>
            </article>
          ))}
        </div>
      </div>
    </PublicPage>
  );
}
