import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { fitLongEdge, jpegGeometry, orientedSize } from "../src/lib/studio/cull/jpeg-geometry";
import {
  captureDropHandles,
  frameFileStamp,
  OriginalResolver,
  requestSourcePermission,
  SourcePermissionError,
  sourcePermission,
  walkDirectory,
  type CullSourceRoot,
} from "../src/lib/studio/cull/sources";
import { openCullStore } from "../src/lib/studio/cull/store";
import { frameFor, MockDirectory, MockFile } from "./cull-originals.fixture";

const T = 1_726_000_000_000;

function card() {
  const root = new MockDirectory("Card");
  root.add("DCIM/100/IMG_0001.jpg", "first frame", T);
  root.add("DCIM/100/IMG_0002.jpg", "second frame", T + 1000);
  root.add("DCIM/101/IMG_0001.jpg", "same name, other folder", T + 2000);
  return root;
}

describe("finding a frame's original again", () => {
  test("the stamp comes from the frame, or from the id older sessions were saved with", () => {
    expect(frameFileStamp({ id: "x", bytes: 10, lastModified: 5 })).toEqual({
      size: 10,
      lastModified: 5,
    });
    // A path with colons in it is read from the right.
    expect(frameFileStamp({ id: "Card/12:30 game/IMG.jpg:10:1726:3", bytes: 10 })).toEqual({
      size: 10,
      lastModified: 1726,
    });
    // An id that does not carry this frame's size is not trusted for a date.
    expect(frameFileStamp({ id: "custom-id", bytes: 10 })).toEqual({
      size: 10,
      lastModified: null,
    });
  });

  test("resolves by path under the imported folder, and caches each folder lookup", async () => {
    const root = card();
    const resolver = new OriginalResolver([root]);
    const first = await resolver.resolve(frameFor("Card/DCIM/100/IMG_0001.jpg", "first frame", T));
    expect(await first!.text()).toBe("first frame");
    const twin = await resolver.resolve(
      frameFor("Card/DCIM/101/IMG_0001.jpg", "same name, other folder", T + 2000),
    );
    expect(await twin!.text()).toBe("same name, other folder");
    const before = root.lookups;
    await resolver.resolve(frameFor("Card/DCIM/100/IMG_0002.jpg", "second frame", T + 1000));
    // DCIM was already open; only nothing new at the top level was looked up.
    expect(root.lookups).toBe(before);
  });

  test("never returns a changed file: size or date must match", async () => {
    const root = card();
    const resolver = new OriginalResolver([root]);
    // Re-exported in place: same name, new date.
    expect(
      await resolver.resolve(frameFor("Card/DCIM/100/IMG_0001.jpg", "first frame", T - 1)),
    ).toBeNull();
    // Edited: same date, different size.
    expect(
      await resolver.resolve(frameFor("Card/DCIM/100/IMG_0001.jpg", "first frame, edited", T)),
    ).toBeNull();
    // Moved away.
    expect(await resolver.resolve(frameFor("Card/DCIM/102/IMG_9.jpg", "gone", T))).toBeNull();
  });

  test("a renamed card folder, or its parent picked instead, still resolves", async () => {
    const renamed = new MockDirectory("Saturday game");
    renamed.add("DCIM/100/IMG_0001.jpg", "first frame", T);
    const frame = frameFor("Card/DCIM/100/IMG_0001.jpg", "first frame", T);
    expect(await (await new OriginalResolver([renamed]).resolve(frame))!.text()).toBe(
      "first frame",
    );

    const parent = new MockDirectory("Volumes");
    parent.add("Card/DCIM/100/IMG_0001.jpg", "first frame", T);
    expect(await (await new OriginalResolver([parent]).resolve(frame))!.text()).toBe("first frame");
  });

  test("loose dropped files resolve by name, and the stamp picks the right one", async () => {
    const a = new MockFile("IMG_1.jpg", "from card A", T);
    const b = new MockFile("IMG_1.jpg", "from card B!", T + 5);
    const resolver = new OriginalResolver([a, b]);
    expect(
      await (await resolver.resolve(frameFor("IMG_1.jpg", "from card B!", T + 5)))!.text(),
    ).toBe("from card B!");
    expect(await resolver.resolve(frameFor("IMG_2.jpg", "x", T))).toBeNull();
  });

  test("revoked access is reported, and a new grant works without a new resolver", async () => {
    const root = card();
    const resolver = new OriginalResolver([root]);
    const frame = frameFor("Card/DCIM/100/IMG_0001.jpg", "first frame", T);
    root.permission.state = "prompt";
    await expect(resolver.resolve(frame)).rejects.toBeInstanceOf(SourcePermissionError);
    root.permission.state = "granted";
    expect(await resolver.resolve(frame)).not.toBeNull();
  });
});

