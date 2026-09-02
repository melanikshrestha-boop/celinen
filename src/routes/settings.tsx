import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Btn, Card, Chip, SectionTitle, Shell } from "@/components/lensos/Shell";
import { useLens } from "@/lib/lensos-store";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — LensLabs" },
      {
        name: "description",
        content:
          "Default metadata templates, export destinations, local-first privacy, Lightroom plugin status and the full keyboard reference.",
      },
      { property: "og:title", content: "Settings — LensLabs" },
      { property: "og:description", content: "Templates, destinations, privacy, plugin status, shortcuts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Settings,
});

const KEYS = [
  ["K", "Keep / pick"],
  ["X", "Soft reject"],
  ["U", "Undo last verdict"],
  ["← →", "Previous / next frame"],
  ["⌘K", "Command palette"],
  ["R", "Reset develop"],
];

function Settings() {
  const { clients } = useLens();
  const [plugin, setPlugin] = useState(true);

  return (
    <Shell>
      <SectionTitle
        kicker="Settings"
        title="Defaults, privacy, plugin, shortcuts."
        sub="No billing product, no team permissions, no video editor."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">Default templates</p>
          <div className="mt-3 space-y-2">
            {clients.map((c) => (
              <div key={c.id} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
                <span className="text-sm">{c.name}</span>
                <span className="font-mono text-[12px] text-moss">{c.template}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">Export destinations</p>
          <div className="mt-3 space-y-2">
            {clients.map((c) => (
              <div key={c.id} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
                <span className="text-sm">{c.name}</span>
                <span className="font-mono text-[12px] text-moss">{c.destination}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">Privacy · local first</p>
          <p className="mt-3 text-sm text-moss">
            Originals are read-only. Reject is a soft reject and never deletes a file. Frames are decoded
            in your browser; nothing uploads until you approve a delivery.
          </p>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
              Lightroom plugin
            </p>
            <Chip tone={plugin ? "solid" : "warn"}>{plugin ? "connected" : "disconnected"}</Chip>
          </div>
          <p className="mt-3 text-sm text-moss">
            Version 1.4 · watches the handoff folder, writes XMP, reads edited returns.
          </p>
          <Btn className="mt-3" onClick={() => setPlugin((p) => !p)}>
            {plugin ? "Disconnect" : "Connect plugin"}
          </Btn>
        </Card>

        <Card className="lg:col-span-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">Keyboard reference</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {KEYS.map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <kbd className="rounded-md border border-input bg-muted px-2 py-0.5 font-mono text-[12px]">{k}</kbd>
                <span className="text-[13px] text-moss">{v}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Shell>
  );
}
