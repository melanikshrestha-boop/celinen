import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { CullLoupe } from "../src/components/cull/CullLoupe";
import { CullWorkspace } from "../src/components/cull/CullWorkspace";
import {
  compareIds,
  detailRows,
  expandTyped,
  cullCells,
  keyMarks,
  rangeIds,
  staysInView,
} from "../src/components/cull/cull-review";
import { layoutPicture } from "../src/components/cull/picture-view";
import { parseCodeReplacements } from "../src/lib/studio/cull/captions";
import { NO_CODES, type CullSnapshot } from "../src/lib/studio/cull/controller";
import type { FocusHit } from "../src/lib/studio/cull/ingest-engine";
import { NO_REFINE, type CullFrame } from "../src/lib/studio/cull/session";
import { cullFrame, smallGame } from "./cull-review.fixture";

const noop = () => {};
const noThumbnail = async () => null;
const hit = (verdict: FocusHit["verdict"], confidence: number): FocusHit => ({
  hit: confidence,
  afAcuity: 0.3,
  bestAcuity: 0.7,
  bestRegion: { x: 0.6, y: 0.1, w: 0.2, h: 0.2 },
  verdict,
});

function inRouter(node: ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ["/cull"] }),
  });
  return renderToStaticMarkup(
    <RouterContextProvider router={router}>{node}</RouterContextProvider>,
  );
}

function workspace(frames: readonly CullFrame[], snapshot: Partial<CullSnapshot> = {}) {
  return inRouter(
    <CullWorkspace
      snapshot={{
        sessionId: "game",
        frames,
        progress: null,
        notice: null,
        canUndo: false,
        originals: "unavailable",
        keepTarget: null,
        ranked: frames.length,
        codes: NO_CODES,
        ...snapshot,
      }}
      onImport={noop}
      onCancelImport={noop}
      onMark={noop}
      onUndo={noop}
      onKeepTarget={noop}
      thumbnail={noThumbnail}
      viewport={{ width: 1440, height: 900 }}
    />,
  );
}

describe("key marks", () => {
  test("labels and tags toggle off only when every target already has them", () => {
    const red = cullFrame("a", {}, { label: "red", tagged: true });
    const plain = cullFrame("b", {});
    expect(keyMarks({ kind: "label", label: "red" }, [red])).toEqual({ label: null });
    expect(keyMarks({ kind: "label", label: "red" }, [red, plain])).toEqual({ label: "red" });
    expect(keyMarks({ kind: "tag" }, [red])).toEqual({ tagged: false });
    expect(keyMarks({ kind: "tag" }, [red, plain])).toEqual({ tagged: true });
    expect(keyMarks({ kind: "rate", stars: 4 }, [red])).toEqual({ rating: 4 });
  });

  test("a mark that takes the frame out of the view is known before it lands", () => {
    const frame = cullFrame("a", {}, { rating: 4 });
    const fourUp = { ...NO_REFINE, minRating: 4 };
    expect(staysInView(frame, { rating: 2 }, "all", fourUp)).toBe(false);
    expect(staysInView(frame, { rating: 5 }, "all", fourUp)).toBe(true);
    expect(staysInView(frame, { verdict: "reject" }, "keepers", NO_REFINE)).toBe(false);
  });

  test("ranges run either way, and compare takes a selection or a burst's best four", () => {
    const cells = cullCells(smallGame(), { filter: "all", stacked: false, expanded: new Set() });
    expect(rangeIds(cells, 3, 1)).toEqual(["b1-2", "b1-3", "b1-4"]);
    expect(compareIds(["x", "y", "z", "w", "v"], [])).toEqual(["x", "y", "z", "w"]);
    const burst = smallGame().filter((frame) => frame.suggestion?.group === 1);
    expect(compareIds([], burst)).toEqual(["b1-best", "b1-2", "b1-3", "b1-4"]);
    expect(compareIds(["one"], burst.slice(0, 1))).toBeNull();
  });
});