describe("permission", () => {
  test("granted only when every root is; denied is kept apart from asking", async () => {
    const granted = new MockDirectory("A");
    const prompt = new MockDirectory("B", { state: "prompt" });
    const denied = new MockDirectory("C", { state: "denied" });
    expect(await sourcePermission([granted])).toBe("granted");
    expect(await sourcePermission([granted, prompt, denied])).toBe("prompt");
    expect(await sourcePermission([granted, denied])).toBe("denied");
    expect(await sourcePermission([])).toBe("denied");
  });

  test("asking grants, a refusal is reported, and a lost gesture leaves it askable", async () => {
    const yes = new MockDirectory("A", { state: "prompt", onRequest: () => "granted" });
    expect(await requestSourcePermission([yes])).toBe("granted");
    const no = new MockDirectory("B", { state: "prompt", onRequest: () => "denied" });
    expect(await requestSourcePermission([no])).toBe("denied");
    const expired = new MockDirectory("C", { state: "prompt" });
    expired.requestPermission = async () => {
      throw new DOMException("User activation is required.", "SecurityError");
    };
    expect(await requestSourcePermission([expired])).toBe("prompt");
  });
});

describe("capturing handles at import", () => {
  test("a picked folder yields every file with its path from the folder itself", async () => {
    const files = await walkDirectory(card());
    const paths = files.map((file) => file.webkitRelativePath).sort();
    expect(paths).toEqual([
      "Card/DCIM/100/IMG_0001.jpg",
      "Card/DCIM/100/IMG_0002.jpg",
      "Card/DCIM/101/IMG_0001.jpg",
    ]);
    expect(files.find((file) => file.webkitRelativePath.endsWith("0002.jpg"))!.lastModified).toBe(
      T + 1000,
    );
  });

  test("drop handles are requested synchronously, and a refused item is skipped", async () => {
    const folder = card();
    let calls = 0;
    const item = (handle: CullSourceRoot | Error) => ({
      kind: "file",
      getAsFileSystemHandle: () => {
        calls += 1;
        return handle instanceof Error ? Promise.reject(handle) : Promise.resolve(handle);
      },
    });
    const transfer = {
      items: [
        item(folder),
        item(new Error("denied")),
        // A scripted DataTransfer resolves to undefined, not null.
        { kind: "file", getAsFileSystemHandle: () => Promise.resolve(undefined) },
        { kind: "string" },
      ],
    } as unknown as DataTransfer;
    const pending = captureDropHandles(transfer);
    expect(calls).toBe(2); // before any await: the drag data closes when the event returns
    expect(await pending).toEqual([folder]);
    // A browser without the method: no handles, no error.
    expect(
      await captureDropHandles({ items: [{ kind: "file" }] } as unknown as DataTransfer),
    ).toEqual([]);
  });

  test("a session's roots are stored with it and removed with it", async () => {
    const store = await openCullStore("account", new IDBFactory());
    const session = await store.create("Game");
    // Real handles are structured-cloneable; plain records stand in for them here.
    const roots = [{ kind: "directory", name: "Card" }] as unknown as CullSourceRoot[];
    expect(await store.sources(session.id)).toEqual([]);
    await store.saveSources(session.id, roots);
    expect(await store.sources(session.id)).toEqual(roots);
    await store.deleteSession(session.id);
    expect(await store.sources(session.id)).toEqual([]);
    expect(await store.list()).toEqual([]);
    store.close();
  });
});

describe("JPEG geometry", () => {
  const fixture = new Uint8Array(
    readFileSync(new URL("fixtures/photos/volleyball-portrait-cc0.jpg", import.meta.url)),
  );

  test("reads size from the header", () => {
    const geometry = jpegGeometry(fixture);
    expect(geometry).not.toBeNull();
    expect(geometry!.width).toBeGreaterThan(0);
    expect(geometry!.height).toBeGreaterThan(0);
    expect(jpegGeometry(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  test("reads EXIF orientation in either byte order", () => {
    for (const little of [true, false]) {
      const exif = exifSegment(6, little);
      const bytes = new Uint8Array(2 + exif.length + fixture.length - 2);
      bytes.set([0xff, 0xd8]);
      bytes.set(exif, 2);
      bytes.set(fixture.subarray(2), 2 + exif.length);
      const geometry = jpegGeometry(bytes)!;
      expect(geometry.orientation).toBe(6);
      expect(orientedSize(geometry)).toEqual({ width: geometry.height, height: geometry.width });
    }
  });

  test("fits the long edge without enlarging", () => {
    expect(fitLongEdge(6000, 4000, 2048)).toEqual({ width: 2048, height: 1365 });
    expect(fitLongEdge(4000, 6000, 2048)).toEqual({ width: 1365, height: 2048 });
    expect(fitLongEdge(1200, 800, 2048)).toEqual({ width: 1200, height: 800 });
  });
});

/** An APP1 segment holding one IFD0 entry: Orientation. */
function exifSegment(orientation: number, little: boolean): Uint8Array {
  const tiff: number[] = [];
  const u16 = (value: number) => (little ? [value & 0xff, value >> 8] : [value >> 8, value & 0xff]);
  const u32 = (value: number) =>
    little
      ? [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, value >>> 24]
      : [value >>> 24, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  tiff.push(...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0));
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const length = body.length + 2;
  return new Uint8Array([0xff, 0xe1, length >> 8, length & 0xff, ...body]);
}
