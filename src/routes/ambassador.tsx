import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { LogoMark } from "@/components/lensos/Logo";
import { Footer } from "@/components/lensos/Footer";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/ambassador")({
  head: () => ({
    meta: [
      { title: "Campus ambassadors — Celinen for sports photographers" },
      {
        name: "description",
        content:
          "A quiet program for student sports photographers at Big Ten and other D1 schools: free Pro, gear stipend, and a same-night culling workflow for game days.",
      },
      { property: "og:title", content: "LensLabs campus ambassadors" },
      {
        property: "og:description",
        content: "Shoot the game, file before the bus leaves. Free Pro for student sports shooters.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Ambassador,
});

const CONFERENCES = ["Big Ten", "Big 12", "SEC", "ACC", "Pac-12", "Other D1", "D2 / D3", "High school"];

const PERKS: [string, string][] = [
  ["Pro, on us", "Free Pro for the season, 25,000 frames a month. No card."],
  ["Game-day turnaround", "Cull 3,000 frames between quarters, file before the bus leaves."],
  ["Gear stipend", "$250 a semester toward cards, batteries or a rental body."],
  ["Named credit", "Your work, your byline. We never license or resell a frame."],
];

const ASKS: string[] = [
  "Shoot at least four events a semester with LensLabs in the loop.",
  "One short note a month on what broke and what saved you time.",
  "Tell one other shooter on your staff. That's the whole marketing plan.",
];

function Ambassador() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    school: "",
    conference: CONFERENCES[0]!,
    sports: "",
    portfolio: "",
    socials: "",
    message: "",
  });
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!form.name.trim() || !form.email.trim()) return setErr("Name and email, that's all we need to start.");
    setState("sending");
    const { error } = await supabase.from("ambassador_applications").insert({
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      school: form.school.trim() || null,
      conference: form.conference,
      sports: form.sports.trim() || null,
      portfolio: form.portfolio.trim() || null,
      socials: form.socials.trim() || null,
      message: form.message.trim() || null,
    });
    if (error) {
      setState("idle");
      return setErr("That didn't send. Try again in a second.");
    }
    setState("sent");
  };

  const field =
    "mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-[16px] text-ink outline-none focus:border-rust sm:py-2 sm:text-[14px]";

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-ink">
      <header className="mx-auto flex w-full max-w-[1100px] items-center justify-between px-6 py-5">
        <Link to="/" className="flex items-center gap-2">
          <LogoMark className="text-ink" />
          <span className="font-display text-[15px] font-semibold tracking-tight">LensLabs</span>
        </Link>
        <Link
          to="/pricing"
          className="rounded-xl border border-input px-4 py-2 text-sm hover:bg-muted"
        >
          Pricing
        </Link>
      </header>

      <main className="mx-auto w-full max-w-[1100px] flex-1 px-6 pb-24">
        <section className="max-w-[720px] pt-10">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
            Campus ambassadors
          </span>
          <h1 className="mt-4 font-display text-[clamp(2rem,5vw,3.2rem)] font-bold leading-[1.05] tracking-[-0.04em]">
            Shoot the game. File before the bus leaves.
          </h1>
          <p className="mt-5 max-w-[560px] text-[15px] leading-relaxed text-moss">
            A small, quiet program for student sports photographers — built first around Big Ten
            staffs, open to any college shooter working real deadlines. You keep your credit, your
            files and your byline. We cover the software.
          </p>
          <a
            href="#apply"
            className="mt-7 inline-block rounded-xl bg-ink px-5 py-2.5 text-sm font-medium text-paper2 hover:opacity-85"
          >
            Apply — two minutes
          </a>
        </section>

        <section className="mt-16 grid gap-3 sm:grid-cols-2">
          {PERKS.map(([title, body]) => (
            <div key={title} className="rounded-2xl border border-border bg-card p-6">
              <h2 className="font-display text-[15px] font-semibold">{title}</h2>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-moss">{body}</p>
            </div>
          ))}
        </section>

        <section className="mt-12 rounded-2xl border border-border bg-card p-6 sm:p-8">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
            What we ask back
          </h2>
          <ul className="mt-4 space-y-2.5">
            {ASKS.map((a) => (
              <li key={a} className="flex gap-3 text-[14px] leading-relaxed">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-rust" />
                {a}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-[12.5px] leading-relaxed text-moss">
            No quotas, no posting schedule, no affiliate links. If it stops being useful, walk away
            and keep the semester.
          </p>
        </section>

        <section id="apply" className="mt-16 max-w-[720px] scroll-mt-8">
          <h2 className="font-display text-[24px] font-semibold tracking-tight">Apply</h2>
          <p className="mt-1.5 text-[13.5px] text-moss">
            One round per semester. We read every one.
          </p>

          {state === "sent" ? (
            <div className="mt-5 rounded-2xl border border-border bg-card p-6">
              <p className="text-[15px] font-medium text-rust">Application in.</p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-moss">
                We reply to {form.email} within a week — usually sooner if you sent a portfolio.
                Meanwhile, the Free plan already culls 100 frames a month.
              </p>
              <Link
                to="/signup"
                search={{ plan: "hobby", billing: "yearly" }}
                className="mt-4 inline-block rounded-lg border border-input px-4 py-2 text-[13.5px] hover:bg-muted"
              >
                Start free while you wait
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-5 grid gap-4 rounded-2xl border border-border bg-card p-6 sm:grid-cols-2">
              <label className="text-[12px] text-moss">
                Your name
                <input value={form.name} onChange={set("name")} className={field} />
              </label>
              <label className="text-[12px] text-moss">
                Email
                <input type="email" value={form.email} onChange={set("email")} className={field} />
              </label>
              <label className="text-[12px] text-moss">
                School
                <input value={form.school} onChange={set("school")} placeholder="Michigan State" className={field} />
              </label>
              <label className="text-[12px] text-moss">
                Conference
                <select value={form.conference} onChange={set("conference")} className={field}>
                  {CONFERENCES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="text-[12px] text-moss">
                Sports you shoot
                <input value={form.sports} onChange={set("sports")} placeholder="Football, hockey, track" className={field} />
              </label>
              <label className="text-[12px] text-moss">
                Portfolio link
                <input value={form.portfolio} onChange={set("portfolio")} placeholder="https://" className={field} />
              </label>
              <label className="text-[12px] text-moss sm:col-span-2">
                Instagram / X (optional)
                <input value={form.socials} onChange={set("socials")} placeholder="@handle" className={field} />
              </label>
              <label className="text-[12px] text-moss sm:col-span-2">
                What does a normal game day look like for you?
                <textarea
                  value={form.message}
                  onChange={set("message")}
                  rows={3}
                  placeholder="2,500 frames a night, 30 to the paper by midnight, editing on a laptop in the press box."
                  className={field}
                />
              </label>
              {err && <p className="text-[13px] text-destructive sm:col-span-2">{err}</p>}
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={state === "sending"}
                  className="rounded-xl bg-rust px-5 py-2.5 text-[14px] font-semibold text-paper2 hover:opacity-90 disabled:opacity-60"
                >
                  {state === "sending" ? "Sending…" : "Send application"}
                </button>
              </div>
            </form>
          )}
        </section>
      </main>

      <Footer />
    </div>
  );
}
