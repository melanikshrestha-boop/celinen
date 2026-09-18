import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { TooltipProvider } from "../src/components/ui/tooltip";
import {
  LibraryRecents,
  NewShootAction,
  type NavigationRecent,
} from "../src/components/workbench/PrimaryNavigation";
import {
  historyKindLabel,
  showRecentSection,
  sidebarConversationTitle,
} from "../src/components/workbench/sidebar-presentation";
import { workspaceText } from "../src/lib/workspace-language";

const source = (name: string) => readFileSync(`src/components/workbench/${name}`, "utf8");
const recents = (rows: NavigationRecent[], error = "") =>
  renderToStaticMarkup(
    <LibraryRecents rows={rows} activeId="0" open={() => {}} loading={false} error={error} />,
  );

describe("compact sidebar presentation without identity changes", () => {
  test("only the unnamed default title changes vocabulary; saved custom titles are exact", () => {
    expect(sidebarConversationTitle({ title: "New chat", named: false })).toBe("New Shoot");
    for (const title of ["New chat", "New Shoot", "studio RAW 🟠", "Client A / 2026", "<shoot>"]) {
      const row = Object.freeze({ title, named: true });
      expect(sidebarConversationTitle(row)).toBe(title);
      expect(row.title).toBe(title);
    }
    expect(sidebarConversationTitle({ title: "Automatically titled shoot", named: false })).toBe(
      "Automatically titled shoot",
    );
    expect(
      ["chat", "shoot", "album"].map((kind) =>
        historyKindLabel(kind as "chat" | "shoot" | "album"),
      ),
    ).toEqual(["Shoot", "Shoot", "Album"]);
  });

  test("Recent is absent for zero through two rows and starts at three without hiding saved data", () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({
      id: String(i),
      title: `Original name ${i}`,
      href: `/shoots/${i}`,
      detail: "337 photos · Updated Sep 8",
    }));
    const before = JSON.stringify(rows);
    for (const count of [0, 1, 2]) {
      expect(showRecentSection(count)).toBe(false);
      expect(recents(rows.slice(0, count))).toBe("");
    }
    expect(showRecentSection(3)).toBe(true);
    const html = recents(rows.slice(0, 3));
    expect(html).toContain("<h2>Recent</h2>");
    expect(html.match(/class="foto-library-row/g)).toHaveLength(3);
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain("<small>");
    expect(html).toContain('aria-description="337 photos · Updated Sep 8"');
    expect(JSON.stringify(rows)).toBe(before);
    for (const invalid of [-1, NaN, Infinity, 2.5]) expect(showRecentSection(invalid)).toBe(false);
  });

  test("recovery remains described and operation feedback survives a hidden Recent list", () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: String(i),
      title: `Source ${i}`,
      href: "/library",
      detail: "337 photos",
      recoveryPending: true,
    }));
    expect(recents(rows)).toContain('aria-description="Recovery available"');
    const error = recents(rows.slice(0, 2), "Could not archive; your source remains saved.");
    expect(error).toContain('role="alert"');
    expect(error).not.toContain("<h2>Recent</h2>");
    expect(error).not.toContain('class="foto-library-row');
    const component = source("PrimaryNavigation.tsx");
    expect(component).toContain("!actions.archived && !actions.error");
    expect(component).toContain("<ArchiveUndo");
  });

  test("one prominent New Shoot action; history plus and menus keep existing guarded callbacks", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <NewShootAction create={() => {}} busy={false} />
      </TooltipProvider>,
    );
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('aria-label="New Shoot"');
    expect(html).toContain(">New Shoot</span>");
    const chat = source("ChatRecents.tsx");
    expect(chat).toContain('"Archived Shoots" : "Shoots"');
    expect(chat).toContain('aria-label={t("New Shoot")}');
    expect(chat).toContain("if (await history.select())");
    expect(chat).toContain("history.archive(row.id, !row.archived)");
    expect(chat).toContain("history.archive(undoArchive.id, false)");
    expect(chat).toContain("setRenameText(row.title)");
    expect(chat).toContain("<span>{sidebarConversationTitle(row)}</span>");
    expect(chat).toContain("[data-history-menu]");
    expect(chat).toContain('querySelector<HTMLElement>("[data-history-new]")');
    expect(source("Workbench.tsx").match(/<NewShootAction /g)).toHaveLength(1); // drawer/sheet only — no permanent mobile rail
    const workbench = source("Workbench.tsx");
    expect(workbench).toContain('className="workbench-sidebar-toggle workbench-mobile-menu"');
    expect(workbench).toContain("setOpenMobile(true)");
    expect(workbench).not.toContain("foto-mobile-rail");
  });

  test("no active marker, shared compact row metric, focus rings and touch targets retained", () => {
    const css = source("workbench.css");
    expect(css).not.toContain(".foto-primary-item.is-active::before");
    expect(css).not.toMatch(/(?:\.ll-chat-row|\.foto-recent-item|\.recent-shoot-row)[^{]*::before/);
    expect(css).toContain("--foto-sidebar-row-height: 29px");
    expect(css).toContain("--workspace-sidebar-width: 232px");
    expect(css).toContain("--toolbar-height: 42px");
    expect(css).toContain("--foto-sidebar-row-height: 44px");
    expect(css).toContain("min-height: var(--foto-sidebar-row-height)");
    expect(css).toContain(".foto-library-recents + .foto-sidebar-chats");
    expect(css).toContain("outline: 2px solid var(--wb-focus, currentColor)");
    expect(css).toContain(".history-row > .foto-library-row:is(:hover, .is-active)");
    expect(source("chat-controls.css")).toContain(
      "font-family: var(--workspace-ui-font, var(--font-sans))",
    );
    expect(source("chat-controls.css")).toContain("text-overflow: ellipsis");
    expect(source("row-actions.css")).toContain(
      ".history-row:has(:focus-visible) > .history-row-actions",
    );
    expect(source("row-actions.css")).not.toContain(".is-active");
    const settingsCss = readFileSync("src/components/account/settings-workspace.css", "utf8");
    const settingsTargets = Array.from(
      settingsCss.matchAll(/\.settings-nav-group > button\s*\{[^}]*min-height:\s*(\d+)px/g),
    );
    // The last narrow-screen rule must not shrink the earlier touch target.
    expect(settingsTargets.at(-1)?.[1]).toBe("44");
    expect(settingsCss).toContain("@media (hover: none), (pointer: coarse)");
  });

  test("new display labels preserve the explicit Spanish language choice", () => {
    for (const label of [
      "Shoots",
      "New Shoot",
      "Archived Shoots",
      "Recent Shoots",
      "New Section…",
      "Open in Side Panel",
    ])
      expect(workspaceText(label, "es")).not.toBe(label);
    expect(workspaceText("New Shoot", "en")).toBe("New Shoot");
    expect(workspaceText("User-authored title", "es")).toBe("User-authored title");
  });
});
