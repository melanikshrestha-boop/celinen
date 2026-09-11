import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { hapticTap, onHapticPress } from "../src/lib/haptic-press";

test("press uses Instagram scale-down bounce and a short haptic", () => {
  const calls: number[][] = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      vibrate: (pattern: number | number[]) => {
        calls.push(Array.isArray(pattern) ? pattern : [pattern]);
        return true;
      },
    },
  });
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false }),
  });
  hapticTap();
  expect(calls[0]).toEqual([12]);
  onHapticPress({ pointerType: "touch", button: 0, target: null });
  expect(calls).toHaveLength(1);
  const social = readFileSync(
    new URL("../src/components/dashboard/social-accounts.css", import.meta.url),
    "utf8",
  );
  expect(social).toContain("scale(0.94)");
  expect(social).toContain("cubic-bezier(0.34, 1.45, 0.64, 1)");
  const page = readFileSync(
    new URL("../src/components/dashboard/SocialAccounts.tsx", import.meta.url),
    "utf8",
  );
  expect(page).toContain("onHapticPress");
});
