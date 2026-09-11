import { describe, expect, test } from "bun:test";
import { isGhostShoot, nextShootLabel } from "../src/lib/studio/shoot-directory";

describe("shoot numbering", () => {
  test("counts created shoots like Spotify playlists and never reuses a number", () => {
    const scope = crypto.randomUUID();
    expect(nextShootLabel(scope)).toBe("Shoot #1");
    expect(nextShootLabel(scope)).toBe("Shoot #2");
    expect(nextShootLabel(scope)).toBe("Shoot #3");
  });

  test("empty Untitled leftovers are ghosts; named Shoot #1 is real even with no photos yet", () => {
    expect(
      isGhostShoot({ title: "Untitled project", count: 0, recoveryPending: false }),
    ).toBe(true);
    expect(isGhostShoot({ title: "Untitled shoot", count: 0, recoveryPending: false })).toBe(true);
    expect(isGhostShoot({ title: "Shoot #1", count: 0, recoveryPending: false })).toBe(false);
    expect(isGhostShoot({ title: "Untitled project", count: 12, recoveryPending: false })).toBe(
      false,
    );
  });
});
