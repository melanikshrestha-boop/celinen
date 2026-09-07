import { createFileRoute, Link } from "@tanstack/react-router";
import { PhotographerDirectory } from "@/components/commerce/PhotographerNetwork";
import { LogoMark } from "@/components/lensos/Logo";
export const Route = createFileRoute("/photographers")({
  head: () => ({ meta: [{ title: "Find a photographer — LensLabs" }] }),
  component: PublicDirectory,
});
function PublicDirectory() {
  return (
    <main className="commerce-desk">
      <nav className="commerce-row">
        <Link to="/" className="flex items-center gap-2">
          <LogoMark size={28} />
          LensLabs
        </Link>
        <Link to="/network">Your profile & inbox</Link>
      </nav>
      <header className="commerce-heading">
        <div>
          <h1>Find your photographer.</h1>
          <p>Discover independent photographers. Ask about a shoot or propose a collaboration.</p>
        </div>
      </header>
      <PhotographerDirectory />
    </main>
  );
}
