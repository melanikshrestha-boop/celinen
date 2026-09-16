import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Btn, Card, Chip, SectionTitle, Shell } from "@/components/lensos/Shell";
import { useLens } from "@/lib/lensos-store";

export const Route = createFileRoute("/business")({
  head: () => ({
    meta: [
      { title: "Business — Celinen Job Economics" },
      {
        name: "description",
        content:
          "Production facts Celinen can actually know, plus manual money fields. Unknown values stay blank — never a fake $0 profit.",
      },
      { property: "og:title", content: "Business — Celinen Job Economics" },
      {
        property: "og:description",
        content: "Selection rate, turnaround, work time, and profit per hour only when revenue and costs exist.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Business,
});

const MONEY_FIELDS = [
  ["agreedRevenue", "Agreed revenue", "Add revenue"],
  ["invoiced", "Invoiced", "Add invoice"],
  ["collected", "Collected", "Add payment"],
  ["estimatedCosts", "Estimated costs", "Add cost"],
  ["actualCosts", "Actual costs", "Add cost"],
] as const;

function Business() {
  const { active, setMoney } = useLens();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const m = active.money;
  const revenue = m.collected ?? m.invoiced ?? m.agreedRevenue;
  const costs = m.actualCosts ?? m.estimatedCosts;
  const hours = active.metrics.workMinutes / 60;
  const selectionRate = active.pickQueue.reviewed
    ? Math.round((active.pickQueue.selects / active.pickQueue.reviewed) * 100)
    : null;
  const delivered = active.packages.filter((p) => p.state === "delivered").length;

  const production = [
    ["Ingested", `${active.metrics.ingested} frames`],
    ["Reviewed", `${active.metrics.reviewed} frames`],
    ["Selection rate", selectionRate === null ? "—" : `${selectionRate}%`],
    ["Lightroom handoff", active.lightroom.handoff ? "done" : "not done"],
    ["Packages delivered", `${delivered} of ${active.packages.length}`],
    ["Active work time", hours ? `${hours.toFixed(1)} h` : "—"],
    [
      "Turnaround vs deadline",
      active.receipts.length ? "delivered before deadline" : "in progress",
    ],
  ];

  return (
    <Shell>
      <SectionTitle
        kicker="Business"
        title="Only what production can actually know."
        sub="Money is manual or imported and labelled as such. Unknown stays blank — never a fake zero."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">Production</p>
          <div className="mt-3 space-y-2">
            {production.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
                <span className="text-sm text-moss">{k}</span>
                <span className="font-mono text-[13px]">{v}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">Money</p>
            {m.source && <Chip>{m.source}</Chip>}
          </div>
          <div className="mt-3 space-y-2">
            {MONEY_FIELDS.map(([key, label, cta]) => {
              const val = m[key];
              return (
                <div key={key} className="flex items-center justify-between gap-2 border-b border-border pb-2 last:border-0">
                  <span className="text-sm text-moss">{label}</span>
                  {editing === key ? (
                    <span className="flex gap-2">
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        className="w-24 rounded-lg border border-input bg-card px-2 py-1 text-right font-mono text-[13px] outline-none"
                      />
                      <Btn
                        className="px-2 py-1 text-[12px]"
                        variant="primary"
                        onClick={() => {
                          const n = Number(draft);
                          if (!Number.isNaN(n) && draft.trim() !== "") setMoney({ [key]: n });
                          setEditing(null);
                          setDraft("");
                        }}
                      >
                        Save
                      </Btn>
                    </span>
                  ) : val === null ? (
                    <button
                      onClick={() => {
                        setEditing(key);
                        setDraft("");
                      }}
                      className="text-[13px] text-rust hover:underline"
                    >
                      {cta}
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setEditing(key);
                        setDraft(String(val));
                      }}
                      className="font-mono text-[13px]"
                    >
                      ${val.toLocaleString()}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-4 rounded-xl border border-border p-4">
            {revenue !== null && revenue !== undefined && costs !== null && costs !== undefined ? (
              <>
                <p className="font-display text-2xl font-semibold tracking-tight">
                  ${(revenue - costs).toLocaleString()}
                </p>
                <p className="text-[13px] text-moss">
                  profit · {hours ? `$${((revenue - costs) / hours).toFixed(0)} per work hour` : "work time unknown"}
                </p>
              </>
            ) : (
              <p className="text-[13px] text-moss">
                Profit appears once both revenue and costs exist. Nothing is guessed.
              </p>
            )}
          </div>
        </Card>
      </div>
    </Shell>
  );
}
