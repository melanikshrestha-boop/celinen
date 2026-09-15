import { expect, test } from "bun:test";
import { readBookingTypes, writeBookingTypes } from "../src/lib/booking-types";

const memory = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value);
  },
  removeItem: (key: string) => {
    memory.delete(key);
  },
  clear: () => memory.clear(),
  key: () => null,
  get length() {
    return memory.size;
  },
} as Storage;

test("booking types roundtrip locally", () => {
  const scope = "test-bookings";
  writeBookingTypes(scope, [
    { id: "a", title: "Family Portrait", price: 600, durationMin: 60, location: "Heights Park", enabled: true },
  ]);
  const rows = readBookingTypes(scope);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.title).toBe("Family Portrait");
  expect(rows[0]?.durationMin).toBe(60);
});
