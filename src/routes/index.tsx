import { createFileRoute, Link } from "@tanstack/react-router";
import { useAccount } from "@/components/account/AccountProvider";
import { Nav } from "@/components/Nav";
import { SavingsSection } from "@/components/marketing/SavingsSection";
import { PossibilitiesSection } from "@/components/marketing/PossibilitiesSection";
import { WorkflowSection } from "@/components/marketing/WorkflowSection";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { IntegrationsSection } from "@/components/marketing/IntegrationsSection";
import { PublishEverywhere } from "@/components/marketing/PublishEverywhere";
import { LivePhotographers } from "@/components/marketing/LivePhotographers";
import { HomePricing } from "@/components/marketing/HomePricing";
import { AffiliatesLanding } from "@/components/marketing/AffiliatesPage";
import { MarketingStats } from "@/components/marketing/MarketingStats";
import { SectionGuard } from "@/components/marketing/SectionGuard";
import { useMarketingMotion } from "@/components/marketing/useMarketingMotion";
import { publicEntry } from "@/lib/public-entry";
import { PRODUCT_HEADLINE } from "@/lib/product";
import { ArrowRight, Check, Heart, Images } from "lucide-react";
import "@/components/marketing/marketing-page.css";
import "@/components/marketing/sky-entry.css";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: PRODUCT_HEADLINE },
      {
        name: "description",
        content:
          "Go where the good light takes you. Review, edit, and send galleries — originals stay yours.",
      },
      { property: "og:title", content: PRODUCT_HEADLINE },
      { name: "twitter:title", content: PRODUCT_HEADLINE },
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
            <LivePhotographers />
            <h1 id="home-heading">
              Go where the
              <br />
              good light takes you.
            </h1>
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
        </div>
        <MarketingStats />
        <SectionGuard>
          <PublishEverywhere />
        </SectionGuard>
        <SectionGuard>
          <PossibilitiesSection />
        </SectionGuard>
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
          <section className="marketing-plan-invitation" aria-labelledby="plans-heading" data-reveal>
            <div>
              <p className="marketing-value__eyebrow">A home for your next chapter</p>
              <h2 id="plans-heading">Start small. Dream in full frame.</h2>
              <p>Explore plans, compare what’s included, and find your fit.</p>
            </div>
            <Link to="/pricing" className="marketing-action marketing-action--primary">
              Find your plan <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </section>
        </SectionGuard>
        <SectionGuard>
          <HomePricing />
        </SectionGuard>
        <SectionGuard>
          <AffiliatesLanding />
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
          <div className="marketing-handoff__body" data-reveal>
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
