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

      <section className="mx-auto flex w-full max-w-[900px] flex-1 flex-col items-center justify-center px-6 py-32 text-center">
        <h1 className="font-display text-[clamp(2.6rem,7vw,5rem)] font-medium leading-[1.02] tracking-tight">
          Cull a whole shoot.
        </h1>
        <p className="mt-6 max-w-md text-base leading-relaxed text-moss">
          Drop 300 RAW files in. Get your keepers out.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/studio"
            className="rounded-md bg-ink px-6 py-3 text-sm text-paper transition-opacity hover:opacity-85"
          >
            Open studio
          </Link>
          <Link
            to="/pricing"
            className="rounded-md border border-input px-6 py-3 text-sm text-moss transition-colors hover:text-ink"
          >
            Pricing
          </Link>
        </div>

        <div className="mt-20 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
          <span>Runs locally</span>
          <span>No uploads</span>
          <span>RAW + JPEG</span>
        </div>
      </section>

      <Footer />
    </div>
  );
}
