import { expect, test } from "bun:test";
import { inferCalendarKind, kindFromSlash, kindInViewSet } from "../src/lib/calendar-kinds";

test("slash and verbs map onto photographer kinds", () => {
  expect(kindFromSlash("USC Friday 7pm /shoot").kind).toBe("shoot");
  expect(kindFromSlash("gallery Thursday /delivery").kind).toBe("delivery");
  expect(inferCalendarKind("edit Lakers selects")).toBe("edit");
  expect(kindInViewSet("shoot", "shoots")).toBe(true);
  expect(kindInViewSet("edit", "shoots")).toBe(false);
  expect(kindInViewSet("delivery", "post")).toBe(true);
});
