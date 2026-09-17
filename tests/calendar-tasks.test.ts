import { expect, test } from "bun:test";
import { readCalendarTasks, writeCalendarTasks } from "../src/lib/calendar-tasks";

test("calendar tasks persist locally", () => {
  const store = new Map<string, string>();
  // defineProperty, not assignment: bun runs every file in one process, and a
  // sibling that installed a non-writable localStorage makes assignment throw.
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
  });
  const scope = `test-${Date.now()}`;
  expect(readCalendarTasks(scope)).toEqual([]);
  writeCalendarTasks(scope, [{ id: "1", title: "Call client", done: false }]);
  expect(readCalendarTasks(scope)).toEqual([{ id: "1", title: "Call client", done: false }]);
});
