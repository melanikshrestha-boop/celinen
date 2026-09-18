import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { CullController, type CullSnapshot } from "../src/lib/studio/cull/controller";
import { directoryTarget } from "../src/lib/studio/cull/handoff/target";
import { openCullStore } from "../src/lib/studio/cull/store";
import { FakeDirectory } from "./handoff-fs.fixture";

const photo = new Uint8Array(
  readFileSync(new URL("./fixtures/photos/volleyball-portrait-cc0.jpg", import.meta.url)),
);
const card = (count: number) =>
  Array.from(
    { length: count },
    (_, index) =>
      new File([photo], `GAME_${String(index).padStart(4, "0")}.jpg`, {
        type: "image/jpeg",
        lastModified: 1_700_000_000_000 + index * 500,
      }),
  );

function settle(controller: CullController): Promise<CullSnapshot> {
  return new Promise((resolve) => {
    const stop = controller.subscribe((snapshot) =>
      queueMicrotask(() => {
        stop();
        resolve(snapshot);
      }),
    );
  });
}

async function names(directory: FakeDirectory): Promise<string[]> {
  const out: string[] = [];
  for await (const name of directory.keys()) out.push(name);
  return out.sort();
}

/** The XMP packet embedded in a copied JPEG, without the megabytes around it. */
async function xmpOf(folder: FakeDirectory, name: string): Promise<string> {
  const text = await (await folder.getFileHandle(name)).getFile().then((file) => file.text());
  const start = text.indexOf("<x:xmpmeta");
  const end = text.indexOf("</x:xmpmeta>");
  return start < 0 || end < 0 ? "" : text.slice(start, end);
}

describe("cull hand-off wiring", () => {
  test("exporting sends the marks a photographer set, and only the frames asked for", async () => {
    const store = await openCullStore("account", new IDBFactory());
    const controller = new CullController(store);
    await controller.importCard("Game", card(4));
    let snapshot = await settle(controller);
    const ids = snapshot.frames.map((frame) => frame.id);
    await controller.mark([ids[0]!], {
      verdict: "keep",
      rating: 5,
      label: "green",
      tagged: true,
      caption: "Ja'Kobi Lane at the rim",
    });
    await controller.mark([ids[1]!], { verdict: "reject" });

    const folder = FakeDirectory.root();
    const report = await controller.exportFrames({
      target: directoryTarget(folder),
      ids: [ids[0]!, ids[1]!],
      renameTemplate: "{filename}",
    });
    expect(report.failed).toEqual([]);
    // Only the two named frames, and a JPEG carries its XMP inside the copy.
    expect(report.copied.map((entry) => entry.destination)).toEqual([
      "GAME_0000.jpg",
      "GAME_0001.jpg",
    ]);
    const packet = await xmpOf(folder, "GAME_0000.jpg");
    expect(packet).toContain('xmp:Rating="5"');
    expect(packet).toContain('xmp:Label="Green"');
    expect(packet).toMatch(/Ja(&#39;|')Kobi Lane at the rim/);
    expect(packet).toContain(">tagged<");
    // The rejected frame is marked as such for Lightroom, not praised.
    expect(await xmpOf(folder, "GAME_0001.jpg")).toContain('xmp:Rating="-1"');

    // Without ids, the shoot's keepers go: the one kept plus the engine's.
    const all = FakeDirectory.root();
    const keepers = await controller.exportFrames({ target: directoryTarget(all) });
    expect(keepers.copied.length).toBeGreaterThan(0);
    expect(await names(all)).not.toContain("GAME_0001.jpg");
    controller.dispose();
  });

  test("a card backup copies every photo while the card is read, and says so", async () => {
    const store = await openCullStore("account", new IDBFactory());
    const controller = new CullController(store);
    const primary = FakeDirectory.root();
    const secondary = FakeDirectory.root();
    await controller.importCard("Game two", card(3), [], {
      primary: directoryTarget(primary),
      secondary: directoryTarget(secondary),
    });
    // The copy runs alongside the read and finishes on its own.
    for (let attempt = 0; attempt < 200; attempt++) {
      const snapshot = controller.snapshot();
      if (snapshot.backup?.done) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const snapshot = controller.snapshot();
    expect(snapshot.backup).toMatchObject({ done: true, failed: 0, cancelled: false });
    const folder = [...primary.entries.keys()].find((name) => !name.startsWith("."))!;
    const dated = await primary.getDirectoryHandle(folder);
    expect(await names(dated as FakeDirectory)).toEqual([
      "GAME_0000.jpg",
      "GAME_0001.jpg",
      "GAME_0002.jpg",
    ]);
    expect(await names(secondary)).toContain(".celinen-ingest.json");
    controller.dispose();
  });
});
