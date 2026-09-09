import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HistoryRowActions, ArchiveUndo } from "../src/components/workbench/HistoryRowActions";
import {
  mergeShootOrganization,
  shootOrganizationKeySchema,
} from "../src/lib/studio/shoot-directory";
import { summarizeShoots } from "../src/components/shoots/navigation";
import { newProject } from "../src/lib/projects/model";

const id = "eeaf3000-1111-4222-8333-000000000031";
describe("row-specific pin and reversible archive", () => {
  test("controls have accurate independent pin/archive and restore labels, no navigation links", () => {
    const html = renderToStaticMarkup(
      <HistoryRowActions
        title="Game <one>"
        kind="chat"
        pinned
        archived
        disabled={false}
        pin={() => {}}
        archive={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Unpin Shoot: Game &lt;one&gt;"');
    expect(html).toContain('aria-label="Restore Shoot: Game &lt;one&gt;"');
    expect(html).toContain('aria-pressed="true"');
    expect(html.match(/type="button"/g)).toHaveLength(2);
    expect(html).not.toContain("<a");
    expect(html).not.toContain("is-pinned");
    expect(renderToStaticMarkup(<ArchiveUndo title="Game" disabled undo={() => {}} />)).toContain(
      'disabled=""',
    );
  });
  test("both actual control handlers stop row navigation/rename before invoking their own command", () => {
    const called: string[] = [];
    const element = HistoryRowActions({
      title: "Game",
      kind: "shoot",
      pinned: false,
      archived: false,
      disabled: false,
      pin: () => called.push("pin"),
      archive: () => called.push("archive"),
    });
    for (const button of element.props.children)
      button.props.onClick({ stopPropagation: () => called.push("stop") });
    expect(called).toEqual(["stop", "pin", "stop", "archive"]);
    element.props.onPointerDown({ stopPropagation: () => called.push("pointer stopped") });
    element.props.onDoubleClick({ stopPropagation: () => called.push("double stopped") });
    expect(called.slice(-2)).toEqual(["pointer stopped", "double stopped"]);
  });
  test("fine pointer reveals only hovered or keyboard-focused row; selection and pin do not override visibility", () => {
    const css = readFileSync(resolve("src/components/workbench/row-actions.css"), "utf8");
    expect(css).toContain("opacity: 0");
    expect(css).toContain("pointer-events: none");
    expect(css).toContain(".history-row:hover > .history-row-actions");
    expect(css).toContain(".history-row:has(:focus-visible) > .history-row-actions");
    expect(css).toContain("(pointer: coarse)");
    expect(css).toContain("44px");
    expect(css).not.toMatch(/\.is-active|\.is-pinned|aria-pressed/);
    const chat = readFileSync(resolve("src/components/workbench/ChatRecents.tsx"), "utf8");
    expect(chat).toContain("history.archive(row.id, !row.archived)");
    expect(chat).toContain("history.archive(undoArchive.id, false)");
    expect(chat).toContain('kind="chat"');
    const shell = readFileSync(resolve("src/components/workbench/Workbench.tsx"), "utf8");
    expect(shell).toContain('className="foto-sidebar-chats"');
    expect(shell).not.toContain('className="foto-conversation-history"');
  });
  test("canonical organization identity distinguishes local projects and shoots and rejects paths", () => {
    for (const key of [id, `project:${id}`, "legacy"])
      expect(shootOrganizationKeySchema.safeParse(key).success).toBe(true);
    for (const key of [
      "project:legacy",
      "../shoots",
      "",
      `${id}?other`,
      "__proto__",
      "https://example.com",
    ])
      expect(shootOrganizationKeySchema.safeParse(key).success).toBe(false);
    expect(() => mergeShootOrganization(id, { key: `project:${id}` }, { pinned: true })).toThrow(
      "Wrong shoot",
    );
    expect(() => mergeShootOrganization(id, undefined, { pinned: "yes" } as never)).toThrow();
    expect(() => mergeShootOrganization(id, undefined, { delete: true } as never)).toThrow();
    expect(() => mergeShootOrganization(id, undefined, {})).toThrow();
    expect(() => mergeShootOrganization(id, undefined, { pinned: undefined } as never)).toThrow();
    const pinned = mergeShootOrganization(id, undefined, { pinned: true });
    expect(
      mergeShootOrganization(id, pinned, { pinned: undefined, archived: true } as never).pinned,
    ).toBe(true);
  });
  test("1000 interleaved field patches retain unknown metadata, other flags and their original inputs", () => {
    let value = mergeShootOrganization(
      id,
      { key: id, custom: { retain: ["untouched"] } },
      { pinned: false },
    );
    for (let n = 0; n < 1000; n++) {
      const before = JSON.stringify(value),
        pinned = value.pinned,
        archived = value.archived;
      const next =
        n % 2
          ? mergeShootOrganization(id, value, { pinned: !pinned }, { pinned })
          : mergeShootOrganization(id, value, { archived: !archived }, { archived });
      expect(JSON.stringify(value)).toBe(before);
      expect(next.custom).toEqual({ retain: ["untouched"] });
      expect(n % 2 ? next.archived : next.pinned).toBe(n % 2 ? archived : pinned);
      expect(next.revision).toBe(value.revision + 1);
      value = next;
    }
  });
  test("organization changes order/visibility metadata without changing source counts, timestamps or documents", () => {
    const shoot = {
      id,
      title: "Real shoot",
      named: true,
      count: 337,
      updatedAt: 10,
      recoveredFromDevice: false,
      recoveryPending: false,
    };
    const project = newProject({
      title: "Album",
      genre: "sports",
      brief: "",
      clientId: null,
      bookingId: null,
      invoiceIds: [],
      galleryIds: [],
    });
    project.id = id;
    const before = JSON.stringify([shoot, project]);
    const organization = {
      [id]: mergeShootOrganization(id, undefined, { pinned: true, archived: true }),
    };
    const rows = summarizeShoots([shoot], [project], organization);
    expect(rows[0]?.key).toBe(id);
    expect(rows[0]?.pinned).toBe(true);
    expect(rows[0]?.archived).toBe(true);
    expect(rows[0]?.photoCount).toBe(337);
    expect(rows[0]?.updatedAt).toBe(10);
    expect(rows.find((row) => row.kind === "project")?.archived).toBe(false);
    expect(JSON.stringify([shoot, project])).toBe(before);
  });
});
