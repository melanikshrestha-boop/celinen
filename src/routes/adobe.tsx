import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Btn, Card, Chip, SectionTitle, Shell } from "@/components/lensos/Shell";
import { useLens } from "@/lib/lensos-store";
import { downloadLightroomPlugin } from "@/lib/lightroom-plugin";

export const Route = createFileRoute("/adobe")({
  head: () => ({
    meta: [
      { title: "Adobe Handoff — Lens OS" },
      {
        name: "description",
        content:
          "Write XMP and a manifest, describe the Lightroom collection set, import edited returns and resolve field-level conflicts without silent overwrite.",
      },
      { property: "og:title", content: "Adobe Handoff — Lens OS" },
      {
        property: "og:description",
        content: "Honest Lightroom and Photoshop handoff. Lightroom stays the develop authority.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Adobe,
});

const CONFLICTS = [
  { frame: "RDG_4460.NEF", field: "Caption", lens: "Goal line stand", lr: "Goal-line stand, Q4" },
  { frame: "RDG_4502.NEF", field: "Keywords", lens: "ridgeway, football", lr: "ridgeway, football, celebration" },
];

function Adobe() {
  const { active, handoff, importReturns } = useLens();
  const [log, setLog] = useState<string[]>([]);
  const [resolved, setResolved] = useState<Record<string, "lens" | "lr">>({});
  const [pkgId, setPkgId] = useState<string>(active.packages[0]?.id ?? "");
  const picks = active.picks.filter((p) => p.packageId);
  const targetPicks = active.picks.filter((p) => p.packageId === pkgId);

  const push = (line: string) => setLog((l) => [`${new Date().toLocaleTimeString()} · ${line}`, ...l]);

  const steps: [string, boolean, string][] = [
    ["Import Lightroom folder in the studio", active.sources.length > 0, "Studio → Lightroom folder (reads .xmp sidecars)"],
    ["Plugin installed and pushing", active.lightroom.returns > 0 || active.lightroom.handoff, "Library → Plug-in Extras → Push selection to Lens OS"],
    ["Picks rated and metadata approved", active.picks.some((p) => p.approved), "Metadata desk → approve"],
    ["Package created and filled", active.packages.length > 0 && picks.length > 0, "Packages → assign picks"],
    ["Edits synced back into the package", active.lightroom.returns > 0, "Import returns below, scoped to one package"],
  ];

  return (
    <Shell>
      <SectionTitle
        kicker="Adobe"
        title="Honest handoff. Lens OS does not edit your photos."
        sub="Lens OS writes XMP and a manifest. Lightroom stays the authority for develop and crop after handoff."
      />

      <Card className="mb-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
          One shoot, end to end
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-5">
          {steps.map(([label, done, how], i) => (
            <div
              key={label}
              className={`rounded-xl border p-3 ${done ? "border-rust bg-rust/5" : "border-border"}`}
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-moss">
                step {i + 1} {done ? "· done" : ""}
              </p>
              <p className="mt-1 text-sm">{label}</p>
              <p className="mt-1 text-[12px] text-moss">{how}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Card>
          <div className="flex flex-wrap gap-2">
            <Btn
              variant="primary"
              onClick={() => {
                handoff();
                push(`XMP written for ${picks.length} picks · ratings, labels, IPTC, captions, copyright, keywords`);
                push(`Manifest written · asset ids, pick/reject, paths, package membership`);
                push(`Collection set "${active.name}" · one collection per package`);
              }}
            >
              Prepare Lightroom handoff
            </Btn>
            <Btn
              onClick={() => {
                const endpoint = downloadLightroomPlugin();
                push(`Lens OS.lrplugin downloaded · bridge endpoint ${endpoint}`);
              }}
            >
              Download Lightroom plugin
            </Btn>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <select
              value={pkgId}
              onChange={(e) => setPkgId(e.target.value)}
              className="rounded-lg border border-input bg-card px-3 py-1.5 text-[13px] outline-none"
            >
              {active.packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <Btn
              className="px-3 py-1.5 text-[13px]"
              onClick={() => {
                importReturns(pkgId);
                const name = active.packages.find((p) => p.id === pkgId)?.name ?? "package";
                push(`Imported ${targetPicks.length} edited returns into ${name} · 2 field conflicts held for review`);
              }}
            >
              Import returns into package ({targetPicks.length})
            </Btn>
          </div>

          <div className="mt-5 space-y-3">
            {[
              ["Plugin push", "rating, colour label, pick flag, IPTC and develop settings → studio, live"],
              ["XMP sidecars", `ratings, labels, IPTC, caption, copyright, keywords for ${picks.length} picks`],
              ["Manifest", "asset id, pick/reject, source path, package membership"],
              ["Collection set", `${active.name} → one collection per package`],
              ["Develop authority", "Lightroom after handoff — Lens OS never rewrites develop settings"],
            ].map(([k, v]) => (
              <div key={k} className="border-b border-border pb-3 last:border-0 last:pb-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-moss">{k}</p>
                <p className="mt-0.5 text-sm text-moss">{v}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Chip tone={active.lightroom.handoff ? "solid" : "quiet"}>
              handoff {active.lightroom.handoff ? "done" : "not done"}
            </Chip>
            <Chip>{active.lightroom.returns} returns</Chip>
            <Chip tone={active.lightroom.conflicts ? "warn" : "quiet"}>
              {active.lightroom.conflicts} conflicts
            </Chip>
          </div>

          <p className="mt-4 text-[12px] text-moss">
            Lens OS never edits a .lrcat file. Sync happens through XMP sidecars, a manifest and the
            Lens OS Lightroom plugin — the same path Lightroom itself trusts.
          </p>
        </Card>


        <div className="space-y-4">
          {active.lightroom.conflicts > 0 && (
            <Card>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
                Field conflicts · never silently overwritten
              </p>
              <div className="mt-3 space-y-3">
                {CONFLICTS.map((c) => {
                  const key = `${c.frame}-${c.field}`;
                  return (
                    <div key={key} className="rounded-xl border border-border p-3">
                      <p className="font-mono text-[12px]">
                        {c.frame} · {c.field}
                      </p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <button
                          onClick={() => setResolved((r) => ({ ...r, [key]: "lens" }))}
                          className={`rounded-lg border p-2 text-left text-[13px] ${
                            resolved[key] === "lens" ? "border-rust bg-rust/8" : "border-input"
                          }`}
                        >
                          <span className="block font-mono text-[10px] uppercase text-moss">Lens OS</span>
                          {c.lens}
                        </button>
                        <button
                          onClick={() => setResolved((r) => ({ ...r, [key]: "lr" }))}
                          className={`rounded-lg border p-2 text-left text-[13px] ${
                            resolved[key] === "lr" ? "border-rust bg-rust/8" : "border-input"
                          }`}
                        >
                          <span className="block font-mono text-[10px] uppercase text-moss">Lightroom</span>
                          {c.lr}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <Card className="p-0">
            <p className="border-b border-border p-4 font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
              Handoff log
            </p>
            <div className="max-h-[260px] space-y-1 overflow-y-auto p-4 font-mono text-[11px] text-moss">
              {log.length === 0 && <p>Nothing written yet.</p>}
              {log.map((l) => (
                <p key={l}>{l}</p>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </Shell>
  );
}
