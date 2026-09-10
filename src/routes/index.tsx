import { createFileRoute, Link } from "@tanstack/react-router";
import { useAccount } from "@/components/account/AccountProvider";
import { Nav } from "@/components/Nav";
import { SavingsSection } from "@/components/marketing/SavingsSection";
import { WorkflowSection } from "@/components/marketing/WorkflowSection";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { IntegrationsSection } from "@/components/marketing/IntegrationsSection";
import { HomePricing } from "@/components/marketing/HomePricing";
import { SectionGuard } from "@/components/marketing/SectionGuard";
import { useMarketingMotion } from "@/components/marketing/useMarketingMotion";
import { publicEntry } from "@/lib/public-entry";
import { PRODUCT_NAME } from "@/lib/product";
import { ArrowRight, Camera, Check, Heart, Images } from "lucide-react";
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
  const motion = useMarketingMotion();
  return (
    <div className="marketing-page" ref={motion}>
      <a className="marketing-skip" href="#main-content">
        Skip to content
      </a>
      <Nav landing />
      <main id="main-content" tabIndex={-1}>
        <div className="marketing-vista">
          <div className="marketing-vista__ground" aria-hidden="true">
            <img
              className="marketing-hero__image"
              src="/images/foto-open-sky.webp"
              alt=""
              width="1672"
              height="941"
              fetchPriority="high"
            />
          </div>
        <section className="marketing-hero" aria-labelledby="home-heading">
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
            </div>
            <p className="marketing-hero__note">Made for the person behind the camera.</p>
          </div>
        </section>
        <div className="marketing-promises" aria-label="Your work stays yours" data-reveal>
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
        <section className="marketing-learn" aria-labelledby="learn-heading" data-reveal>
          <h2 id="learn-heading">It learns from your photos and your edits.</h2>
          <p>
            When you save a look (snapshot or preset), FOTO can remember that technique so the tool
            gets more useful for you over time. Original files stay read-only. This stays in your
            workspace. It is not used to train a shared model for other photographers. Turn it off
            in Settings → Privacy.
          </p>
          <Link to="/privacy" className="marketing-action marketing-action--text">
            Read the privacy note
          </Link>
        </section>
        </div>
        <SectionGuard>
          <WorkflowSection />
        </SectionGuard>
        <SectionGuard>
          <IntegrationsSection />
        </SectionGuard>
        <SectionGuard>
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
        </SectionGuard>
        <SectionGuard>
          <HomePricing />
        </SectionGuard>
        <SectionGuard>
        <section className="marketing-handoff" aria-labelledby="handoff-heading">
          <img
            className="marketing-handoff__image"
            src="/images/foto-open-sky.webp"
            alt=""
            loading="lazy"
          />
          <div data-reveal>
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
        </SectionGuard>
      </main>
      <MarketingFooter />
    </div>
  );
}
