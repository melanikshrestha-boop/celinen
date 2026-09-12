import { expect, test } from "bun:test";
import { parseShootNote } from "../src/lib/calendar-assist";
import {
  eventsInWeek,
  isCalendarColor,
  parseCalendarHex,
} from "../src/lib/calendar-ics";

const now = new Date(2026, 8, 11, 9, 0, 0); // Friday
const selected = new Date(2026, 8, 11);
const opts = { now, selected, accent: "#ff3b30" };

test("assistant pulls time, weekday, and at-location out of a note", () => {
  const event = parseShootNote("Saturday 2-5pm wedding at the Getty", opts);
  expect(event?.title).toBe("wedding");
  expect(event?.location).toBe("the Getty");
  expect(event?.allDay).toBe(false);
  const start = new Date(event!.start);
  expect(start.getDay()).toBe(6);
  expect(start.getHours()).toBe(14);
  expect(new Date(event!.end).getHours()).toBe(17);
});

test("tomorrow and a single clock land on the next morning", () => {
  const event = parseShootNote("tomorrow 10am portraits", opts);
  const start = new Date(event!.start);
  expect(start.getDate()).toBe(12);
  expect(start.getHours()).toBe(10);
  expect(event?.title).toBe("portraits");
});

test("slash date and a bare note on the selected day still book", () => {
  const dated = parseShootNote("10/12 3pm Jordan", opts);
  expect(new Date(dated!.start).getMonth()).toBe(9);
  expect(new Date(dated!.start).getDate()).toBe(12);
  expect(dated?.title).toBe("Jordan");
  const fallback = parseShootNote("hold", opts);
  expect(new Date(fallback!.start).getDate()).toBe(11);
  expect(fallback?.allDay).toBe(true);
  expect(fallback?.title).toBe("hold");
});

test("blank notes do not invent a shoot", () => {
  expect(parseShootNote("   ", opts)).toBeNull();
});

test("hex accepts #RGB codes and rejects junk", () => {
  expect(parseCalendarHex("#007AFF")).toBe("#007aff");
  expect(parseCalendarHex("34c759")).toBe("#34c759");
  expect(parseCalendarHex("#fff")).toBeNull();
  expect(parseCalendarHex("red")).toBeNull();
  expect(isCalendarColor("#ff3b30")).toBe(true);
  expect(isCalendarColor("#00ffaa")).toBe(true);
});

test("this-week count only includes the Sunday week around the day", () => {
  const week = [
    { id: "a", title: "Fri", start: now.getTime(), end: now.getTime() + 3600000, allDay: false, source: "local" as const },
    { id: "b", title: "Next", start: now.getTime() + 8 * 86400000, end: now.getTime() + 8 * 86400000 + 3600000, allDay: false, source: "local" as const },
  ];
  expect(eventsInWeek(week, now)).toHaveLength(1);
});
