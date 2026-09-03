import { useCallback, useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/lensos/Logo";
import {
  getVibeSession,
  setVibeConsent,
  sendVibeMessage,
  finishVibeSession,
  confirmVibeBooking,
  type VibeMessage,
} from "@/lib/vibe.functions";

type Session = Awaited<ReturnType<typeof getVibeSession>>;

const SHOOT_TYPES = ["portrait", "sports", "event", "wedding", "product", "editorial"];

/**
 * Opt-in, ask-and-allow shoot concierge. Nothing runs until the client
 * explicitly turns it on, and turning it off wipes the transcript.
 */
export function VibeChat({ onBooked }: { onBooked?: () => void } = {}) {
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<VibeMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [booking, setBooking] = useState({
    shoot_type: SHOOT_TYPES[0]!,
    preferred_date: "",
    location: "",
    budget: "",
  });
  const [booked, setBooked] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);


  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const s = await getVibeSession();
        if (!alive) return;
        setSession(s);
        setMessages(((s?.messages as VibeMessage[] | null) ?? []) as VibeMessage[]);
      } catch {
        /* portal renders fine without it */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const toggle = useCallback(
    async (consent: boolean) => {
      if (!session) return;
      setBusy(true);
      setErr(null);
      const res = await setVibeConsent({ data: { id: session.id, consent } });
      if ("error" in res && res.error) setErr(res.error);
      else if (res.session) {
        setSession(res.session);
        setMessages((res.session.messages as VibeMessage[] | null) ?? []);
      }
      setBusy(false);
    },
    [session],
  );

  const send = useCallback(async () => {
    if (!session || !text.trim() || busy) return;
    const mine = text.trim();
    setText("");
    setMessages((m) => [...m, { role: "user", content: mine }]);
    setBusy(true);
    setErr(null);
    const res = await sendVibeMessage({ data: { id: session.id, text: mine } });
    if (res.messages) setMessages(res.messages);
    if ("error" in res && res.error) setErr(res.error);
    setBusy(false);
  }, [session, text, busy]);

  const finish = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setErr(null);
    const res = await finishVibeSession({ data: { id: session.id } });
    if ("error" in res && res.error) setErr(res.error);
    else if (res.session) setSession(res.session);
    setBusy(false);
  }, [session]);

  if (!session) return null;

  return (
    <section className="mt-10">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
        Shoot concierge
      </h2>

      <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
        {/* header */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
          <LogoMark size={22} className={session.consent ? "iris-breathe text-ink" : "text-moss"} />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-medium">Describe your vibe</p>
            <p className="truncate text-[12px] text-moss">
              {session.consent ? "On — you can turn it off any time" : "Off — nothing is recorded"}
            </p>
          </div>
          <button
            onClick={() => void toggle(!session.consent)}
            disabled={busy}
            className={`ml-auto shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-60 ${
              session.consent
                ? "border border-input text-moss hover:bg-muted"
                : "bg-rust text-paper2 hover:opacity-90"
            }`}
          >
            {session.consent ? "Turn off" : "Turn on"}
          </button>
        </div>

        {!session.consent ? (
          <div className="px-4 py-6 sm:px-5">
            <p className="text-[13px] leading-relaxed text-moss">
              Most people know the photos they want when they see them, but not how to say it. If
              you want, our assistant asks a few short questions — light, colour, framing, how
              you&apos;ll use the shots — and turns your answers into a brief your photographer
              reads before the shoot.
            </p>
            <p className="mt-3 text-[12px] leading-relaxed text-moss">
              Completely optional. It only starts when you turn it on, only your photographer sees
              the brief, and turning it off deletes the conversation.
            </p>
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="max-h-[52vh] overflow-y-auto px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-3">
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`rise-in max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed sm:max-w-[75%] ${
                      m.role === "user"
                        ? "self-end bg-ink text-paper2"
                        : "self-start border border-border bg-background text-ink"
                    }`}
                    style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}
                  >
                    {m.content}
                  </div>
                ))}
                {busy && (
                  <div className="flex items-center gap-2 self-start text-[12px] text-moss">
                    <LogoMark size={16} className="iris-spin" />
                    thinking…
                  </div>
                )}
              </div>
            </div>

            {session.summary && (
              <div className="border-t border-border bg-muted/40 px-4 py-4 sm:px-5">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-moss">
                  Your brief
                </p>
                <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed">
                  {session.summary}
                </p>
                {session.vibe_tags?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {session.vibe_tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-full border border-input px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-moss"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {err && <p className="px-4 pb-2 text-[12px] text-destructive sm:px-5">{err}</p>}

            <div className="flex items-end gap-2 border-t border-border px-3 py-3 sm:px-5">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder="warm, a bit filmic, not too posed…"
                className="max-h-32 min-h-[42px] flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-[16px] text-ink sm:text-[14px]"
              />
              <button
                onClick={() => void send()}
                disabled={busy || !text.trim()}
                className="shrink-0 rounded-xl bg-rust px-4 py-2.5 text-[14px] font-semibold text-paper2 transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Send
              </button>
            </div>

            {messages.length > 2 && (
              <div className="border-t border-border px-4 py-3 sm:px-5">
                <button
                  onClick={() => void finish()}
                  disabled={busy}
                  className="rounded-lg border border-input px-3 py-1.5 text-[13px] text-moss hover:bg-muted disabled:opacity-60"
                >
                  {session.summary ? "Rewrite my brief" : "That's enough — write my brief"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
