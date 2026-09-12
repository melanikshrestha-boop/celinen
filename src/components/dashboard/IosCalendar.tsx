import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAccount } from "@/components/account/AccountProvider";
import { fetchCalendarFeed } from "@/lib/calendar-feed.functions";
import {
  buildIcs,
  eventsOnDay,
  isCalendarFeedUrl,
  monthGrid,
  normalizeCalendarFeedUrl,
  parseIcs,
  sameDay,
  type CalendarEvent,
} from "@/lib/calendar-ics";
import {
  allCalendarEvents,
  emptyCalendarState,
  readCalendarState,
  writeCalendarState,
  type CalendarState,
} from "@/lib/calendar-store";
import { downloadText } from "@/lib/business/reminders";
import "./ios-calendar.css";

const WEEK = ["S", "M", "T", "W", "T", "F", "S"] as const;

function timeLabel(event: CalendarEvent) {
  if (event.allDay) return "all-day";
  return new Date(event.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function IosCalendar() {
  const account = useAccount();
  const scope = account?.scope;
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(today);
  const [state, setState] = useState<CalendarState>(emptyCalendarState);
  const [sheet, setSheet] = useState<"google" | "ios" | null>(null);
  const [feedDraft, setFeedDraft] = useState("");
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("10:00");
  const [busy, setBusy] = useState("");
  const cells = monthGrid(cursor.getFullYear(), cursor.getMonth());
  const events = allCalendarEvents(state);
  const dayEvents = eventsOnDay(events, selected);
  const connected = Boolean(state.feedUrl);

  useEffect(() => {
    if (!scope) return;
    const next = readCalendarState(scope);
    setState(next);
    setFeedDraft(next.feedUrl);
  }, [scope]);

  useEffect(() => {
    if (!scope || !state.feedUrl) return;
    let alive = true;
    void fetchCalendarFeed({ data: { url: state.feedUrl } })
      .then((result) => {
        if (!alive || !result?.ics) return;
        const feedEvents = parseIcs(result.ics, "google");
        const next = { ...readCalendarState(scope), feedUrl: state.feedUrl, feedEvents };
        writeCalendarState(scope, next);
        setState(next);
      })
      .catch(() => {
        /* keep the last imported events */
      });
    return () => {
      alive = false;
    };
  }, [scope, state.feedUrl]);

  function persist(next: CalendarState) {
    setState(next);
    if (scope) writeCalendarState(scope, next);
  }

  async function connectGoogle() {
    if (feedDraft.includes("BEGIN:VCALENDAR")) {
      persist({ ...state, feedUrl: "", feedEvents: parseIcs(feedDraft, "google") });
      setSheet(null);
      setBusy("");
      return;
    }
    const url = normalizeCalendarFeedUrl(feedDraft);
    if (!url || !isCalendarFeedUrl(url)) {
      setBusy("Use a Google Calendar iCal link.");
      return;
    }
    setBusy("Connecting…");
    try {
      const result = await fetchCalendarFeed({ data: { url } });
      const feedEvents = parseIcs(result.ics, "google");
      persist({ ...state, feedUrl: url, feedEvents });
      setSheet(null);
      setBusy("");
    } catch {
      setBusy("That calendar link could not be opened.");
    }
  }

  function addEvent() {
    const [hours, minutes] = when.split(":").map(Number);
    if (!title.trim() || !Number.isFinite(hours) || !Number.isFinite(minutes)) return;
    const start = new Date(selected);
    start.setHours(hours, minutes, 0, 0);
    const event: CalendarEvent = {
      id: `local-${start.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      title: title.trim().slice(0, 200),
      start: start.getTime(),
      end: start.getTime() + 3600000,
      allDay: false,
      source: "local",
    };
    persist({ ...state, localEvents: [...state.localEvents, event] });
    setTitle("");
  }

  function exportIos() {
    downloadText(buildIcs(events), "celinen.ics", "text/calendar");
  }

  const monthLabel = cursor.toLocaleString("en-US", { month: "long", year: "numeric" });
  const agendaLabel = selected.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <section className="celinen-dash__cal celinen-ios-cal" aria-label="Calendar">
      <div className="celinen-ios-cal__bar">
        <h1>{monthLabel}</h1>
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
        >
          <ChevronLeft size={22} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
        >
          <ChevronRight size={22} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => {
            const now = new Date();
            setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
            setSelected(now);
          }}
        >
          Today
        </button>
      </div>
      <div className="celinen-ios-cal__connect">
        <button
          type="button"
          aria-pressed={sheet === "google" || connected}
          onClick={() => setSheet(sheet === "google" ? null : "google")}
        >
          Google Calendar
        </button>
        <button type="button" aria-pressed={sheet === "ios"} onClick={() => setSheet(sheet === "ios" ? null : "ios")}>
          Calendar
        </button>
      </div>
      {sheet === "google" && (
        <div className="celinen-ios-cal__sheet">
          <input
            value={feedDraft}
            onChange={(event) => setFeedDraft(event.target.value)}
            aria-label="Google Calendar iCal link"
            placeholder="calendar.google.com/.../basic.ics"
            spellCheck={false}
            autoComplete="off"
          />
          <button type="button" onClick={() => void connectGoogle()}>
            Connect
          </button>
          {connected && (
            <button
              type="button"
              onClick={() => {
                persist({ ...state, feedUrl: "", feedEvents: [] });
                setFeedDraft("");
              }}
            >
              Disconnect
            </button>
          )}
          {busy ? <span>{busy}</span> : null}
        </div>
      )}
      {sheet === "ios" && (
        <div className="celinen-ios-cal__sheet">
          <button type="button" onClick={exportIos}>
            Add to Calendar
          </button>
        </div>
      )}
      <div className="celinen-ios-cal__week">
        {WEEK.map((day, index) => (
          <span key={`${day}-${index}`}>{day}</span>
        ))}
      </div>
      <div className="celinen-ios-cal__grid">
        {cells.map((cell) => {
          const onDay = eventsOnDay(events, cell.date);
          const todayOn = sameDay(cell.date, today);
          const selectedOn = sameDay(cell.date, selected);
          return (
            <button
              key={cell.date.toISOString()}
              type="button"
              className={`celinen-ios-cal__day${cell.inMonth ? "" : " is-out"}${todayOn ? " is-today" : ""}${selectedOn ? " is-selected" : ""}`}
              aria-current={todayOn ? "date" : undefined}
              aria-pressed={selectedOn}
              onClick={() => {
                setSelected(cell.date);
                if (!cell.inMonth) setCursor(new Date(cell.date.getFullYear(), cell.date.getMonth(), 1));
              }}
            >
              <span className="celinen-ios-cal__num">{cell.date.getDate()}</span>
              <span className="celinen-ios-cal__dots">
                {onDay.slice(0, 3).map((event) => (
                  <i key={event.id} data-source={event.source} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="celinen-ios-cal__agenda">
        <h2>{agendaLabel}</h2>
        {dayEvents.map((event) => (
          <article key={event.id} className="celinen-ios-cal__event" data-source={event.source}>
            <time dateTime={new Date(event.start).toISOString()}>{timeLabel(event)}</time>
            <strong>{event.title}</strong>
          </article>
        ))}
        <div className="celinen-ios-cal__add">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-label="Event"
            placeholder="Event"
            onKeyDown={(event) => {
              if (event.key === "Enter") addEvent();
            }}
          />
          <input
            type="time"
            value={when}
            onChange={(event) => setWhen(event.target.value)}
            aria-label="Time"
          />
          <button type="button" onClick={addEvent} aria-label="Add event">
            Add
          </button>
        </div>
      </div>
    </section>
  );
}
