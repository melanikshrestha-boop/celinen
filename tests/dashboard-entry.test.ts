import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { publicEntry } from "../src/lib/public-entry";
import { isPrivateAppRoute, isWorkbenchRoute, safeSignInPath } from "../src/lib/workbench";
import { parseAuthSearch } from "../src/lib/auth-flow";

test("signed-in public CTA is Dashboard and opens the dashboard", () => {
  expect(publicEntry("in")).toEqual({ to: "/dashboard", search: {}, label: "Dashboard" });
  expect(isWorkbenchRoute(["__root__", "/dashboard"])).toBe(false);
  expect(isPrivateAppRoute(["__root__", "/dashboard"], "/dashboard")).toBe(true);
  expect(isPrivateAppRoute(["__root__", "/"], "/")).toBe(false);
  expect(isPrivateAppRoute(["__root__", "/auth"], "/auth")).toBe(false);
  expect(parseAuthSearch({}).next).toBe("/dashboard");
  expect(safeSignInPath("/auth")).toBe("/dashboard");
});

test("dashboard shell is the photographer rail, not a chat sidebar", () => {
  const source = readFileSync(
    new URL("../src/components/dashboard/AppDashboard.tsx", import.meta.url),
    "utf8",
  );
  expect(source).toContain("dashboardGreetingFor");
  expect(source).toContain('label: "Home"');
  expect(source).toContain('label: "Pick"');
  expect(source).toContain('label: "Galleries"');
  expect(source).toContain('label: "Develop"');
  expect(source).toContain('label: "Calendar"');
  expect(source).toContain('label: "Analytics"');
  expect(source).toContain('label: "Social accounts"');
  expect(source).toContain('label: "Tools"');
  expect(source).toContain('label: "Upgrade"');
  expect(source).toContain('label: "Guide"');
  expect(source).toContain('label: "Community"');
  expect(source).toContain('label: "Settings"');
  expect(source).toContain('to: "/studio"');
  expect(source).toContain('to: "/deliver"');
  expect(source).toContain('to: "/develop"');
  expect(source).toContain('to: "/earnings"');
  expect(source).toContain('to: "/publish"');
  expect(source).toContain('to: "/library"');
  expect(source).toContain("Loading your workspace");
  expect(source).not.toContain("New chat");
  expect(source).not.toContain("celinen-dash__card");
  expect(source).toContain("Close sidebar");
  expect(source).toContain("Open sidebar");
  expect(source).toContain("celinen-dash__composer");
  expect(source).toContain("dashboardGreetingFor");
});

test("dashboard chrome is the full light rail", () => {
  const css = readFileSync(
    new URL("../src/components/dashboard/dashboard.css", import.meta.url),
    "utf8",
  );
  expect(css).toContain(".celinen-dash__nav");
  expect(css).toContain(".celinen-dash__link.is-active");
  expect(css).toContain("background: #eef2ff");
  expect(css).toContain("color: #4d6fff");
  expect(css).toContain(".celinen-dash__composer");
  expect(css).toContain(".celinen-dash.is-closed");
});
