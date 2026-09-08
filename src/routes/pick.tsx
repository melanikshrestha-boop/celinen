import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, Chip, SectionTitle, Shell } from "@/components/lensos/Shell";
import { useLens } from "@/lib/lensos-store";

export const Route = createFileRoute("/pick")({
  head: () => ({
    meta: [
      { title: "Pick — LensLabs Cull Queue" },
      {
        name: "description",
        content: "Cull the card dump before a client ever sees a file.",
      },
      { property: "og:title", content: "Pick — LensLabs Cull Queue" },
      { property: "og:description", content: "Keep, reject, then send keepers only." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PickScreen,
});

function PickScreen() {
  const { active } = useLens();
  const q = active.pickQueue;
  const remaining = Math.max(0, q.total - q.reviewed);

  return (
    <Shell>
      <SectionTitle
        kicker="Pick"
        title="Pick"
        sub="Cull here. Client favorites come later, on keepers only."
      />

      <Card>
        <div className="grid gap-6 sm:grid-cols-4">
          {[
            { k: "In queue", v: q.total },
            { k: "Reviewed", v: q.reviewed },
            { k: "Selects", v: q.selects },
            { k: "Soft rejects", v: q.rejects },
          ].map((s) => (
            <div key={s.k}>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-moss">{s.k}</p>
              <p className="mt-1 font-display text-[28px] font-bold tracking-[-0.03em]">{s.v}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-rust transition-[width] duration-500"
            style={{ width: `${q.total ? (q.reviewed / q.total) * 100 : 0}%` }}
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            to="/studio"
            className="rounded-xl bg-ink px-5 py-2.5 text-sm font-medium text-paper2 transition-all hover:-translate-y-0.5"
          >
            Open Pick studio →
          </Link>
          <Chip>{remaining} frames left to review</Chip>
          <Chip>keyboard: K keep · X reject · U undo</Chip>
        </div>
      </Card>

      <p className="mt-4 text-[13px] text-moss">
        Reject is a soft reject. Originals are never modified or deleted by LensLabs.
      </p>
    </Shell>
  );
}
