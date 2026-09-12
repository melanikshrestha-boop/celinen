import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { publicEntry } from "../src/lib/public-entry";
import {
  isDashboardAppRoute,
  isPrivateAppRoute,
  isWorkbenchRoute,
  safeSignInPath,
} from "../src/lib/workbench";
import { parseAuthSearch } from "../src/lib/auth-flow";

test("signed-in public CTA is Dashboard and opens the dashboard", () => {
  expect(publicEntry("in")).toEqual({ to: "/dashboard", search: {}, label: "Dashboard" });
  expect(isWorkbenchRoute(["__root__", "/dashboard"])).toBe(false);
  expect(isWorkbenchRoute(["__root__", "/studio"])).toBe(false);
  expect(isDashboardAppRoute(["__root__", "/studio"], "/studio")).toBe(true);
  expect(isPrivateAppRoute(["__root__", "/studio"], "/studio")).toBe(true);
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
  expect(source).toContain('label: "Poses"');
  expect(source).toContain('label: "Analytics"');
  expect(source).toContain('label: "Social accounts"');
  expect(source).toContain('label: "Tools"');
  expect(source).toContain('title="Upgrade"');
  expect(source).not.toContain('label: "Guide"');
  expect(source).not.toContain('label: "Community"');
  expect(source).toContain("AccountMenu");
  expect(source).toContain("SocialDock");
  expect(source).toContain("Aperture");
  expect(source).toContain('to: "/studio"');
  expect(source).toContain('to: "/deliver"');
  expect(source).toContain('to: "/develop"');
  expect(source).toContain('to: "/poses"');
  expect(source).toContain('to: "/earnings"');
  expect(source).toContain('to: "/publish"');
  expect(source).toContain('to: "/library"');
  expect(source).toContain("Loading your workspace");
  expect(source).not.toContain("New chat");
  expect(source).not.toContain("celinen-dash__card");
  expect(source).toContain("Minimize sidebar");
  expect(source).toContain("Expand sidebar");
  expect(source).toContain('visual === "mini"');
  expect(source).not.toContain("Close sidebar");
  expect(source).toContain('RailMode = "open" | "mini"');
  expect(source).toContain("const MAX_OPEN = OPEN_W");
  expect(source).toContain("const OPEN_W = 248");
  expect(source).toContain("Resize sidebar");
  expect(source).toContain("celinen-dash__resize");
  expect(source).toContain("celinen-dash__composer");
  expect(source).toContain("celinen-dash__theme");
  expect(source).toContain('theme: "dark"');
  expect(source).toContain("strokeWidth={1.5}");
  expect(source).toContain("<Sun");
  expect(source).toContain("<Moon");
  expect(source).toContain('aria-label="Light"');
  expect(source).toContain('aria-label="Dark"');
  expect(source).not.toMatch(/>\s*Light\s*</);
  expect(source).not.toMatch(/>\s*Dark\s*</);
  expect(source).toContain("social-post");
  expect(source).toContain("Generate inside");
  expect(source).toContain('BrandMark id="claude"');
  expect(source).toContain('BrandMark id="chatgpt"');
  expect(source).toContain('BrandMark id="grok"');
  expect(source).toContain("Browse templates");
  expect(source).toContain("dashboardGreetingFor");
  expect(source).toContain("DashboardContext.Provider");
  expect(source).toContain("children");
  expect(source).not.toContain("Planner");
  expect(source).not.toContain("Campaigns");
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
  expect(css).toContain(".celinen-dash__body.is-chat");
  expect(css).toContain(".social-post .celinen-dash__composer");
  expect(css).toContain("font-weight: 400");
  expect(css).toContain('font-family: var(--celinen-sans');
  expect(css).toContain(".celinen-dash.is-mini");
  expect(css).toContain(".celinen-dash__ico");
  expect(css).toContain("place-items: center");
  expect(css).toContain("color: #5c6370");
  expect(css).toContain("backdrop-filter: saturate(1.6) blur(24px)");
  expect(css).toContain("html.dark .celinen-dash");
  expect(css).toContain("background: #000");
  expect(css).toContain("grid-template-columns: var(--rail) minmax(0, 1fr)");
  expect(css).not.toContain(".celinen-dash.is-closed");
  expect(css).toContain(".celinen-dash__resize");
  expect(css).toContain("cursor: col-resize");
  expect(css).toContain(".celinen-dash .foto-develop");
  expect(css).toContain(".celinen-dash__body:has(.foto-develop)");
});

test("develop rail mounts the Lightroom editor as the full page", () => {
  const source = readFileSync(new URL("../src/routes/develop.tsx", import.meta.url), "utf8");
  expect(source).toContain("DevelopPage");
  expect(source).toContain("explicitWorkspaceBinding");
  expect(source).not.toContain("LegacyWorkbenchRedirect");
});
