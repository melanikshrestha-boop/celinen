import { describe, expect, test } from "bun:test";
import {
  activityCategory,
  deliveryActivityCsv,
  filteredActivity,
  sharedActivity,
  type DeliveryActivityFilter,
} from "../src/lib/delivery/activity";
import type { DeliveryState } from "../src/lib/delivery/workflow";

type Event = DeliveryState["events"][number];
const event = (text: string, role: Event["role"] = "client", id = crypto.randomUUID()): Event => ({
  id,
  at: "2026-09-08T04:00:00.000Z",
  role,
  text,
});

describe("owner delivery activity export", () => {
  const events = [
    event("Upload reserved: private.jpg", "owner"),
    event("2 photo versions published for review", "owner"),
    event("Photo selected"),
    event("2 selections submitted"),
    event("Revision requested: one.jpg"),
    event("Exact version approved: one.jpg"),
    event(
      "Browser handoff recorded: 2 high-resolution files in a ZIP part; final save location not verified",
    ),
  ];

  test("keeps shared source order, hides reservations, and classifies bounded workflow events", () => {
    expect(sharedActivity(events).map((item) => item.text)).toEqual(
      events.slice(1).map((item) => item.text),
    );
    expect(activityCategory(events[1]!)).toBe("delivery");
    expect(activityCategory(events[2]!)).toBe("selections");
    expect(activityCategory(events[4]!)).toBe("feedback");
    expect(activityCategory(events[6]!)).toBe("downloads");
    expect(events).toHaveLength(7);
  });

  test.each([
    ["all", 6],
    ["client", 5],
    ["selections", 2],
    ["feedback", 2],
    ["downloads", 1],
  ] as [DeliveryActivityFilter, number][])(
    "filters %s activity without mutating history",
    (filter, count) => {
      const before = JSON.stringify(events);
      expect(filteredActivity(events, filter)).toHaveLength(count);
      expect(JSON.stringify(events)).toBe(before);
    },
  );

  test("exports UTF-8-safe quoted CSV and preserves the truthful browser-handoff wording", () => {
    const csv = deliveryActivityCsv(
      [event('Comment added: =HYPERLINK("bad")\nनमस्ते'), events[6]!],
      "all",
    );
    expect(csv).toStartWith('"Timestamp (UTC)","Actor","Category","Activity"\r\n');
    expect(csv).toContain('"Comment added: =HYPERLINK(""bad"")\nनमस्ते"');
    expect(csv).toContain(
      '"Browser handoff recorded: 2 high-resolution files in a ZIP part; final save location not verified"',
    );
    expect(csv.toLowerCase()).not.toContain("download completed");
    expect(csv).not.toContain("private.jpg");
  });

  test("neutralizes spreadsheet formulas in every exported cell", () => {
    const unsafe = event('=HYPERLINK("https://example.invalid")');
    unsafe.at = "+1";
    const csv = deliveryActivityCsv([unsafe], "all");
    expect(csv).toContain('"\'+1"');
    expect(csv).toContain('"\'=HYPERLINK(""https://example.invalid"")"');
  });
});
