import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Moon, PanelLeft, Sun } from "lucide-react";
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
  dropCalendarEvent,
  emptyCalendarState,
  eventDropMark,
  isCalendarDeleteCommand,
  isCalendarDeleteKey,
  readCalendarState,
  readDroppedMarks,
  writeCalendarState,
  writeDroppedMarks,
} from "@/lib/calendar-store";
import { readBookingTypes, writeBookingTypes, type BookingType } from "@/lib/booking-types";
import { readCalendarTasks, writeCalendarTasks, type CalendarTask } from "@/lib/calendar-tasks";
import { mapsSearchUrl } from "@/lib/maps-places";
import { registerAppKeys } from "@/lib/app-keys";
import { BookingsPanel } from "./BookingsPanel";
import { EventSheet, type EventSheetValue } from "./EventSheet";
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
const HOURS = Array.from({ length: 24 }, (_, i) => i);
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
  return `${((clock.getHours() * 60 + clock.getMinutes()) / (24 * 60)) * 100}%`;
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
  const origin = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
  const minutes = Math.max(0, (start.getTime() - origin.getTime()) / 60000);
  const dur = Math.max(25, (end.getTime() - start.getTime()) / 60000);
  return {
    top: `${(minutes / (24 * 60)) * 100}%`,
    height: `${Math.min(100, (dur / (24 * 60)) * 100)}%`,
  };
}

function snapMs(value: number, shift: boolean) {
  if (shift) return value;
  return Math.round(value / SNAP) * SNAP;
}

function minutesFromY(clientY: number, col: HTMLElement) {
  const rect = col.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
  return Math.round((pct * 24 * 60) / 15) * 15;
}

