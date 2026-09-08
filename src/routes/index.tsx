import { createFileRoute, Link } from "@tanstack/react-router";
import { useAccount } from "@/components/account/AccountProvider";
import { Nav } from "@/components/Nav";
import { SavingsSection } from "@/components/marketing/SavingsSection";
import { WorkflowSection } from "@/components/marketing/WorkflowSection";
import { publicEntry } from "@/lib/public-entry";
import "@/components/marketing/marketing-page.css";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LensLabs — A workspace for your photography" },
      {
        name: "description",
        content:
          "Review your shoot, choose your keepers, and prepare your client gallery. Explore LensLabs and estimate the value of your time before signing in.",
      },
      { property: "og:title", content: "LensLabs — A workspace for your photography" },
      {
        property: "og:description",
        content:
          "Review, edit and prepare your photography for delivery. Your decisions stay yours.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const account = useAccount();
  const entry = publicEntry(account?.status);
  return (
    <div className="marketing-page">
      <a className="marketing-skip" href="#main-content">
        Skip to content
      </a>
      <Nav landing />
      <main id="main-content" tabIndex={-1}>
        <section className="marketing-hero" aria-labelledby="home-heading">
          <img
            className="marketing-hero__image"
            src="/images/auth-lens.jpg"
            alt=""
            width="1280"
            height="720"
            fetchPriority="high"
          />
          <div className="marketing-hero__content">
            <p className="marketing-value__eyebrow">Your photography. Your decisions.</p>
            <h1 id="home-heading">
              More time for
              <br />
              the photographs.
            </h1>
            <p className="marketing-hero__lead">
              Review your shoot, choose your keepers, and prepare your client gallery. One place to
              keep the work moving.
            </p>
            <div className="marketing-actions">
              <Link
                to={entry.to}
                search={entry.search}
                className="marketing-action marketing-action--primary"
              >
                {entry.label}
                <span aria-hidden="true">→</span>
              </Link>
              <a href="#savings" className="marketing-action marketing-action--text">
                Estimate your savings<span aria-hidden="true">↓</span>
              </a>
            </div>
            <p className="marketing-hero__note">
              Review before applying edits. Publish only when you choose.
            </p>
          </div>
        </section>
        <SavingsSection>
          <Link
            to={entry.to}
            search={entry.search}
            className="marketing-action marketing-action--primary"
          >
            {entry.label}
            <span aria-hidden="true">→</span>
          </Link>
        </SavingsSection>
        <WorkflowSection />
        <section className="marketing-handoff" aria-labelledby="handoff-heading">
          <div>
            <p className="marketing-value__eyebrow">Fits the way you work</p>
            <h2 id="handoff-heading">
              Keep your editor.
              <br />
              Keep your control.
            </h2>
          </div>
          <div className="marketing-handoff__body">
            <p>
              Export ratings and supported develop settings for your Adobe workflow. Finish detailed
              retouching in your editor, then prepare gallery copies for delivery.
            </p>
            <p>
              Gallery publishing requires a connected account. Available options depend on your
              setup.
            </p>
            <Link to="/docs" className="marketing-action marketing-action--text">
              Read the workflow guide<span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>
      </main>
      <footer className="marketing-footer">
        <Link to="/" className="marketing-footer__brand">
          LensLabs
        </Link>
        <nav aria-label="Footer">
          <Link to="/docs">Documentation</Link>
          <Link to="/security">Security</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </nav>
      </footer>
    </div>
  );
}
