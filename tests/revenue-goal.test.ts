import { describe, expect, test } from "bun:test";
import {
  dollarsToMinor,
  parseGoalInput,
  readRevenueGoal,
  remainingPerMonth,
  suggestGoalMinor,
  writeRevenueGoal,
} from "../src/lib/revenue-goal";

describe("photographer yearly revenue goal", () => {
  test("chips and k-suffix type into minor units", () => {
    expect(dollarsToMinor(40_000)).toBe(4_000_000);
    expect(parseGoalInput("40k")).toBe(4_000_000);
    expect(parseGoalInput("$40,000")).toBe(4_000_000);
    expect(parseGoalInput("admin")).toBe(null);
    expect(parseGoalInput("0")).toBe(null);
  });

  test("suggests a rounded pace without inventing income", () => {
    expect(suggestGoalMinor(0, "2026-01-02")).toBe(4_000_000);
    expect(suggestGoalMinor(1_000_000, "2026-07-02")).toBe(2_000_000);
    expect(remainingPerMonth(4_000_000, 1_000_000, "2026-09-10")).toBe(750_000);
    expect(remainingPerMonth(1_000_000, 1_000_000, "2026-09-10")).toBe(0);
  });

  test("stores per year on one account and ignores junk", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (name: string) => memory.get(name) ?? null,
      setItem: (name: string, value: string) => {
        memory.set(name, value);
      },
    };
    writeRevenueGoal("device-local", 2026, 4_000_000, storage);
    expect(readRevenueGoal("device-local", 2026, storage)).toBe(4_000_000);
    expect(readRevenueGoal("device-local", 2025, storage)).toBe(null);
    memory.set("celinen.revenue-goal.v1", '{"2026":"admin"}');
    expect(readRevenueGoal("device-local", 2026, storage)).toBe(null);
  });
});
