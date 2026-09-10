import { createFileRoute } from "@tanstack/react-router";
import { PublicPage } from "@/components/marketing/PublicPage";
import { fotoReleases, publicContentHead, publicDateLabel } from "@/lib/public-content";
import "@/components/marketing/public-editorial.css";

const description = "Recent improvements, with the limits made clear.";

export const Route = createFileRoute("/changelog")({
  head: () => publicContentHead("Changelog", description, "/changelog"),
  component: ChangelogPage,
});

export function ChangelogPage() {
  return (
    <PublicPage
      eyebrow="Changelog"
      title="A little better, every release."
      description={description}
    >
      <div className="public-editorial public-editorial__releases">
        {fotoReleases.map((release) => (
          <article key={release.id} aria-labelledby={`release-${release.id}`} data-reveal>
            <div className="public-editorial__article-meta">
              <time dateTime={release.date}>{publicDateLabel(release.date)}</time>
              <span>
                Release <code>{release.id}</code>
              </span>
            </div>
            <h2 id={`release-${release.id}`}>{release.title}</h2>
            <p>{release.description}</p>
            <ul>
              {release.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
            <p className="public-editorial__release-note">{release.note}</p>
          </article>
        ))}
      </div>
    </PublicPage>
  );
}
