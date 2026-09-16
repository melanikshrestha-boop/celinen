/** iCal (ICS) parse/build for Google Calendar and the iOS Calendar app. No OAuth. */

import type { CalendarKind } from "./calendar-kinds";

export type CalendarEvent = {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  source: "google" | "local" | "feed";
  location?: string;
  mapsUrl?: string;
  notes?: string;
  pose?: string;
  color?: string;
  kind?: CalendarKind;
};

export const CALENDAR_COLORS = [
  "#ff3b30",
  "#007aff",
  "#34c759",
  "#ffcc00",
  "#af52de",
  "#ff9500",
  "#1c1c1e",
] as const;

export function parseCalendarHex(value: string): string | null {
  const body = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(body)) return null;
  return `#${body.toLowerCase()}`;
}

export function isCalendarColor(value: string): boolean {
  return parseCalendarHex(value) !== null;
}

export function sortCalendarEvents(events: CalendarEvent[]) {
  return [...events].sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}

const FEED_HOSTS = new Set([
  "calendar.google.com",
  "www.google.com",
  "google.com",
  "ical.icloud.com",
  "www.icloud.com",
  "icloud.com",
  "outlook.office365.com",
  "outlook.live.com",
  "calendar.live.com",
]);

export function isCalendarFeedUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 2000) return false;
  let href = trimmed.replace(/^webcal:/i, "https:");
  if (!/^https?:\/\//i.test(href)) href = `https://${href}`;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (url.username || url.password || (url.protocol !== "https:" && url.protocol !== "http:"))
    return false;
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  if (host === "google.com" || host === "www.google.com")
    return url.pathname.toLowerCase().includes("/calendar/");
  return FEED_HOSTS.has(url.hostname.toLowerCase()) || FEED_HOSTS.has(host);
}

export function normalizeCalendarFeedUrl(input: string): string | null {
  if (!isCalendarFeedUrl(input)) return null;
  let href = input.trim().replace(/^webcal:/i, "https:");
  if (!/^https?:\/\//i.test(href)) href = `https://${href}`;
  try {
    return new URL(href).toString();
  } catch {
    return null;
  }
}

export function dayKey(stamp: number, zone = true): string {
  const date = new Date(stamp);
  if (!zone) return date.toISOString().slice(0, 10);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function unfold(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

function unescapeIcs(value: string) {
  return value.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

function parseStamp(raw: string, params: string): { start: number; allDay: boolean } | null {
  const value = raw.trim();
  if (/^\d{8}$/.test(value)) {
    const y = Number(value.slice(0, 4));
    const m = Number(value.slice(4, 6)) - 1;
    const d = Number(value.slice(6, 8));
    if (!y || m < 0 || m > 11 || d < 1) return null;
    return { start: new Date(y, m, d).getTime(), allDay: true };
  }
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!match) return null;
  const [, ys, ms, ds, hs, ns, ss, z] = match;
  const y = Number(ys),
    m = Number(ms) - 1,
    d = Number(ds),
    h = Number(hs),
    n = Number(ns),
    s = Number(ss);
  if (z) return { start: Date.UTC(y, m, d, h, n, s), allDay: false };
  void params;
  return { start: new Date(y, m, d, h, n, s).getTime(), allDay: false };
}

function field(block: string, name: string): { params: string; value: string } | null {
  const re = new RegExp(`(?:^|\\n)${name}([^:\\n]*):([^\\n]*)`, "i");
  const match = block.match(re);
  if (!match) return null;
  return { params: match[1] ?? "", value: match[2] ?? "" };
}

export function parseIcs(text: string, source: CalendarEvent["source"] = "feed"): CalendarEvent[] {
  if (typeof text !== "string" || text.length > 2_000_000) return [];
  const body = unfold(text);
  if (!body.includes("BEGIN:VCALENDAR")) return [];
  const events: CalendarEvent[] = [];
  const chunks = body.split(/BEGIN:VEVENT/i).slice(1);
  for (const chunk of chunks) {
    const block = chunk.split(/END:VEVENT/i)[0] ?? "";
    const startField = field(block, "DTSTART");
    if (!startField) continue;
    const start = parseStamp(startField.value, startField.params);
    if (!start || !Number.isFinite(start.start)) continue;
    const endField = field(block, "DTEND");
    const ended = endField ? parseStamp(endField.value, endField.params) : null;
    const uid = field(block, "UID")?.value?.trim() || `evt-${start.start}-${events.length}`;
    const title = unescapeIcs((field(block, "SUMMARY")?.value ?? "").trim()) || "Busy";
    const end = ended?.start && ended.start > start.start
      ? ended.start
      : start.start + (start.allDay ? 86400000 : 3600000);
    events.push({
      id: uid.slice(0, 200),
      title: title.slice(0, 200),
      start: start.start,
      end,
      allDay: start.allDay,
      source,
    });
    if (events.length >= 500) break;
  }
  return events.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}

function icsStamp(ms: number, allDay: boolean) {
  const date = new Date(ms);
  if (allDay) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return { key: "DTSTART;VALUE=DATE", value: `${y}${m}${d}` };
  }
  return {
    key: "DTSTART",
    value: date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""),
  };
}

function escapeIcs(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/[,;]/g, "\\$&");
}

export function buildIcs(events: CalendarEvent[], now = Date.now()): string {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const rows = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//celinen//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:celinen",
  ];
  for (const event of events) {
    const start = icsStamp(event.start, event.allDay);
    const end = icsStamp(event.end, event.allDay);
    rows.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcs(event.id)}@celinen`,
      `DTSTAMP:${stamp}`,
      `${start.key}:${start.value}`,
      `${end.key.replace("DTSTART", "DTEND")}:${end.value}`,
      `SUMMARY:${escapeIcs(event.title)}`,
      "END:VEVENT",
    );
  }
  return `${rows.join("\r\n")}\r\nEND:VCALENDAR\r\n`;
}

export function monthGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { date, inMonth: date.getMonth() === month };
  });
}

export function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function eventsOnDay(events: CalendarEvent[], day: Date) {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const end = start + 86400000;
  return events.filter((event) => event.start < end && event.end > start);
}

export function weekStart(day: Date) {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate() - day.getDay());
  start.setHours(0, 0, 0, 0);
  return start;
}

export function eventsInWeek(events: CalendarEvent[], day: Date) {
  const start = weekStart(day).getTime();
  const end = start + 7 * 86400000;
  return events.filter((event) => event.start < end && event.end > start);
}

export function weekDays(day: Date) {
  const start = weekStart(day);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

/** Thirteen weeks from the Sunday of the selected month — Fantastical Quarter. */
export function quarterWeeks(day: Date, weeks = 13) {
  const start = weekStart(new Date(day.getFullYear(), day.getMonth(), 1));
  return Array.from({ length: weeks }, (_, week) =>
    Array.from({ length: 7 }, (_, index) => addCalendarDays(start, week * 7 + index)),
  );
}

export function addCalendarDays(day: Date, count: number) {
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + count);
  return next;
}
