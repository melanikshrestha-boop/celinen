import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Btn, Card, Chip, SectionTitle, Shell } from "@/components/lensos/Shell";
import { useLens } from "@/lib/lensos-store";
import { packageFill } from "@/lib/lensos";

export const Route = createFileRoute("/send")({
  head: () => ({
    meta: [
      { title: "Send & Delivery — Lens OS" },
      {
        name: "description",
        content:
          "Preview exactly what will send, approve explicitly, emit one delivery receipt and create a new revision for corrections.",
      },
      { property: "og:title", content: "Send & Delivery — Lens OS" },
      {
        property: "og:description",
        content: "Nothing sends without approval. Every send emits a receipt.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Send,
});

function Send() {
  const { active, deliver, createGallery } = useLens();
  const [pkgId, setPkgId] = useState(active.packages[0]?.id ?? "");
  const [approved, setApproved] = useState(false);
  const [pin, setPin] = useState("");

  const pkg = active.packages.find((p) => p.id === pkgId);
  const files = pkg ? packageFill(active, pkg) : 0;
  const blockers = pkg
    ? active.picks.filter((p) => p.packageId === pkg.id && (!p.approved || !p.fields.caption?.value))
    : [];

  return (
    <Shell>
      <SectionTitle
        kicker="Send"
        title="Nothing leaves without your explicit approval."
        sub="Preview the exact payload, approve, send, and keep one immutable receipt per revision."
      />

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Card>
          <select
            value={pkgId}
            onChange={(e) => {
              setPkgId(e.target.value);
              setApproved(false);
            }}
            className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none"
          >
            {active.packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {active.packages.length === 0 && <option>No packages</option>}
          </select>

          {pkg && (
            <>
              <div className="mt-4 rounded-xl border border-border p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
                  What will send
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[
                    ["Recipient", pkg.recipient],
                    ["Destination", pkg.destination],
                    ["Files", `${files}`],
                    ["Preset", pkg.preset],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-moss">{k}</p>
                      <p className="text-sm">{v}</p>
                    </div>
                  ))}
                </div>
              </div>

              {blockers.length > 0 && (
                <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-moss">
                  {blockers.length} frame(s) blocked: metadata not approved or caption missing.
                </div>
              )}

              <label className="mt-4 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(e) => setApproved(e.target.checked)}
                  className="size-4 accent-rust"
                />
                I approve this delivery.
              </label>

              <Btn
                variant="primary"
                className="mt-3"
                disabled={!approved || blockers.length > 0 || files === 0}
                onClick={() => {
                  deliver(pkg.id, files);
                  setApproved(false);
                }}
              >
                Send {files} files
              </Btn>
            </>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
              Delivery receipts
            </p>
            {active.receipts.length === 0 && (
              <p className="mt-3 text-sm text-moss">No delivery yet on this event.</p>
            )}
            <div className="mt-3 space-y-3">
              {active.receipts.map((r) => (
                <div key={r.id} className="rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[12px]">
                      {active.packages.find((p) => p.id === r.packageId)?.name ?? r.packageId}
                    </span>
                    <Chip tone="solid">rev {r.revision}</Chip>
                  </div>
                  <p className="mt-1 text-[13px] text-moss">
                    {r.at} · {r.files} files → {r.recipient} ({r.destination})
                  </p>
                  <p className="font-mono text-[11px] text-moss">{r.preset}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[12px] text-moss">
              A correction creates a new revision. Old receipts are never rewritten.
            </p>
          </Card>

          <Card>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
              Client gallery
            </p>
            {active.gallery.link ? (
              <div className="mt-3">
                <p className="font-mono text-sm">{active.gallery.link}</p>
                <p className="mt-1 text-[13px] text-moss">
                  {active.gallery.pin ? `PIN ${active.gallery.pin}` : "no PIN"} ·{" "}
                  {active.gallery.favorites} client favorites returned to the event
                </p>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Optional PIN"
                  className="rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none"
                />
                <Btn onClick={() => createGallery(pin || null)}>Create share link</Btn>
              </div>
            )}
          </Card>
        </div>
      </div>
    </Shell>
  );
}
