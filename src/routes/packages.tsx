import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Btn, Card, Chip, SectionTitle, Shell } from "@/components/lensos/Shell";
import { useLens } from "@/lib/lensos-store";
import { PACKAGE_STATES, packageFill } from "@/lib/lensos";

export const Route = createFileRoute("/packages")({
  head: () => ({
    meta: [
      { title: "Packages — Celinen Deadline Sets" },
      {
        name: "description",
        content:
          "A package is a deadline set: target count, caption rules, export preset, destination and state from planned to delivered.",
      },
      { property: "og:title", content: "Packages — Celinen Deadline Sets" },
      {
        property: "og:description",
        content: "Assign picks, see shortfall vs target, validate before send.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Packages,
});

function Packages() {
  const { active, assignPicks, setPackageState, createPackage } = useLens();
  const [open, setOpen] = useState<string | null>(active.packages[0]?.id ?? null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", deadline: "", target: 20 });
  const [validation, setValidation] = useState<string[] | null>(null);

  const pkg = active.packages.find((p) => p.id === open) ?? null;
  const assigned = pkg ? active.picks.filter((p) => p.packageId === pkg.id) : [];
  const unassigned = active.picks.filter((p) => !p.packageId);

  const validate = () => {
    if (!pkg) return;
    const issues: string[] = [];
    const fill = packageFill(active, pkg);
    if (fill < pkg.target) issues.push(`${pkg.target - fill} selects short of target`);
    assigned
      .filter((p) => !p.fields['caption']?.value)
      .forEach((p) => issues.push(`${p.frame}: caption missing`));
    assigned.filter((p) => !p.approved).forEach((p) => issues.push(`${p.frame}: metadata not approved`));
    setValidation(issues);
  };

  return (
    <Shell>
      <SectionTitle
        kicker="Packages"
        title="A package is a deadline set, not a folder dump."
        sub="Target count, caption rules, preset, destination, recipient and state — all in one row."
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-3">
          {active.packages.map((p) => {
            const fill = packageFill(active, p);
            const short = Math.max(0, p.target - fill);
            return (
              <button
                key={p.id}
                onClick={() => {
                  setOpen(p.id);
                  setValidation(null);
                }}
                className={`block w-full rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 ${
                  open === p.id ? "border-rust/50 bg-card" : "border-border bg-card"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-[15px] font-semibold tracking-tight">{p.name}</span>
                  <Chip tone={p.state === "delivered" ? "solid" : "accent"}>{p.state}</Chip>
                </div>
                <p className="mt-1 text-[13px] text-moss">
                  {p.deadline} · {fill}/{p.target}{" "}
                  {short > 0 ? <span className="text-rust">({short} short)</span> : "(target met)"}
                </p>
              </button>
            );
          })}

          <Btn onClick={() => setCreating((c) => !c)} className="w-full">
            {creating ? "Cancel" : "Create package"}
          </Btn>

          {creating && (
            <Card>
              <div className="space-y-2">
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Package name"
                  className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none"
                />
                <input
                  value={form.deadline}
                  onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                  placeholder="Deadline (e.g. Tonight 23:30)"
                  className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none"
                />
                <input
                  type="number"
                  value={form.target}
                  onChange={(e) => setForm({ ...form, target: Number(e.target.value) })}
                  className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none"
                />
                <Btn
                  variant="primary"
                  disabled={!form.name.trim()}
                  onClick={() => {
                    createPackage({
                      name: form.name.trim(),
                      deadline: form.deadline || "TBD",
                      target: form.target,
                      requirements: ["Caption required"],
                      preset: "JPEG 3000px q85 sRGB",
                      destination: "Client gallery link",
                      recipient: "—",
                    });
                    setForm({ name: "", deadline: "", target: 20 });
                    setCreating(false);
                  }}
                >
                  Add package
                </Btn>
              </div>
            </Card>
          )}
        </div>

        {pkg && (
          <div className="space-y-4">
            <Card>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ["Deadline", pkg.deadline],
                  ["Target", `${pkg.target} frames`],
                  ["Preset", pkg.preset],
                  ["Destination", pkg.destination],
                  ["Recipient", pkg.recipient],
                  ["Requirements", pkg.requirements.join(" · ")],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-moss">{k}</p>
                    <p className="mt-0.5 text-sm">{v}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-moss">State</span>
                <select
                  value={pkg.state}
                  onChange={(e) => setPackageState(pkg.id, e.target.value as never)}
                  className="rounded-lg border border-input bg-card px-3 py-1.5 text-sm outline-none"
                >
                  {PACKAGE_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <Btn onClick={() => setPackageState(pkg.id, "selects ready")} className="px-3 py-1.5 text-[13px]">
                  Mark ready for Lightroom
                </Btn>
                <Btn variant="primary" onClick={validate} className="px-3 py-1.5 text-[13px]">
                  Validate before send
                </Btn>
              </div>

              {validation && (
                <div className="mt-4 rounded-xl border border-border p-4">
                  {validation.length === 0 ? (
                    <p className="text-sm text-rust">Validation passed. Ready for Send.</p>
                  ) : (
                    <ul className="space-y-1 text-sm text-moss">
                      {validation.map((v) => (
                        <li key={v}>· {v}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Card>

            <Card className="p-0">
              <p className="border-b border-border p-4 font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
                Assigned ({assigned.length})
              </p>
              <div className="max-h-[220px] overflow-y-auto">
                {assigned.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 border-b border-border px-4 py-2.5 last:border-0">
                    <span className="font-mono text-[12px]">{p.frame}</span>
                    {!p.approved && <Chip tone="warn">unapproved</Chip>}
                    <button
                      onClick={() => assignPicks([p.id], null)}
                      className="ml-auto text-[12px] text-moss hover:text-ink"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {assigned.length === 0 && <p className="p-4 text-sm text-moss">Nothing assigned yet.</p>}
              </div>
              {unassigned.length > 0 && (
                <div className="border-t border-border p-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
                    Unassigned picks
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {unassigned.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => assignPicks([p.id], pkg.id)}
                        className="rounded-lg border border-input px-2.5 py-1 font-mono text-[11px] text-moss hover:border-rust/50 hover:text-ink"
                      >
                        + {p.frame}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </Shell>
  );
}
