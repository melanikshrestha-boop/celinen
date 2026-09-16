import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, PanelLeft } from "lucide-react";
import { useAccount } from "@/components/account/AccountProvider";
import { parseShootNote } from "@/lib/calendar-assist";
import {
  addCalendarDays,
  eventsOnDay,
  monthGrid,
  quarterWeeks,
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
import {
  formatPlace,
  lookupPlace,
  placeFromGeo,
  placeFromZone,
  readCalendarPlace,
  shortTimeZone,
  writeCalendarPlace,
  type CalendarPlace,
} from "@/lib/calendar-place";
import { readCalendarTasks, writeCalendarTasks, type CalendarTask } from "@/lib/calendar-tasks";
import { BookingsPanel } from "./BookingsPanel";
import "./ios-calendar.css";

const VIEWS = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "quarter", label: "Quarter" },
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

function clockLabel(clock: Date) {
  return clock.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function nowTop(clock: Date) {
  return `${((clock.getHours() * 60 + clock.getMinutes() - 360) / (16 * 60)) * 100}%`;
}

function quarterLabel(date: Date, today: Date) {
  if (sameDay(date, today) || date.getDate() === 1) {
    return date.toLocaleString("en-US", { month: "short", day: "numeric" });
  }
  return String(date.getDate());
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
  const [clock, setClock] = useState(() => new Date());
  const today = clock;
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
  const [place, setPlace] = useState<CalendarPlace>(() => readCalendarPlace() ?? placeFromZone());
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [taskDraft, setTaskDraft] = useState("");
  const [tasksOpen, setTasksOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [viewsLocked, setViewsLocked] = useState(false);
  const viewsLockedRef = useRef(false);
  const taskScope = scope ?? "local";
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
    setTasks(readCalendarTasks(scope ?? "local"));
    if (!scope) return;
    const loaded = readCalendarState(scope);
    const localEvents = loaded.localEvents.filter((event) => !/usc vs ucla/i.test(event.title));
    const next = { ...loaded, localEvents };
    setState(next);
    if (localEvents.length !== loaded.localEvents.length) writeCalendarState(scope, next);
    setTypes(readBookingTypes(scope));
  }, [scope]);

  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 15000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let gone = false;
    async function hydrate() {
      const current = readCalendarPlace() ?? placeFromZone();
      if (!gone) {
        setPlace(current);
        writeCalendarPlace(current);
      }
      try {
        const perm = await navigator.permissions?.query({ name: "geolocation" });
        if (perm?.state === "granted") {
          await askPrecise(true);
          return;
        }
        if (perm?.state === "denied") {
          const next = { ...current, asked: true };
          if (!gone) {
            setPlace(next);
            writeCalendarPlace(next);
          }
          return;
        }
      } catch {
        /* permissions.query is optional */
      }
      if (current.precise) return;
      try {
        const geo = await lookupPlace();
        if (!geo || gone) return;
        const next = placeFromGeo(geo, current);
        setPlace(next);
        writeCalendarPlace(next);
      } catch {
        /* keep zone region */
      }
    }
    void hydrate();
    return () => {
      gone = true;
    };
  }, []);

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
      if (viewsLockedRef.current) return;
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

  function askPrecise(silent = false) {
    return new Promise<void>((resolve) => {
      if (!navigator.geolocation) {
        setPlace((current) => {
          const next = { ...current, asked: true };
          writeCalendarPlace(next);
          return next;
        });
        resolve();
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async (here) => {
          try {
            const geo = await lookupPlace({
              latitude: here.coords.latitude,
              longitude: here.coords.longitude,
            });
            setPlace((current) => {
              const next = placeFromGeo(geo ?? {}, { ...current, asked: true, precise: true });
              writeCalendarPlace(next);
              return next;
            });
          } catch {
            setPlace((current) => {
              const next = { ...current, asked: true };
              writeCalendarPlace(next);
              return next;
            });
          }
          resolve();
        },
        () => {
          setPlace((current) => {
            const next = { ...current, asked: true };
            writeCalendarPlace(next);
            return next;
          });
          resolve();
        },
        { enableHighAccuracy: !silent, maximumAge: 300000, timeout: 12000 },
      );
    });
  }

  function step(dir: number) {
    if (view === "day") setSelected(addCalendarDays(selected, dir));
    else if (view === "week") setSelected(addCalendarDays(selected, dir * 7));
    else if (view === "quarter") setSelected(new Date(selected.getFullYear(), selected.getMonth() + dir * 3, 1));
    else if (view === "year") setSelected(new Date(selected.getFullYear() + dir, selected.getMonth(), 1));
    else setSelected(new Date(selected.getFullYear(), selected.getMonth() + dir, 1));
  }

  function persistTasks(next: CalendarTask[]) {
    setTasks(next);
    writeCalendarTasks(taskScope, next);
  }

  function lockView(next: CalView) {
    setView(next);
    setViewsLocked(true);
    viewsLockedRef.current = true;
  }

  function unlockViews() {
    setViewsLocked(false);
    viewsLockedRef.current = false;
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
    persist({
      ...state,
      localEvents: state.localEvents.filter((event) => event.id !== id),
      feedEvents: state.feedEvents.filter((event) => event.id !== id),
    });
    setInspect(null);
  }

  const title = selected.toLocaleString("en-US", { month: "long", year: "numeric" });
  const monthName = selected.toLocaleString("en-US", { month: "long" });
  const yearName = String(selected.getFullYear());
  const placeLabel = formatPlace({ ...place, tz: place.tz || shortTimeZone(today, place.zone) });

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
    } else if (event.key === "d" || event.key === "D") lockView("day");
    else if (event.key === "w" || event.key === "W") lockView("week");
    else if (event.key === "m" || event.key === "M") lockView("month");
    else if (event.key === "q" || event.key === "Q") lockView("quarter");
    else if (event.key === "y" || event.key === "Y") lockView("year");
    else if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    } else if (event.key === "Escape") {
      setInspect(null);
      setTasksOpen(false);
      setViewsOpen(false);
      unlockViews();
    }
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
              onClick={() => lockView(item.id)}
              onPointerEnter={(event) => {
                // Hover moves the view; a click locks it until Escape.
                if (event.pointerType !== "mouse" || viewsLocked) return;
                setView(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="celinen-ios-cal__tasks-wrap">
            <button
              type="button"
              className="celinen-ios-cal__tasks-btn"
              aria-label="Tasks"
              aria-expanded={tasksOpen}
              onClick={() => {
                setTasksOpen((open) => !open);
                setViewsOpen(false);
              }}
            >
              <Check size={16} strokeWidth={2} />
            </button>
            {tasksOpen ? (
              <div className="celinen-ios-cal__menu" role="dialog" aria-label="All Tasks">
                <p>All Tasks</p>
                <ul>
                  {tasks.map((task) => (
                    <li key={task.id}>
                      <button
                        type="button"
                        className={task.done ? "is-done" : undefined}
                        onClick={() =>
                          persistTasks(
                            tasks.map((item) => (item.id === task.id ? { ...item, done: !item.done } : item)),
                          )
                        }
                      >
                        {task.title}
                      </button>
                    </li>
                  ))}
                </ul>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const title = taskDraft.trim();
                    if (!title) return;
                    persistTasks([...tasks, { id: `task-${Date.now()}`, title, done: false }]);
                    setTaskDraft("");
                  }}
                >
                  <input
                    value={taskDraft}
                    onChange={(event) => setTaskDraft(event.target.value)}
                    aria-label="New task"
                  />
                </form>
              </div>
            ) : null}
        </div>
        <div className="celinen-ios-cal__compact">
          <div className="celinen-ios-cal__views-wrap">
            <button
              type="button"
              className="celinen-ios-cal__views-now"
              aria-haspopup="listbox"
              aria-expanded={viewsOpen}
              onClick={() => {
                setViewsOpen((open) => !open);
                setTasksOpen(false);
              }}
            >
              {VIEWS.find((item) => item.id === view)?.label}
              <ChevronDown size={14} strokeWidth={2} />
            </button>
            {viewsOpen ? (
              <div className="celinen-ios-cal__menu" role="listbox" aria-label="View">
                {VIEWS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={view === item.id}
                    onClick={() => {
                      lockView(item.id);
                      setViewsOpen(false);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <label className="celinen-ios-cal__find">
          <span className="sr-only">Search</span>
          <input type="search" placeholder="Search" />
        </label>
        <div className="celinen-ios-cal__place">
          <span className="celinen-ios-cal__tz">{placeLabel}</span>
          {!place.precise && !place.asked ? (
            <button type="button" className="celinen-ios-cal__locate" onClick={() => void askPrecise()}>
              Allow full location access
            </button>
          ) : null}
        </div>
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
          ) : view === "quarter" ? (
            <div className="celinen-ios-cal__quarter">
              <div className="celinen-ios-cal__weekheads">
                {WEEK.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="celinen-ios-cal__quarter-grid">
                {quarterWeeks(selected).map((week) => (
                  <div key={week[0]?.toISOString()} className="celinen-ios-cal__quarter-row">
                    {week.map((day) => {
                      const on = sameDay(day, today);
                      const monthStart = day.getDate() === 1;
                      const onDay = eventsOnDay(events, day);
                      return (
                        <button
                          key={day.toISOString()}
                          type="button"
                          className={`celinen-ios-cal__qday${on ? " is-today" : ""}${monthStart ? " is-month" : ""}${day.getDay() === 0 || day.getDay() === 6 ? " is-end" : ""}`}
                          onClick={() => setSelected(day)}
                          onDoubleClick={() => setView("day")}
                        >
                          <span className={`celinen-ios-cal__mark${on ? " is-now" : monthStart ? " is-start" : ""}`}>
                            {quarterLabel(day, today)}
                          </span>
                          {onDay.slice(0, 3).map((event) => (
                            <em
                              key={event.id}
                              style={{ background: eventColor(event) }}
                              onClick={(click) => {
                                click.stopPropagation();
                                setSelected(day);
                                setInspect(event.id);
                              }}
                            >
                              {event.title}
                            </em>
                          ))}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
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
                        <em
                          key={event.id}
                          style={{ borderLeftColor: eventColor(event) }}
                          onClick={(click) => {
                            click.stopPropagation();
                            setSelected(cell.date);
                            setInspect(event.id);
                          }}
                        >
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
                        <button
                          key={event.id}
                          type="button"
                          className={`celinen-ios-cal__lane${inspect === event.id ? " is-on" : ""}`}
                          style={{ background: eventColor(event) }}
                          onClick={() => {
                            setSelected(day);
                            setInspect(event.id);
                          }}
                        >
                          {event.title}
                        </button>
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
                {dayColumns.some((day) => sameDay(day, today)) ? (
                  <span className="celinen-ios-cal__now" style={{ top: nowTop(clock) }}>
                    <em>{clockLabel(clock)}</em>
                  </span>
                ) : null}
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
            <button type="button" onClick={() => removeEvent(inspected.id)}>
              Delete
            </button>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
