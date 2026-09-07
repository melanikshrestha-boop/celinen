import { expect, test } from "bun:test";
import {
  assertSameAccount,
  nextPreparedAt,
  visibleToAccount,
} from "../src/lib/delivery/account-boundary";

test("A's synced and unsynced outbox material is hidden from B and from signed-out state", () => {
  for (const synced of [true, false]) {
    expect(visibleToAccount({ ownerId: "a", synced }, "a")).toBe(true);
    expect(visibleToAccount({ ownerId: "a", synced }, "b")).toBe(false);
    expect(visibleToAccount({ ownerId: "a", synced }, null)).toBe(false);
  }
});
test("explicit pre-login drafts stay device-local; legacy synced ownership is never guessed", () => {
  expect(visibleToAccount({ ownerId: null, synced: false }, "a")).toBe(true);
  expect(visibleToAccount({ synced: true }, "a")).toBe(false);
  expect(visibleToAccount({ synced: true }, null)).toBe(false);
  expect(visibleToAccount({ ownerId: null, synced: true }, null)).toBe(false);
  expect(visibleToAccount({ synced: false }, "a")).toBe(false);
  expect(visibleToAccount({ synced: false }, null)).toBe(true);
});
test("identity mismatch or expired authentication stops a bound upload", () => {
  expect(() => assertSameAccount("a", "b")).toThrow("Account changed");
  expect(() => assertSameAccount("a", null)).toThrow("Account changed");
  expect(() => assertSameAccount("a", "a")).not.toThrow();
});
test("older jobs without valid chronology cannot poison the next preparation order", () => {
  expect(
    nextPreparedAt([{}, { preparedAt: NaN }, { preparedAt: Infinity }, { preparedAt: 1100 }], 1000),
  ).toBe(1101);
  expect(nextPreparedAt([{}], 1000)).toBe(1000);
});
