import type { CalendarEvent } from "./calendar-ics";
import { inferCalendarKind, kindFromSlash, KIND_COLOR } from "./calendar-kinds";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function clock(hour: number, minute: number, mer?: string) {
  let h = hour;
  if (mer) {
    const pm = mer.toLowerCase() === "pm";
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  if (h < 0 || h > 23 || minute < 0 || minute > 59) return null;
  return { h, m: minute };
}

function stamp(day: Date, hours: number, minutes: number) {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes, 0, 0).getTime();
}

function nextWeekday(from: Date, weekday: number) {
  const delta = (weekday - from.getDay() + 7) % 7;
  const next = new Date(from.getFullYear(), from.getMonth(), from.getDate() + delta);
  return next;
}

function takeTime(rest: string): {
  rest: string;
  start: { h: number; m: number } | null;
  end: { h: number; m: number } | null;
  allDay: boolean;
} {
  const range = rest.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i,
  );
  if (range) {
    const mer2 = range[6] || range[3];
    const mer1 = range[3] || mer2;
    const start = clock(Number(range[1]), Number(range[2] || 0), mer1);
    const end = clock(Number(range[4]), Number(range[5] || 0), mer2);
    if (start && end)
      return { rest: rest.replace(range[0], " ").replace(/\s+/g, " ").trim(), start, end, allDay: false };
  }
  const one = rest.match(/\b(\d{1,2})(?::(\d{2}))\s*(am|pm)?\b/i) || rest.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  if (one) {
    const mer = one[3] || one[2];
    const minuteToken = one[0].includes(":") ? one[2] : "0";
    const hourToken = one[1];
    const parsed = one[0].includes(":")
      ? clock(Number(hourToken), Number(minuteToken), one[3])
      : clock(Number(hourToken), 0, mer);
    if (parsed)
      return {
        rest: rest.replace(one[0], " ").replace(/\s+/g, " ").trim(),
        start: parsed,
        end: { h: Math.min(23, parsed.h + 1), m: parsed.m },
        allDay: false,
      };
  }
  const allDay = /\ball[\s-]?day\b/i.test(rest);
  return {
    rest: rest.replace(/\ball[\s-]?day\b/i, " ").replace(/\s+/g, " ").trim(),
    start: null,
    end: null,
    allDay,
  };
}

function takeDate(rest: string, now: Date, selected: Date): { rest: string; day: Date } {
  if (/\btomorrow\b/i.test(rest)) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return { rest: rest.replace(/\btomorrow\b/i, " ").replace(/\s+/g, " ").trim(), day };
  }
  if (/\btoday\b/i.test(rest)) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { rest: rest.replace(/\btoday\b/i, " ").replace(/\s+/g, " ").trim(), day };
  }
  const named = rest.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\b/i,
  );
  if (named) {
    const month = MONTHS[named[1]!.toLowerCase()];
    const date = Number(named[2]);
    if (month !== undefined && date >= 1 && date <= 31) {
      let year = now.getFullYear();
      const candidate = new Date(year, month, date);
      if (candidate.getTime() + 86400000 < now.getTime()) year += 1;
      return {
        rest: rest.replace(named[0], " ").replace(/\s+/g, " ").trim(),
        day: new Date(year, month, date),
      };
    }
  }
  const slash = rest.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slash) {
    const month = Number(slash[1]) - 1;
    const date = Number(slash[2]);
    let year = slash[3] ? Number(slash[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    if (month >= 0 && month <= 11 && date >= 1 && date <= 31) {
      return {
        rest: rest.replace(slash[0], " ").replace(/\s+/g, " ").trim(),
        day: new Date(year, month, date),
      };
    }
  }
  for (const [index, name] of WEEKDAYS.entries()) {
    const re = new RegExp(`\\b${name}\\b`, "i");
    if (re.test(rest)) {
      return {
        rest: rest.replace(re, " ").replace(/\s+/g, " ").trim(),
        day: nextWeekday(now, index),
      };
    }
  }
  return { rest, day: new Date(selected.getFullYear(), selected.getMonth(), selected.getDate()) };
}

/**
 * Turn a photographer note into a calendar event. No network. Date, time, and
 * "at …" location are pulled out; leftover words are the title.
 */
export function parseShootNote(
  input: string,
  options: { now: Date; selected: Date; accent: string },
): CalendarEvent | null {
  const text = input.trim().replace(/\s+/g, " ").slice(0, 400);
  if (!text) return null;
  const slashed = kindFromSlash(text);
  let rest = slashed.rest;
  let location = "";
  const at = rest.match(/\s(?:at|@)\s+(.+)$/i);
  if (at && at.index !== undefined) {
    location = at[1]!.trim().slice(0, 200);
    rest = rest.slice(0, at.index).trim();
  }
  const timed = takeTime(rest);
  rest = timed.rest;
  const dated = takeDate(rest, options.now, options.selected);
  rest = dated.rest.replace(/^[-–,]+|[-–,]+$/g, "").trim();
  const title = (rest || "Shoot").slice(0, 200);
  const kind = slashed.kind ?? inferCalendarKind(title);
  const allDay = timed.allDay || !timed.start;
  const start = allDay
    ? stamp(dated.day, 0, 0)
    : stamp(dated.day, timed.start!.h, timed.start!.m);
  const end = allDay
    ? start + 86400000 - 1
    : stamp(dated.day, timed.end!.h, timed.end!.m);
  return {
    id: `local-${start}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    start,
    end: end > start ? end : start + 3600000,
    allDay,
    source: "local",
    kind,
    color: KIND_COLOR[kind] ?? options.accent,
    ...(location ? { location } : {}),
  };
}
