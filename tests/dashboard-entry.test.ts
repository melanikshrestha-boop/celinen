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

test("dashboard shell is a chat with real work destinations", () => {
  const source = readFileSync(
    new URL("../src/components/dashboard/AppDashboard.tsx", import.meta.url),
    "utf8",
  );
  expect(source).toContain("What should we work on?");
  expect(source).toContain("New chat");
  expect(source).toContain("Chat");
  expect(source).toContain("Work");
  expect(source).toContain("destinationPathFor");
  expect(source).toContain('to: "/shoots"');
  expect(source).toContain('to: "/earnings"');
  expect(source).toContain('to: "/publish"');
  expect(source).toContain('to: "/library"');
  expect(source).toContain("Loading your workspace");
  expect(source).not.toContain("celinen-dash__card");
});

test("dashboard chrome is a light chat rail and centered composer", () => {
  const css = readFileSync(
    new URL("../src/components/dashboard/dashboard.css", import.meta.url),
    "utf8",
  );
  expect(css).toContain("background: #f9f9f9");
  expect(css).toContain(".celinen-dash__composer");
  expect(css).toContain("border-radius: 28px");
  expect(css).toContain("background: #4d6fff");
});
