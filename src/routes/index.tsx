import { createFileRoute, Link } from "@tanstack/react-router";
import { useAccount } from "@/components/account/AccountProvider";
import { Nav } from "@/components/Nav";
import { SavingsSection } from "@/components/marketing/SavingsSection";
import { WorkflowSection } from "@/components/marketing/WorkflowSection";
import { publicEntry } from "@/lib/public-entry";
import { PRODUCT_NAME } from "@/lib/product";
import { ArrowRight, Camera, Check, Heart, Images, SlidersHorizontal, Star } from "lucide-react";
import "@/components/marketing/marketing-page.css";
import "@/components/marketing/sky-entry.css";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: PRODUCT_NAME },
      {
        name: "description",
        content:
          "A little less admin. A lot more creating. Bring your shoots, edits and client galleries together with foto.",
      },
      { property: "og:title", content: PRODUCT_NAME },
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
            src="/images/foto-open-sky.webp"
            alt=""
            width="1672"
            height="941"
            fetchPriority="high"
          />
          <div className="marketing-hero__content">
            <p className="marketing-hero__eyebrow">
              <Camera size={16} /> A little space for your big ideas
            </p>
            <h1 id="home-heading">
              Go where the
              <br />
              good light takes you.
            </h1>
            <p className="marketing-hero__lead">
              Your shoots, edits, and galleries. Happily together.
              <br />A little less admin. A lot more creating.
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
              <a href="#possibilities" className="marketing-action marketing-action--glass">
                Take a look around<span aria-hidden="true">↗</span>
              </a>
            </div>
            <p className="marketing-hero__note">Made for the person behind the camera.</p>
          </div>
        </section>
        <div className="marketing-promises" aria-label="Your work stays yours">
          <span>
            <Check size={16} /> Originals stay untouched
          </span>
          <span>
            <Heart size={16} /> Your eye. Your decisions.
          </span>
          <span>
            <Images size={16} /> Share when you’re ready
          </span>
        </div>
        <section
          className="marketing-possibilities"
          id="possibilities"
          aria-labelledby="possibilities-heading"
        >
          <div className="marketing-section-intro">
            <p className="marketing-value__eyebrow">Room to do your thing</p>
            <h2 id="possibilities-heading">
              Less busywork.
              <br />
              More possibility.
            </h2>
            <p>
              From a folder full of maybes to a gallery you can’t wait to share. Keep the creative
              part yours.
            </p>
          </div>
          <div className="marketing-feature-grid">
            <article className="marketing-feature">
              <div
                className="marketing-feature__art marketing-feature__art--selects"
                aria-hidden="true"
              >
                <span className="marketing-sticker">
                  That’s the one <Heart size={16} />
                </span>
                <div className="marketing-print marketing-print--one">
                  <img src="/images/foto-open-sky.webp" alt="" loading="lazy" />
                  <span>Keep the feeling.</span>
                </div>
                <div className="marketing-print marketing-print--two">
                  <img src="/images/foto-open-sky.webp" alt="" loading="lazy" />
                  <span>
                    <Star size={13} fill="currentColor" />
                    <Star size={13} fill="currentColor" />
                    <Star size={13} fill="currentColor" />
                    <Star size={13} fill="currentColor" />
                    <Star size={13} fill="currentColor" />
                  </span>
                </div>
              </div>
              <h3>Find your favorites.</h3>
              <p>
                Bring in your shoot, review suggestions, and pick the frames that tell your story.
              </p>
            </article>
            <article className="marketing-feature">
              <div
                className="marketing-feature__art marketing-feature__art--color"
                aria-hidden="true"
              >
                <div className="marketing-color-wheel">
                  <SlidersHorizontal size={40} strokeWidth={1.4} />
                </div>
                <div className="marketing-palette">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                <span className="marketing-sticker">A little more you.</span>
              </div>
              <h3>Follow your own color.</h3>
              <p>
                Shape the light, explore a look, and save your treatment. Your originals stay
                untouched.
              </p>
            </article>
            <article className="marketing-feature">
              <div
                className="marketing-feature__art marketing-feature__art--gallery"
                aria-hidden="true"
              >
                <div className="marketing-mini-gallery">
                  <span>
                    The good light collection <Heart size={15} />
                  </span>
                  <div>
                    <img src="/images/foto-open-sky.webp" alt="" loading="lazy" />
                    <img src="/images/foto-open-sky.webp" alt="" loading="lazy" />
                    <img src="/images/foto-open-sky.webp" alt="" loading="lazy" />
                  </div>
                </div>
                <span className="marketing-sticker">Made to be shared ↗</span>
              </div>
              <h3>Give your photos a home.</h3>
              <p>
                Prepare a client gallery for favorites and feedback. Connect your account to publish
                when you’re ready.
              </p>
            </article>
            <article className="marketing-feature">
              <div
                className="marketing-feature__art marketing-feature__art--studio"
                aria-hidden="true"
              >
                <div className="marketing-orbit">
                  <span>
                    <Camera size={32} />
                  </span>
                  <i>
                    <Heart size={21} />
                  </i>
                  <i>
                    <Images size={21} />
                  </i>
                  <i>
                    <Star size={21} />
                  </i>
                </div>
                <span className="marketing-sticker">Less juggling. More joy.</span>
              </div>
              <h3>Keep the whole shoot together.</h3>
              <p>
                People, plans, and photographs in one workspace. More room for whatever comes next.
              </p>
            </article>
          </div>
        </section>
        <WorkflowSection />
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
        <section className="marketing-handoff" aria-labelledby="handoff-heading">
          <img
            className="marketing-handoff__image"
            src="/images/foto-open-sky.webp"
            alt=""
            loading="lazy"
          />
          <div>
            <p className="marketing-hero__eyebrow">The next chapter is yours</p>
            <h2 id="handoff-heading">
              Make something
              <br />
              worth looking back on.
            </h2>
          </div>
          <div className="marketing-handoff__body">
            <Link
              to={entry.to}
              search={entry.search}
              className="marketing-action marketing-action--primary"
            >
              {entry.label}
              <ArrowRight size={18} />
            </Link>
          </div>
        </section>
      </main>
      <footer className="marketing-footer">
        <Link to="/" className="marketing-footer__brand">
          foto
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
