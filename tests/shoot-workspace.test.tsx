import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
import { describeShoot } from "../src/lib/studio/shoot-brief";
import { createShootRecovery } from "../src/lib/studio/recovery";
import { parseProjectArchive } from "../src/lib/projects/archive";
import { validateProject } from "../src/lib/projects/model";
import { hydrateProject } from "../src/lib/projects/studio-adapter";
import {
  canPersistStudioSession,
  sameStudioView,
  StudioSaveConflict,
} from "../src/lib/studio/session";
import { ShootOverview } from "../src/components/workbench/ShootOverview";
import { SaveRecovery } from "../src/components/studio/SaveRecovery";
import { CullChat } from "../src/components/studio/CullChat";

const noop = () => {};
const shot = (id: string, extra: Partial<Shot> = {}): Shot => ({
  id,
  name: `${id}.jpg`,
  relativePath: `Track meet/${id}.jpg`,
  file: new File([`original:${id}`], `${id}.jpg`, { type: "image/jpeg", lastModified: 10 }),
  previewUrl: `blob:fixture-${id}`,
  previewBlob: new Blob([`preview:${id}`], { type: "image/jpeg" }),
  sourceAvailable: true,
  isRaw: false,
  width: 100,
  height: 80,
  sizeMb: 0.01,
  sharpness: 40,
  brightness: 120,
  clippedHighlights: 0,
  clippedShadows: 0,
  hash: "1".repeat(64),
  score: 80,
  flags: [],
  verdict: "undecided",
  edits: { ...DEFAULT_EDITS },
  ...extra,
});

describe("photo-first workspace", () => {
  test("uses real decisions and limits a 3,000-frame brief to six previews", () => {
    const shots = Array.from({ length: 3000 }, (_, i) =>
      shot(String(i), { verdict: i < 400 ? "keep" : i < 600 ? "reject" : "undecided" }),
    );
    const before = shots.map((s) => s.verdict);
    const brief = describeShoot(shots, "2200");
    expect(brief).toMatchObject({
      title: "Track meet",
      total: 3000,
      keepers: 400,
      undecided: 2400,
      missingOriginals: 0,
      reviewId: "600",
    });
    expect(brief.previews).toHaveLength(6);
    expect(brief.previews[0]?.id).toBe("2200");
    expect(new Set(brief.previews.map((s) => s.id)).size).toBe(6);
    expect(brief.previews[0]).not.toHaveProperty("file");
    expect(shots.map((s) => s.verdict)).toEqual(before);
  });
  test("mixed folders and missing previews don't invent a shoot name or pictures", () => {
    const brief = describeShoot(
      [
        shot("a", { relativePath: "one/a.jpg", previewUrl: null, sourceAvailable: false }),
        shot("b", { relativePath: "two/b.jpg", previewUrl: null }),
      ],
      null,
    );
    expect(brief.title).toBe("Your shoot");
    expect(brief.previews).toHaveLength(0);
    expect(brief.missingOriginals).toBe(1);
    const html = renderToStaticMarkup(
      <ShootOverview
        shoot={brief}
        compact={false}
        paused={false}
        onReview={noop}
        onOpen={noop}
        onReconnect={noop}
      />,
    );
    expect(html).toContain("Previews aren’t available");
    expect(html).toContain("Choose source folder");
    expect(html).not.toContain("<img");
  });
  test("loaded chat shows the shoot rather than an empty welcome screen", () => {
    const brief = describeShoot(
      Array.from({ length: 16 }, (_, i) => shot(String(i))),
      "0",
    );
    const html = renderToStaticMarkup(
      <CullChat
        workspace
        frameCount={16}
        shoot={brief}
        context="fixture"
        execute={async () => "ok"}
      />,
    );
    expect(html).toContain("Track meet");
    expect(html).toContain("Continue reviewing");
    expect(html.match(/<img /g)).toHaveLength(6);
    expect(html).not.toContain("The shoot starts here");
    expect(html).toContain("Source previews");
    expect(html).toContain('aria-label="Photo assistant conversation"');
  });
  test("empty chat has one direct import path; compact context does not mount thumbnails", () => {
    const html = renderToStaticMarkup(
      <CullChat workspace context="fixture" execute={async () => "ok"} onImportFolder={noop} />,
    );
    expect(html).toContain('aria-label="Attach photos or a folder"');
    expect(html).toContain('placeholder="Drop your shoot folder."');
    expect(html).toContain('rows="1"');
    expect(html).not.toContain("Choose a folder");
    expect(html).not.toContain("workbench-chat-empty");
    expect(html).not.toContain("On this device");
    expect(html).not.toContain("Continue reviewing");
    const compact = renderToStaticMarkup(
      <ShootOverview
        shoot={describeShoot([shot("a")], "a")}
        compact
        paused={false}
        onReview={noop}
        onOpen={noop}
      />,
    );
    expect(compact).toContain("Open shoot");
    expect(compact).not.toContain("<img");
  });
  test("attachment shelf is conditional, counts remain unknown during enumeration", () => {
    const html = renderToStaticMarkup(
      <CullChat
        workspace
        context="fixture"
        execute={async () => "ok"}
        importing
        importAttachment={{ name: "Actual folder", count: null, kind: "folder" }}
        status="Reading folder…"
      />,
    );
    expect(html).toContain("workbench-attachment");
    expect(html).toContain("Actual folder");
    expect(html).toContain("Reading folder…");
    expect(html).not.toContain("selected photo");
    expect(html).toContain(">Stop</button>");
    const completed = renderToStaticMarkup(
      <CullChat
        workspace
        context="fixture"
        execute={async () => "ok"}
        importAttachment={{ name: "Actual folder", count: 3, kind: "folder" }}
        status="3 frames read"
      />,
    );
    expect(completed).toContain("3 selected photos");
    expect(completed).toContain('aria-label="Dismiss import summary"');
  });
});

