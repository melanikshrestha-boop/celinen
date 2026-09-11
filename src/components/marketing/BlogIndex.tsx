import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { LogoMark } from "@/components/lensos/Logo";
import {
  BLOG_CATEGORIES,
  articlesInCategory,
  type BlogCategory,
} from "@/lib/public-content";

function cardDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function BlogIndex() {
  const [category, setCategory] = useState<BlogCategory>("All");
  const articles = useMemo(() => articlesInCategory(category), [category]);
  return (
    <div className="public-editorial public-editorial--wide blog-index">
      <header className="blog-index__intro">
        <h1>
          The <em>foto</em> blog
        </h1>
        <p>Honest comparisons, guides, and insights for photographers.</p>
      </header>
      <div className="blog-index__filters" role="tablist" aria-label="Blog categories">
        {BLOG_CATEGORIES.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={category === item}
            onClick={() => setCategory(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="blog-index__grid">
        {articles.map((article) => (
          <Link key={article.slug} className="blog-index__card" to="/blog/$slug" params={{ slug: article.slug }}>
            {article.cover ? (
              <img src={article.cover} alt="" />
            ) : (
              <span className="blog-index__still" />
            )}
            <div className="blog-index__body">
              <p className="blog-index__byline">
                <LogoMark size={24} />
                foto
              </p>
              <h2>{article.title}</h2>
              <p className="blog-index__meta">
                <time dateTime={article.published}>{cardDate(article.published)}</time>
                {article.minutes ? <span>· {article.minutes} min read</span> : null}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
