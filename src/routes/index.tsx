import { createFileRoute, Link } from "@tanstack/react-router";
import { Footer, Nav } from "@/components/Nav";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lens OS — Cull a Shoot in Minutes" },
      {
        name: "description",
        content:
          "Lens OS scores, flags and culls a full RAW or JPEG shoot locally in your browser, then hands you the basic develop tools.",
      },
      { property: "og:title", content: "Lens OS — Cull a Shoot in Minutes" },
      {
        property: "og:description",
        content: "Score, cull and develop a full shoot locally. No uploads.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const TICKER = [
  "laplacian focus variance",
  "histogram clipping",
  "average-hash dedupe",
  "embedded raw preview",
  "keeper ranking",
  "local only · no uploads",
];

function Index() {
  return (
    <div className="flex min-h-screen w-full flex-col overflow-hidden text-ink">
      <Nav />

      <section className="mx-auto flex w-full max-w-[1000px] flex-1 flex-col items-center px-6 pb-24 pt-24 text-center">
        <span className="rise-in inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[12px] text-moss shadow-[0_1px_2px_rgba(0,0,0,0.04)] [animation-delay:0ms]">
          <span className="live-dot size-1.5 rounded-full bg-rust" />
          Local · RAW + JPEG
        </span>

        <h1 className="rise-in mt-8 font-display text-[clamp(2.6rem,7.5vw,5.5rem)] font-bold leading-[0.98] tracking-[-0.04em] [animation-delay:90ms]">
          Cull your shoot
          <br />
          in <span className="text-rust">minutes</span>, not hours.
        </h1>

        <p className="rise-in mt-8 text-lg text-moss [animation-delay:180ms]">Drop the folder in</p>

        <div className="rise-in relative mt-4 w-full max-w-[560px] overflow-hidden rounded-xl bg-ink px-4 py-3.5 text-left shadow-[0_8px_30px_rgba(0,0,0,0.10)] [animation-delay:240ms]">
          <div className="scanline pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-transparent via-paper2/8 to-transparent" />
          <code className="relative font-mono text-sm text-paper2">
            <span className="text-rust">$</span>{" "}
            <span className="type-line align-bottom">300 RAW files → 42 keepers</span>
            <span className="caret ml-0.5 h-[1.05em] align-[-0.15em]" />
          </code>
        </div>

        <p className="rise-in mt-4 text-lg text-moss [animation-delay:300ms]">
          and let it take it from there.
        </p>

        <div className="rise-in mt-10 flex flex-wrap items-center justify-center gap-3 [animation-delay:380ms]">
          <Link
            to="/studio"
            className="group rounded-xl bg-ink px-6 py-3 text-sm font-medium text-paper2 transition-all duration-200 hover:-translate-y-0.5 hover:opacity-90 hover:shadow-[0_10px_24px_rgba(0,0,0,0.16)]"
          >
            Open studio{" "}
            <span className="inline-block transition-transform duration-200 group-hover:translate-x-1">
              →
            </span>
          </Link>
          <Link
            to="/pricing"
            className="rounded-xl border border-input bg-card px-6 py-3 text-sm text-moss transition-all duration-200 hover:-translate-y-0.5 hover:text-ink"
          >
            Pricing
          </Link>
        </div>
      </section>

      <div className="rise-in relative w-full overflow-hidden border-y border-border bg-card/60 py-3 [animation-delay:460ms]">
        <div className="ticker-track gap-10 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
          {[...TICKER, ...TICKER].map((t, i) => (
            <span key={i} className="flex items-center gap-10">
              {t}
              <span className="size-1 rounded-full bg-rust/60" />
            </span>
          ))}
        </div>
      </div>

      <section className="mx-auto w-full max-w-[1000px] px-6 py-24">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">Integrations</p>
        <h2 className="mt-3 max-w-[720px] font-display text-[clamp(1.9rem,4.4vw,3.1rem)] font-bold leading-[1.02] tracking-[-0.035em]">
          Keeps your <span className="text-rust">Adobe</span> workflow. Kills the rest.
        </h2>
        <p className="mt-4 max-w-[560px] text-moss">
          Send keepers straight to Lightroom or Photoshop with edits intact. Everything else —
          the jargon-heavy gallery tools like Pixieset — you can stop paying for.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {[
            { k: "Lightroom Classic", v: "Keepers + develop settings, one click" },
            { k: "Photoshop", v: "Open the frame you flagged, full res" },
            { k: "Adobe Bridge", v: "Verdicts written as star ratings" },
          ].map((i, n) => (
            <div
              key={i.k}
              className="rise-in rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_14px_34px_rgba(0,0,0,0.08)]"
              style={{ animationDelay: `${n * 90}ms` }}
            >
              <p className="font-display text-[15px] font-semibold tracking-tight">{i.k}</p>
              <p className="mt-2 text-sm text-moss">{i.v}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1000px] px-6 pb-24">
        <div className="rounded-3xl border border-border bg-card p-8 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:p-12">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">Portfolio</p>
          <h2 className="mt-3 max-w-[720px] font-display text-[clamp(1.9rem,4.4vw,3.1rem)] font-bold leading-[1.02] tracking-[-0.035em]">
            Your site, live in <span className="text-rust">seconds</span>. Not minutes.
          </h2>
          <p className="mt-4 max-w-[560px] text-moss">
            Pick keepers, pick a layout, ship it. Domain generated for you — or bring your own.
          </p>

          <div className="mt-8 max-w-[520px] overflow-hidden rounded-xl bg-ink px-4 py-3.5 font-mono text-sm text-paper2">
            <span className="text-rust">$</span> publish →{" "}
            <span className="type-line align-bottom">maya-okafor.lens.photo</span>
            <span className="caret ml-0.5 h-[1.05em] align-[-0.15em]" />
          </div>

          <div className="mt-8 flex flex-wrap gap-2">
            {["Auto galleries", "Client proofing", "Free subdomain", "Custom domain", "No page builder"].map(
              (t) => (
                <span
                  key={t}
                  className="rounded-full border border-border px-3 py-1 text-[12px] text-moss transition-colors hover:border-rust/40 hover:text-ink"
                >
                  {t}
                </span>
              ),
            )}
          </div>
        </div>
      </section>

      <Footer />

    </div>
  );
}
