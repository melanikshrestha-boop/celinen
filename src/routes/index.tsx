import { createFileRoute, Link } from "@tanstack/react-router";
import { Footer, Nav } from "@/components/Nav";
import keeperImg from "@/assets/frame-keeper.jpg";
import blinkImg from "@/assets/frame-blink.jpg";
import loupeImg from "@/assets/frame-loupe.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lens OS — AI Photo Culling for RAW Shoots" },
      {
        name: "description",
        content:
          "Lens OS ranks a 300-frame RAW shoot in minutes, flags blur, exposure misses and duplicates, then hands you a Lightroom-style edit desk.",
      },
      { property: "og:title", content: "Lens OS — AI Photo Culling for RAW Shoots" },
      {
        property: "og:description",
        content:
          "Cull 300 shots in the time it takes to pour a second coffee. Local RAW culling, ranking and basic develop tools.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="paper-tex min-h-screen w-full text-ink">
      <Nav />

      {/* HERO */}
      <section className="mx-auto grid max-w-[1240px] items-center gap-8 px-6 pb-8 pt-14 lg:grid-cols-12">
        <div className="relative lg:col-span-7">
          <span className="inline-block font-mono text-[11px] uppercase tracking-[0.25em] text-rust">
            Auto-cull · rank · edit
          </span>
          <h1 className="mt-4 font-display text-[clamp(2.6rem,6vw,5rem)] font-semibold leading-[0.95] tracking-tight">
            Cull 300 shots in the time it takes to pour a{" "}
            <span className="italic text-rust">second coffee.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-moss">
            Drop in a full RAW/JPEG shoot. Lens OS ranks your keepers, flags soft focus, blown
            highlights and near-duplicates, then opens a Lightroom-style desk for exposure, contrast,
            white balance and crop.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              to="/studio"
              className="rounded-full bg-rust px-6 py-3 font-mono text-sm uppercase tracking-[0.12em] text-paper2 transition-colors hover:bg-ink"
            >
              Start culling
            </Link>
            <Link
              to="/"
              hash="workflow"
              className="font-mono text-sm uppercase tracking-[0.12em] underline decoration-moss underline-offset-4"
            >
              See the workflow
            </Link>
          </div>
          <div className="mt-10 flex gap-6 font-mono text-xs text-ink/70">
            <div>
              <span className="block font-display text-lg font-bold text-ink">300+</span>frames per
              batch
            </div>
            <div className="border-l border-border pl-6">
              <span className="block font-display text-lg font-bold text-ink">0</span>uploads — runs
              locally
            </div>
            <div className="border-l border-border pl-6">
              <span className="block font-display text-lg font-bold text-rust">4</span>auto-flag
              types
            </div>
          </div>
        </div>

        {/* collage */}
        <div className="relative h-[420px] lg:col-span-5">
          <span className="tape left-10 top-2 -rotate-6" />
          <div className="torn wig-a absolute left-0 top-4 w-56 bg-paper2 p-3 shadow-xl">
            <img
              src={keeperImg}
              alt="Sharp candid wedding portrait marked as a keeper"
              width={512}
              height={640}
              className="aspect-[4/5] w-full object-cover"
            />
            <div className="mt-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
              <span>IMG_2048.NEF</span>
              <span className="rounded-full bg-moss px-2 py-0.5 text-paper2">keeper · 94</span>
            </div>
          </div>
          <div className="torn wig-b absolute right-0 top-20 w-52 bg-paper2 p-3 shadow-xl">
            <img
              src={blinkImg}
              alt="Soft, out of focus wedding guest portrait flagged by Lens OS"
              width={512}
              height={640}
              loading="lazy"
              className="aspect-[4/5] w-full object-cover"
            />
            <div className="mt-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
              <span>IMG_2071.NEF</span>
              <span className="rounded-full bg-rust px-2 py-0.5 text-paper2">soft</span>
            </div>
          </div>
          <div className="torn absolute bottom-0 left-10 w-44 -rotate-2 bg-mist/50 p-3 shadow-lg">
            <div className="font-mono text-[10px] uppercase tracking-wider">Auto-flagged</div>
            <div className="mt-1 font-display text-4xl font-semibold">9</div>
            <div className="mt-1 font-mono text-[10px] text-moss">
              blur · 4&nbsp;&nbsp;dup · 3&nbsp;&nbsp;expo · 2
            </div>
          </div>
        </div>
      </section>

      {/* WORKFLOW / WORKSPACE PREVIEW */}
      <section id="workflow" className="mx-auto max-w-[1240px] px-6 pb-4 pt-8">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-rust">
              The culling workspace
            </span>
            <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight">
              Every frame, ranked &amp; ready to edit
            </h2>
          </div>
          <span className="hidden font-mono text-xs text-moss md:block">
            Runs in your browser · RAW previews read locally
          </span>
        </div>

        <div className="torn bg-paper2 p-4 shadow-2xl md:p-6">
          <div className="grid gap-5 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <img
                src={loupeImg}
                alt="Bride at golden hour open in the Lens OS loupe"
                width={1024}
                height={1024}
                loading="lazy"
                className="aspect-square w-full object-cover"
              />
              <div className="mt-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
                <span>IMG_2048.NEF · 1/200 · f/2.8</span>
                <span className="rounded-full bg-moss px-2 py-0.5 text-paper2">keeper · 94</span>
              </div>
            </div>
            <div className="lg:col-span-5">
              <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-moss">
                How a batch runs
              </div>
              <ol className="flex flex-col gap-2">
                {[
                  ["01 · Ingest", "Drop 300 RAW or JPEG files. Embedded previews decode locally."],
                  ["02 · Score", "Focus, exposure and duplicate analysis on every frame, 0–99."],
                  ["03 · Cull", "Keep or reject with K / X. Filter to keepers or flagged only."],
                  ["04 · Develop", "Exposure, contrast, WB, highlights, shadows, crop — then export."],
                ].map(([t, d]) => (
                  <li key={t} className="torn bg-paper2 p-3 shadow">
                    <div className="font-mono text-[11px] text-rust">{t}</div>
                    <div className="mt-1 text-sm text-moss">{d}</div>
                  </li>
                ))}
              </ol>
              <Link
                to="/studio"
                className="mt-4 block rounded-full bg-ink py-3 text-center font-mono text-xs uppercase tracking-[0.12em] text-paper2 transition-colors hover:bg-rust"
              >
                Open the studio
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="mx-auto max-w-[1240px] px-6 pb-24 pt-16">
        <div className="mb-12 text-center">
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-rust">
            Pricing · billed monthly
          </span>
          <h2 className="mt-3 font-display text-4xl font-semibold tracking-tight md:text-5xl">
            Pick your darkroom
          </h2>
        </div>
        <div className="grid items-start gap-6 md:grid-cols-3">
          <div className="torn wig-a bg-paper2 p-7 shadow-lg">
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-moss">Starter</div>
            <div className="mt-3 font-display text-5xl font-semibold">
              $19<small className="font-mono text-base text-moss">/mo</small>
            </div>
            <ul className="mt-6 space-y-3 font-mono text-[12px] text-ink/80">
              <li>· 5 shoots / month</li>
              <li>· Auto-cull up to 200 shots</li>
              <li>· Blur, exposure &amp; dup flags</li>
              <li>· Basic edit desk</li>
              <li>· 5 GB cloud backup</li>
            </ul>
            <Link
              to="/pricing"
              className="mt-7 block rounded-full border border-input py-3 text-center font-mono text-xs uppercase tracking-[0.12em] transition-colors hover:bg-ink hover:text-paper2"
            >
              Start free 14 days
            </Link>
          </div>

          <div className="relative -mt-4 md:-mt-8">
            <span className="tape left-1/2 top-2 -translate-x-1/2 rotate-3" />
            <div className="torn wig-b bg-ink p-8 text-paper2 shadow-2xl">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-sun">Pro</span>
                <span className="rounded-full bg-sun px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink">
                  most picked
                </span>
              </div>
              <div className="mt-3 font-display text-5xl font-semibold">
                $49<small className="font-mono text-base text-sun">/mo</small>
              </div>
              <ul className="mt-6 space-y-3 font-mono text-[12px] text-paper2/85">
                <li>· Unlimited shoots</li>
                <li>· Auto-cull up to 2,000 shots</li>
                <li>· Full culling + ranked keepers</li>
                <li>· Full edit desk + presets</li>
                <li>· 100 GB cloud backup</li>
                <li>· RAW / TIFF export</li>
              </ul>
              <Link
                to="/pricing"
                className="mt-7 block rounded-full bg-rust py-3 text-center font-mono text-xs uppercase tracking-[0.12em] text-paper2 transition-colors hover:bg-paper2 hover:text-ink"
              >
                Choose Pro
              </Link>
            </div>
          </div>

          <div className="torn wig-a bg-mist/50 p-7 shadow-lg">
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-moss">Studio</div>
            <div className="mt-3 font-display text-5xl font-semibold">
              $129<small className="font-mono text-base text-moss">/mo</small>
            </div>
            <ul className="mt-6 space-y-3 font-mono text-[12px] text-ink/80">
              <li>· Everything in Pro</li>
              <li>· 5 seats + client review links</li>
              <li>· Batch export &amp; handoff</li>
              <li>· Team presets &amp; styles</li>
              <li>· 1 TB cloud backup</li>
              <li>· Priority support</li>
            </ul>
            <Link
              to="/pricing"
              className="mt-7 block rounded-full border border-input py-3 text-center font-mono text-xs uppercase tracking-[0.12em] transition-colors hover:bg-ink hover:text-paper2"
            >
              Talk to us
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
