import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_PREFERENCES,
  preferencesSchema,
  readPreferences,
} from "../src/lib/account-preferences";
import { restorableTabs } from "../src/lib/workbench-tabs";
import {
  addWorkbenchTab,
  closeWorkbenchTab,
  studioWorkbenchBinding,
  workbenchTab,
} from "../src/lib/workbench";
import { projectScope, scopeToolHref, tabProjectScope } from "../src/lib/workbench-projects";
import { ShootTabs } from "../src/components/workbench/ShootTabs";

describe("Dark, Light and System appearance", () => {
  test("Dark is the default and System settings preserve other preferences", () => {
    expect(preferencesSchema.parse({}).theme).toBe("dark");
    expect(
      readPreferences(
        JSON.stringify({
          theme: "system",
          textSize: "large",
          reduceMotion: true,
          sidebarOpen: false,
        }),
      ),
    ).toEqual({
      ...DEFAULT_PREFERENCES,
      theme: "system",
      textSize: "large",
      reduceMotion: true,
      sidebarOpen: false,
      sendKey: "enter",
    });
    expect(preferencesSchema.parse({ theme: "light" }).theme).toBe("light");
    expect(preferencesSchema.safeParse({ theme: "gray" }).success).toBe(false);
  });
});

describe("tabs belong to a shoot", () => {
  const a = crypto.randomUUID(),
    b = crypto.randomUUID();
  const binding = studioWorkbenchBinding(`/workspace?shoot=${a}`, false);
  test("tabs in other shoots do not exhaust this shoot's restoration budget", () => {
    const previous = Array.from({ length: 40 }, () => `/clients?shoot=${crypto.randomUUID()}`);
    const current = `/deliver?shoot=${a}&workflow=1`;
    const restored = restorableTabs([...previous, current]);
    expect(restored).toHaveLength(41);
    expect(restored.at(-1)?.href).toBe(current);
  });
  test("Studio and Delivery retain shoot context while global Clients survives reload separately", () => {
    const urls = ["/studio", "/deliver?workflow=1", "/clients"].map((href) =>
      scopeToolHref(href, binding),
    );
    urls.push(`/deliver?shoot=${b}&workflow=1`);
    const restored = restorableTabs(JSON.parse(JSON.stringify(urls)));
    expect(restored).toHaveLength(4);
    expect(
      restored.filter((tab) => tabProjectScope(tab.href) === projectScope(binding)),
    ).toHaveLength(2);
    expect(scopeToolHref("/clients", binding)).toBe("/clients");
    expect(restored.find((tab) => tab.path === "/clients")?.href).toBe("/clients");
    expect(restored.filter((tab) => tabProjectScope(tab.href) === b)).toHaveLength(1);
    expect(restorableTabs(["/studio?shoot=legacy"])).toHaveLength(1);
  });
  test("equivalent URLs do not create duplicate tabs", () => {
    const first = workbenchTab(`/deliver?workflow=true&shoot=${a}`)!;
    const second = workbenchTab(`/deliver?shoot=${a}&workflow=1`)!;
    expect(first.href).toBe(second.href);
    expect(addWorkbenchTab([first], second)).toHaveLength(1);
  });
  test("unsafe or mixed bindings and private connection requests are not restored", () => {
    expect(
      restorableTabs([
        "/studio?shoot=bad",
        `/studio?shoot=${a}&shoot=${b}`,
        `/studio?shoot=${a}&project=${b}`,
        `/deliver?shoot=${a}&workspaceProject=${b}`,
        `/mail?shoot=${a}`,
        `/research?shoot=${a}&q=private`,
        `/deliver?shoot=${a}&token=private`,
      ]),
    ).toEqual([]);
  });
  test("closing the last tool returns to the same shoot without affecting another shoot", () => {
    const first = workbenchTab(`/deliver?shoot=${a}&workflow=1`)!;
    const other = workbenchTab(`/clients?shoot=${b}`)!;
    const result = closeWorkbenchTab([first], first.href, first.href);
    expect(scopeToolHref(result.next, binding)).toBe(`/workspace?shoot=${a}`);
    expect([first, other].filter((tab) => tab.href !== first.href)).toEqual([other]);
  });
  test("chat and the new-tab control stay available even before a tool opens", () => {
    const html = renderToStaticMarkup(
      <ShootTabs
        tabs={[]}
        currentHref={null}
        chatHref={`/workspace?shoot=${a}`}
        titles={{}}
        onOpen={async () => true}
        onClose={async () => true}
        onNew={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Tabs in this project"');
    expect(html).toContain('aria-label="Open a new tab in this project"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain(`href="/workspace?shoot=${a}"`);
  });
});