describe("picture layout", () => {
  test("fits without ever drawing past one image pixel per device pixel", () => {
    const view = { zoomed: false, cx: 0.5, cy: 0.5 };
    // A 2560 px picture in a 1000×600 box at 2x: fitted by height.
    const fit = layoutPicture({ width: 2560, height: 1600 }, { width: 1000, height: 600 }, 2, view);
    expect(fit.scale).toBeCloseTo(600 / 1600);
    expect(fit.image.x).toBeCloseTo((1000 - 960) / 2);
    // A 320 px thumbnail in the same box stays 160 CSS px wide at 2x.
    const small = layoutPicture({ width: 320, height: 200 }, { width: 1000, height: 600 }, 2, view);
    expect(small.image.width).toBe(160);
    expect(small.image.x).toBe(420);
  });

  test("100% centres on the view point and never pans off the image", () => {
    const zoomed = layoutPicture({ width: 2560, height: 1600 }, { width: 1000, height: 600 }, 1, {
      zoomed: true,
      cx: 0,
      cy: 1,
    });
    expect(zoomed.scale).toBe(1);
    expect(zoomed.image.x).toBe(0);
    expect(zoomed.image.y).toBe(600 - 1600);
    expect(zoomed.cx).toBeCloseTo(500 / 2560);
  });
});

describe("captions as they are typed", () => {
  const { table } = parseCodeReplacements("u23\tJa'Kobi Lane\nref\tthe referee");

  test("a code expands when its closing delimiter lands, caret after it", () => {
    const typed = "Goal by \\u23\\";
    const result = expandTyped(typed, typed.length, table);
    expect(result.text).toBe("Goal by Ja'Kobi Lane");
    expect(result.caret).toBe(result.text.length);
    const middle = expandTyped("\\u23\\ scores", 5, table);
    expect(middle).toEqual({ text: "Ja'Kobi Lane scores", caret: 12, unknown: [] });
  });

  test("unknown and unfinished codes stay exactly as typed", () => {
    expect(expandTyped("\\u99\\ and \\u2", 13, table)).toEqual({
      text: "\\u99\\ and \\u2",
      caret: 13,
      unknown: ["u99"],
    });
  });
});

describe("review screen marks", () => {
  test("grid cells show stars, label and tag, and a long name keeps its tail and the score", () => {
    const frame = cullFrame(
      "f",
      { score: 77 },
      { name: "9d865dfe5467ce9aa2c70d898a964ca0.jpg", rating: 3, label: "green", tagged: true },
    );
    const html = workspace([frame]);
    expect(html).toContain('class="cull-name-tail">964ca0.jpg<');
    expect(html).toContain('aria-label="3 stars"');
    expect(html).toContain('data-label="green"');
    expect(html).toContain('aria-label="Tagged"');
    expect(html).toContain(">77<");
  });

  test("optional chips appear only with something to show; the keep line shows its count", () => {
    const plain = workspace(smallGame());
    expect(plain).not.toContain("Not from this shoot");
    expect(plain).not.toContain(">Invalid");
    expect(plain).not.toContain(">Missed focus");
    expect(plain).toContain("Keep ~3");
    const stray = cullFrame("s", {}, { membership: { inShoot: false, reason: "Last week" } });
    const art = cullFrame("i", {}, { validity: { status: "invalid", reason: "Illustration" } });
    const missed = cullFrame(
      "m",
      {},
      { focusHit: hit("missed", 0.1), afPoint: { x: 0.4, y: 0.4, w: 0.1, h: 0.1 } },
    );
    const html = workspace([stray, art, missed], { keepTarget: 2 });
    expect(html).toContain(">Not from this shoot 1<");
    expect(html).toContain(">Invalid 1<");
    expect(html).toContain(">Missed focus 1<");
    expect(html).toContain("Keep ~2");
    expect(html).toContain('aria-label="Engine keep line"');
  });

  test("the loupe lists where focus landed and offers the caption", () => {
    const frame = cullFrame(
      "a",
      {},
      {
        afPoint: { x: 0.4, y: 0.3, w: 0.1, h: 0.1 },
        afConfirmed: true,
        focusHit: hit("front-or-back-focus", 0.2),
        caption: "Ja'Kobi Lane dunks",
        burstRole: { role: "alternate", reason: "Same moment, ball less visible" },
      },
    );
    expect(detailRows(frame)).toContainEqual({ label: "AF", value: "Front or back focus · 20%" });
    expect(detailRows(frame)).toContainEqual({
      label: "Alternate",
      value: "Same moment, ball less visible",
    });
    const html = renderToStaticMarkup(
      <CullLoupe
        frame={frame}
        position={0}
        total={1}
        thumbnail={noThumbnail}
        burst={[]}
        onDecide={noop}
        onStep={noop}
        onSelect={noop}
        onClose={noop}
        codes={NO_CODES}
        onCaption={noop}
      />,
    );
    expect(html).toContain("Front or back focus · 20%");
    expect(html).toContain(">Ja&#x27;Kobi Lane dunks</textarea>");
    expect(html).not.toContain("No face found");
  });
});
