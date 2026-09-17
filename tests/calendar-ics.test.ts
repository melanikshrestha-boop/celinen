import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildIcs,
  eventsOnDay,
  isCalendarFeedUrl,
  monthGrid,
  parseIcs,
  quarterWeeks,
  sameDay,
} from "../src/lib/calendar-ics";
import {
  dropCalendarEvent,
  emptyCalendarState,
  eventDropMark,
  isCalendarDeleteCommand,
  isCalendarDeleteKey,
} from "../src/lib/calendar-store";

test("typing Delete on a note is a delete command", () => {
  expect(isCalendarDeleteCommand("Delete")).toBe(true);
  expect(isCalendarDeleteCommand(" delete ")).toBe(true);
  expect(isCalendarDeleteCommand("dih")).toBe(false);
  expect(isCalendarDeleteCommand("Delete later")).toBe(false);
  expect(isCalendarDeleteKey("Delete")).toBe(true);
  expect(isCalendarDeleteKey("Backspace")).toBe(true);
  expect(isCalendarDeleteKey("Enter")).toBe(false);
});

test("dropCalendarEvent removes local and feed rows by id", () => {
  const state = emptyCalendarState();
  const local = {
    id: "local-1",
    title: "clih",
    start: 1,
    end: 2,
    allDay: false,
    source: "local" as const,
  };
  const feed = {
    id: "feed-1",
    title: "dih",
    start: 3,
    end: 4,
    allDay: false,
    source: "google" as const,
  };
  const next = dropCalendarEvent({ ...state, localEvents: [local], feedEvents: [feed] }, "local-1");
  expect(next.localEvents).toEqual([]);
  expect(next.feedEvents).toEqual([feed]);
  expect(dropCalendarEvent(next, "feed-1").feedEvents).toEqual([]);
  const clone = { ...local, id: "local-2", title: "dih", start: 5, end: 6 };
  const twins = dropCalendarEvent(
    { ...state, localEvents: [local, clone] },
    "local-2",
    { start: 5, title: "dih" },
  );
  expect(twins.localEvents).toEqual([local]);
  expect(eventDropMark({ id: "x", start: 5, title: "dih" })).toBe("t:5:dih");
});

test("Google and Calendar iCal hosts are accepted, junk is not", () => {
  expect(
    isCalendarFeedUrl(
      "https://calendar.google.com/calendar/ical/you%40gmail.com/private-abc/basic.ics",
    ),
  ).toBe(true);
  expect(isCalendarFeedUrl("webcal://calendar.google.com/calendar/ical/x/public/basic.ics")).toBe(
    true,
  );
  expect(isCalendarFeedUrl("https://evil.com/calendar.google.com/basic.ics")).toBe(false);
  expect(isCalendarFeedUrl("javascript:alert(1)")).toBe(false);
});

test("ICS parser keeps timed and all-day events in order", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:a",
    "DTSTART:20260911T170000Z",
    "DTEND:20260911T180000Z",
    "SUMMARY:Park shoot",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:b",
    "DTSTART;VALUE=DATE:20260912",
    "SUMMARY:All day hold",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const events = parseIcs(ics, "google");
  expect(events).toHaveLength(2);
  expect(events[0]?.title).toBe("Park shoot");
  expect(events[0]?.allDay).toBe(false);
  expect(events[1]?.allDay).toBe(true);
  expect(parseIcs(buildIcs(events)).map((event) => event.title)).toEqual([
    "Park shoot",
    "All day hold",
  ]);
});

test("month grid is six iOS weeks and today matching is local", () => {
  const cells = monthGrid(2026, 8);
  expect(cells).toHaveLength(42);
  expect(cells[0]?.date.getDay()).toBe(0);
  expect(sameDay(new Date(2026, 8, 11), new Date(2026, 8, 11, 22))).toBe(true);
  const day = new Date(2026, 8, 11);
  const hits = eventsOnDay(
    [{ id: "1", title: "x", start: day.getTime() + 3600000, end: day.getTime() + 7200000, allDay: false, source: "local" }],
    day,
  );
  expect(hits).toHaveLength(1);
});

test("quarter is thirteen Sunday-start weeks from the selected month", () => {
  const weeks = quarterWeeks(new Date(2026, 8, 15));
  expect(weeks).toHaveLength(13);
  expect(weeks[0]).toHaveLength(7);
  expect(weeks[0]?.[0]?.getDay()).toBe(0);
  expect(weeks[0]?.[2]?.getDate()).toBe(1);
  expect(weeks[0]?.[2]?.getMonth()).toBe(8);
});

test("dashboard calendar fills the page, no add form, no Google connectors", () => {
  const dash = readFileSync(new URL("../src/components/dashboard/AppDashboard.tsx", import.meta.url), "utf8");
  const cal = readFileSync(new URL("../src/components/dashboard/IosCalendar.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/components/dashboard/ios-calendar.css", import.meta.url), "utf8");
  expect(dash).toContain("IosCalendar");
  expect(cal).not.toContain("Google Calendar");
  expect(cal).not.toContain("Add to Calendar");
  expect(cal).not.toContain('placeholder="Location"');
  expect(cal).not.toContain('placeholder="Pose"');
  expect(cal).not.toContain('placeholder="Title"');
  expect(cal).not.toContain('placeholder="All day"');
  expect(cal).toContain("parseShootNote");
  expect(cal).toContain("Tomorrow 2pm shoot at the park");
  expect(cal).toContain("submitAsk");
  expect(cal).toContain('scope ?? "local"');
  expect(cal).toContain("length: 24");
  expect(cal).toContain("Quarter");
  expect(cal).toContain("All Tasks");
  expect(cal).toContain("onDoubleClick");
  expect(cal).toContain("droppedIds");
  expect(cal).toContain("isCalendarDeleteKey");
  expect(cal).toContain("dropCalendarEvent");
  expect(cal).toContain("inspectRef.current = item.id");
  const sheet = readFileSync(new URL("../src/components/dashboard/EventSheet.tsx", import.meta.url), "utf8");
  expect(sheet).toContain('className="is-delete"');
  expect(sheet).toContain("onPointerDown");
  expect(css).toContain("button.is-delete");
  expect(css).toContain("background: #ffe8ea");
  expect(css).toContain("color: #c41e3a");
  expect(cal).toContain("writeDroppedMarks");
  expect(cal).toContain("eventDropMark");
  expect(cal).toContain('"week"');
  expect(cal).toContain('"quarter"');
  expect(cal).toContain("Day");
  expect(cal).toContain("celinen-ios-cal__side");
  expect(cal).toContain("celinen-ios-cal__block");
  expect(cal).not.toContain("OAuth");
  expect(css).toContain("grid-template-rows: repeat(6, minmax(72px, 1fr))");
  expect(css).toContain("celinen-ios-cal__shell");
  expect(css).not.toContain("margin: 0 auto");
  expect(css).toContain("color-scheme: light");
  expect(css).toContain('font-family: var(--celinen-sans');
  expect(css).toContain("celinen-ios-cal__title");
});
