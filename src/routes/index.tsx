import { createFileRoute, Link } from "@tanstack/react-router";
import { Footer, Nav } from "@/components/Nav";
import { Fade } from "@/components/Fade";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LensLabs — Cull a Shoot in Minutes" },
      {
        name: "description",
        content:
          "LensLabs scores, flags and culls a full RAW or JPEG shoot locally in your browser, then hands you the basic develop tools.",
      },
      { property: "og:title", content: "LensLabs — Cull a Shoot in Minutes" },
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

const ADOBE = [
  {
    k: "Lightroom Classic",
    mark: "Lr",
    bg: "oklch(0.28 0.09 265)",
    fg: "oklch(0.82 0.16 240)",
    v: "Keepers + develop settings",
  },
  {
    k: "Photoshop",
    mark: "Ps",
    bg: "oklch(0.26 0.08 250)",
    fg: "oklch(0.80 0.14 235)",
    v: "Open flagged frame, full res",
  },
  {
    k: "Adobe Bridge",
    mark: "Br",
    bg: "oklch(0.27 0.07 285)",
    fg: "oklch(0.82 0.12 290)",
    v: "Verdicts as star ratings",
  },
];

const REPLACED = [
  { name: "Pixieset", domain: "pixieset.com", usd: 40 },
  { name: "SmugMug", domain: "smugmug.com", usd: 15 },
  { name: "Photo Mechanic", domain: "camerabits.com", usd: 12 },
  { name: "Squarespace", domain: "squarespace.com", usd: 23 },
  { name: "Pic-Time", domain: "pic-time.com", usd: 20 },
  { name: "Narrative Select", domain: "narrative.so", usd: 20 },
];

const REPLACED_TOTAL = REPLACED.reduce((s, r) => s + r.usd, 0);

const logoFor = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

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
          in <span className="text-rust">seconds</span>, not minutes.
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
          and let it take it from there. Go create more.
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

      <Fade as="section" className="mx-auto w-full max-w-[1000px] px-6 py-24">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">Integrations</p>
        <h2 className="mt-3 max-w-[720px] font-display text-[clamp(1.9rem,4.4vw,3.1rem)] font-bold leading-[1.02] tracking-[-0.035em]">
          Plugs into <span className="text-rust">Adobe</span>. Replaces the rest.
        </h2>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {ADOBE.map((i, n) => (
            <div
              key={i.k}
              className="rise-in group flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_14px_34px_rgba(0,0,0,0.08)]"
              style={{ animationDelay: `${n * 90}ms` }}
            >
              <span
                className="grid size-12 shrink-0 place-items-center rounded-xl font-display text-[17px] font-bold transition-transform duration-200 group-hover:scale-105"
                style={{ background: i.bg, color: i.fg, border: `1px solid ${i.fg}33` }}
              >
                {i.mark}
              </span>
              <span>
                <span className="block font-display text-[15px] font-semibold tracking-tight">
                  {i.k}
                </span>
                <span className="mt-0.5 block text-sm text-moss">{i.v}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-moss">
              Replaces — the average stack a photographer pays for
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {REPLACED.map((r) => (
                <span
                  key={r.name}
                  className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1 text-[13px] text-moss"
                >
                  <img
                    src={logoFor(r.domain)}
                    alt={`${r.name} logo`}
                    width={16}
                    height={16}
                    loading="lazy"
                    className="size-4 rounded-[3px]"
                  />
                  <span className="line-through decoration-rust/60">{r.name}</span>
                  <span className="font-mono text-[11px] text-moss/70">${r.usd}/mo</span>
                </span>
              ))}
            </div>
            <p className="mt-3 font-mono text-[11px] text-moss">
              ≈ ${REPLACED_TOTAL}/mo across {REPLACED.length} subscriptions
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-ink p-5 text-paper2">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper2/60">
              One tool
            </p>
            <p className="mt-3 font-display text-[19px] font-semibold tracking-tight">
              Cull → develop → gallery → site.
            </p>
            <p className="mt-1 text-sm text-paper2/70">
              No jargon, no {REPLACED.length} subscriptions.
            </p>
          </div>
        </div>
      </Fade>


      <Fade as="section" className="mx-auto w-full max-w-[1000px] px-6 pb-24">
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
      </Fade>

      <Footer />

    </div>
  );
}
