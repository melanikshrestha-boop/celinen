import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAccount } from "@/components/account/AccountProvider";
import { parseShootNote } from "@/lib/calendar-assist";
import {
  CALENDAR_COLORS,
  addCalendarDays,
  eventsInWeek,
  eventsOnDay,
  monthGrid,
  parseCalendarHex,
  sameDay,
  weekDays,
  type CalendarEvent,
} from "@/lib/calendar-ics";
import {
  allCalendarEvents,
  emptyCalendarState,
  readCalendarState,
  writeCalendarState,
  type CalendarState,
} from "@/lib/calendar-store";
import "./ios-calendar.css";

const VIEWS = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "quarter", label: "Quarter" },
  { id: "year", label: "Year" },
] as const;
type CalView = (typeof VIEWS)[number]["id"];
const WEEK = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6);

function timeLabel(event: CalendarEvent) {
  if (event.allDay) return "";
  return new Date(event.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function hourLabel(hour: number) {
  if (hour === 0 || hour === 24) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

function eventColor(event: CalendarEvent, accent: string) {
  return event.color || accent;
}

function blockStyle(event: CalendarEvent, day: Date) {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const origin = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 6, 0, 0, 0);
  const minutes = Math.max(0, (start.getTime() - origin.getTime()) / 60000);
  const dur = Math.max(25, (end.getTime() - start.getTime()) / 60000);
  return {
    top: `${(minutes / (16 * 60)) * 100}%`,
    height: `${Math.min(100, (dur / (16 * 60)) * 100)}%`,
  };
}

function MiniMonth({
  month,
  today,
  selected,
  events,
  accent,
  onPick,
}: {
  month: Date;
  today: Date;
  selected: Date;
  events: CalendarEvent[];
  accent: string;
  onPick: (day: Date) => void;
}) {
  const cells = monthGrid(month.getFullYear(), month.getMonth());
  return (
    <div className="celinen-ios-cal__mini">
      <p>{month.toLocaleString("en-US", { month: "long", year: "numeric" })}</p>
      <div className="celinen-ios-cal__mini-week">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span key={`${d}-${i}`}>{d}</span>
        ))}
      </div>
      <div className="celinen-ios-cal__mini-grid">
        {cells.map((cell) => {
          const hits = eventsOnDay(events, cell.date);
          const on = sameDay(cell.date, today);
          const sel = sameDay(cell.date, selected);
          return (
            <button
              key={cell.date.toISOString()}
              type="button"
              className={`${cell.inMonth ? "" : "is-out"}${on ? " is-today" : ""}${sel ? " is-selected" : ""}`}
              aria-current={on ? "date" : undefined}
              onClick={() => onPick(cell.date)}
            >
              {cell.date.getDate()}
              {hits.length ? (
                <i style={{ background: eventColor(hits[0]!, accent) }} />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function IosCalendar() {
  const account = useAccount();
  const scope = account?.scope;
  const today = useMemo(() => new Date(), []);
  const [view, setView] = useState<CalView>("week");
  const [selected, setSelected] = useState(today);
  const [state, setState] = useState<CalendarState>(emptyCalendarState);
  const [ask, setAsk] = useState("");
  const [hexOpen, setHexOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState("");
  const askRef = useRef<HTMLInputElement>(null);
  const hexRef = useRef<HTMLFormElement>(null);
  const events = allCalendarEvents(state);
  const week = weekDays(selected);
  const weekCount = eventsInWeek(events, today).length;
  const upcoming = events.filter((event) => event.end >= today.getTime() - 3600000).slice(0, 24);

  useEffect(() => {
    if (!scope) return;
    setState(readCalendarState(scope));
  }, [scope]);

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
    setSelected(new Date());
  }

  function step(dir: number) {
    if (view === "day") setSelected(addCalendarDays(selected, dir));
    else if (view === "week") setSelected(addCalendarDays(selected, dir * 7));
    else if (view === "month")
      setSelected(new Date(selected.getFullYear(), selected.getMonth() + dir, 1));
    else if (view === "quarter")
      setSelected(new Date(selected.getFullYear(), selected.getMonth() + dir * 3, 1));
    else setSelected(new Date(selected.getFullYear() + dir, selected.getMonth(), 1));
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
    setSelected(new Date(event.start));
  }

  const title =
    view === "day"
      ? selected.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" })
      : view === "week"
        ? `${week[0]!.toLocaleString("en-US", { month: "short", day: "numeric" })} – ${week[6]!.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
        : view === "year"
          ? String(selected.getFullYear())
          : selected.toLocaleString("en-US", { month: "long", year: "numeric" });

  const monthsFor =
    view === "year"
      ? Array.from({ length: 12 }, (_, i) => new Date(selected.getFullYear(), i, 1))
      : view === "quarter"
        ? Array.from({ length: 3 }, (_, i) => new Date(selected.getFullYear(), Math.floor(selected.getMonth() / 3) * 3 + i, 1))
        : [new Date(selected.getFullYear(), selected.getMonth(), 1)];

  const dayColumns = view === "day" ? [selected] : week;
  const timedGrid = { gridTemplateColumns: `52px repeat(${dayColumns.length}, minmax(0, 1fr))` };

  return (
    <section
      className="celinen-dash__cal celinen-ios-cal"
      aria-label="Calendar"
      style={{ ["--ios-red" as string]: state.accent }}
    >
      <div className="celinen-ios-cal__bar">
        <div className="celinen-ios-cal__title">
          <button type="button" aria-label="Previous" onClick={() => step(-1)}>
            <ChevronLeft size={18} strokeWidth={1.75} />
          </button>
          <h1>{title}</h1>
          <button type="button" aria-label="Next" onClick={() => step(1)}>
            <ChevronRight size={18} strokeWidth={1.75} />
          </button>
        </div>
        <div className="celinen-ios-cal__views" role="tablist" aria-label="View">
          {VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={view === item.id}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="celinen-ios-cal__week-count">{weekCount} this week</p>
        <button
          type="button"
          className="celinen-ios-cal__today-dot"
          aria-label="Today"
          style={{ background: state.accent }}
          onClick={jumpToday}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setHexDraft(state.accent);
            setHexOpen(true);
          }}
        />
        <button type="button" className="celinen-ios-cal__plus" aria-label="Add" onClick={() => askRef.current?.focus()}>
          +
        </button>
      </div>
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
          aria-label="Ask"
        />
      </form>
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
      <div className="celinen-ios-cal__shell">
        <aside className="celinen-ios-cal__side">
          <MiniMonth
            month={new Date(selected.getFullYear(), selected.getMonth(), 1)}
            today={today}
            selected={selected}
            events={events}
            accent={state.accent}
            onPick={(day) => {
              setSelected(day);
              if (view === "year" || view === "quarter") setView("week");
            }}
          />
          <ul className="celinen-ios-cal__list">
            {upcoming.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(new Date(event.start));
                    setView("week");
                  }}
                >
                  <i style={{ background: eventColor(event, state.accent) }} />
                  <strong>{event.title}</strong>
                  <span>
                    {new Date(event.start).toLocaleString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      ...(event.allDay ? {} : { hour: "numeric", minute: "2-digit" }),
                    })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <div className="celinen-ios-cal__board">
          {view === "month" ? (
            <>
              <div className="celinen-ios-cal__weekheads">
                {WEEK.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="celinen-ios-cal__month">
                {monthGrid(selected.getFullYear(), selected.getMonth()).map((cell) => {
                  const onDay = eventsOnDay(events, cell.date);
                  const on = sameDay(cell.date, today);
                  const sel = sameDay(cell.date, selected);
                  return (
                    <button
                      key={cell.date.toISOString()}
                      type="button"
                      className={`celinen-ios-cal__mday${cell.inMonth ? "" : " is-out"}${on ? " is-today" : ""}${sel ? " is-selected" : ""}`}
                      onClick={() => setSelected(cell.date)}
                      onDoubleClick={() => setView("day")}
                    >
                      <span className="celinen-ios-cal__num">{cell.date.getDate()}</span>
                      {onDay.slice(0, 4).map((event) => (
                        <em key={event.id} style={{ borderLeftColor: eventColor(event, state.accent) }}>
                          {event.title}
                        </em>
                      ))}
                    </button>
                  );
                })}
              </div>
            </>
          ) : view === "quarter" || view === "year" ? (
            <div className={view === "year" ? "celinen-ios-cal__year" : "celinen-ios-cal__quarter"}>
              {monthsFor.map((month) => (
                <MiniMonth
                  key={month.toISOString()}
                  month={month}
                  today={today}
                  selected={selected}
                  events={events}
                  accent={state.accent}
                  onPick={(day) => {
                    setSelected(day);
                    setView("week");
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="celinen-ios-cal__weekview">
              <div className="celinen-ios-cal__weekheads celinen-ios-cal__weekheads--timed" style={timedGrid}>
                <span />
                {dayColumns.map((day) => {
                  const on = sameDay(day, today);
                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      className={on ? "is-today" : undefined}
                      onClick={() => setSelected(day)}
                    >
                      <small>{WEEK[day.getDay()]}</small>
                      <b>{day.getDate()}</b>
                    </button>
                  );
                })}
              </div>
              <div className="celinen-ios-cal__lanes" style={timedGrid}>
                <span />
                {dayColumns.map((day) => (
                  <div key={`lane-${day.toISOString()}`}>
                    {eventsOnDay(events, day)
                      .filter((event) => event.allDay)
                      .map((event) => (
                        <em key={event.id} style={{ background: eventColor(event, state.accent) }}>
                          {event.title}
                        </em>
                      ))}
                  </div>
                ))}
              </div>
              <div className="celinen-ios-cal__gridscroll" style={timedGrid}>
                <div className="celinen-ios-cal__hours">
                  {HOURS.map((hour) => (
                    <span key={hour}>{hourLabel(hour)}</span>
                  ))}
                </div>
                {dayColumns.map((day) => (
                  <div
                    key={`col-${day.toISOString()}`}
                    className="celinen-ios-cal__col"
                    onDoubleClick={() => {
                      setSelected(day);
                      askRef.current?.focus();
                    }}
                  >
                    {HOURS.map((hour) => (
                      <i key={hour} />
                    ))}
                    {eventsOnDay(events, day)
                      .filter((event) => !event.allDay)
                      .map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          className="celinen-ios-cal__block"
                          style={{
                            ...blockStyle(event, day),
                            ["--evt" as string]: eventColor(event, state.accent),
                          }}
                          onClick={() => setSelected(day)}
                        >
                          <strong>{event.title}</strong>
                          <span>{timeLabel(event)}</span>
                        </button>
                      ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
