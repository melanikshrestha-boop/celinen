import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight, PanelLeft } from "lucide-react";
import { useAccount } from "@/components/account/AccountProvider";
import { parseShootNote } from "@/lib/calendar-assist";
import {
  addCalendarDays,
  eventsOnDay,
  monthGrid,
  sameDay,
  weekDays,
  type CalendarEvent,
} from "@/lib/calendar-ics";
import {
  inferCalendarKind,
  kindInViewSet,
  KIND_COLOR,
  KIND_LABEL,
  type ViewSet,
} from "@/lib/calendar-kinds";
import {
  allCalendarEvents,
  emptyCalendarState,
  readCalendarState,
  writeCalendarState,
} from "@/lib/calendar-store";
import { readBookingTypes, writeBookingTypes, type BookingType } from "@/lib/booking-types";
import { BookingsPanel } from "./BookingsPanel";
import "./ios-calendar.css";

const VIEWS = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
] as const;
type CalView = (typeof VIEWS)[number]["id"];
const SETS: { id: ViewSet; label: string }[] = [
  { id: "everything", label: "Everything" },
  { id: "shoots", label: "Shoots" },
  { id: "post", label: "Post-production" },
  { id: "business", label: "Business" },
];
const WEEK = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6);
const SNAP = 15 * 60 * 1000;

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

function eventKind(event: CalendarEvent) {
  return event.kind ?? inferCalendarKind(event.title);
}

