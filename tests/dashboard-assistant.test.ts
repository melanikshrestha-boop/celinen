import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { requestDashboardReply } from "../src/lib/dashboard-assistant";
import { isChatGreeting, isPhotographyConversation } from "../src/lib/photography-assistant";
import { destinationPathFor } from "../src/lib/workspace-routing";
import { isPostIntent } from "../src/lib/social-post";

// Execute the actual dashboard callback, with no real storage/account/network.
const dashboard = readFileSync(
  new URL("../src/components/dashboard/AppDashboard.tsx", import.meta.url),
  "utf8",
);
const localReply = dashboard.slice(
  dashboard.indexOf("function replyFor("),
  dashboard.indexOf("export function AppDashboard"),
);
const realSend = dashboard.slice(
  dashboard.indexOf("  async function send("),
  dashboard.indexOf("  // Narrow-screen presentation"),
);
function callbackFixture() {
  const saved: Array<{ role: string; text: string }[]> = [];
  const requests: Array<unknown> = [];
  const navigations: unknown[] = [];
  const pendingReply = { current: null as AbortController | null };
  const currentScope = { current: "owner-a" };
  let resolve!: (text: string) => void;
  const response = new Promise<string>((done) => {
    resolve = done;
  });
  const env = {
    isChatGreeting,
    isPhotographyConversation,
    destinationPathFor,
    isPostIntent,
    writeSocialDraft: () => {},
    buildSocialPost: () => ({}),
    draft: "",
    scope: "owner-a",
    pendingReply,
    currentScope,
    setChatError: () => {},
    setDraft: () => {},
    setReplying: () => {},
    activeId: null,
    active: null,
    threads: [],
    box: { current: null },
    titleFrom: (text: string) => text.slice(0, 42),
    persist: (rows: Array<{ messages: (typeof saved)[number] }>) => saved.push(rows[0]!.messages),
    requestDashboardReply: (input: unknown) => {
      requests.push(input);
      return response;
    },
    account: { preferences: { cloudAssistant: true } },
    window: { setTimeout: (callback: () => void) => callback() },
    navigate: (input: unknown) => navigations.push(input),
  };
  const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(
    `${localReply}\n${realSend}\nreturn send;`,
  );
  const send = new Function(...Object.keys(env), code)(...Object.values(env)) as (
    text: string,
  ) => Promise<void>;
  return { send, saved, requests, navigations, resolve, pendingReply, currentScope };
}
for (const text of ["hi", "yo", "hello", "hey"])
  test(`actual dashboard Send greets instantly: ${text}`, async () => {
    const f = callbackFixture();
    await f.send(text);
    expect(f.requests).toHaveLength(0);
    expect(f.navigations).toHaveLength(0);
    expect(f.saved[0]?.at(-1)?.text).toBe("Hey.");
  });
for (const text of [
  "Where should I shoot?",
  "check the lighting for a night portrait",
  "show me some ideas for a shoot",
])
  test(`actual dashboard Send requests AI: ${text}`, async () => {
    const f = callbackFixture();
    const task = f.send(text);
    expect(f.requests).toHaveLength(1);
    expect(f.navigations).toHaveLength(0);
    expect(f.saved[0]?.[0]?.text).toBe(text);
    f.resolve("Let's plan your shoot.");
    await task;
    expect(f.saved[1]?.[1]?.text).toBe("Let's plan your shoot.");
  });
