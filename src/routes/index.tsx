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

function Index() {
  return (
    <div className="flex min-h-screen w-full flex-col text-ink">
      <Nav />

      <section className="mx-auto flex w-full max-w-[1000px] flex-1 flex-col items-center px-6 pb-24 pt-24 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[12px] text-moss shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <span className="size-1.5 rounded-full bg-rust" />
          Local · RAW + JPEG
        </span>

        <h1 className="mt-8 font-display text-[clamp(2.6rem,7.5vw,5.5rem)] font-bold leading-[0.98] tracking-[-0.04em]">
          Cull your shoot
          <br />
          in <span className="text-rust">minutes</span>, not hours.
        </h1>

        <p className="mt-8 text-lg text-moss">Drop the folder in</p>

        <div className="mt-4 w-full max-w-[560px] rounded-xl bg-ink px-4 py-3.5 text-left shadow-[0_8px_30px_rgba(0,0,0,0.10)]">
          <code className="font-mono text-sm text-paper2">
            <span className="text-rust">$</span> 300 RAW files → 42 keepers
          </code>
        </div>

        <p className="mt-4 text-lg text-moss">and let it take it from there.</p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/studio"
            className="rounded-xl bg-ink px-6 py-3 text-sm font-medium text-paper2 transition-opacity hover:opacity-85"
          >
            Open studio →
          </Link>
          <Link
            to="/pricing"
            className="rounded-xl border border-input bg-card px-6 py-3 text-sm text-moss transition-colors hover:text-ink"
          >
            Pricing
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}
