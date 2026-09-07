import { describe, expect, test } from "bun:test";
import {
  canPersistStudioSession,
  nextStudioClearRevision,
  nextStudioRevision,
  shouldWriteStudioShot,
  studioRevisionChanged,
} from "../src/lib/studio/session";

describe("Studio persistence safety", () => {
  test("arms persistence only after successful hydration", () => {
    expect(canPersistStudioSession("loading")).toBe(false);
    expect(canPersistStudioSession("failed")).toBe(false);
    expect(canPersistStudioSession("clearing")).toBe(false);
    expect(canPersistStudioSession("ready")).toBe(true);
  });

  test("a clear tombstone advances the revision and blocks stale saves", () => {
    const staleWriterRevision = 10;
    const tombstoneRevision = nextStudioRevision(10, staleWriterRevision);

    expect(tombstoneRevision).toBe(11);
    expect(studioRevisionChanged(tombstoneRevision, staleWriterRevision)).toBe(true);
    expect(studioRevisionChanged(tombstoneRevision, tombstoneRevision)).toBe(false);
  });

  test("an ordinary clear cannot erase a newer tab's snapshot", () => {
    expect(() => nextStudioClearRevision(11, 10)).toThrow("changed in another tab");
    expect(nextStudioClearRevision(10, 10)).toBe(11);
  });

  test("a confirmed recovery clear can replace an unreadable snapshot", () => {
    expect(nextStudioClearRevision(11, 10, true)).toBe(12);
  });

  test("never trusts a matching signature when its stored record is absent", () => {
    expect(shouldWriteStudioShot("same", "same", false)).toBe(true);
    expect(shouldWriteStudioShot("old", "new", true)).toBe(true);
    expect(shouldWriteStudioShot("same", "same", true)).toBe(false);
  });
});
