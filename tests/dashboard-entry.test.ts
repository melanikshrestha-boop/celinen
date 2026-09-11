import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { publicEntry } from "../src/lib/public-entry";
import { isWorkbenchRoute, safeSignInPath } from "../src/lib/workbench";
import { parseAuthSearch } from "../src/lib/auth-flow";

test("signed-in public CTA is Dashboard and opens the dashboard", () => {
  expect(publicEntry("in")).toEqual({ to: "/dashboard", search: {}, label: "Dashboard" });
  expect(isWorkbenchRoute(["__root__", "/dashboard"])).toBe(false);
  expect(parseAuthSearch({}).next).toBe("/dashboard");
  expect(safeSignInPath("/auth")).toBe("/dashboard");
});

test("dashboard shell has real signed-in destinations", () => {
  const source = readFileSync(
    new URL("../src/components/dashboard/AppDashboard.tsx", import.meta.url),
    "utf8",
  );
  expect(source).toContain('to: "/shoots"');
  expect(source).toContain('to: "/deliver"');
  expect(source).toContain('to: "/develop"');
  expect(source).toContain('to: "/publish"');
  expect(source).toContain('to: "/settings"');
  expect(source).toContain('to: "/auth"');
  expect(source).toContain("Loading your workspace");
  expect(source).toContain("celinen-dash__card");
  expect(source).toContain("Open a shoot");
  expect(source).toContain("Send a gallery");
  expect(source).toContain("Connect socials");
});
