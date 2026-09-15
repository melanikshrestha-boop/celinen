import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Btn, Card, Chip, SectionTitle, Shell } from "@/components/lensos/Shell";
import { useLens } from "@/lib/lensos-store";
import { METADATA_FIELDS, SOURCE_LABELS } from "@/lib/lensos";

export const Route = createFileRoute("/metadata")({
  head: () => ({
    meta: [
      { title: "Metadata Desk — Celinen" },
      {
        name: "description",
        content:
          "Caption, IPTC, copyright, keywords and jersey data on your picks, with the origin of every field and explicit approval before write.",
      },
      { property: "og:title", content: "Metadata Desk — Celinen" },
      {
        property: "og:description",
        content: "Field-level provenance, batch apply with conflicts, approve, then write XMP.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MetadataDesk,
});

function MetadataDesk() {
  const { active, clients, setField, resolveSuggestion, approvePicks, applyTemplate } = useLens();
  const [sel, setSel] = useState<string[]>([]);
  const [focus, setFocus] = useState<string | null>(active.picks[0]?.id ?? null);
  const [wrote, setWrote] = useState(false);

  const picks = active.picks;
  const current = picks.find((p) => p.id === focus) ?? null;
  const client = clients.find((c) => c.id === active.clientId);
  const toggle = (id: string) =>
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const conflicts = sel.filter((id) => {
    const p = picks.find((x) => x.id === id);
    return p && p.fields['iptc']?.source === "manual";
  }).length;

  if (!picks.length) {
    return (
      <Shell>
        <SectionTitle kicker="Metadata" title="No picks on this event yet." sub="Run Pick first — the metadata desk only works on selects." />
      </Shell>
    );
  }

  return (
    <Shell>
      <SectionTitle
        kicker="Metadata"
        title="Picks only. RAW files never change."
        sub="Every field shows where it came from. A caption edited after approval must be approved again."
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <Card className="p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
            <Btn className="px-3 py-1.5 text-[13px]" onClick={() => setSel(picks.map((p) => p.id))}>
              Select all
            </Btn>
            <Btn className="px-3 py-1.5 text-[13px]" onClick={() => setSel([])}>
              Clear
            </Btn>
            <span className="ml-auto font-mono text-[11px] text-moss">{sel.length} selected</span>
          </div>

          <div className="max-h-[520px] overflow-y-auto">
            {picks.map((p) => (
              <div
                key={p.id}
                className={`flex items-center gap-3 border-b border-border px-4 py-3 last:border-0 ${
                  focus === p.id ? "bg-muted" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={sel.includes(p.id)}
                  onChange={() => toggle(p.id)}
                  className="size-4 accent-rust"
                />
                <button onClick={() => setFocus(p.id)} className="flex-1 text-left">
                  <span className="font-mono text-[12px]">{p.frame}</span>
                  <span className="ml-2 text-[12px] text-moss">
                    {p.fields['caption']?.value || "no caption"}
                  </span>
                </button>
                {p.suggestions.some((s) => s.status === "open") && <Chip tone="accent">suggestion</Chip>}
                <Chip tone={p.approved ? "solid" : "warn"}>{p.approved ? "approved" : "needs approval"}</Chip>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border p-4">
            <Btn
              disabled={!sel.length}
              onClick={() => applyTemplate(sel, client?.template ?? "Event template")}
              className="px-3 py-1.5 text-[13px]"
            >
              Apply {client?.template ?? "template"}
            </Btn>
            <Btn
              variant="primary"
              disabled={!sel.length}
              onClick={() => approvePicks(sel)}
              className="px-3 py-1.5 text-[13px]"
            >
              Approve {sel.length || ""} metadata
            </Btn>
            {sel.length > 0 && (
              <span className="font-mono text-[11px] text-moss">
                batch: {sel.length} frames · 2 fields changed ·{" "}
                {conflicts ? <span className="text-destructive">{conflicts} conflicts</span> : "no conflicts"}
              </span>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          {current && (
            <Card>
              <div className="flex items-center justify-between">
                <p className="font-mono text-[12px]">{current.frame}</p>
                <Chip tone={current.approved ? "solid" : "warn"}>
                  {current.approved ? "approved" : "needs approval"}
                </Chip>
              </div>

              <div className="mt-4 space-y-3">
                {METADATA_FIELDS.map((f) => {
                  const field = current.fields[f.key];
                  return (
                    <label key={f.key} className="block">
                      <span className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-moss">
                        <span>{f.label}</span>
                        <span className="text-rust">{SOURCE_LABELS[field?.source ?? "original"]}</span>
                      </span>
                      <input
                        value={field?.value ?? ""}
                        onChange={(e) => setField(current.id, f.key, e.target.value)}
                        className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:border-rust/50"
                      />
                    </label>
                  );
                })}
              </div>

              {current.suggestions.filter((s) => s.status === "open").length > 0 && (
                <div className="mt-4 rounded-xl border border-rust/30 bg-rust/5 p-4">
                  {current.suggestions
                    .filter((s) => s.status === "open")
                    .map((s) => (
                      <div key={s.field} className="flex flex-wrap items-center gap-2">
                        <span className="text-sm">
                          Suggested {s.field}: <strong>{s.value}</strong>{" "}
                          <span className="font-mono text-[11px] text-moss">
                            {Math.round(s.confidence * 100)}%
                          </span>
                        </span>
                        <span className="ml-auto flex gap-2">
                          <Btn
                            className="px-3 py-1 text-[13px]"
                            variant="primary"
                            onClick={() => resolveSuggestion(current.id, s.field, true)}
                          >
                            Accept
                          </Btn>
                          <Btn
                            className="px-3 py-1 text-[13px]"
                            onClick={() => resolveSuggestion(current.id, s.field, false)}
                          >
                            Reject
                          </Btn>
                        </span>
                      </div>
                    ))}
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <Btn variant="primary" onClick={() => approvePicks([current.id])}>
                  Approve metadata
                </Btn>
                <Btn
                  onClick={() => setWrote(true)}
                  disabled={!current.approved}
                >
                  Write XMP sidecar
                </Btn>
              </div>
              {wrote && (
                <p className="mt-3 font-mono text-[11px] text-moss">
                  Sidecar queued · {current.frame.replace(/\.[^.]+$/, ".xmp")} — original RAW untouched.
                </p>
              )}
            </Card>
          )}

          <Card>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">Approval state</p>
            <p className="mt-2 text-sm text-moss">
              {picks.filter((p) => p.approved).length} of {picks.length} picks approved. Packages will
              not validate until every assigned pick is approved.
            </p>
          </Card>
        </div>
      </div>
    </Shell>
  );
}
