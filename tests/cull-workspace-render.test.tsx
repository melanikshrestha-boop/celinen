import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { CullLoupe } from "../src/components/cull/CullLoupe";
import { CullWorkspace, type CullWorkspaceProps } from "../src/components/cull/CullWorkspace";
import { libraryGridWindow } from "../src/lib/develop/library-window";
import type { CullSnapshot } from "../src/lib/studio/cull/controller";
import {
  applySuggestions,
  formatRemaining,
  groupFrames,
  ingestProgress,
  type CullFrame,
} from "../src/lib/studio/cull/session";
import { cullFrame, cullReading, cullRow, smallGame, sportsCard } from "./cull-review.fixture";

const VIEWPORT = { width: 1440, height: 900 };
const noop = () => {};
const noThumbnail = async () => null;

function inRouter(node: ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ["/cull"] }),
  });
  return renderToStaticMarkup(
    <RouterContextProvider router={router}>{node}</RouterContextProvider>,
  );
}

type Overrides = Partial<Omit<CullWorkspaceProps, "snapshot">> & {
  snapshot?: Partial<CullSnapshot>;
};

function renderWorkspace(frames: readonly CullFrame[], overrides: Overrides = {}) {
  const { snapshot, ...props } = overrides;
  return inRouter(
    <CullWorkspace
      snapshot={{
        sessionId: "game",
        frames,
        progress: null,
        notice: null,
        canUndo: false,
        ...snapshot,
      }}
      onImport={noop}
      onCancelImport={noop}
      onDecide={noop}
      onUndo={noop}
      thumbnail={noThumbnail}
      viewport={VIEWPORT}
      {...props}
    />,
  );
}