function stampMinutes(day: Date, minutes: number) {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes).getTime();
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
  layout = "side",
}: {
  month: Date;
  today: Date;
  selected: Date;
  events: CalendarEvent[];
  onPick: (day: Date) => void;
  heading?: boolean;
  layout?: "side" | "year";
}) {
  const cells = monthGrid(month.getFullYear(), month.getMonth());
  const year = layout === "year";
  return (
    <div className={year ? "celinen-ios-cal__ymonth" : "celinen-ios-cal__mini"}>
      {heading ? (
        <p>{month.toLocaleString("en-US", { month: year ? "long" : "long", year: year ? undefined : "numeric" })}</p>
      ) : null}
      <div className={year ? "celinen-ios-cal__ymonth-week" : "celinen-ios-cal__mini-week"}>
        {(year ? WEEK : ["S", "M", "T", "W", "T", "F", "S"]).map((d, i) => (
          <span key={`${d}-${i}`}>{d}</span>
        ))}
      </div>
      <div className={year ? "celinen-ios-cal__ymonth-grid" : "celinen-ios-cal__mini-grid"}>
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
              {hits.length ? <i aria-hidden="true" /> : null}
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
  const [sheet, setSheet] = useState<{
    mode: "create" | "edit";
    value: EventSheetValue;
    anchor: { top: number; left: number };
  } | null>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const [bookOpen, setBookOpen] = useState(false);
  const [types, setTypes] = useState<BookingType[]>([]);
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
    moved: boolean;
  } | null>(null);
  const paint = useRef<{ day: Date; origin: number; col: HTMLElement } | null>(null);
  const [ghost, setGhost] = useState<{ start: number; end: number } | null>(null);
  const droppedIds = useRef(new Set<string>());
  const undoDeleted = useRef<CalendarEvent[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const inspectRef = useRef(inspect);
  inspectRef.current = inspect;

  const raw = allCalendarEvents(state);
  const events = raw.filter(
    (event) =>
      !droppedIds.current.has(event.id) &&
      !droppedIds.current.has(eventDropMark(event)) &&
      kindInViewSet(eventKind(event), setName),
  );
  const week = weekDays(selected);
  const dayColumns = view === "day" ? [selected] : week;
  const timedGrid = {
    gridTemplateColumns: `56px repeat(${dayColumns.length}, minmax(48px, 1fr))`,
    minWidth: 56 + dayColumns.length * 48,
  };
  const preview = ask.trim() ? parseShootNote(ask, { now: new Date(), selected, accent: "#2f6fed" }) : null;
  const inspected = events.find((event) => event.id === inspect) ?? null;
  const shownGhost =
    ghost ??
    (sheet?.mode === "create" && !sheet.value.allDay
      ? { start: sheet.value.start, end: sheet.value.end }
      : null);

  useEffect(() => {
    const store = scope ?? "local";
    for (const mark of readDroppedMarks(store)) droppedIds.current.add(mark);
    setTasks(readCalendarTasks(store));
    const loaded = readCalendarState(store);
    const keep = (event: CalendarEvent) =>
      !droppedIds.current.has(event.id) &&
      !droppedIds.current.has(eventDropMark(event)) &&
      !/usc vs ucla/i.test(event.title);
    const localEvents = loaded.localEvents.filter(keep);
    const feedEvents = loaded.feedEvents.filter(keep);
    const next = { ...loaded, localEvents, feedEvents };
    setState(next);
    if (
      localEvents.length !== loaded.localEvents.length ||
      feedEvents.length !== loaded.feedEvents.length
    )
      writeCalendarState(store, next);
    setTypes(readBookingTypes(store));
  }, [scope]);

  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 15000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    function onWindowKey(event: globalThis.KeyboardEvent) {
      const target = event.target;
      const inField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      const selectedId = sheetRef.current?.value.id || inspectRef.current;
      if (!selectedId) return;
      if (event.key === "Backspace" && inField && !event.metaKey && !event.ctrlKey) return;
      if (!isCalendarDeleteKey(event.key)) return;
      event.preventDefault();
      persist(dropCalendarEvent(stateRef.current, selectedId));
      inspectRef.current = null;
      sheetRef.current = null;
      setInspect(null);
      setSheet(null);
      setGhost(null);
    }
    window.addEventListener("keydown", onWindowKey);
    return () => window.removeEventListener("keydown", onWindowKey);
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
    const keep = (event: CalendarEvent) =>
      !droppedIds.current.has(event.id) && !droppedIds.current.has(eventDropMark(event));
    const cleaned = {
      ...next,
      localEvents: next.localEvents.filter(keep),
      feedEvents: next.feedEvents.filter(keep),
    };
    stateRef.current = cleaned;
    setState(cleaned);
    const store = scope ?? "local";
    writeCalendarState(store, cleaned);
    writeDroppedMarks(store, droppedIds.current);
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

  function removeEvent(id: string, fallback?: { start: number; title: string }) {
    const current = stateRef.current;
    const hit =
      [...current.localEvents, ...current.feedEvents].find((event) => event.id === id) ??
      (fallback
        ? [...current.localEvents, ...current.feedEvents].find(
            (event) => event.start === fallback.start && event.title === fallback.title,
          )
        : undefined);
    const targetId = hit?.id ?? id;
    if (hit) undoDeleted.current.push(hit);
    droppedIds.current.add(targetId);
    if (hit) {
      droppedIds.current.add(eventDropMark(hit));
      for (const event of [...current.localEvents, ...current.feedEvents]) {
        if (event.start === hit.start && event.title === hit.title) {
          droppedIds.current.add(event.id);
          droppedIds.current.add(eventDropMark(event));
        }
      }
    } else if (fallback) droppedIds.current.add(eventDropMark(fallback));
    const twin = hit ?? fallback;
    persist(dropCalendarEvent(current, targetId, twin));
    if (scope && scope !== "local") {
      writeCalendarState("local", dropCalendarEvent(readCalendarState("local"), targetId, twin));
      writeDroppedMarks("local", droppedIds.current);
    }
    inspectRef.current = null;
    sheetRef.current = null;
    setInspect(null);
    setSheet(null);
    setGhost(null);
  }

  function undoDeletedEvent() {
    const event = undoDeleted.current.pop();
    if (!event) return;
    droppedIds.current.delete(event.id);
    droppedIds.current.delete(eventDropMark(event));
    persist({
      ...stateRef.current,
      localEvents:
        event.source === "local"
          ? [...stateRef.current.localEvents, event]
          : stateRef.current.localEvents,
      feedEvents:
        event.source === "local"
          ? stateRef.current.feedEvents
          : [...stateRef.current.feedEvents, event],
    });
  }

  useEffect(() => {
    return registerAppKeys({
      undo: undoDeletedEvent,
      copy: () => {
        const id = inspectRef.current;
        const event = [...stateRef.current.localEvents, ...stateRef.current.feedEvents].find(
          (item) => item.id === id,
        );
        const title = event?.title || sheetRef.current?.value.title.trim();
        if (!title) return false;
        void navigator.clipboard.writeText(title);
        return true;
      },
      paste: (_files, text) => {
        const note = text.trim();
        if (!note) return false;
        const event = parseShootNote(note, { now: new Date(), selected, accent: "#2f6fed" });
        if (!event) return false;
        persist({ ...stateRef.current, localEvents: [...stateRef.current.localEvents, event] });
        return true;
      },
    });
  }, [selected]);

  function valueFromEvent(event: CalendarEvent): EventSheetValue {
    const location = event.location ?? "";
    return {
      id: event.id,
      title: event.title,
      location,
      mapsUrl: event.mapsUrl || (location ? mapsSearchUrl(location) : ""),
      allDay: event.allDay,
      start: event.start,
      end: event.end,
    };
  }

  function openSheet(mode: "create" | "edit", value: EventSheetValue, el: HTMLElement) {
    const box = el.getBoundingClientRect();
    setInspect(value.id ?? null);
    setSheet({ mode, value, anchor: { top: box.bottom + 8, left: box.left } });
  }

  function saveSheet() {
    if (!sheet) return;
    if (sheet.value.id && droppedIds.current.has(sheet.value.id)) {
      setSheet(null);
      return;
    }
    if (sheet.mode === "edit" && sheet.value.id && isCalendarDeleteCommand(sheet.value.title)) {
      removeEvent(sheet.value.id);
      return;
    }
    const title = sheet.value.title.trim() || "Shoot";
    const location = sheet.value.location.trim();
    const mapsUrl = (sheet.value.mapsUrl.trim() || (location ? mapsSearchUrl(location) : "")).slice(0, 2000);
    if (sheet.mode === "edit" && sheet.value.id) {
      patchLocal(sheet.value.id, {
        title,
        start: sheet.value.start,
        end: Math.max(sheet.value.end, sheet.value.start + (sheet.value.allDay ? 86400000 : SNAP)),
        allDay: sheet.value.allDay,
        location,
        mapsUrl,
      });
    } else {
      const event: CalendarEvent = {
        id: `local-${sheet.value.start}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        start: sheet.value.start,
        end: Math.max(sheet.value.end, sheet.value.start + (sheet.value.allDay ? 86400000 : SNAP)),
        allDay: sheet.value.allDay,
        source: "local",
        kind: "shoot",
        color: KIND_COLOR.shoot,
        ...(location ? { location, mapsUrl } : {}),
      };
      persist({ ...state, localEvents: [...state.localEvents, event] });
    }
    setSheet(null);
    setGhost(null);
  }

  const title = selected.toLocaleString("en-US", { month: "long", year: "numeric" });
  const monthName = selected.toLocaleString("en-US", { month: "long" });
  const yearName = String(selected.getFullYear());

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
    const inField =
      event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    const selectedId = sheetRef.current?.value.id || inspectRef.current;
    if (isCalendarDeleteKey(event.key) && selectedId && !inField) {
      event.preventDefault();
      removeEvent(selectedId);
      return;
    }
    if (event.key === "Delete" && selectedId && inField) {
      event.preventDefault();
      removeEvent(selectedId);
      return;
    }
    if (inField) {
      if (event.key === "Escape") (event.target as HTMLElement).blur();
      return;
    }
    if (event.key === "t" || event.key === "T") {
      event.preventDefault();
      jumpToday();
    } else if (event.key === "n" || event.key === "N") {
      event.preventDefault();
      setComposing(true);
      askRef.current?.focus();
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
      setSheet(null);
      setTasksOpen(false);
      setViewsOpen(false);
      unlockViews();
    }
  }

  function startMove(event: PointerEvent<HTMLButtonElement>, item: CalendarEvent) {
    inspectRef.current = item.id;
    setInspect(item.id);
    if (item.source !== "local") return;
    drag.current = {
      id: item.id,
      mode: event.shiftKey ? "resize" : "move",
      start: item.start,
      end: item.end,
      y: event.clientY,
      shift: event.shiftKey,
      moved: false,
    };
  }

  function onMove(event: PointerEvent<HTMLButtonElement>) {
    const job = drag.current;
    if (!job) return;
    if (!job.moved && Math.abs(event.clientY - job.y) < 8) return;
    if (!job.moved) {
      job.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
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
    const startMin = Math.round((pct * 24 * 60) / 15) * 15;
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
    openSheet(
      "create",
      {
        title: event.title === "Shoot" ? "" : event.title,
        location: event.location ?? "",
        mapsUrl: "",
        allDay: false,
        start: event.start,
        end: event.end,
      },
      col,
    );
  }

  function paintStart(event: PointerEvent<HTMLDivElement>, day: Date) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button, .celinen-ios-cal__now, .celinen-ios-cal__ghost")) return;
    const col = event.currentTarget;
    col.setPointerCapture(event.pointerId);
    const origin = minutesFromY(event.clientY, col);
    paint.current = { day, origin, col };
    const start = stampMinutes(day, origin);
    setGhost({ start, end: start + 60 * 60 * 1000 });
    setSelected(day);
  }

  function paintMove(event: PointerEvent<HTMLDivElement>) {
    const job = paint.current;
    if (!job) return;
    const now = minutesFromY(event.clientY, job.col);
    const a = Math.min(job.origin, now);
    const b = Math.max(job.origin + 15, now);
    setGhost({ start: stampMinutes(job.day, a), end: stampMinutes(job.day, b) });
  }

  function paintEnd(event: PointerEvent<HTMLDivElement>) {
    const job = paint.current;
    if (!job) return;
    paint.current = null;
    const now = minutesFromY(event.clientY, job.col);
    const a = Math.min(job.origin, now);
    const b = Math.max(job.origin + 60, now === job.origin ? job.origin + 60 : now);
    const start = stampMinutes(job.day, a);
    const end = stampMinutes(job.day, Math.max(a + 15, b));
    setGhost({ start, end });
    const session = pendingType.current;
    pendingType.current = null;
    openSheet(
      "create",
      {
        title: session?.title ?? "",
        location: session?.location ?? "",
        mapsUrl: "",
        allDay: false,
        start,
        end,
      },
      job.col,
    );
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
              <div className="celinen-dash__theme celinen-ios-cal__theme" role="group" aria-label="Appearance">
                <button
                  type="button"
                  aria-label="Light"
                  aria-pressed={account?.preferences.theme === "light"}
                  onClick={() => account?.savePreferences({ theme: "light" })}
                >
                  <Sun size={14} strokeWidth={1.5} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Dark"
                  aria-pressed={account?.preferences.theme === "dark"}
                  onClick={() => account?.savePreferences({ theme: "dark" })}
                >
                  <Moon size={14} strokeWidth={1.5} aria-hidden="true" />
                </button>
              </div>
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
                        onClick={(click) => {
                          setSelected(new Date(event.start));
                          openSheet("edit", valueFromEvent(event), click.currentTarget);
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
        <div className="celinen-ios-cal__bar-nav">
        <button type="button" aria-label="Previous" onClick={() => step(-1)}>
          <ChevronLeft size={16} strokeWidth={1.75} />
        </button>
        <button type="button" className="celinen-ios-cal__today" onClick={jumpToday}>
          Today
        </button>
        <button type="button" aria-label="Next" onClick={() => step(1)}>
          <ChevronRight size={16} strokeWidth={1.75} />
        </button>
        </div>
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
        <div className="celinen-ios-cal__bar-tools">
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
        <form
          className="celinen-ios-cal__find"
          onSubmit={(event) => {
            event.preventDefault();
            submitAsk();
          }}
        >
          <label>
            <span className="sr-only">Add or find</span>
            <input
              ref={askRef}
              type="search"
              value={ask}
              placeholder="Tomorrow 2pm shoot at the park"
              onChange={(event) => setAsk(event.target.value)}
            />
          </label>
          {preview ? (
            <span className="celinen-ios-cal__ask-preview">
              {preview.title}
              {preview.allDay
                ? " · All day"
                : ` · ${new Date(preview.start).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}`}
            </span>
          ) : null}
        </form>
        <button type="button" className="celinen-ios-cal__today" onClick={() => setBookOpen((value) => !value)}>
          Book
        </button>
        <button
          ref={plusRef}
          type="button"
          className="celinen-ios-cal__plus"
          aria-label="Add"
          onClick={(event) => {
            const day = selected;
            const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
            openSheet(
              "create",
              {
                title: "",
                location: "",
                mapsUrl: "",
                allDay: true,
                start,
                end: start + 86400000,
              },
              event.currentTarget,
            );
          }}
        >
          +
        </button>
        <button type="button" className="celinen-ios-cal__rail" aria-label={open ? "Hide sidebar" : "Show sidebar"} onClick={() => setOpen((value) => !value)}>
          <PanelLeft size={16} />
        </button>
        </div>
      </div>
        <div className="celinen-ios-cal__board">
          {view === "year" ? (
            <div className="celinen-ios-cal__year">
              <p className="celinen-ios-cal__year-label">{selected.getFullYear()}</p>
              <div className="celinen-ios-cal__year-grid">
                {Array.from({ length: 12 }, (_, index) => new Date(selected.getFullYear(), index, 1)).map((month) => (
                  <MiniMonth
                    key={month.toISOString()}
                    month={month}
                    today={today}
                    selected={selected}
                    events={events}
                    layout="year"
                    onPick={(day) => {
                      setSelected(day);
                      setView("week");
                    }}
                  />
                ))}
              </div>
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
                                openSheet("edit", valueFromEvent(event), click.currentTarget);
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
                            openSheet("edit", valueFromEvent(event), click.currentTarget);
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
                className={`celinen-ios-cal__weekheads celinen-ios-cal__weekheads--timed${view === "day" ? " celinen-ios-cal__weekheads--day" : ""}`}
                style={timedGrid}
              >
                <span />
                {dayColumns.map((day) => {
                  const on = sameDay(day, today);
                  const sel = sameDay(day, selected);
                  const end = day.getDay() === 0 || day.getDay() === 6;
                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      className={`${on ? "is-today" : ""}${sel ? " is-selected" : ""}${end ? " is-end" : ""}`}
                      onClick={() => setSelected(day)}
                    >
                      {view === "day" ? (
                        <>
                          <small>{day.toLocaleString("en-US", { weekday: "long" })}</small>
                          <span className="celinen-ios-cal__daystamp">
                            {day.toLocaleString("en-US", { month: "short" })}
                            <b>{day.getDate()}</b>
                          </span>
                        </>
                      ) : (
                        <>
                          <small>{WEEK[day.getDay()]}</small>
                          <b>{day.getDate()}</b>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="celinen-ios-cal__lanes" style={timedGrid}>
                <span className="celinen-ios-cal__allday">all-day</span>
                {dayColumns.map((day) => (
                  <div
                    key={`lane-${day.toISOString()}`}
                    className={`${sameDay(day, selected) ? " is-selected" : ""}${day.getDay() === 0 || day.getDay() === 6 ? " is-end" : ""}`}
                  >
                    {eventsOnDay(events, day)
                      .filter((event) => event.allDay)
                      .map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          className={`celinen-ios-cal__lane${sheet?.value.id === event.id ? " is-on" : ""}`}
                          style={{ background: eventColor(event) }}
                          onClick={(click) => {
                            setSelected(day);
                            openSheet("edit", valueFromEvent(event), click.currentTarget);
                          }}
                          onDoubleClick={(click) => click.stopPropagation()}
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
                    className={`celinen-ios-cal__col${sameDay(day, today) ? " is-today" : ""}${sameDay(day, selected) ? " is-selected" : ""}${day.getDay() === 0 || day.getDay() === 6 ? " is-end" : ""}`}
                    onDoubleClick={(event) => createAt(day, event.clientY, event.currentTarget)}
                    onPointerDown={(event) => paintStart(event, day)}
                    onPointerMove={paintMove}
                    onPointerUp={paintEnd}
                    onPointerCancel={() => {
                      paint.current = null;
                      setGhost(null);
                    }}
                  >
                    {HOURS.map((hour) => (
                      <i key={hour} />
                    ))}
                    {shownGhost && sameDay(new Date(shownGhost.start), day) ? (
                      <div
                        className="celinen-ios-cal__ghost"
                        style={blockStyle(
                          { start: shownGhost.start, end: shownGhost.end, title: "", id: "ghost", allDay: false, source: "local" },
                          day,
                        )}
                      >
                        <span>
                          {new Date(shownGhost.start).toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                          –
                          {new Date(shownGhost.end).toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                        <strong>{sheet?.value.title.trim() || "(No title)"}</strong>
                      </div>
                    ) : null}
                    {eventsOnDay(events, day)
                      .filter((event) => !event.allDay)
                      .map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          className={`celinen-ios-cal__block${sheet?.value.id === event.id ? " is-on" : ""}`}
                          style={{
                            ...blockStyle(event, day),
                            ["--evt" as string]: eventColor(event),
                          }}
                          onPointerDown={(pointer) => startMove(pointer, event)}
                          onPointerMove={onMove}
                          onPointerUp={endMove}
                          onPointerCancel={endMove}
                          onClick={(click) => {
                            setSelected(day);
                            setInspect(event.id);
                            openSheet("edit", valueFromEvent(event), click.currentTarget);
                          }}
                          onDoubleClick={(click) => {
                            click.stopPropagation();
                            setSelected(day);
                            setInspect(event.id);
                            openSheet("edit", valueFromEvent(event), click.currentTarget);
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
              writeBookingTypes(scope ?? "local", next);
            }}
            onBook={(type) => {
              pendingType.current = type;
              setBookOpen(false);
            }}
          />
        ) : null}
        {sheet ? (
          <EventSheet
            mode={sheet.mode}
            value={sheet.value}
            anchor={sheet.anchor}
            onChange={(value) => setSheet({ ...sheet, value })}
            onSave={saveSheet}
            onDelete={
              sheet.mode === "edit"
                ? () =>
                    removeEvent(sheet.value.id ?? "", {
                      start: sheet.value.start,
                      title: sheet.value.title,
                    })
                : undefined
            }
            onClose={() => {
              setSheet(null);
              setGhost(null);
            }}
          />
        ) : null}
      </div>
    </section>
  );
}
