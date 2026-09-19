import { useEffect, useMemo, useRef, useState } from "react";
import {
  LANDING_DEMO,
  landingDemoById,
  landingDemoPauseAt,
  type DemoMessage,
  type DemoSession,
} from "@/lib/landing-demo";
import "./landing-demo.css";

function visibleUntil(session: DemoSession, shown: number): DemoMessage[] {
  return session.messages.slice(0, Math.max(0, shown));
}

function nextWait(session: DemoSession, shown: number): DemoMessage | undefined {
  const next = session.messages[shown];
  return next?.wait ? next : undefined;
}

export function LandingDemo() {
  const [id, setId] = useState(LANDING_DEMO[0]!.id);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(() => landingDemoPauseAt(LANDING_DEMO[0]!));
  const [draft, setDraft] = useState("");
  const session = landingDemoById(id);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return LANDING_DEMO;
    return LANDING_DEMO.filter(
      (item) =>
        item.name.toLowerCase().includes(q) || item.preview.toLowerCase().includes(q),
    );
  }, [query]);
  const visible = visibleUntil(session, shown);
  const pending = nextWait(session, shown);
  const thread = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: "smooth" });
  }, [shown, id]);

  useEffect(() => {
    return () => {
      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current = [];
    };
  }, []);

  function clearTimers() {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  }

  function playFrom(start: number, target: DemoSession) {
    clearTimers();
    const pause = landingDemoPauseAt(target);
    const reduced =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || start >= pause) {
      setShown(pause);
      return;
    }
    setShown(start);
    let step = start;
    const tick = () => {
      step += 1;
      setShown(step);
      if (step < pause) {
        timers.current.push(window.setTimeout(tick, 720));
      }
    };
    timers.current.push(window.setTimeout(tick, 640));
  }

  function openSession(next: DemoSession) {
    setId(next.id);
    setDraft("");
    playFrom(0, next);
  }

  function commit(line?: string) {
    if (!pending) return;
    const after = shown + 1;
    setShown(after);
    setDraft("");
    const rest = session.messages.slice(after);
    const until = rest.findIndex((message) => message.wait);
    const end = until === -1 ? session.messages.length : after + until;
    if (end <= after) return;
    const reduced =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setShown(end);
      return;
    }
    let step = after;
    const tick = () => {
      step += 1;
      setShown(step);
      if (step < end) timers.current.push(window.setTimeout(tick, 720));
    };
    timers.current.push(window.setTimeout(tick, 520));
  }

  return (
    <div className="marketing-demo" aria-label="Celinen example">
      <div className="marketing-demo__chrome" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="marketing-demo__app">
        <aside className="marketing-demo__rail">
          <label className="marketing-demo__search">
            <span className="marketing-demo__sr">Search examples</span>
            <input
              type="search"
              value={query}
              placeholder="Search"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <ul>
            {list.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={item.id === session.id ? "is-on" : undefined}
                  onClick={() => openSession(item)}
                >
                  <span className="marketing-demo__face" style={{ background: item.accent }} />
                  <span>
                    <strong>
                      {item.name}
                      <time>{item.time}</time>
                    </strong>
                    <em>{item.preview}</em>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="marketing-demo__you">You</p>
        </aside>
        <section className="marketing-demo__main" aria-live="polite">
          <header>
            <span className="marketing-demo__face" style={{ background: session.accent }} />
            {session.name}
          </header>
          <div className="marketing-demo__thread" ref={thread}>
            {visible.map((message, index) => (
              <DemoBubble key={`${session.id}-${index}`} message={message} />
            ))}
            {pending ? (
              <p className="marketing-demo__choice">
                <button type="button" onClick={() => commit(pending.text)}>
                  {pending.text}
                </button>
              </p>
            ) : null}
          </div>
          <form
            className="marketing-demo__composer"
            onSubmit={(event) => {
              event.preventDefault();
              commit(draft);
            }}
          >
            <input
              value={draft}
              placeholder={`Message ${session.name}`}
              aria-label={`Message ${session.name}`}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" aria-label="Send" disabled={!pending}>
              ↑
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

function DemoBubble({ message }: { message: DemoMessage }) {
  if (message.role === "user") {
    return <p className="marketing-demo__user">{message.text}</p>;
  }
  return (
    <div className="marketing-demo__bot">
      {message.checks?.length ? (
        <ul>
          {message.checks.map((check) => (
            <li key={check.label}>
              <strong>{check.label}</strong>
              <span> → {check.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {message.text ? <p>{message.text}</p> : null}
    </div>
  );
}