test("actual dashboard Send prevents duplicate pending submissions", async () => {
  const f = callbackFixture();
  const task = f.send("Where should I shoot?");
  await f.send("hello again");
  expect(f.requests).toHaveLength(1);
  f.resolve("hello");
  await task;
});
test("account changes fence a late dashboard reply", async () => {
  const f = callbackFixture();
  const task = f.send("Where should I shoot?");
  f.currentScope.current = "owner-b";
  f.resolve("private reply");
  await task;
  expect(f.saved).toHaveLength(1);
});
test("navigation cancellation fences a late dashboard reply", async () => {
  const f = callbackFixture();
  const task = f.send("Where should I shoot?");
  f.pendingReply.current?.abort();
  f.resolve("late reply");
  await task;
  expect(f.saved).toHaveLength(1);
});
test("explicit Open calendar still navigates, without a paid AI request", async () => {
  const f = callbackFixture();
  await f.send("Open calendar");
  expect(f.requests).toHaveLength(0);
  expect(f.navigations[0]).toEqual({ to: "/dashboard", search: { view: "calendar" } });
});
test("explicit Open video still navigates, without a paid AI request", async () => {
  const f = callbackFixture();
  await f.send("Open video");
  expect(f.requests).toHaveLength(0);
  expect(f.navigations[0]).toEqual({ to: "/video" });
});

function fixture(
  options: { local?: boolean; enabled?: boolean; owner?: string; response?: Response } = {},
) {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const controller = new AbortController();
  const input = {
    scope: "owner-a",
    messages: [{ role: "user" as const, text: "Where can I shoot tomorrow?" }],
    enabled: options.enabled !== false,
    signal: controller.signal,
  };
  const deps = {
    local: options.local ?? false,
    session: async () => ({
      user: { id: options.owner ?? "owner-a" },
      access_token: "synthetic-token",
    }),
    fetch: (async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return (
        options.response ??
        Response.json({ message: { content: "What city are you planning to shoot in?" } })
      );
    }) as typeof fetch,
  };
  return { requests, controller, run: () => requestDashboardReply(input, deps) };
}
test("dashboard conversation makes a real API request with history but no tools", async () => {
  const f = fixture();
  expect(await f.run()).toContain("What city");
  expect(f.requests[0]?.url).toBe("/api/chat");
  expect(f.requests[0]?.body.mode).toBe("conversation");
  expect(f.requests[0]?.body.workRole).toBe("sports");
  expect(f.requests[0]?.body.tools).toBeUndefined();
});
for (const opts of [{ local: true }, { enabled: false }, { owner: "owner-b" }])
  test(`no request with unavailable AI/session: ${JSON.stringify(opts)}`, async () => {
    const f = fixture(opts);
    await expect(f.run()).rejects.toThrow();
    expect(f.requests).toHaveLength(0);
  });
