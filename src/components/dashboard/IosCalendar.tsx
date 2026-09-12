import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAccount } from "@/components/account/AccountProvider";
import {
  CALENDAR_COLORS,
  eventsOnDay,
  isCalendarColor,
  monthGrid,
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
import "./ios-calendar.css";

const WEEK = ["S", "M", "T", "W", "T", "F", "S"] as const;

function timeLabel(event: CalendarEvent) {
  if (event.allDay) return "all-day";
  return new Date(event.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function stampFor(day: Date, clock: string, allDay: boolean) {
  const next = new Date(day);
  if (allDay) {
    next.setHours(0, 0, 0, 0);
    return next.getTime();
  }
  const [hours, minutes] = clock.split(":").map(Number);
  next.setHours(Number.isFinite(hours) ? hours : 10, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return next.getTime();
}

export function IosCalendar() {
  const account = useAccount();
  const scope = account?.scope;
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(today);
  const [state, setState] = useState<CalendarState>(emptyCalendarState);
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [pose, setPose] = useState("");
  const [notes, setNotes] = useState("");
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("11:00");
  const [allDay, setAllDay] = useState(false);
  const [eventColor, setEventColor] = useState(state.accent);
  const cells = monthGrid(cursor.getFullYear(), cursor.getMonth());
  const events = allCalendarEvents(state);
  const dayEvents = eventsOnDay(events, selected);

  useEffect(() => {
    if (!scope) return;
    const next = readCalendarState(scope);
    setState(next);
    setEventColor(next.accent);
  }, [scope]);

  function persist(next: CalendarState) {
    setState(next);
    if (scope) writeCalendarState(scope, next);
  }

  function addEvent() {
    if (!title.trim()) return;
    const start = stampFor(selected, startTime, allDay);
    const end = allDay ? start + 86400000 - 1 : stampFor(selected, endTime, false);
    const event: CalendarEvent = {
      id: `local-${start}-${Math.random().toString(36).slice(2, 8)}`,
      title: title.trim().slice(0, 200),
      start,
      end: end >= start ? end : start + 3600000,
      allDay,
      source: "local",
      color: isCalendarColor(eventColor) ? eventColor : state.accent,
      ...(location.trim() ? { location: location.trim().slice(0, 200) } : {}),
      ...(pose.trim() ? { pose: pose.trim().slice(0, 80) } : {}),
      ...(notes.trim() ? { notes: notes.trim().slice(0, 2000) } : {}),
    };
    persist({ ...state, localEvents: [...state.localEvents, event] });
    setTitle("");
    setLocation("");
    setPose("");
    setNotes("");
  }

  const monthLabel = cursor.toLocaleString("en-US", { month: "long", year: "numeric" });
  const agendaLabel = selected.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <section
      className="celinen-dash__cal celinen-ios-cal"
      aria-label="Calendar"
      style={{ ["--ios-red" as string]: state.accent }}
    >
      <div className="celinen-ios-cal__stage">
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
        </div>
        <button
          type="button"
          className="celinen-ios-cal__today"
          onClick={() => {
            const now = new Date();
            setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
            setSelected(now);
          }}
        >
          Today
        </button>
        <div className="celinen-ios-cal__swatches" role="group" aria-label="Dot color">
          {CALENDAR_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={color}
              aria-pressed={state.accent === color}
              style={{ background: color }}
              onClick={() => persist({ ...state, accent: color })}
            />
          ))}
        </div>
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
                <span className="celinen-ios-cal__dots">
                  {onDay.slice(0, 3).map((event) => (
                    <i
                      key={event.id}
                      style={{ background: event.color || state.accent }}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <div className="celinen-ios-cal__agenda">
          <h2>{agendaLabel}</h2>
          {dayEvents.map((event) => (
            <article key={event.id} className="celinen-ios-cal__event">
              <i style={{ background: event.color || state.accent }} />
              <time dateTime={new Date(event.start).toISOString()}>{timeLabel(event)}</time>
              <div>
                <strong>{event.title}</strong>
                {event.location ? <span>{event.location}</span> : null}
                {event.pose ? <span>{event.pose}</span> : null}
                {event.notes ? <span>{event.notes}</span> : null}
              </div>
            </article>
          ))}
          <form
            className="celinen-ios-cal__add"
            onSubmit={(event) => {
              event.preventDefault();
              addEvent();
            }}
          >
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label="Title"
              placeholder="Title"
              required
            />
            <input
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              aria-label="Location"
              placeholder="Location"
            />
            <input
              value={pose}
              onChange={(event) => setPose(event.target.value)}
              aria-label="Pose"
              placeholder="Pose"
            />
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              aria-label="Notes"
              placeholder="Notes"
              rows={2}
            />
            <label className="celinen-ios-cal__allday">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(event) => setAllDay(event.target.checked)}
              />
              All day
            </label>
            {allDay ? null : (
              <div className="celinen-ios-cal__times">
                <input
                  type="time"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                  aria-label="Start"
                />
                <input
                  type="time"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                  aria-label="End"
                />
              </div>
            )}
            <div className="celinen-ios-cal__swatches" role="group" aria-label="Event color">
              {CALENDAR_COLORS.map((color) => (
                <button
                  key={`event-${color}`}
                  type="button"
                  aria-label={color}
                  aria-pressed={eventColor === color}
                  style={{ background: color }}
                  onClick={() => setEventColor(color)}
                />
              ))}
            </div>
            <button type="submit">Add</button>
          </form>
        </div>
      </div>
    </section>
  );
}
