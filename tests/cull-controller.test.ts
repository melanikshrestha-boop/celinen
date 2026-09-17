import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { CullController, type CullSnapshot } from "../src/lib/studio/cull/controller";
import { instantiateIngestWasm } from "../src/lib/studio/cull/ingest-engine";
import { effectiveVerdict, type CullFrame } from "../src/lib/studio/cull/session";
import { createCullWriter, openCullStore } from "../src/lib/studio/cull/store";

const root = new URL("../", import.meta.url);
const ingest = await instantiateIngestWasm(
  readFileSync(new URL("src/lib/studio/cull/celinen-ingest.wasm", root)),
);
const sharpBytes = new Uint8Array(
  readFileSync(new URL("tests/fixtures/photos/volleyball-portrait-cc0.jpg", root)),
);

/** A real frame read through the real engine. `soft` replaces its focus
 * measurements with those of a defocused frame, so the shoot has both kinds. */
function realFrame(id: string, captureTimeMs: number, soft = false) {
  const read = ingest.read(sharpBytes);
  const frame: CullFrame = {
    id,
    name: `${id}.jpg`,
    width: read.width,
    height: read.height,
    bytes: sharpBytes.length,
    captureTimeMs,
    reading: soft
      ? { ...read.reading, acuitySubject: 0.15, acuityBest: 0.18, quality: 12 }
      : read.reading,
    verdict: "undecided",
    decided: false,
  };
  return { frame, thumbnail: read.thumbnail };
}

function settle(controller: CullController): Promise<CullSnapshot> {
  return new Promise((resolve) => {
    const stop = controller.subscribe((snapshot) => {
      queueMicrotask(() => {
        stop();
        resolve(snapshot);
      });
    });
  });
}

describe("cull controller", () => {
  test("reopening a session ranks it again and keeps every decision", async () => {
    const factory = new IDBFactory();
    const store = await openCullStore("account", factory);
    const session = await store.create("Game one");
    await store.append(session.id, [realFrame("sharp", 1000), realFrame("soft", 90_000, true)]);
    const controller = new CullController(store);
    await controller.open(session.id);
    let snapshot = await settle(controller);
    const byId = (id: string) => snapshot.frames.find((frame) => frame.id === id)!;
    expect(byId("sharp").suggestion?.verdict).toBe("keep");
    expect(byId("soft").suggestion?.verdict).toBe("reject");
    expect(byId("soft").suggestion?.reason).toBe("out-of-focus");

    // The photographer keeps the soft frame anyway.
    await controller.decide(["soft"], "keep");
    snapshot = await settle(controller);
    expect(effectiveVerdict(byId("soft"))).toBe("keep");
    expect(snapshot.canUndo).toBe(true);
    controller.dispose();

    // A reload keeps that decision, and the fresh ranking does not overrule it.
    const reopened = new CullController(await openCullStore("account", factory));
    await reopened.open(session.id);
    snapshot = await settle(reopened);
    expect(effectiveVerdict(byId("soft"))).toBe("keep");
    expect(byId("soft").decided).toBe(true);
    reopened.dispose();
  });

  test("bulk decisions undo as one step", async () => {
    const store = await openCullStore("account", new IDBFactory());
    const session = await store.create("Bulk");
    await store.append(session.id, [
      realFrame("a", 1000),
      realFrame("b", 60_000),
      realFrame("c", 120_000),
    ]);
    const controller = new CullController(store);
    await controller.open(session.id);
    await controller.decide(["a", "b", "c"], "reject");
    let snapshot = await settle(controller);
    expect(snapshot.frames.every((frame) => frame.decided && frame.verdict === "reject")).toBe(
      true,
    );
    await controller.undo();
    snapshot = await settle(controller);
    expect(snapshot.frames.every((frame) => !frame.decided)).toBe(true);
    expect(snapshot.canUndo).toBe(false);
    // Deciding a frame the same way twice is not a new undo step.
    await controller.decide(["a"], "keep");
    await controller.decide(["a"], "keep");
    await controller.undo();
    snapshot = await settle(controller);
    expect(snapshot.canUndo).toBe(false);
    controller.dispose();
  });

  test("a decision made while a frame waits to be written is what gets saved", async () => {
    const factory = new IDBFactory();
    const store = await openCullStore("account", factory);
    const session = await store.create("Race");
    const { frame, thumbnail } = realFrame("waiting", 1000);
    let current = frame;
    const writer = createCullWriter(store, session.id, {
      delayMs: 10_000,
      latest: () => current,
    });
    writer.add(frame, thumbnail);
    // The photographer keeps it before the batch commits.
    current = { ...frame, verdict: "keep", decided: true };
    await store.update(session.id, [current]);
    await writer.flush();
    const [saved] = await store.frames(session.id);
    expect(saved!.decided).toBe(true);
    expect(saved!.verdict).toBe("keep");
    store.close();
  });
});
