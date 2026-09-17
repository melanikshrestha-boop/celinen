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
  const shell = readFileSync(
    new URL("../src/components/workbench/Workbench.tsx", import.meta.url),
    "utf8",
  );
  expect(shell).toContain("return <AppDashboard>{children}</AppDashboard>");
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
  expect(source).not.toContain('label: "Pick"');
  expect(source).toContain('to: "/deliver"');
  expect(source).toContain('"Galleries"');
  expect(source).toContain('"Gallery"');
  expect(source).toContain('label: "Develop"');
  expect(source).toContain('label: "Calendar"');
  expect(source).not.toContain('label: "Poses"');
  expect(source).toContain('label: "Analytics"');
  expect(source).toContain('label: "Social accounts"');
  expect(source).toContain('label: "Tools"');
  expect(source).toContain('title="Upgrade"');
  expect(source).not.toContain('label: "Guide"');
  expect(source).not.toContain('label: "Community"');
  expect(source).toContain("AccountMenu");
  expect(source).toContain("SocialDock");
  expect(source).toContain("Plus");
  expect(source).not.toContain("LayoutTemplate");
  const lucide = source.match(/import \{([\s\S]*?)\} from "lucide-react"/);
  expect(lucide).toBeTruthy();
  const imported = new Set((lucide?.[1].match(/\b[A-Z][A-Za-z0-9]*/g) ?? []) as string[]);
  for (const match of source.matchAll(/<([A-Z][A-Za-z0-9]*)\s+size=/g)) {
    const name = match[1]!;
    if (name === "LogoMark" || name === "BrandMark" || name === "Icon") continue;
    expect(imported.has(name), `${name} is used in AppDashboard JSX but not imported from lucide-react`).toBe(
      true,
    );
  }
  expect(source).toContain('to: "/deliver"');
  expect(source).toContain('to: "/develop"');
  expect(source).not.toContain('to: "/poses"');
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
  expect(source).not.toContain("Generate inside");
  expect(source).not.toContain("Turn a simple idea");
  expect(source).not.toContain("social-post__mark");
  expect(source).not.toContain("Browse templates");
  expect(source).not.toContain("Planning a shoot week");
  expect(source).toContain('placeholder="drop your game here"');
  const dashCss = readFileSync(
    new URL("../src/components/dashboard/dashboard.css", import.meta.url),
    "utf8",
  );
  expect(dashCss).toContain(".celinen-dash__plus");
  expect(dashCss).toContain("place-items: center");
  expect(dashCss).toContain("line-height: 0");
  expect(dashCss).toContain(".celinen-dash__plus svg");
  expect(source).not.toContain("Open Pick");
  expect(source).not.toContain("Open calendar");
  expect(source).not.toContain("HOME_ACTIONS");
  expect(source).toContain('htmlFor="celinen-home-photos"');
  expect(source).toContain('aria-label="Add photos"');
  expect(source).toContain("queueStudioImport");
  expect(source).toContain("collectDroppedFiles");
  expect(source).not.toContain('aria-label="Open Pick"');
  expect(source).toContain('preloadRoute({ to: "/studio" })');
  expect(source).not.toContain("Send a gallery");
  expect(source).toContain("Share Only");
  expect(source).not.toContain("Copy chat");
  expect(source).toContain('typeof localStorage === "undefined"');
  expect(dashCss).toContain(".celinen-dash-tool .shoot-workflow-tabs");
  const deliver = readFileSync(new URL("../src/routes/deliver.tsx", import.meta.url), "utf8");
  const gallery = readFileSync(
    new URL("../src/components/delivery/DeliveryWorkspace.tsx", import.meta.url),
    "utf8",
  );
  expect(deliver).not.toContain("Saved galleries");
  expect(deliver).not.toContain("Outreach drafts");
  expect(gallery).toContain("New Gallery");
  expect(dashCss).toContain("line-height: 1.5");
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
  expect(css).toMatch(/\.celinen-dash__link\.is-active\s*\{[^}]*background: #f0f0f0/);
  expect(css).toMatch(/\.celinen-dash__link\.is-active\s*\{[^}]*color: #142a36/);
  expect(css).not.toMatch(/\.celinen-dash__link\.is-active\s*\{[^}]*#4d6fff/);
  expect(css).not.toMatch(/html\.dark \.celinen-dash__link\.is-active[^}]*#8aa0ff/);
  expect(css).toContain("padding-right: 92px");
  expect(css).toContain(".celinen-dash__composer");
  expect(css).toContain(".celinen-dash__body.is-chat");
  expect(css).toContain(".celinen-dash .social-post.has-thread");
  expect(css).toContain("overflow: hidden");
  expect(css).toContain("white-space: pre-wrap");
  expect(css).toContain("max-width: 52rem");
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
  expect(css).not.toContain("flex-wrap: wrap");
  expect(css).not.toMatch(/\.celinen-dash__rail[^{]*\{[^}]*flex-direction:\s*row/);
  expect(css).not.toContain(".celinen-dash.is-closed");
  expect(css).toContain(".celinen-dash__resize");
  expect(css).toContain("cursor: col-resize");
  expect(css).toContain(".celinen-dash .foto-develop");
  expect(css).toContain(".celinen-dash__body:has(.foto-develop)");
});

test("home canvas is pitch black in dark mode", () => {
  const css = readFileSync(
    new URL("../src/components/dashboard/social-accounts.css", import.meta.url),
    "utf8",
  );
  expect(css).toMatch(
    /\.social-post\s*\{[^}]*radial-gradient\(90% 70% at 50% 0%, #d7ecff 0%, #eef8f3 38%, #ffffff 72%\)/,
  );
  expect(css).toMatch(/html\.dark \.social-post\s*\{[^}]*background:\s*#000/);
  expect(css).not.toContain("#1e3f6b");
  expect(css).toContain("home-composer-open");
  expect(css).toContain("home-open");
  expect(css).toContain(".social-post__action");
});

test("Pick has no Drop the shoot landing; Home plus and drop import photos", () => {
  const studio = readFileSync(new URL("../src/routes/studio.tsx", import.meta.url), "utf8");
  expect(studio).not.toContain("Drop the shoot");
  expect(studio).not.toContain("Choose files");
  expect(studio).not.toContain("Choose folder");
  expect(studio).toContain("takeStudioImport");
  expect(studio).toContain('navigate({ to: "/dashboard" })');
  expect(studio).not.toContain('return <p role="status">Opening your workspace…</p>');
});

test("develop rail mounts the Lightroom editor as the full page", () => {
  const source = readFileSync(new URL("../src/routes/develop.tsx", import.meta.url), "utf8");
  expect(source).toContain("DevelopPage");
  expect(source).toContain("explicitWorkspaceBinding");
  expect(source).not.toContain("LegacyWorkbenchRedirect");
});

test("root error recovery reloads instead of soft-resetting a dead module", () => {
  const source = readFileSync(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");
  expect(source).toContain("This page didn’t load");
  expect(source).toContain("window.location.reload()");
  expect(source).toContain("celinen.reload-once");
  expect(source).toContain("ReferenceError");
  expect(source).not.toContain("router.invalidate()");
  expect(source).not.toContain("useRouter");
});
