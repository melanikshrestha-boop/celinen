import { isCalendarColor, sortCalendarEvents, type CalendarEvent } from "./calendar-ics";
import { isGoogleMapsUrl } from "./maps-places";
import { isCalendarKind } from "./calendar-kinds";

export type CalendarState = {
  feedUrl: string;
  feedEvents: CalendarEvent[];
  localEvents: CalendarEvent[];
  accent: string;
};

function key(scope: string) {
  return `celinen.calendar.v1:${scope}`;
}

function droppedKey(scope: string) {
  return `celinen.calendar.dropped.v1:${scope}`;
}

export function eventDropMark(event: { start: number; title: string }) {
  return `t:${event.start}:${event.title}`;
}

export function readDroppedMarks(scope: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(droppedKey(scope)) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string").slice(-500) : [];
  } catch {
    return [];
  }
}

export function writeDroppedMarks(scope: string, ids: Iterable<string>) {
  localStorage.setItem(droppedKey(scope), JSON.stringify([...new Set(ids)].slice(-500)));
}

export function isCalendarDeleteCommand(title: string) {
  return /^\s*delete\s*$/i.test(title);
}

export function isCalendarDeleteKey(key: string) {
  return key === "Delete" || key === "Backspace";
}

export function dropCalendarEvent(
  state: CalendarState,
  id: string,
  twin?: { start: number; title: string },
): CalendarState {
  const skip = (event: { id: string; start: number; title: string }) =>
    event.id === id || Boolean(twin && event.start === twin.start && event.title === twin.title);
  return {
    ...state,
    localEvents: state.localEvents.filter((event) => !skip(event)),
    feedEvents: state.feedEvents.filter((event) => !skip(event)),
  };
}

export function emptyCalendarState(): CalendarState {
  return { feedUrl: "", feedEvents: [], localEvents: [], accent: "#ff3b30" };
}

function asEvent(value: unknown, source: CalendarEvent["source"]): CalendarEvent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.title !== "string") return null;
  if (!Number.isFinite(row.start) || !Number.isFinite(row.end)) return null;
  const location = typeof row.location === "string" ? row.location.slice(0, 200) : "";
  const mapsUrl =
    typeof row.mapsUrl === "string" && isGoogleMapsUrl(row.mapsUrl) ? row.mapsUrl.slice(0, 2000) : "";
  const notes = typeof row.notes === "string" ? row.notes.slice(0, 2000) : "";
  const pose = typeof row.pose === "string" ? row.pose.slice(0, 80) : "";
  const color = typeof row.color === "string" && isCalendarColor(row.color) ? row.color : undefined;
  const kind = typeof row.kind === "string" && isCalendarKind(row.kind) ? row.kind : undefined;
  return {
    id: row.id.slice(0, 200),
    title: row.title.slice(0, 200),
    start: Number(row.start),
    end: Number(row.end),
    allDay: row.allDay === true,
    source,
    ...(location ? { location } : {}),
    ...(mapsUrl ? { mapsUrl } : {}),
    ...(notes ? { notes } : {}),
    ...(pose ? { pose } : {}),
    ...(color ? { color } : {}),
    ...(kind ? { kind } : {}),
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
    const accent = typeof row.accent === "string" && isCalendarColor(row.accent) ? row.accent : "#ff3b30";
    return {
      feedUrl,
      feedEvents: sortCalendarEvents(feedEvents).slice(0, 500),
      localEvents: sortCalendarEvents(localEvents).slice(0, 200),
      accent,
    };
  } catch {
    return emptyCalendarState();
  }
}

export function writeCalendarState(scope: string, state: CalendarState) {
  localStorage.setItem(
    key(scope),
    JSON.stringify({
      feedUrl: state.feedUrl.slice(0, 2000),
      feedEvents: sortCalendarEvents(state.feedEvents).slice(0, 500),
      localEvents: sortCalendarEvents(state.localEvents).slice(0, 200),
      accent: isCalendarColor(state.accent) ? state.accent : "#ff3b30",
    }),
  );
}

export function allCalendarEvents(state: CalendarState): CalendarEvent[] {
  return sortCalendarEvents([...state.feedEvents, ...state.localEvents]);
}
