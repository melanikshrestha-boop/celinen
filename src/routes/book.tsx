import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { LogoMark } from "@/components/lensos/Logo";
import { createShootRequest } from "@/lib/shoot-app.functions";

export const Route = createFileRoute("/book")({
  head: () => ({
    meta: [
      { title: "Book a shoot — LensLabs" },
      {
        name: "description",
        content:
          "Start a shoot with your photographer in seconds. Pick a date, add references, and get a private link — no account needed.",
      },
      { property: "og:title", content: "Book a shoot — LensLabs" },
      {
        property: "og:description",
        content: "Pick a date, add references, get a private shoot link. No sign-in required.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BookShoot,
});

const SHOOT_TYPES = ["Portrait", "Wedding", "Event", "Brand / product", "Family", "Editorial"];

function BookShoot() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [shootType, setShootType] = useState(SHOOT_TYPES[0]!);
  const [date, setDate] = useState("");
  const [place, setPlace] = useState("");
  const [budget, setBudget] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      const res = await createShootRequest({
        data: {
          name,
          email,
          shoot_type: shootType,
          preferred_date: date,
          location: place,
          budget: budget ? Number(budget) : null,
          message: brief,
        },
      });
      if ("error" in res && res.error) {
        setBusy(false);
        return setErr(res.error);
      }
      if ("token" in res) {
        try {
          const prev = JSON.parse(localStorage.getItem("lenslabs.shoots") ?? "[]") as string[];
          localStorage.setItem(
            "lenslabs.shoots",
            JSON.stringify([res.token, ...prev.filter((t) => t !== res.token)].slice(0, 20)),
          );
        } catch {
          /* storage blocked — the link on the next screen still works */
        }
        void navigate({ to: "/s/$token", params: { token: res.token } });
      }
    } catch (e) {
      setBusy(false);
      setErr(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  const field =
    "w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-[14px] outline-none transition-shadow focus:ring-2 focus:ring-primary/30";
  const label = "font-mono text-[11px] uppercase tracking-[0.14em] text-moss";

  return (
    <main className="min-h-dvh px-5 py-10">
      <div className="mx-auto max-w-[560px]">
        <Link to="/" className="mb-8 flex items-center gap-2">
          <LogoMark className="text-ink" />
          <span className="font-display text-[15px] font-semibold tracking-tight">LensLabs</span>
        </Link>

        <h1 className="font-display text-[34px] font-semibold leading-[1.05] tracking-tight">
          Start a shoot.
        </h1>
        <p className="mt-2 max-w-[44ch] text-[15px] text-moss">
          One form. You get a private link to your shoot — references, picks and final photos live
          there. No account, no password.
        </p>

        <form onSubmit={submit} className="panel mt-8 space-y-5 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <p className={label}>Your name</p>
              <input value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder="Alex Rivera" />
            </div>
            <div className="space-y-1.5">
              <p className={label}>Email</p>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={field}
                placeholder="you@studio.com"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <p className={label}>Shoot type</p>
            <div className="flex flex-wrap gap-2">
              {SHOOT_TYPES.map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => setShootType(t)}
                  className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
                    shootType === t
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input text-moss hover:text-ink"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <p className={label}>Date</p>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
            </div>
            <div className="space-y-1.5">
              <p className={label}>Location</p>
              <input value={place} onChange={(e) => setPlace(e.target.value)} className={field} placeholder="Brooklyn" />
            </div>
            <div className="space-y-1.5">
              <p className={label}>Budget</p>
              <input
                inputMode="numeric"
                value={budget}
                onChange={(e) => setBudget(e.target.value.replace(/[^0-9.]/g, ""))}
                className={field}
                placeholder="1200"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <p className={label}>Brief</p>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={4}
              className={`${field} resize-none`}
              placeholder="What the shoot is for, the mood you want, anything the photographer should know."
            />
          </div>

          {err && <p className="text-[13px] text-destructive">{err}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-primary px-4 py-3 text-[14px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Creating your shoot…" : "Create shoot →"}
          </button>
          <p className="text-center font-mono text-[11px] text-moss">
            Keep the link you get next — it is the key to your shoot.
          </p>
        </form>
      </div>
    </main>
  );
}
