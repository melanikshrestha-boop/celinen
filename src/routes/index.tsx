import { createFileRoute, Link } from "@tanstack/react-router";
import { Footer, Nav } from "@/components/Nav";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lens OS — Local AI Photo Culling for RAW Shoots" },
      {
        name: "description",
        content:
          "Lens OS ranks a 300-frame RAW shoot in minutes, flags blur, exposure misses and duplicates, then hands you a Lightroom-style edit desk — all in your browser.",
      },
      { property: "og:title", content: "Lens OS — Local AI Photo Culling for RAW Shoots" },
      {
        property: "og:description",
        content:
          "Cull 300 shots in the time it takes to pour a second coffee. Local RAW culling, ranking and develop tools.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const steps = [
  ["01", "Ingest", "Drop 300 RAW or JPEG files. Embedded previews decode locally, nothing uploads."],
  ["02", "Score", "Focus, exposure and duplicate analysis on every frame, scored 0–99."],
  ["03", "Cull", "Keep or reject with K / X. Filter to keepers, flagged or still-to-review."],
  ["04", "Develop", "Exposure, contrast, WB, highlights, shadows, crop — then export."],
];

const flags = [
  ["Soft focus", "Laplacian variance per frame"],
  ["Underexposed", "Shadow-clip histogram read"],
  ["Blown highlights", "Upper-tail clip detection"],
  ["Near-duplicate", "8×8 perceptual hash match"],
];

function Index() {
  return (
    <div className="paper-tex min-h-screen w-full text-ink">
      <Nav />

      {/* HERO */}
      <section className="mx-auto max-w-[1240px] px-6 pb-10 pt-20">
        <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.25em] text-sun">
          <span className="size-1.5 animate-pulse rounded-full bg-rust" />
          runs offline · in-browser
        </span>
        <h1 className="mt-6 max-w-5xl font-display text-[clamp(2.8rem,8vw,6.5rem)] font-bold leading-[0.9] tracking-tight">
          Cull 300 shots
          <br />
          before the coffee
          <span className="text-rust"> goes cold.</span>
        </h1>
        <p className="mt-8 max-w-xl text-lg leading-relaxed text-moss">
          Drop in a full RAW/JPEG shoot. Lens OS ranks your keepers, flags soft focus, blown
          highlights and near-duplicates, then opens a develop desk for exposure, contrast, white
          balance and crop.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link
            to="/studio"
            className="glow-lime rounded-full bg-rust px-7 py-3.5 font-mono text-sm uppercase tracking-[0.12em] text-paper transition-transform hover:-translate-y-0.5"
          >
            Start culling
          </Link>
          <Link
            to="/"
            hash="workflow"
            className="rounded-full border border-input px-7 py-3.5 font-mono text-sm uppercase tracking-[0.12em] text-moss transition-colors hover:border-rust hover:text-rust"
          >
            See the workflow
          </Link>
        </div>

        <div className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
          {[
            ["300+", "frames per batch"],
            ["0", "uploads — fully local"],
            ["4", "auto-flag types"],
          ].map(([n, l]) => (
            <div key={l} className="bg-paper2/70 px-6 py-8">
              <div className="font-display text-4xl font-bold text-rust">{n}</div>
              <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
                {l}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* WORKFLOW */}
      <section id="workflow" className="mx-auto max-w-[1240px] px-6 py-20">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-sun">
          The culling workspace
        </span>
        <h2 className="mt-3 max-w-2xl font-display text-4xl font-bold tracking-tight md:text-5xl">
          Every frame ranked, then ready to edit
        </h2>

        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {steps.map(([n, t, d]) => (
            <div key={n} className="panel group p-6 transition-colors hover:border-rust/50">
              <div className="font-mono text-xs text-rust">{n}</div>
              <div className="mt-3 font-display text-xl font-bold">{t}</div>
              <p className="mt-2 text-sm leading-relaxed text-moss">{d}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="panel p-7 lg:col-span-2">
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-moss">
              What gets flagged
            </div>
            <ul className="mt-5 grid gap-px overflow-hidden rounded-xl bg-border sm:grid-cols-2">
              {flags.map(([t, d]) => (
                <li key={t} className="bg-paper2 px-5 py-4">
                  <div className="font-display text-base font-bold text-sun">{t}</div>
                  <div className="mt-1 font-mono text-[11px] text-moss">{d}</div>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-sm text-moss">
              No made-up “AI magic”: every score comes from a real measurement on your pixels, run
              locally in the browser.
            </p>
          </div>
          <div className="panel flex flex-col justify-between p-7">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-moss">
                Keyboard first
              </div>
              <div className="mt-5 flex flex-wrap gap-2 font-mono text-xs">
                {["K keep", "X reject", "U undo", "R reset", "← →"].map((k) => (
                  <span key={k} className="rounded-md border border-input px-3 py-1.5 text-moss">
                    {k}
                  </span>
                ))}
              </div>
            </div>
            <Link
              to="/studio"
              className="mt-8 block rounded-full bg-rust py-3 text-center font-mono text-xs uppercase tracking-[0.12em] text-paper transition-transform hover:-translate-y-0.5"
            >
              Open the studio
            </Link>
          </div>
        </div>
      </section>

      {/* PRICING TEASER */}
      <section className="mx-auto max-w-[1240px] px-6 pb-24">
        <div className="panel flex flex-col items-start justify-between gap-6 p-10 md:flex-row md:items-center">
          <div>
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-sun">
              Pricing · billed monthly
            </span>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight md:text-4xl">
              From $19/mo. Free for 14 days.
            </h2>
            <p className="mt-3 max-w-lg text-sm text-moss">
              Starter, Pro and Studio — priced by shoot volume, not per photo.
            </p>
          </div>
          <Link
            to="/pricing"
            className="rounded-full border border-input px-7 py-3.5 font-mono text-sm uppercase tracking-[0.12em] transition-colors hover:border-rust hover:text-rust"
          >
            See plans
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}