test("revoked request is fenced before provider access", async () => {
  const f = fixture();
  f.controller.abort();
  await expect(f.run()).rejects.toThrow();
  expect(f.requests).toHaveLength(0);
});
for (const status of [401, 403, 402, 429, 500])
  test(`HTTP ${status} is not a fake reply`, async () => {
    const f = fixture({ response: Response.json({ error: "PRIVATE-CANARY" }, { status }) });
    let message = "";
    try {
      await f.run();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("PRIVATE-CANARY");
  });
test("HTML fallback reports a host/API response problem", async () => {
  const f = fixture({
    response: new Response("<html>SPA</html>", { headers: { "content-type": "text/html" } }),
  });
  await expect(f.run()).rejects.toThrow("unexpected response (200)");
});
test("conversation never executes or accepts a booking/tool success", async () => {
  const f = fixture({
    response: Response.json({ message: { tool_calls: [{ function: { name: "reserve" } }] } }),
  });
  await expect(f.run()).rejects.toThrow("Nothing was run");
});
test("dashboard greets locally; planning still hits AI; Thinking sits above the composer", () => {
  const source = readFileSync(
    new URL("../src/components/dashboard/AppDashboard.tsx", import.meta.url),
    "utf8",
  );
  expect(source).toContain("if (isChatGreeting(text)) return { text: \"Hey.\", href: null }");
  expect(source).toContain("await requestDashboardReply(");
  expect(source).toContain("if (isPhotographyConversation(text)) return null");
  expect(source).toContain("currentScope.current !== scope");
  expect(source).toContain("pendingReply.current?.abort()");
  expect(source).toContain('className="celinen-dash__thinking"');
  expect(source.indexOf("celinen-dash__thinking")).toBeLessThan(
    source.indexOf("social-post__composer celinen-dash__composer"),
  );
});
test("calendar timed rows share readable minimum tracks and scroll together", () => {
  const source = readFileSync(
    new URL("../src/components/dashboard/IosCalendar.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(
    new URL("../src/components/dashboard/ios-calendar.css", import.meta.url),
    "utf8",
  );
  expect(source).toContain("minmax(48px, 1fr)");
  expect(source).toContain("minWidth: 56 + dayColumns.length * 48");
  expect(source).toContain("`56px repeat(${dayColumns.length}, minmax(48px, 1fr))`");
  expect(source).not.toContain("key={`r-${hour}`}");
  expect(source.match(/className="celinen-ios-cal__hours"/g)?.length).toBe(1);
  expect(source.match(/style=\{timedGrid\}/g)?.length).toBeGreaterThanOrEqual(3);
  expect(css).toContain("grid-template-columns: minmax(0, 1fr) 268px");
  expect(css).toContain(".celinen-ios-cal__year-grid");
  expect(css).toContain("repeat(4, minmax(0, 1fr))");
  expect(source).toContain('layout="year"');
  expect(source).toContain("celinen-ios-cal__theme");
  expect(source).toContain('weekday: "long"');
  expect(source).toContain("celinen-ios-cal__daystamp");
  expect(css).toContain("@container (max-width: 700px)");
  expect(css).toContain("width: max-content");
  expect(css).toContain(".celinen-ios-cal__quarter");
  expect(css).toContain("@container (max-width: 900px)");
  expect(css).not.toContain("flex-basis: 100%");
});

test("night mode calendar does not reserve a black appearance gutter", () => {
  const dash = readFileSync(
    new URL("../src/components/dashboard/dashboard.css", import.meta.url),
    "utf8",
  );
  const cal = readFileSync(
    new URL("../src/components/dashboard/ios-calendar.css", import.meta.url),
    "utf8",
  );
  expect(dash).toContain(".celinen-dash__body.is-cal {\n  padding-right: 0;");
  expect(dash).toContain("html.dark .celinen-dash__body.is-cal {\n  background: #111111;");
  expect(cal).toContain("padding: 16px 8px 16px 16px");
  expect(cal).toContain("celinen-ios-cal__bar-tools");
});

test("now line shows the clock on hover and today is a blue dot", () => {
  const source = readFileSync(
    new URL("../src/components/dashboard/IosCalendar.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(
    new URL("../src/components/dashboard/ios-calendar.css", import.meta.url),
    "utf8",
  );
  expect(source).toContain("clockLabel(clock)");
  expect(source).toContain("celinen-ios-cal__now");
  expect(css).toContain(".celinen-ios-cal__now:hover em");
  expect(css).toContain("left: 56px");
  expect(css).toContain("celinen-ios-cal__allday");
  expect(source).toContain("dayColumns.some((day) => sameDay(day, today))");
  expect(css).toMatch(/button\.is-today b\s*\{[^}]*background: #2f6fed/);
});

test("desktop calendar view switcher moves without a click", () => {
  const source = readFileSync(
    new URL("../src/components/dashboard/IosCalendar.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(
    new URL("../src/components/dashboard/ios-calendar.css", import.meta.url),
    "utf8",
  );
  expect(source).toContain('id: "quarter"');
  expect(source).toContain("All Tasks");
  expect(source).toContain("celinen-ios-cal__compact");
  expect(source).not.toContain("Allow full location access");
  expect(source).not.toContain("formatPlace");
  expect(source).toContain('event.pointerType !== "mouse" || viewsLocked');
  expect(source).toContain("lockView");
  expect(source).toContain("unlockViews");
  expect(source).toContain("celinen-ios-cal__lane");
  expect(source).toContain("EventSheet");
  expect(source).toContain("paintStart");
  expect(source).toContain("celinen-ios-cal__ghost");
  expect(source).toContain("onViewsWheel");
  expect(source).not.toContain("celinen-ios-cal__views-thumb");
  expect(css).not.toContain(".celinen-ios-cal__views-thumb");
  expect(css).toContain(".celinen-ios-cal__views {\n  display: flex");
  expect(css).toContain("background: none");
});
