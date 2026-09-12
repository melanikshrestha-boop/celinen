import type { CalendarEvent } from "./calendar-ics";

export type CalendarState = {
  feedUrl: string;
  feedEvents: CalendarEvent[];
  localEvents: CalendarEvent[];
};

function key(scope: string) {
  return `celinen.calendar.v1:${scope}`;
}

export function emptyCalendarState(): CalendarState {
  return { feedUrl: "", feedEvents: [], localEvents: [] };
}

function asEvent(value: unknown, source: CalendarEvent["source"]): CalendarEvent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.title !== "string") return null;
  if (!Number.isFinite(row.start) || !Number.isFinite(row.end)) return null;
  return {
    id: row.id.slice(0, 200),
    title: row.title.slice(0, 200),
    start: Number(row.start),
    end: Number(row.end),
    allDay: row.allDay === true,
    source,
  };
}

export function readCalendarState(scope: string): CalendarState {
  try {
    const raw = localStorage.getItem(key(scope));
    if (!raw) return emptyCalendarState();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyCalendarState();
    const row = parsed as Record<string, unknown>;
    const feedUrl = typeof row.feedUrl === "string" ? row.feedUrl.slice(0, 2000) : "";
    const feedEvents = Array.isArray(row.feedEvents)
      ? row.feedEvents.map((item) => asEvent(item, "google")).filter((item): item is CalendarEvent => Boolean(item))
      : [];
    const localEvents = Array.isArray(row.localEvents)
      ? row.localEvents.map((item) => asEvent(item, "local")).filter((item): item is CalendarEvent => Boolean(item))
      : [];
    return { feedUrl, feedEvents: feedEvents.slice(0, 500), localEvents: localEvents.slice(0, 200) };
  } catch {
    return emptyCalendarState();
  }
}

export function writeCalendarState(scope: string, state: CalendarState) {
  localStorage.setItem(
    key(scope),
    JSON.stringify({
      feedUrl: state.feedUrl.slice(0, 2000),
      feedEvents: state.feedEvents.slice(0, 500),
      localEvents: state.localEvents.slice(0, 200),
    }),
  );
}

export function allCalendarEvents(state: CalendarState): CalendarEvent[] {
  return [...state.feedEvents, ...state.localEvents].sort(
    (a, b) => a.start - b.start || a.title.localeCompare(b.title),
  );
}
