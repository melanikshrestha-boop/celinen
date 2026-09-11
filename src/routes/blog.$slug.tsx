import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PublicPage } from "@/components/marketing/PublicPage";
import {
  findFotoArticle,
  publicContentHead,
  publicDateLabel,
  type FotoArticle,
} from "@/lib/public-content";
import { BlogComments } from "@/components/marketing/BlogComments";
import "@/components/marketing/public-editorial.css";

export const Route = createFileRoute("/blog/$slug")({
  loader: ({ params }) => {
    const article = findFotoArticle(params.slug);
    if (!article) throw notFound();
    return article;
  },
  head: ({ loaderData }) =>
    loaderData
      ? publicContentHead(loaderData.title, loaderData.description, `/blog/${loaderData.slug}`)
      : {
          meta: [{ title: "Article not found — FOTO" }, { name: "robots", content: "noindex" }],
        },
  notFoundComponent: ArticleNotFound,
  component: BlogArticleRoute,
});

function BlogArticleRoute() {
  return <BlogArticle article={Route.useLoaderData()} />;
}

export function BlogArticle({ article }: { article: FotoArticle }) {
  return (
    <PublicPage eyebrow={article.category} title={article.title} description={article.description}>
      <article className="public-editorial public-editorial__prose">
        <div className="public-editorial__article-meta">
          <Link to="/blog">← Back to blog</Link>
          <time dateTime={article.published}>{publicDateLabel(article.published)}</time>
          {article.minutes ? <span>· {article.minutes} min read</span> : null}
        </div>
        {article.cover ? (
          <img className="public-editorial__cover" src={article.cover} alt="" />
        ) : null}
        {article.sections.map((section) => (
          <section key={section.title} data-reveal>
            <h2>{section.title}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.items ? (
              <ul>
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
        <Link to="/product">
          Explore FOTO <span aria-hidden="true">↗</span>
        </Link>
        <BlogComments slug={article.slug} />
      </article>
    </PublicPage>
  );
}

export function ArticleNotFound() {
  return (
    <PublicPage
      eyebrow="Field notes"
      title="That article isn’t here."
      description="The link may have changed. The rest of our notes are still here."
    >
      <div className="public-editorial">
        <Link to="/blog">← Back to the blog</Link>
      </div>
    </PublicPage>
  );
}
