import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Btn, Card, SectionTitle, Shell } from "@/components/lensos/Shell";
import {
  listMyPackages,
  savePackage,
  deletePackage,
  saveStudioProfile,
  type PackageInput,
} from "@/lib/rates.functions";
import { getProfile } from "@/lib/finance.functions";

export const Route = createFileRoute("/rates")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Rates and packages — Celinen" },
      {
        name: "description",
        content:
          "Set your own shoot rates and packages once. Clients see the same card in their portal before they book.",
      },
      { property: "og:title", content: "Rates and packages — Celinen" },
      {
        property: "og:description",
        content: "Your prices, published to every client portal in one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Rates,
});

type Pkg = Awaited<ReturnType<typeof listMyPackages>>[number];

const blank: PackageInput = {
  title: "",
  blurb: "",
  price: 0,
  unit: "flat",
  duration: "",
  deliverables: "",
  turnaround: "",
  published: true,
};

const field =
  "mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-[16px] text-ink outline-none focus:border-rust sm:py-2 sm:text-[14px]";

const money = (n: number, c = "usd") =>
  Number(n).toLocaleString(undefined, {
    style: "currency",
    currency: c.toUpperCase(),
    maximumFractionDigits: 0,
  });

function Rates() {
  const [rows, setRows] = useState<Pkg[]>([]);
  const [draft, setDraft] = useState<PackageInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [studio, setStudio] = useState({
    studio_name: "",
    city: "",
    specialty: "",
    bio: "",
    travel_note: "",
    booking_note: "",
  });
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const [pkgs, profile] = await Promise.all([listMyPackages(), getProfile()]);
    setRows(pkgs);
    if (profile) {
      setStudio({
        studio_name: profile.studio_name ?? "",
        city: profile.city ?? "",
        specialty: profile.specialty ?? "",
        bio: profile.bio ?? "",
        travel_note: profile.travel_note ?? "",
        booking_note: profile.booking_note ?? "",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const commit = async () => {
    if (!draft) return;
    setBusy(true);
    setErr(null);
    const res = await savePackage({ data: { ...draft, price: Number(draft.price) || 0 } });
    setBusy(false);
    if ("error" in res && res.error) return setErr(res.error);
    setDraft(null);
    await load();
  };

  const remove = async (id: string) => {
    await deletePackage({ data: { id } });
    await load();
  };

  const saveStudio = async () => {
    setBusy(true);
    const res = await saveStudioProfile({ data: studio });
    setBusy(false);
    if ("error" in res && res.error) return setErr(res.error);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Shell>
      <SectionTitle
        kicker="Rates"
        title="Your prices, written once."
        sub="Every published package shows up in your clients' portal before they ask what you charge."
      />

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        {/* packages */}
        <Card>
          <div className="flex items-center gap-3">
            <h3 className="font-display text-[15px] font-semibold">Shoot packages</h3>
            <Btn className="ml-auto" onClick={() => setDraft({ ...blank })}>
              New package
            </Btn>
          </div>

          {rows.length === 0 && !draft && (
            <p className="mt-4 text-[13px] text-moss">
              Nothing published yet. Add your first package — half day, full day, whatever you
              actually sell.
            </p>
          )}

          <div className="mt-4 space-y-2">
            {rows.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-[14.5px] font-medium">{p.title}</p>
                  <p className="truncate text-[12.5px] text-moss">
                    {[p.duration, p.deliverables, p.turnaround].filter(Boolean).join(" · ") ||
                      p.blurb ||
                      "—"}
                  </p>
                </div>
                <span className="ml-auto font-mono text-[14px]">
                  {money(Number(p.price), p.currency)}
                  <span className="text-[11px] text-moss">
                    {p.unit === "hour" ? " / hr" : p.unit === "day" ? " / day" : ""}
                  </span>
                </span>
                {!p.published && (
                  <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-moss">
                    hidden
                  </span>
                )}
                <button
                  onClick={() =>
                    setDraft({
                      id: p.id,
                      title: p.title,
                      blurb: p.blurb ?? "",
                      price: Number(p.price),
                      unit: p.unit,
                      duration: p.duration ?? "",
                      deliverables: p.deliverables ?? "",
                      turnaround: p.turnaround ?? "",
                      published: p.published,
                    })
                  }
                  className="rounded-lg border border-input px-2.5 py-1 text-[12.5px] hover:bg-muted"
                >
                  Edit
                </button>
                <button
                  onClick={() => void remove(p.id)}
                  className="rounded-lg px-2 py-1 text-[12.5px] text-moss hover:text-destructive"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>

          {draft && (
            <div className="mt-4 grid gap-3 rounded-xl border border-border bg-background p-4 sm:grid-cols-2">
              <label className="text-[12px] text-moss">
                Package name
                <input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="Game day — full match"
                  className={field}
                />
              </label>
              <label className="text-[12px] text-moss">
                Price
                <input
                  value={String(draft.price)}
                  onChange={(e) =>
                    setDraft({ ...draft, price: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 })
                  }
                  inputMode="decimal"
                  className={field}
                />
              </label>
              <label className="text-[12px] text-moss">
                Billed as
                <select
                  value={draft.unit}
                  onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                  className={field}
                >
                  <option value="flat">Flat rate</option>
                  <option value="hour">Per hour</option>
                  <option value="day">Per day</option>
                </select>
              </label>
              <label className="text-[12px] text-moss">
                Duration
                <input
                  value={draft.duration ?? ""}
                  onChange={(e) => setDraft({ ...draft, duration: e.target.value })}
                  placeholder="Up to 4 hours"
                  className={field}
                />
              </label>
              <label className="text-[12px] text-moss">
                Deliverables
                <input
                  value={draft.deliverables ?? ""}
                  onChange={(e) => setDraft({ ...draft, deliverables: e.target.value })}
                  placeholder="40 edited frames, full gallery"
                  className={field}
                />
              </label>
              <label className="text-[12px] text-moss">
                Turnaround
                <input
                  value={draft.turnaround ?? ""}
                  onChange={(e) => setDraft({ ...draft, turnaround: e.target.value })}
                  placeholder="Same night"
                  className={field}
                />
              </label>
              <label className="text-[12px] text-moss sm:col-span-2">
                One line for the client
                <input
                  value={draft.blurb ?? ""}
                  onChange={(e) => setDraft({ ...draft, blurb: e.target.value })}
                  placeholder="Sideline coverage, both halves, files before you're off the field."
                  className={field}
                />
              </label>
              <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
                <input
                  type="checkbox"
                  checked={draft.published !== false}
                  onChange={(e) => setDraft({ ...draft, published: e.target.checked })}
                />
                Show this in client portals
              </label>
              {err && <p className="text-[13px] text-destructive sm:col-span-2">{err}</p>}
              <div className="flex gap-2 sm:col-span-2">
                <Btn onClick={() => void commit()} disabled={busy}>
                  {busy ? "Saving…" : "Save package"}
                </Btn>
                <button
                  onClick={() => setDraft(null)}
                  className="rounded-lg border border-input px-3 py-1.5 text-[13px] hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Card>

        {/* studio profile */}
        <Card>
          <h3 className="font-display text-[15px] font-semibold">Your profile</h3>
          <p className="mt-1 text-[12.5px] text-moss">
            This sits above your rates in every client portal.
          </p>
          <div className="mt-4 grid gap-3">
            <label className="text-[12px] text-moss">
              Studio name
              <input
                value={studio.studio_name}
                onChange={(e) => setStudio({ ...studio, studio_name: e.target.value })}
                className={field}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-[12px] text-moss">
                Based in
                <input
                  value={studio.city}
                  onChange={(e) => setStudio({ ...studio, city: e.target.value })}
                  placeholder="Ann Arbor, MI"
                  className={field}
                />
              </label>
              <label className="text-[12px] text-moss">
                Specialty
                <input
                  value={studio.specialty}
                  onChange={(e) => setStudio({ ...studio, specialty: e.target.value })}
                  placeholder="College sports"
                  className={field}
                />
              </label>
            </div>
            <label className="text-[12px] text-moss">
              Short bio
              <textarea
                value={studio.bio}
                onChange={(e) => setStudio({ ...studio, bio: e.target.value })}
                rows={3}
                className={field}
              />
            </label>
            <label className="text-[12px] text-moss">
              Travel
              <input
                value={studio.travel_note}
                onChange={(e) => setStudio({ ...studio, travel_note: e.target.value })}
                placeholder="Free within 40 miles, $0.65/mi after."
                className={field}
              />
            </label>
            <label className="text-[12px] text-moss">
              Booking terms
              <input
                value={studio.booking_note}
                onChange={(e) => setStudio({ ...studio, booking_note: e.target.value })}
                placeholder="50% holds the date, balance due on delivery."
                className={field}
              />
            </label>
            <div className="flex items-center gap-3">
              <Btn onClick={() => void saveStudio()} disabled={busy}>
                {busy ? "Saving…" : "Save profile"}
              </Btn>
              {saved && <span className="text-[12.5px] text-moss">Saved.</span>}
            </div>
          </div>
        </Card>
      </div>
    </Shell>
  );
}