function eventColor(event: CalendarEvent) {
  return KIND_COLOR[eventKind(event)] || event.color || "#2f6fed";
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

function snapMs(value: number, shift: boolean) {
  if (shift) return value;
  return Math.round(value / SNAP) * SNAP;
}

function threeDays(day: Date) {
  return [0, 1, 2].map((offset) => addCalendarDays(day, offset));
}

function MiniMonth({
  month,
  today,
  selected,
  events,
  onPick,
  heading = true,
}: {
  month: Date;
  today: Date;
  selected: Date;
  events: CalendarEvent[];
  onPick: (day: Date) => void;
  heading?: boolean;
}) {
  const cells = monthGrid(month.getFullYear(), month.getMonth());
  return (
    <div className="celinen-ios-cal__mini">
      {heading ? <p>{month.toLocaleString("en-US", { month: "long", year: "numeric" })}</p> : null}
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
              {hits.length ? <i style={{ background: eventColor(hits[0]!) }} /> : null}
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
  const [setName, setSetName] = useState<ViewSet>("everything");
  const [selected, setSelected] = useState(today);
  const [state, setState] = useState(emptyCalendarState);
  const [ask, setAsk] = useState("");
  const [composing, setComposing] = useState(false);
  const [open, setOpen] = useState(true);
  const [inspect, setInspect] = useState<string | null>(null);
  const [bookOpen, setBookOpen] = useState(false);
  const [types, setTypes] = useState<BookingType[]>([]);
  const pendingType = useRef<BookingType | null>(null);
  const askRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLElement>(null);
  const viewsRef = useRef<HTMLDivElement>(null);
  const zoomAt = useRef(0);
  const drag = useRef<{
    id: string;
    mode: "move" | "resize";
    start: number;
    end: number;
    y: number;
    shift: boolean;
  } | null>(null);

  const raw = allCalendarEvents(state);
  const events = raw.filter((event) => kindInViewSet(eventKind(event), setName));
  const week = weekDays(selected);
  const dayColumns = view === "day" ? [selected] : week;
  const timedGrid = {
    gridTemplateColumns: `48px repeat(${dayColumns.length}, minmax(48px, 1fr))`,
    minWidth: 48 + dayColumns.length * 48,
  };
  const preview = ask.trim() ? parseShootNote(ask, { now: new Date(), selected, accent: "#2f6fed" }) : null;
  const inspected = events.find((event) => event.id === inspect) ?? null;

  useEffect(() => {
    if (!scope) return;
    const loaded = readCalendarState(scope);
    const localEvents = loaded.localEvents.filter((event) => !/usc vs ucla/i.test(event.title));
    const next = { ...loaded, localEvents };
    setState(next);
    if (localEvents.length !== loaded.localEvents.length) writeCalendarState(scope, next);
    setTypes(readBookingTypes(scope));
  }, [scope]);

  function stepView(dir: number) {
    const now = performance.now();
    if (now - zoomAt.current < 140) return;
    zoomAt.current = now;
    setView((current) => {
      const index = VIEWS.findIndex((item) => item.id === current);
      return VIEWS[Math.max(0, Math.min(VIEWS.length - 1, index + dir))]?.id ?? current;
    });
  }

  useEffect(() => {
    const root = viewsRef.current;
    const shell = shellRef.current;
    if (!root || !shell) return;
    function onViewsWheel(event: WheelEvent) {
      event.preventDefault();
      stepView(event.deltaY > 0 || event.deltaX > 0 ? 1 : -1);
    }
    function onShellWheel(event: WheelEvent) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      stepView(event.deltaY > 0 ? 1 : -1);
    }
    root.addEventListener("wheel", onViewsWheel, { passive: false });
    shell.addEventListener("wheel", onShellWheel, { passive: false });
    return () => {
      root.removeEventListener("wheel", onViewsWheel);
      shell.removeEventListener("wheel", onShellWheel);
    };
  }, []);

  function persist(next: typeof state) {
    setState(next);
    if (scope) writeCalendarState(scope, next);
  }

  function patchLocal(id: string, patch: Partial<CalendarEvent>) {
    persist({
      ...state,
      localEvents: state.localEvents.map((event) => (event.id === id ? { ...event, ...patch } : event)),
    });
  }

  function jumpToday() {
    setSelected(new Date());
  }

  function step(dir: number) {
    if (view === "day") setSelected(addCalendarDays(selected, dir));
    else if (view === "week") setSelected(addCalendarDays(selected, dir * 7));
    else if (view === "year") setSelected(new Date(selected.getFullYear() + dir, selected.getMonth(), 1));
    else setSelected(new Date(selected.getFullYear(), selected.getMonth() + dir, 1));
  }

  function submitAsk() {
    const event = parseShootNote(ask, { now: new Date(), selected, accent: "#2f6fed" });
    if (!event) return;
    persist({ ...state, localEvents: [...state.localEvents, event] });
    setAsk("");
    setComposing(false);
    setSelected(new Date(event.start));
    setInspect(event.id);
  }

  function removeEvent(id: string) {
    persist({ ...state, localEvents: state.localEvents.filter((event) => event.id !== id) });
    setInspect(null);
  }

  const title = selected.toLocaleString("en-US", { month: "long", year: "numeric" });
  const monthName = selected.toLocaleString("en-US", { month: "long" });
  const yearName = String(selected.getFullYear());
  const tz =
    Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
      .formatToParts(today)
      .find((part) => part.type === "timeZoneName")?.value ?? "";

  const agendaGroups = useMemo(() => {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const tomorrow = addCalendarDays(today, 1);
    const buckets = new Map<string, { label: string; items: CalendarEvent[] }>();
    for (const event of events.filter((item) => item.end >= start).slice(0, 40)) {
      const day = new Date(event.start);
      const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
      let label = day
        .toLocaleString("en-US", { weekday: "long", month: "numeric", day: "numeric", year: "numeric" })
        .toUpperCase();
      if (sameDay(day, today))
        label = `TODAY  ${day.toLocaleDateString("en-US")}`;
      else if (sameDay(day, tomorrow))
        label = `TOMORROW  ${day.toLocaleDateString("en-US")}`;
      const bucket = buckets.get(key) ?? { label, items: [] };
      bucket.items.push(event);
      buckets.set(key, bucket);
    }
    return [...buckets.values()];
  }, [events, today]);

  const agenda = events
    .filter((event) => event.end >= new Date(selected.getFullYear(), selected.getMonth(), selected.getDate()).getTime())
    .slice(0, 18);

  function onKey(event: KeyboardEvent) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      if (event.key === "Escape") (event.target as HTMLElement).blur();
      return;
    }
    if (event.key === "t" || event.key === "T") {
      event.preventDefault();
      jumpToday();
    } else if (event.key === "n" || event.key === "N") {
      event.preventDefault();
      setComposing(true);
      requestAnimationFrame(() => askRef.current?.focus());
    } else if (event.key === "d" || event.key === "D") setView("day");
    else if (event.key === "w" || event.key === "W") setView("week");
    else if (event.key === "m" || event.key === "M") setView("month");
    else if (event.key === "y" || event.key === "Y") setView("year");
    else if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    } else if (event.key === "Escape") setInspect(null);
    else if (event.key === "Delete" || event.key === "Backspace") {
      if (inspected?.source === "local") removeEvent(inspected.id);
    }
  }

  function startMove(event: PointerEvent<HTMLButtonElement>, item: CalendarEvent) {
    if (item.source !== "local") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: item.id,
      mode: event.shiftKey ? "resize" : "move",
      start: item.start,
      end: item.end,
      y: event.clientY,
      shift: event.shiftKey,
    };
  }

  function onMove(event: PointerEvent<HTMLButtonElement>) {
    const job = drag.current;
    if (!job) return;
    const delta = ((event.clientY - job.y) / 48) * 60 * 60 * 1000;
    const next = snapMs(delta, event.shiftKey);
    if (job.mode === "resize") {
      patchLocal(job.id, { end: Math.max(job.start + SNAP, job.end + next) });
    } else {
      patchLocal(job.id, { start: job.start + next, end: job.end + next });
    }
  }

  function endMove() {
    drag.current = null;
  }

  function createAt(day: Date, clientY: number, col: HTMLElement) {
    const rect = col.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const startMin = 6 * 60 + Math.round((pct * 16 * 60) / 15) * 15;
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, startMin).getTime();
    const session = pendingType.current;
    const minutes = session?.durationMin ?? 60;
    const event: CalendarEvent = {
      id: `local-${start}-${Math.random().toString(36).slice(2, 8)}`,
      title: session?.title ?? "Shoot",
      start,
      end: start + minutes * 60 * 1000,
      allDay: false,
      source: "local",
      kind: session ? "meeting" : "shoot",
      color: session ? KIND_COLOR.meeting : KIND_COLOR.shoot,
      ...(session?.location ? { location: session.location } : {}),
    };
    pendingType.current = null;
    persist({ ...state, localEvents: [...state.localEvents, event] });
    setInspect(event.id);
  }

  return (
    <section
      ref={shellRef}
      className={`celinen-dash__cal celinen-ios-cal celinen-ios-cal__shell${open ? "" : " is-slim"}`}
      aria-label="Calendar"
      tabIndex={0}
      onKeyDown={onKey}
    >
      {open ? (
        <aside className="celinen-ios-cal__side">
            <div className="celinen-ios-cal__brand">
              <h2>
                {monthName} <span>{yearName}</span>
              </h2>
            </div>
            <MiniMonth
              month={new Date(selected.getFullYear(), selected.getMonth(), 1)}
              today={today}
              selected={selected}
              events={events}
              heading={false}
              onPick={(day) => {
                setSelected(day);
                if (view === "month" || view === "year") setView("week");
              }}
            />
            <div className="celinen-ios-cal__agenda">
              {agendaGroups.map((group) => (
                <div key={group.label}>
                  <p>{group.label}</p>
                  <ul className="celinen-ios-cal__list">
                    {group.items.map((event) => (
                    <li key={event.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(new Date(event.start));
                          setInspect(event.id);
                          if (view === "month" || view === "year") setView("week");
                        }}
                      >
                        <i style={{ background: eventColor(event) }} />
                        <strong>{event.title}</strong>
                        <span>
                          {event.allDay
                            ? "All day"
                            : new Date(event.start).toLocaleTimeString("en-US", {
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                          {event.location ? `  ${event.location}` : ""}
                        </span>
                      </button>
                    </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <ul className="celinen-ios-cal__cals">
              {SETS.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-pressed={setName === item.id}
                    onClick={() => setSetName(item.id)}
                  >
                    <i data-set={item.id} />
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
      ) : null}
      <div className="celinen-ios-cal__main">
      <div className="celinen-ios-cal__bar">
        <button type="button" className="celinen-ios-cal__rail" aria-label={open ? "Hide sidebar" : "Show sidebar"} onClick={() => setOpen((value) => !value)}>
          <PanelLeft size={16} />
        </button>
        <button type="button" aria-label="Previous" onClick={() => step(-1)}>
          <ChevronLeft size={16} strokeWidth={1.75} />
        </button>
        <button type="button" className="celinen-ios-cal__today" onClick={jumpToday}>
          Today
        </button>
        <button type="button" aria-label="Next" onClick={() => step(1)}>
          <ChevronRight size={16} strokeWidth={1.75} />
        </button>
        <div className="celinen-ios-cal__views" role="tablist" aria-label="View" ref={viewsRef}>
          {VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={view === item.id}
              onClick={() => setView(item.id)}
              onPointerEnter={(event) => {
                // Desktop: hovering a view selects it. Touch still taps.
                if (event.pointerType !== "mouse") return;
                setView(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="celinen-ios-cal__find">
          <span className="sr-only">Search</span>
          <input type="search" placeholder="Search" />
        </label>
        <span className="celinen-ios-cal__tz">{tz}</span>
        <button type="button" className="celinen-ios-cal__today" onClick={() => setBookOpen((value) => !value)}>
          Book
        </button>
        <button
          type="button"
          className="celinen-ios-cal__plus"
          aria-label="Add"
          onClick={() => {
            setComposing(true);
            requestAnimationFrame(() => askRef.current?.focus());
          }}
        >
          +
        </button>
      </div>
      {composing ? (
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
          aria-label="Add event"
          placeholder="Add event"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setComposing(false);
              setAsk("");
            }
          }}
        />
        {preview ? (
          <p className="celinen-ios-cal__preview">
            {new Date(preview.start).toLocaleString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              ...(preview.allDay ? {} : { hour: "numeric", minute: "2-digit" }),
            })}
            {preview.allDay ? "" : `–${new Date(preview.end).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}
            {" · "}
            {KIND_LABEL[preview.kind ?? "shoot"]}
            {preview.location ? ` · ${preview.location}` : ""}
          </p>
        ) : null}
      </form>
      ) : null}
        <div className="celinen-ios-cal__board">
          {view === "year" ? (
            <div className="celinen-ios-cal__year">
              {Array.from({ length: 12 }, (_, index) => new Date(selected.getFullYear(), index, 1)).map((month) => (
                <MiniMonth
                  key={month.toISOString()}
                  month={month}
                  today={today}
                  selected={selected}
                  events={events}
                  onPick={(day) => {
                    setSelected(day);
                    setView("week");
                  }}
                />
              ))}
            </div>
          ) : view === "month" ? (
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
                        <em key={event.id} style={{ borderLeftColor: eventColor(event) }}>
                          {event.title}
                        </em>
                      ))}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="celinen-ios-cal__weekview">
              <div
                className="celinen-ios-cal__weekheads celinen-ios-cal__weekheads--timed"
                style={timedGrid}
              >
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
                        <em key={event.id} style={{ background: eventColor(event) }}>
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
                    onDoubleClick={(event) => createAt(day, event.clientY, event.currentTarget)}
                  >
                    {HOURS.map((hour) => (
                      <i key={hour} />
                    ))}
                    {sameDay(day, today) ? <span className="celinen-ios-cal__now" style={{ top: `${((new Date().getHours() * 60 + new Date().getMinutes() - 360) / (16 * 60)) * 100}%` }} /> : null}
                    {eventsOnDay(events, day)
                      .filter((event) => !event.allDay)
                      .map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          className={`celinen-ios-cal__block${inspect === event.id ? " is-on" : ""}`}
                          style={{
                            ...blockStyle(event, day),
                            ["--evt" as string]: eventColor(event),
                          }}
                          onPointerDown={(pointer) => startMove(pointer, event)}
                          onPointerMove={onMove}
                          onPointerUp={endMove}
                          onPointerCancel={endMove}
                          onClick={() => {
                            setSelected(day);
                            setInspect(event.id);
                          }}
                        >
                          <span>{timeLabel(event)}</span>
                          <strong>{event.title}</strong>
                        </button>
                      ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        {bookOpen ? (
          <BookingsPanel
            types={types}
            onChange={(next) => {
              setTypes(next);
              if (scope) writeBookingTypes(scope, next);
            }}
            onBook={(type) => {
              pendingType.current = type;
              setBookOpen(false);
            }}
          />
        ) : inspected ? (
          <aside className="celinen-ios-cal__inspect" aria-label="Event">
            <button type="button" className="celinen-ios-cal__dismiss" onClick={() => setInspect(null)}>
              Close
            </button>
            <h2>{inspected.title}</h2>
            <p>
              {new Date(inspected.start).toLocaleString("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
                ...(inspected.allDay ? {} : { hour: "numeric", minute: "2-digit" }),
              })}
              {inspected.allDay
                ? ""
                : `–${new Date(inspected.end).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}
            </p>
            {inspected.location ? <p>{inspected.location}</p> : null}
            <p className="celinen-ios-cal__kind">{KIND_LABEL[eventKind(inspected)]}</p>
            {inspected.source === "local" ? (
              <button type="button" onClick={() => removeEvent(inspected.id)}>
                Delete
              </button>
            ) : null}
          </aside>
        ) : null}
      </div>
    </section>
  );
}
