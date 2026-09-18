import { createFileRoute, Link } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import "@/components/marketing/marketing-page.css";

export const Route = createFileRoute("/latch")({
  head: () => ({
    meta: [
      { title: "Latch (TBD) — lenslab.dev" },
      {
        name: "description",
        content:
          "Latch (name TBD): long video in, ranked, captioned, reframed clips out. A Lenslab product separate from Celinen.",
      },
      { property: "og:title", content: "Latch (TBD) — lenslab.dev" },
    ],
  }),
  component: LatchPage,
});

function LatchPage() {
  return (
    <div className="marketing-page">
      <Nav landing />
      <main id="main-content" className="mx-auto max-w-3xl px-6 py-20" tabIndex={-1}>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
          Lenslab · separate product
        </p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          Latch <span className="text-moss">(TBD)</span>
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-moss">
          Long video in. Ranked, captioned, reframed, ready-to-post clips out. Built as its own
          product — not part of Celinen — for creators who cut vlogs and shorts from long source
          footage.
        </p>
        <ul className="mt-8 space-y-2 font-mono text-[13px] text-ink">
          <li>· Clip ranking with readable virality scores</li>
          <li>· Auto-reframe for 9:16 / 1:1 / 16:9</li>
          <li>· Word-timed captions and cleanup</li>
          <li>· Self-host or run as a service (MIT)</li>
        </ul>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <a
            className="marketing-action marketing-action--primary"
            href="https://latch.lenslab.dev"
            rel="noreferrer"
          >
            Open Latch demo
            <span aria-hidden="true">→</span>
          </a>
          <a
            className="marketing-action"
            href="https://github.com/melanikshrestha-boop/latchcut"
            rel="noreferrer"
          >
            Source on GitHub
          </a>
          <Link to="/" className="marketing-action">
            Back to lenslab.dev
          </Link>
        </div>
        <p className="mt-8 font-mono text-[11px] text-moss">
          Product name is TBD. Demo deploys from the Latchcut <code>apps/web</code> Next.js app
          (browser demo mode when no API is configured).
        </p>
      </main>
      <MarketingFooter />
    </div>
  );
}