const cards = (html: string) => html.match(/data-frame-id="/g)?.length ?? 0;
const card = (html: string, id: string) =>
  html.match(
    new RegExp(`<div class="cull-card[^"]*" data-frame-id="${id}"[\\s\\S]*?</button>`),
  )?.[0];

describe("cull workspace", () => {
  test("a 10,000-frame card mounts only the visible window", () => {
    const html = renderWorkspace(sportsCard(10_000));
    const window = libraryGridWindow({
      count: 10_000,
      viewportWidth: VIEWPORT.width,
      viewportHeight: VIEWPORT.height,
      scrollTop: 0,
      minCardWidth: 176,
      cardHeight: 164,
      gap: 8,
      padding: 16,
    });
    expect(html).toContain('data-cell-count="10000"');
    expect(cards(html)).toBe(window.end - window.start);
    expect(cards(html)).toBeLessThan(100);
    // The spacer still gives the scrollbar the whole card's height.
    const rows = Math.ceil(10_000 / window.columns);
    expect(html).toContain(`height:${rows * window.rowStride - window.gap + 32}px`);
  });

  test("filter chips carry live counts, and empty reasons cannot be picked", () => {
    const html = renderWorkspace(smallGame());
    for (const label of [
      "All 10",
      "Keepers 3",
      "Rejects 6",
      "Undecided 1",
      "Out of focus 1",
      "Motion blur 1",
      "Eyes closed 1",
      "Exposure 0",
      "Duplicates 6",
    ])
      expect(html).toContain(`>${label}</button>`);
    expect(html).toMatch(/aria-pressed="true"[^>]*>All 10</);
    expect(html).toMatch(/disabled=""[^>]*>Exposure 0</);
    expect(html).toContain("10 frames · 3 keepers · 6 rejects · 1 undecided");
  });

  test("bursts show as one stack with its count until opened", () => {
    const html = renderWorkspace(smallGame());
    expect(cards(html)).toBe(6);
    expect(html).toContain('aria-label="Burst of 4"');
    expect(html).toContain('aria-label="Burst of 2"');
    expect(card(html, "b1-2")).toBeUndefined();
    expect(card(html, "b1-best")).toContain("Best of burst");
    expect(card(html, "b1-best")).toContain(">91<");
  });

  test("the photographer's decision looks different from the engine's suggestion", () => {
    const html = renderWorkspace(smallGame());
    const mine = card(html, "s-eyes")!;
    const engine = card(html, "s-focus")!;
    expect(mine).toContain('data-source="photographer"');
    expect(mine).toContain('aria-label="Kept"');
    expect(mine).toContain("Eyes closed");
    expect(engine).toContain('data-source="engine"');
    expect(engine).toContain('aria-label="Suggested reject"');
    expect(card(html, "s-open")).not.toContain("cull-mark");
  });

  test("a re-suggestion leaves the photographer's keep on screen", () => {
    const resuggested = applySuggestions(
      smallGame(),
      new Map([["s-eyes", cullRow({ verdict: "reject", reason: "out-of-focus", score: 2 })]]),
    );
    const mine = card(renderWorkspace(resuggested), "s-eyes")!;
    expect(mine).toContain('aria-label="Kept"');
    expect(mine).toContain("Out of focus");
    expect(mine).toContain(">2<");
  });

  test("bulk actions only count frames they are allowed to change", () => {
    const html = renderWorkspace(smallGame());
    expect(html).toContain(">Keep 9</button>");
    expect(html).toContain(">Reject 9</button>");
    expect(html).toContain(">Clear 1</button>");
  });

  test("frames are reviewable while the card is still reading, and the read can be cancelled", () => {
    const progress = ingestProgress(10_000, 3_400, 12, 29_000);
    const html = renderWorkspace(sportsCard(40), { snapshot: { progress } });
    expect(html).toContain('role="status"');
    expect(html).toContain("3,412 of 10,000");
    expect(html).toContain("118/sec");
    expect(formatRemaining(progress.remainingMs)).toBe("56 seconds left");
    expect(html).toContain("56 seconds left");
    expect(html).toContain(" · 12 unreadable");
    expect(html).toContain(">Cancel</button>");
    expect(cards(html)).toBe(40);
    expect(html).toMatch(/disabled=""[^>]*>Import folder</);
    expect(html).toContain("← → J L move · K keep · X reject");
  });

  test("Go to Develop is the next step once there are keepers", () => {
    expect(renderWorkspace(smallGame())).not.toContain(">Go to Develop</button>");
    expect(renderWorkspace(smallGame(), { onDevelop: noop })).toContain(">Go to Develop</button>");
    expect(renderWorkspace([], { onDevelop: noop })).not.toContain(">Go to Develop</button>");
  });

  test("undo shows only when the controller has something to undo", () => {
    expect(renderWorkspace(smallGame())).not.toContain(">Undo</button>");
    expect(renderWorkspace(smallGame(), { snapshot: { canUndo: true } })).toMatch(
      /data-app-key="undo"[^>]*>Undo</,
    );
  });

  test("an empty session offers import and the recent sessions", () => {
    const sessions = [
      { id: "game", name: "Lakers vs Celtics", createdAt: 0, updatedAt: 0, frameCount: 10_412 },
      { id: "warmups", name: "Warmups", createdAt: 0, updatedAt: 0, frameCount: 812 },
    ];
    const empty = renderWorkspace([], { sessions, onOpenSession: noop });
    expect(empty).toContain("Drop a folder");
    expect(empty).not.toMatch(/disabled=""[^>]*>Import folder</);
    expect(empty).not.toContain("cull-grid");
    expect(empty).toContain("Lakers vs Celtics");
    expect(empty).toContain(">10,412<");
    // Without a way to open one, no list is offered.
    expect(renderWorkspace([], { sessions })).not.toContain("Lakers vs Celtics");
    // An open session is named in the header.
    expect(renderWorkspace(smallGame(), { sessions, onOpenSession: noop })).toContain(
      "Lakers vs Celtics · </span>10 frames",
    );
  });

  test("a notice from the controller is reported", () => {
    const html = renderWorkspace([], { snapshot: { notice: "The card was removed." } });
    expect(html).toContain('role="alert"');
    expect(html).toContain("The card was removed.");
  });
});

describe("cull loupe", () => {
  const game = smallGame();
  const burst = groupFrames(game.filter((frame) => frame.suggestion?.group === 1))[0]!.frames;
  const loupe = (frame = burst[0]!) =>
    renderToStaticMarkup(
      <CullLoupe
        frame={frame}
        position={0}
        total={6}
        thumbnail={noThumbnail}
        burst={burst}
        onDecide={noop}
        onStep={noop}
        onSelect={noop}
        onClose={noop}
      />,
    );

  test("compares the burst best first", () => {
    const html = loupe();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Burst of 4"');
    const order = [...html.matchAll(/<button type="button" aria-label="(b1-[^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(order).toEqual(["b1-best.NEF", "b1-2.NEF", "b1-3.NEF", "b1-4.NEF"]);
    expect(html).toContain("1 of 6 · 6048×4024");
    expect(html).toMatch(/aria-label="Previous" disabled=""/);
  });

  test("says the measurements plainly and shows the photographer's own decision", () => {
    const soft = cullFrame(
      "soft",
      { verdict: "reject", reason: "missed-focus", score: 9 },
      {
        reading: cullReading({ acuitySubject: 0.2, acuityBest: 0.7, motion: 0.4 }),
        verdict: "reject",
        decided: true,
      },
    );
    const html = loupe(soft);
    expect(html).toContain("Soft, focus missed the subject");
    expect(html).toContain("Subject motion");
    expect(html).toContain("Focus missed the subject");
    expect(html).toMatch(/data-verdict="reject" aria-pressed="true"/);
    expect(html).toMatch(/data-verdict="keep" aria-pressed="false"/);
    expect(html).not.toMatch(/data-verdict="undecided"[^>]*disabled=""/);
  });
});
