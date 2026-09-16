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
  expect(cal).toContain("Quarter");
  expect(cal).toContain("All Tasks");
  expect(cal).toContain("onDoubleClick");
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
