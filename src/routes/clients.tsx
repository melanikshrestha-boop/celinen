import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card, Chip, SectionTitle, Shell } from "@/components/lensos/Shell";
import { useLens } from "@/lib/lensos-store";

export const Route = createFileRoute("/clients")({
  head: () => ({
    meta: [
      { title: "Clients — Lens OS" },
      {
        name: "description",
        content:
          "Client records with contacts, default templates and destinations, plus their events, open packages and last delivery. No CRM bloat.",
      },
      { property: "og:title", content: "Clients — Lens OS" },
      { property: "og:description", content: "Contacts, defaults, events, open packages, last delivery." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Clients,
});

function Clients() {
  const { clients, events, setActiveId } = useLens();
  const [open, setOpen] = useState(clients[0]?.id ?? "");
  const client = clients.find((c) => c.id === open);
  const theirEvents = events.filter((e) => e.clientId === open);

  return (
    <Shell>
      <SectionTitle
        kicker="Clients"
        title="Who the work is for, and what they expect by default."
        sub="Contacts, default template, default destination, and every event you have run for them."
      />

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="space-y-2">
          {clients.map((c) => (
            <button
              key={c.id}
              onClick={() => setOpen(c.id)}
              className={`block w-full rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 ${
                open === c.id ? "border-rust/50 bg-card" : "border-border bg-card"
              }`}
            >
              <p className="font-display text-[15px] font-semibold tracking-tight">{c.name}</p>
              <p className="text-[13px] text-moss">{c.org}</p>
            </button>
          ))}
        </div>

        {client && (
          <div className="space-y-4">
            <Card>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-moss">Contacts</p>
                  {client.contacts.map((c) => (
                    <p key={c.email} className="text-sm">
                      {c.name} · <span className="text-moss">{c.email}</span>
                    </p>
                  ))}
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-moss">Defaults</p>
                  <p className="text-sm">{client.template}</p>
                  <p className="text-sm text-moss">{client.destination}</p>
                </div>
              </div>
            </Card>

            <Card className="p-0">
              <p className="border-b border-border p-4 font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
                Events
              </p>
              {theirEvents.length === 0 && <p className="p-4 text-sm text-moss">No events yet.</p>}
              {theirEvents.map((e) => {
                const openPkgs = e.packages.filter((p) => p.state !== "delivered").length;
                const last = e.receipts[e.receipts.length - 1];
                return (
                  <button
                    key={e.id}
                    onClick={() => setActiveId(e.id)}
                    className="flex w-full flex-wrap items-center gap-2 border-b border-border p-4 text-left last:border-0 hover:bg-muted"
                  >
                    <span className="font-display text-[15px] font-semibold tracking-tight">{e.name}</span>
                    <Chip tone={e.status === "active" ? "accent" : e.status === "delivered" ? "solid" : "quiet"}>
                      {e.status}
                    </Chip>
                    <span className="ml-auto text-[13px] text-moss">
                      {openPkgs} open package{openPkgs === 1 ? "" : "s"} ·{" "}
                      {last ? `last delivery ${last.at}` : "no delivery yet"}
                    </span>
                  </button>
                );
              })}
            </Card>
          </div>
        )}
      </div>
    </Shell>
  );
}
