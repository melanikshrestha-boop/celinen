import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { studioCopyBlocked } from "../src/lib/studio/session";

describe("on-device library copy", () => {
  test("empty tombstones can receive this machine's library", () => {
    expect(studioCopyBlocked(undefined, 0, "device-local")).toBe(false);
    expect(
      studioCopyBlocked({ recoverySource: "device-local", shotIds: [] }, 0, "device-local"),
    ).toBe(false);
  });

  test("occupied destinations are never overwritten", () => {
    expect(
      studioCopyBlocked({ shotIds: ["a"] }, 1, "device-local"),
    ).toBe("blocked");
    expect(
      studioCopyBlocked({ shotIds: ["a", "b"] }, 0, "device-local"),
    ).toBe("blocked");
  });

  test("sign-in attaches this machine's default library, not a new shoot UUID", () => {
    const source = readFileSync(new URL("../src/lib/studio/session.ts", import.meta.url), "utf8");
    expect(source).toContain('inspectPreviousShoot("device-local")');
    expect(source).toContain("Originals stay on this machine");
    expect(source).not.toMatch(/inspectPreviousShoot\("device-local", shootId\)/);
  });

  test("a completed recovery may retry the same copy", () => {
    expect(
      studioCopyBlocked(
        { recoverySource: "device-local", shotIds: ["a", "b"] },
        2,
        "device-local",
      ),
    ).toBe("retry");
    expect(
      studioCopyBlocked(
        { recoverySource: "other-account", shotIds: ["a", "b"] },
        2,
        "device-local",
      ),
    ).toBe("blocked");
  });
});
