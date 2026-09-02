import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/lensos/Logo";
import { supabase } from "@/integrations/supabase/client";
import {
  getClientPortal,
  createBookingRequest,
  listBookingRequests,
  createClientUploadUrl,
  recordClientUpload,
  listClientUploads,
} from "@/lib/client-portal.functions";

export const Route = createFileRoute("/portal")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Client portal — LensLabs" },
      {
        name: "description",
        content:
          "Sign in to your LensLabs client portal to see your shoots, galleries and invoices in one place.",
      },
      { property: "og:title", content: "Client portal — LensLabs" },
      {
        property: "og:description",
        content: "Your shoots, your galleries, your invoices — one login.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Portal,
});

type Data = Awaited<ReturnType<typeof getClientPortal>>;

const money = (n: number, c = "usd") =>
  n.toLocaleString(undefined, { style: "currency", currency: c.toUpperCase() });

function Portal() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<"loading" | "anon" | "ready" | "error">("loading");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!alive) return;
      if (!u.user) return setState("anon");
      setEmail(u.user.email ?? null);
      try {
        const res = await getClientPortal();
        if (!alive) return;
        setData(res);
        setState("ready");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    void navigate({ to: "/portal", replace: true });
    setState("anon");
    setData(null);
  };

  if (state === "loading") {
    return (
      <div className="grid min-h-screen place-items-center text-moss">
        <p className="font-mono text-[12px] uppercase tracking-[0.2em]">loading your portal…</p>
      </div>
    );
  }

  if (state === "anon") {
    return (
      <div className="grid min-h-screen place-items-center px-6 py-16 text-ink">
        <div className="w-full max-w-[420px] rounded-2xl border border-border bg-card p-8">
          <div className="flex flex-col items-center text-center">
            <LogoMark className="text-ink" />
            <h1 className="mt-5 font-display text-[26px] font-semibold tracking-tight">
              Client portal
            </h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-moss">
              Sign in with the email your photographer has on file. You&apos;ll see only your own
              shoots, galleries and invoices.
            </p>
          </div>
          <Link
            to="/auth"
            search={{ next: "/portal", mode: "signin" }}
            className="mt-6 block w-full rounded-lg bg-rust px-4 py-2.5 text-center text-[14px] font-semibold text-paper2 hover:opacity-90"
          >
            Sign in
          </Link>
          <Link
            to="/auth"
            search={{ next: "/portal", mode: "signup" }}
            className="mt-3 block w-full rounded-lg border border-input px-4 py-2.5 text-center text-[14px] font-medium hover:bg-muted"
          >
            Create a client account
          </Link>
          <p className="mt-6 text-center text-[12px] leading-relaxed text-moss">
            Use the same email address your photographer invoiced — it links your account
            automatically.
          </p>
        </div>
      </div>
    );
  }

  if (state === "error" || !data) {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center text-moss">
        <div>
          <p className="text-sm">We couldn&apos;t load your portal.</p>
          <button onClick={() => void signOut()} className="mt-3 text-[13px] underline">
            Sign out and try again
          </button>
        </div>
      </div>
    );
  }

  const linked = data.clients.length > 0;
  const studioName = data.clients[0]?.org || data.clients[0]?.name;

  return (
    <div className="mx-auto min-h-screen w-full max-w-[900px] px-6 py-14 text-ink">
      <header className="flex flex-wrap items-center gap-3">
        <LogoMark className="text-ink" />
        <div>
          <h1 className="font-display text-[24px] font-semibold tracking-tight">
            {linked ? `Welcome back, ${studioName}` : "Client portal"}
          </h1>
          <p className="text-[13px] text-moss">{email}</p>
        </div>
        <button
          onClick={() => void signOut()}
          className="ml-auto rounded-lg border border-input px-3 py-1.5 text-[13px] hover:bg-muted"
        >
          Sign out
        </button>
      </header>

      {!linked && (
        <div className="mt-8 rounded-2xl border border-border bg-card p-6">
          <p className="text-sm">Nothing is linked to {email} yet.</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-moss">
            Ask your photographer to add you as a client with this exact email address. As soon as
            they do, your shoots, galleries and invoices show up here automatically.
          </p>
        </div>
      )}

      {linked && (
        <div className="mt-10 space-y-10">
          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">Shoots</h2>
            <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
              {data.shoots.length === 0 && (
                <p className="p-5 text-[13px] text-moss">No shoots booked yet.</p>
              )}
              {data.shoots.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4 last:border-0"
                >
                  <span className="text-[15px] font-medium">{s.name}</span>
                  {s.location && <span className="text-[13px] text-moss">{s.location}</span>}
                  <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-moss">
                    {s.status}
                  </span>
                  <span className="ml-auto font-mono text-[12px] text-moss">
                    {s.shoot_date ?? "date tbd"}
                    {s.keepers ? ` · ${s.keepers} keepers` : ""}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
              Galleries
            </h2>
            <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
              {data.galleries.length === 0 && (
                <p className="p-5 text-[13px] text-moss">No galleries delivered yet.</p>
              )}
              {data.galleries.map((g) => (
                <div
                  key={g.id}
                  className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4 last:border-0"
                >
                  <span className="text-[15px] font-medium">{g.title}</span>
                  {g.expires_at && (
                    <span className="font-mono text-[11px] text-moss">
                      expires {new Date(g.expires_at).toLocaleDateString()}
                    </span>
                  )}
                  <a
                    href={`/g/${g.slug}`}
                    className="ml-auto rounded-lg bg-ink px-3 py-1.5 text-[13px] font-medium text-paper2 hover:opacity-90"
                  >
                    Open gallery
                  </a>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
              Invoices
            </h2>
            <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
              {data.invoices.length === 0 && (
                <p className="p-5 text-[13px] text-moss">No invoices yet.</p>
              )}
              {data.invoices.map((inv) => (
                <div
                  key={inv.id}
                  className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4 last:border-0"
                >
                  <span className="text-[15px]">{inv.description ?? "Photography services"}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ${
                      inv.status === "paid" ? "bg-ink text-paper2" : "bg-muted text-moss"
                    }`}
                  >
                    {inv.status}
                  </span>
                  {inv.due_date && (
                    <span className="font-mono text-[11px] text-moss">due {inv.due_date}</span>
                  )}
                  <span className="ml-auto font-mono text-[14px]">
                    {money(Number(inv.amount), inv.currency)}
                  </span>
                  {inv.status !== "paid" && inv.hosted_invoice_url && (
                    <a
                      href={inv.hosted_invoice_url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg bg-rust px-3 py-1.5 text-[13px] font-semibold text-paper2 hover:opacity-90"
                    >
                      Pay now
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
