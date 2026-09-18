import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cullCells } from "../src/components/cull/cull-review";
import {
  cloneDevelopSettings,
  defaultDevelopSettings,
  readDevelopSettings,
} from "../src/lib/develop/contract";
import { libraryGridWindow } from "../src/lib/develop/library-window";
import {
  createDevelopDocument,
  currentRecipe,
  DEVELOP_HISTORY_LIMIT,
  pushHistory,
} from "../src/lib/develop/store";
import { countFrames, decide, groupFrames } from "../src/lib/studio/cull/session";
import { sportsCard } from "./cull-review.fixture";

const VIEWPORT = { width: 1440, height: 900 };
const CARD = 50_000;

describe("cull / develop 50,000-pass backtest", () => {
  test("a 50,000-frame card only mounts the visible window", () => {
    const frames = sportsCard(CARD);
    expect(frames).toHaveLength(CARD);
    const counts = countFrames(frames);
    expect(counts.all).toBe(CARD);
    expect(counts.keepers + counts.rejects).toBe(CARD);
    const groups = groupFrames(frames);
    expect(groups.length).toBe(CARD);
    const cells = cullCells(frames, { filter: "all", stacked: true, expanded: new Set() });
    expect(cells.length).toBe(CARD);
    const window = libraryGridWindow({
      count: CARD,
      viewportWidth: VIEWPORT.width,
      viewportHeight: VIEWPORT.height,
      scrollTop: 0,
      minCardWidth: 176,
      cardHeight: 164,
      gap: 8,
      padding: 16,
    });
    expect(window.end - window.start).toBeLessThan(120);
    expect(window.end - window.start).toBeGreaterThan(0);
    const mid = libraryGridWindow({
      ...window,
      count: CARD,
      viewportWidth: VIEWPORT.width,
      viewportHeight: VIEWPORT.height,
      scrollTop: window.maxScroll / 2,
      minCardWidth: 176,
      cardHeight: 164,
      gap: 8,
      padding: 16,
    });
    expect(mid.start).toBeGreaterThan(0);
    expect(mid.end).toBeLessThan(CARD);
    expect(mid.end - mid.start).toBeLessThan(120);
  });

  test("50,000 scroll positions keep a bounded window on a 50,000-frame card", () => {
    const base = {
      count: CARD,
      viewportWidth: VIEWPORT.width,
      viewportHeight: VIEWPORT.height,
      minCardWidth: 176,
      cardHeight: 164,
      gap: 8,
      padding: 16,
      scrollTop: 0,
    };
    const { maxScroll, rowStride, columns } = libraryGridWindow(base);
    expect(maxScroll).toBeGreaterThan(0);
    let worst = 0;
    for (let i = 0; i < CARD; i++) {
      const window = libraryGridWindow({
        ...base,
        scrollTop: (i / (CARD - 1)) * maxScroll,
      });
      const mounted = window.end - window.start;
      if (mounted > worst) worst = mounted;
      expect(window.start).toBeGreaterThanOrEqual(0);
      expect(window.end).toBeLessThanOrEqual(CARD);
      expect(mounted).toBeLessThanOrEqual(columns * 20);
      expect(window.rowStride).toBe(rowStride);
    }
    expect(worst).toBeLessThan(120);
  });

  test("50,000 keep/reject decisions stay photographer-owned", () => {
    const frames = sportsCard(CARD);
    const decided = frames.map((frame, index) =>
      decide(frame, index % 4 === 0 ? "reject" : "keep"),
    );
    expect(decided).toHaveLength(CARD);
    expect(decided.every((frame) => frame.decided)).toBe(true);
    const counts = countFrames(decided);
    expect(counts.keepers).toBe(37_500);
    expect(counts.rejects).toBe(12_500);
    let frame = frames[0]!;
    for (let i = 0; i < CARD; i++) frame = decide(frame, i % 2 === 0 ? "keep" : "reject");
    expect(frame.decided).toBe(true);
    expect(frame.verdict).toBe("reject");
  });

  test(
    "50,000 Develop setting clones stay valid and history stays capped",
    () => {
      let settings = defaultDevelopSettings();
      for (let i = 0; i < CARD; i++) {
        settings = cloneDevelopSettings({
          ...settings,
          exposure: ((i % 21) - 10) / 2,
          contrast: (i % 101) - 50,
        });
      }
      expect(settings.exposure).toBeGreaterThanOrEqual(-5);
      expect(settings.exposure).toBeLessThanOrEqual(5);
      for (let i = 0; i < 1_000; i++) {
        const wide = cloneDevelopSettings({
          ...defaultDevelopSettings(),
          exposure: (i % 201) - 100,
        });
        expect(wide.exposure).toBeGreaterThanOrEqual(-5);
        expect(wide.exposure).toBeLessThanOrEqual(5);
      }
      expect(readDevelopSettings({ ...defaultDevelopSettings(), exposure: 99 }).exposure).toBe(5);
      expect(readDevelopSettings({ ...defaultDevelopSettings(), exposure: -99 }).exposure).toBe(-5);
      let document = createDevelopDocument("backtest-photo");
      for (let i = 0; i < 400; i++) {
        document = pushHistory(
          document,
          { ...currentRecipe(document), exposure: ((i % 21) - 10) / 2 },
          "Exposure",
        );
      }
      expect(document.history.length).toBeLessThanOrEqual(DEVELOP_HISTORY_LIMIT + 1);
      expect(document.history[0]!.label).toBe("Original");
      expect(currentRecipe(document).exposure).toBeGreaterThanOrEqual(-5);
      expect(currentRecipe(document).exposure).toBeLessThanOrEqual(5);
    },
    { timeout: 30_000 },
  );

  test("Home still sends photos to Cull, not Video", () => {
    const source = readFileSync(
      new URL("../src/components/dashboard/AppDashboard.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("queueStudioImport(photos)");
    expect(source).toContain('void navigate({ to: "/cull" })');
    expect(source).toContain('{ to: "/cull", label: "Cull", icon: Aperture }');
    expect(source).toContain('{ to: "/develop", label: "Develop", icon: SlidersHorizontal }');
    const css = readFileSync(
      new URL("../src/components/dashboard/dashboard.css", import.meta.url),
      "utf8",
    );
    expect(css).toContain(".celinen-dash .cull-workspace");
    expect(css).toContain(".celinen-dash .foto-develop");
  });
});
