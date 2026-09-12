import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAccount } from "@/components/account/AccountProvider";
import { parseShootNote } from "@/lib/calendar-assist";
import {
  CALENDAR_COLORS,
  eventsInWeek,
  eventsOnDay,
  monthGrid,
  parseCalendarHex,
  sameDay,
} from "@/lib/calendar-ics";
import {
  allCalendarEvents,
  emptyCalendarState,
  readCalendarState,
  writeCalendarState,
  type CalendarState,
} from "@/lib/calendar-store";
import "./ios-calendar.css";

const WEEK = ["S", "M", "T", "W", "T", "F", "S"] as const;

function timeLabel(event: { allDay: boolean; start: number }) {
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
  const [askOpen, setAskOpen] = useState(false);
  const [ask, setAsk] = useState("");
  const [hexOpen, setHexOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState("");
  const askRef = useRef<HTMLInputElement>(null);
  const hexRef = useRef<HTMLFormElement>(null);
  const cells = monthGrid(cursor.getFullYear(), cursor.getMonth());
  const events = allCalendarEvents(state);
  const dayEvents = eventsOnDay(events, selected);
  const weekCount = eventsInWeek(events, today).length;

  useEffect(() => {
    if (!scope) return;
    setState(readCalendarState(scope));
  }, [scope]);

  useEffect(() => {
    if (askOpen) askRef.current?.focus();
  }, [askOpen]);

  useEffect(() => {
    if (!hexOpen) return;
    const close = (event: MouseEvent) => {
      if (hexRef.current && !hexRef.current.contains(event.target as Node)) setHexOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [hexOpen]);

  function persist(next: CalendarState) {
    setState(next);
    if (scope) writeCalendarState(scope, next);
  }

  function jumpToday() {
    const now = new Date();
    setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelected(now);
  }

  function applyHex(value: string) {
    const hex = parseCalendarHex(value);
    if (!hex) return false;
    persist({ ...state, accent: hex });
    setHexOpen(false);
    return true;
  }

  function submitAsk() {
    const event = parseShootNote(ask, { now: new Date(), selected, accent: state.accent });
    if (!event) return;
    persist({ ...state, localEvents: [...state.localEvents, event] });
    setAsk("");
    setAskOpen(false);
    setSelected(new Date(event.start));
    setCursor(new Date(new Date(event.start).getFullYear(), new Date(event.start).getMonth(), 1));
  }

  const monthLabel = cursor.toLocaleString("en-US", { month: "long", year: "numeric" });

  return (
    <section
      className="celinen-dash__cal celinen-ios-cal"
      aria-label="Calendar"
      style={{ ["--ios-red" as string]: state.accent }}
    >
      <div className="celinen-ios-cal__bar">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
        >
          <ChevronLeft size={20} strokeWidth={1.75} />
        </button>
        <h1>{monthLabel}</h1>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
        >
          <ChevronRight size={20} strokeWidth={1.75} />
        </button>
        <p className="celinen-ios-cal__week-count">
          {weekCount} this week
        </p>
        <button
          type="button"
          className="celinen-ios-cal__today-dot"
          aria-label="Today"
          title="Today"
          style={{ background: state.accent }}
          onClick={jumpToday}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setHexDraft(state.accent);
            setHexOpen(true);
          }}
        />
        <button
          type="button"
          className="celinen-ios-cal__plus"
          aria-label="Add"
          onClick={() => setAskOpen(true)}
        >
          +
        </button>
      </div>
      {hexOpen ? (
        <form
          ref={hexRef}
          className="celinen-ios-cal__hex"
          onSubmit={(event) => {
            event.preventDefault();
            applyHex(hexDraft);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setHexOpen(false);
          }}
        >
          <input
            value={hexDraft}
            onChange={(event) => setHexDraft(event.target.value)}
            aria-label="Hex"
            autoFocus
          />
          <div className="celinen-ios-cal__hex-list" role="list">
            {CALENDAR_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={color}
                style={{ background: color }}
                onClick={() => applyHex(color)}
              />
            ))}
          </div>
        </form>
      ) : null}
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
                if (!cell.inMonth)
                  setCursor(new Date(cell.date.getFullYear(), cell.date.getMonth(), 1));
              }}
            >
              <span className="celinen-ios-cal__num">{cell.date.getDate()}</span>
              <span className="celinen-ios-cal__hits">
                {onDay.slice(0, 3).map((event) => (
                  <em key={event.id}>{event.title}</em>
                ))}
              </span>
            </button>
          );
        })}
      </div>
      {dayEvents.length ? (
        <ul className="celinen-ios-cal__agenda">
          {dayEvents.map((event) => (
            <li key={event.id}>
              <time dateTime={new Date(event.start).toISOString()}>{timeLabel(event)}</time>
              <strong>{event.title}</strong>
              {event.location ? <span>{event.location}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {askOpen ? (
        <form
          className="celinen-ios-cal__ask"
          onSubmit={(event) => {
            event.preventDefault();
            submitAsk();
          }}
        >
          <input
            ref={askRef}
            value={ask}
            onChange={(event) => setAsk(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setAskOpen(false);
            }}
            aria-label="Ask"
          />
        </form>
      ) : null}
    </section>
  );
}
