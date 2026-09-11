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
  expect(source).toContain('label: "Home"');
  expect(source).toContain('label: "Clipping"');
  expect(source).toContain('label: "Automations"');
  expect(source).toContain('label: "Calendar"');
  expect(source).toContain('label: "Analytics"');
  expect(source).toContain('label: "Social Accounts"');
  expect(source).toContain('label: "Tools"');
  expect(source).toContain('to: "/shoots"');
  expect(source).toContain('to: "/tonight"');
  expect(source).toContain('to: "/earnings"');
  expect(source).toContain('to: "/publish"');
  expect(source).toContain('to: "/library"');
  expect(source).toContain('to="/pricing"');
  expect(source).toContain('to="/docs"');
  expect(source).toContain('to="/help"');
  expect(source).toContain('to="/settings"');
  expect(source).toContain("Refer & Earn");
  expect(source).toContain("Loading your workspace");
  expect(source).not.toContain("celinen-dash__card");
});

test("dashboard chrome uses the workspace rail, mint upgrade, and loading canvas", () => {
  const css = readFileSync(
    new URL("../src/components/dashboard/dashboard.css", import.meta.url),
    "utf8",
  );
  expect(css).toContain("background: #eaf7ee");
  expect(css).toContain("background: #eef2ff");
  expect(css).toContain("background: #4d6fff");
  expect(css).toContain(".celinen-dash__upgrade");
});