describe("paused save and recovery", () => {
  test("conflicted state cannot persist and unchanged view comparison checks order, filter and selection", () => {
    expect(canPersistStudioSession("conflicted")).toBe(false);
    expect(new StudioSaveConflict().name).toBe("StudioSaveConflict");
    const current = { shotIds: ["a", "b"], selectedId: "a", filter: "all" as const };
    expect(sameStudioView(current, ["a", "b"], "a", "all")).toBe(true);
    expect(sameStudioView(current, ["b", "a"], "a", "all")).toBe(false);
    expect(sameStudioView(current, ["a", "b"], "b", "all")).toBe(false);
    expect(sameStudioView(current, ["a", "b"], "a", "keepers")).toBe(false);
    expect(sameStudioView(undefined, [], null, "all")).toBe(false);
  });
  test("archives visible unsaved picks, edits, all frame IDs and available original bytes under a new identity", async () => {
    const shots = [
      shot("a", { verdict: "keep", edits: { ...DEFAULT_EDITS, exposure: 20 } }),
      shot("b", { verdict: "reject", sourceAvailable: false }),
    ];
    const a = await parseProjectArchive(await createShootRecovery(shots, "a", "keepers"));
    const b = await parseProjectArchive(await createShootRecovery(shots, "a", "keepers"));
    const project = validateProject(a.document);
    expect(project.id).not.toBe(validateProject(b.document).id);
    expect(project.frames.map((f) => f.id)).toEqual(["a", "b"]);
    const recovered = await hydrateProject(project, a.blobs);
    try {
      expect(recovered.shots[0]?.verdict).toBe("keep");
      expect(recovered.shots[0]?.edits.exposure).toBe(20);
      expect(await recovered.shots[0]!.file.text()).toBe("original:a");
      expect(recovered.shots[1]?.verdict).toBe("reject");
      expect(recovered.shots[1]?.sourceAvailable).toBe(false);
      expect(recovered.selectedId).toBe("a");
      expect(recovered.filter).toBe("keepers");
      expect(shots[1]?.sourceAvailable).toBe(false);
    } finally {
      for (const s of recovered.shots) if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
    }
  });
  test("recovery refuses empty or oversized sources without omitting them", async () => {
    await expect(createShootRecovery([], null, "all")).rejects.toThrow("no photos");
    const source = shot("large");
    Object.defineProperty(source.file, "size", { value: 129 * 1024 * 1024 });
    await expect(createShootRecovery([source], source.id, "all")).rejects.toThrow("128 MiB");
    expect(source.verdict).toBe("undecided");
  });
  test("recovery is an explicit choice, includes limits, and suppresses import during conflict", () => {
    const recovery = (
      <SaveRecovery message="Changed in another tab." onDownload={async () => {}} onReload={noop} />
    );
    const html = renderToStaticMarkup(
      <CullChat
        workspace
        frameCount={1}
        shoot={describeShoot([shot("a", { sourceAvailable: false })], "a")}
        context="fixture"
        execute={async () => "ok"}
        recovery={recovery}
        paused
        onImportFolder={noop}
      />,
    );
    expect(html).toContain("Download recovery copy");
    expect(html).toContain("Reload saved shoot");
    expect(html).toContain("256 MiB");
    expect(html).toContain("keep this tab open");
    expect(html).not.toContain("Choose source folder");
  });
});
