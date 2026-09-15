import { createFileRoute, Link } from "@tanstack/react-router";
import { PhotographerDirectory } from "@/components/commerce/PhotographerNetwork";
import { LogoMark } from "@/components/lensos/Logo";
import { readPublicPhotographer } from "@/lib/commerce/functions";
import { publicStoryId } from "@/lib/business/story-sharing";
export const Route = createFileRoute("/photographers")({
  validateSearch: (search: Record<string, unknown>) => ({
    creator: publicStoryId.safeParse(search["creator"]).success
      ? String(search["creator"])
      : undefined,
  }),
  loaderDeps: ({ search }) => ({ creator: search.creator }),
  loader: ({ deps }) =>
    deps.creator ? readPublicPhotographer({ data: { owner: deps.creator } }) : null,
  head: () => ({ meta: [{ title: "Find a photographer — Celinen" }] }),
  component: PublicDirectory,
  errorComponent: () => (
    <main className="commerce-desk">
      <h1>Creator unavailable</h1>
      <p>Please try again shortly.</p>
      <a href="/photographers">Browse photographers</a>
    </main>
  ),
});
function PublicDirectory() {
  const person = Route.useLoaderData();
  const { creator } = Route.useSearch();
  return (
    <main className="commerce-desk">
      <nav className="commerce-row">
        <Link to="/" className="flex items-center gap-2">
          <LogoMark size={28} />
          celinen
        </Link>
        <Link to="/network">Your profile & inbox</Link>
      </nav>
      <header className="commerce-heading">
        <div>
          <h1>
            {creator
              ? person
                ? `Work with ${person.displayName}.`
                : "This creator isn’t listed."
              : "Find your photographer."}
          </h1>
          <p>
            {creator
              ? "Ask about a project or propose a collaboration."
              : "Discover independent photographers. Ask about a shoot or propose a collaboration."}
          </p>
        </div>
      </header>
      {creator && !person ? (
        <p>
          This profile is no longer public. <a href="/photographers">Browse photographers</a>
        </p>
      ) : (
        <PhotographerDirectory key={creator ?? "directory"} featured={person ?? undefined} />
      )}
      {creator && person && <a href="/photographers">Browse all photographers →</a>}
    </main>
  );
}
