import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/lensos/Logo";
import { VibeChat } from "@/components/lensos/VibeChat";
import { supabase } from "@/integrations/supabase/client";
import {
  getClientPortal,
  createBookingRequest,
  listBookingRequests,
  createClientUploadUrl,
  recordClientUpload,
  listClientUploads,
  getInvoicePaymentLink,
} from "@/lib/client-portal.functions";
import { getStudioRates, type StudioRates } from "@/lib/rates.functions";

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

type Booking = Awaited<ReturnType<typeof listBookingRequests>>[number];
type Upload = Awaited<ReturnType<typeof listClientUploads>>[number];

const SHOOT_TYPES = ["Portrait", "Wedding", "Event", "Brand / product", "Family", "Editorial"];

function Portal() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<"loading" | "anon" | "ready" | "error">("loading");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);

  /* booking form */
  const [shootType, setShootType] = useState(SHOOT_TYPES[0]!);
  const [date, setDate] = useState("");
  const [place, setPlace] = useState("");
  const [budget, setBudget] = useState("");
  const [brief, setBrief] = useState("");
  const [booking, setBooking] = useState<"idle" | "sending" | "sent">("idle");
  const [bookErr, setBookErr] = useState<string | null>(null);

  /* uploads */
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const [studios, setStudios] = useState<StudioRates[]>([]);

  const refresh = useCallback(async () => {
    const [b, u, r] = await Promise.all([
      listBookingRequests(),
      listClientUploads(),
      getStudioRates().catch(() => ({ studios: [] as StudioRates[] })),
    ]);
    setBookings(b);
    setUploads(u);
    setStudios(r.studios);
  }, []);


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
        await refresh();
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [refresh]);

  const submitBooking = async () => {
    setBookErr(null);
    if (!date) return setBookErr("Pick a date for your shoot.");
    setBooking("sending");
    const res = await createBookingRequest({
      data: {
        shoot_type: shootType,
        preferred_date: date,
        location: place,
        budget: budget ? Number(budget) : null,
        message: brief,
      },
    });
    if ("error" in res && res.error) {
      setBooking("idle");
      return setBookErr(res.error);
    }
    setBooking("sent");
    setBrief("");
    setBudget("");
    setPlace("");
    setDate("");
    await refresh();
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      setUploading(file.name);
      const slot = await createClientUploadUrl({ data: { filename: file.name } });
      if (!("signedUrl" in slot) || !slot.signedUrl || !slot.path) break;
      const put = await fetch(slot.signedUrl, { method: "PUT", body: file });
      if (!put.ok) break;
      await recordClientUpload({ data: { storage_path: slot.path, filename: file.name } });
    }
    setUploading(null);
    if (fileRef.current) fileRef.current.value = "";
    await refresh();
  };


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
    <div className="mx-auto min-h-screen w-full max-w-[900px] px-4 py-8 sm:px-6 sm:py-14 text-ink">
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
        <div className="mt-8 rounded-2xl border border-border bg-card p-4 sm:p-6">
          <p className="text-sm">Nothing is linked to {email} yet.</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-moss">
            Ask your photographer to add you as a client with this exact email address. As soon as
            they do, your shoots, galleries and invoices show up here automatically.
          </p>
        </div>
      )}

      {/* ---- book a shoot ---- */}
      <section className="mt-10">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
          Book a shoot
        </h2>
        <div className="mt-3 rounded-2xl border border-border bg-card p-4 sm:p-6">
          {booking === "sent" ? (
            <div>
              <p className="text-[15px] font-medium text-rust">Request sent.</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-moss">
                Your photographer has it — you&apos;ll see the status update below the moment they
                confirm.
              </p>
              <button
                onClick={() => setBooking("idle")}
                className="mt-4 rounded-lg border border-input px-3 py-1.5 text-[13px] hover:bg-muted"
              >
                Book another
              </button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-[12px] text-moss">
                Shoot type
                <select
                  value={shootType}
                  onChange={(e) => setShootType(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-[16px] text-ink sm:py-2 sm:text-[14px]"
                >
                  {SHOOT_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label className="text-[12px] text-moss">
                Preferred date
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-[16px] text-ink sm:py-2 sm:text-[14px]"
                />
              </label>
              <label className="text-[12px] text-moss">
                Location
                <input
                  value={place}
                  onChange={(e) => setPlace(e.target.value)}
                  placeholder="Studio, city or venue"
                  className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-[16px] text-ink sm:py-2 sm:text-[14px]"
                />
              </label>
              <label className="text-[12px] text-moss">
                Budget (optional)
                <input
                  value={budget}
                  onChange={(e) => setBudget(e.target.value.replace(/[^0-9.]/g, ""))}
                  inputMode="decimal"
                  placeholder="1200"
                  className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-[16px] text-ink sm:py-2 sm:text-[14px]"
                />
              </label>
              <label className="text-[12px] text-moss sm:col-span-2">
                What are we shooting?
                <textarea
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  rows={3}
                  placeholder="Two looks, golden hour, need 20 edited frames for a launch."
                  className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-[16px] text-ink sm:py-2 sm:text-[14px]"
                />
              </label>
              {bookErr && (
                <p className="text-[13px] text-destructive sm:col-span-2">{bookErr}</p>
              )}
              <div className="sm:col-span-2">
                <button
                  onClick={() => void submitBooking()}
                  disabled={booking === "sending"}
                  className="rounded-lg bg-rust px-4 py-2.5 text-[14px] font-semibold text-paper2 hover:opacity-90 disabled:opacity-60"
                >
                  {booking === "sending" ? "Sending…" : "Request this date"}
                </button>
              </div>
            </div>
          )}
        </div>

        {bookings.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
            {bookings.map((b) => (
              <div
                key={b.id}
                className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4 last:border-0"
              >
                <span className="text-[15px] font-medium">{b.shoot_type}</span>
                {b.location && <span className="text-[13px] text-moss">{b.location}</span>}
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ${
                    b.status === "confirmed" ? "bg-rust text-paper2" : "bg-muted text-moss"
                  }`}
                >
                  {b.status}
                </span>
                <span className="ml-auto font-mono text-[12px] text-moss">
                  {b.preferred_date ?? "date tbd"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <VibeChat onBooked={() => void refresh()} />

      {/* ---- client uploads ---- */}
      <section className="mt-10">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
          Your uploads
        </h2>
        <div className="mt-3 rounded-2xl border border-dashed border-input bg-card p-4 sm:p-6">
          <p className="text-[13px] leading-relaxed text-moss">
            Send reference shots, moodboards or your own photos straight to your photographer.
            Private — only the two of you can open them.
          </p>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*"
            onChange={(e) => void onFiles(e.target.files)}
            className="mt-4 block w-full text-[13px] text-moss file:mr-3 file:rounded-lg file:border-0 file:bg-rust file:px-4 file:py-2 file:text-[13px] file:font-semibold file:text-paper2"
          />
          {uploading && (
            <p className="mt-3 font-mono text-[12px] text-moss">uploading {uploading}…</p>
          )}
        </div>

        {uploads.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {uploads.map((u) => (
              <a
                key={u.id}
                href={u.url ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="overflow-hidden rounded-xl border border-border bg-card"
              >
                {u.url ? (
                  <img src={u.url} alt={u.filename} className="h-28 w-full object-cover" />
                ) : (
                  <div className="h-28 w-full bg-muted" />
                )}
                <p className="truncate px-3 py-2 font-mono text-[11px] text-moss">{u.filename}</p>
              </a>
            ))}
          </div>
        )}
      </section>



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

          {studios.length > 0 && (
            <section>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
                Rates
              </h2>
              <div className="mt-3 grid gap-3">
                {studios.map((st) => (
                  <div key={st.userId} className="rounded-2xl border border-border bg-card p-5">
                    <p className="font-display text-[16px] font-semibold">{st.name}</p>
                    <p className="mt-0.5 text-[12.5px] text-moss">
                      {[st.specialty, st.city].filter(Boolean).join(" · ")}
                    </p>
                    {st.bio && (
                      <p className="mt-2 text-[13.5px] leading-relaxed text-moss">{st.bio}</p>
                    )}
                    <div className="mt-4 grid gap-2">
                      {st.packages.map((pk) => (
                        <div
                          key={pk.id}
                          className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-4 py-3"
                        >
                          <div className="min-w-0">
                            <p className="text-[14.5px] font-medium">{pk.title}</p>
                            <p className="text-[12.5px] text-moss">
                              {[pk.duration, pk.deliverables, pk.turnaround]
                                .filter(Boolean)
                                .join(" · ") || pk.blurb}
                            </p>
                          </div>
                          <span className="ml-auto font-mono text-[14px]">
                            {money(Number(pk.price), pk.currency)}
                            <span className="text-[11px] text-moss">
                              {pk.unit === "hour" ? " / hr" : pk.unit === "day" ? " / day" : ""}
                            </span>
                          </span>
                        </div>
                      ))}
                      {st.packages.length === 0 && (
                        <p className="text-[13px] text-moss">Ask for a quote — no set packages.</p>
                      )}
                    </div>
                    {(st.travelNote || st.bookingNote) && (
                      <p className="mt-3 text-[12px] leading-relaxed text-moss">
                        {[st.travelNote, st.bookingNote].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

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
                  {inv.status !== "paid" && <PayButton id={inv.id} url={inv.hosted_invoice_url} />}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

/** Opens the photographer's Stripe payment page, creating it on demand. */
function PayButton({ id, url }: { id: string; url: string | null }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pay = async () => {
    if (url) {
      window.open(url, "_blank", "noopener");
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await getInvoicePaymentLink({ data: { invoice_id: id } });
    setBusy(false);
    if ("url" in res && res.url) window.open(res.url, "_blank", "noopener");
    else setErr("error" in res ? (res.error ?? "Could not open payment") : "Could not open payment");
  };

  return (
    <div className="flex items-center gap-2">
      {err && <span className="text-[12px] text-destructive">{err}</span>}
      <button
        onClick={() => void pay()}
        disabled={busy}
        className="rounded-lg bg-rust px-3 py-1.5 text-[13px] font-semibold text-paper2 hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "Opening…" : "Pay now"}
      </button>
    </div>
  );
}
