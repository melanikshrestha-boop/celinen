import { describe, expect, test } from "bun:test";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
import {
  mergeIngestedShots,
  sidecarKey,
  uniquePhotos,
  readImportSidecars,
  sidecarReadNotice,
  SIDECAR_FILE_LIMIT,
  SIDECAR_BATCH_LIMIT,
  fingerprintSource,
  prepareIngestSource,
  createIngestResolver,
  SOURCE_DIGEST_CHUNK_BYTES,
} from "../src/lib/studio/ingest";
import { createHash } from "node:crypto";
import { collectDroppedFiles } from "../src/lib/studio/drop-import";

describe("metadata collisions", () => {
  const pair = () => [
    new File(["first"], "same.jpg", { lastModified: 123 }),
    new File(["other"], "same.jpg", { lastModified: 123 }),
  ];
  test("distinct same-metadata input files survive until byte verification", () => {
    const files = pair();
    expect(uniquePhotos(files)).toEqual(files);
    expect(uniquePhotos([...files].reverse())).toEqual([...files].reverse());
  });
  test("distinct same-metadata dropped files are not silently discarded", async () => {
    const files = pair();
    const result = await collectDroppedFiles({ files, items: [] } as unknown as DataTransfer);
    expect(result.files).toEqual(files);
    expect(result.duplicates).toBe(0);
  });

  test("new colliding originals get deterministic independent IDs regardless of order", async () => {
    const files = pair();
    const resolver = createIngestResolver(files, []);
    const identities = await Promise.all(files.map((file) => resolver.prepare(file)));
    expect(identities.every(Boolean)).toBe(true);
    expect(new Set(identities.map((entry) => entry!.id)).size).toBe(2);
    expect(identities[0]!.sourceDigest).not.toBe(identities[1]!.sourceDigest);
    const backwards = createIngestResolver([...files].reverse(), []);
    const reversed = await Promise.all([...files].reverse().map((file) => backwards.prepare(file)));
    expect(reversed.reverse()).toEqual(identities);
    const frames = identities.map((entry, index) =>
      shot(entry!.id, {
        file: files[index]!,
        sourceDigest: entry!.sourceDigest,
      }),
    );
    expect(mergeIngestedShots([], frames)).toHaveLength(2);
  });

  test("only verified identical byte copies collapse, even with concurrent lanes", async () => {
    const files = Array.from(
      { length: 20 },
      () => new File(["first"], "same.jpg", { lastModified: 123 }),
    );
    const resolver = createIngestResolver(files, []);
    const entries = await Promise.all(files.map((file) => resolver.prepare(file)));
    expect(entries.filter(Boolean)).toHaveLength(1);
    expect(entries.filter((entry) => entry === null)).toHaveLength(19);
  });

  test("a single ordinary source retains its historical metadata ID", async () => {
    const file = pair()[0]!;
    expect((await createIngestResolver([file], []).prepare(file))?.id).toBe("same.jpg:5:123");
  });

  test("each reloaded collision reconnects to its own decisions even when selected alone", async () => {
    const files = pair();
    const resolver = createIngestResolver(files, []);
    const entries = await Promise.all(files.map((file) => resolver.prepare(file)));
    const saved = entries.map((entry, index) =>
      shot(entry!.id, {
        file: new File(["preview"], "preview.jpg", { lastModified: 0 }),
        sourceAvailable: false,
        sourceDigest: entry!.sourceDigest,
        verdict: index ? "reject" : "keep",
        edits: { ...DEFAULT_EDITS, exposure: index + 1 },
      }),
    );
    for (const index of [1, 0]) {
      const file = pair()[index]!;
      const identity = await createIngestResolver([file], saved).prepare(file);
      expect(identity?.id).toBe(saved[index]!.id);
      const merged = mergeIngestedShots(saved, [
        shot(identity!.id, { file, sourceDigest: identity!.sourceDigest }),
      ]);
      expect(merged).toHaveLength(2);
      expect(merged[index]!.file).toBe(file);
      expect(merged[index]!.verdict).toBe(saved[index]!.verdict);
      expect(merged[index]!.edits).toEqual(saved[index]!.edits);
      expect(merged[1 - index]).toBe(saved[1 - index]);
    }
  });

  test("changed bytes cannot enter an existing collision group as a guessed reconnect", async () => {
    const files = pair();
    const entries = await Promise.all(
      files.map((file) => createIngestResolver(files, []).prepare(file)),
    );
    const saved = entries.map((entry, index) =>
      shot(entry!.id, { file: files[index]!, sourceDigest: entry!.sourceDigest }),
    );
    const changed = new File(["third"], "same.jpg", { lastModified: 123 });
    await expect(createIngestResolver([changed], saved).prepare(changed)).rejects.toThrow(
      "different bytes",
    );
  });

  test("an old unqualified saved ID is preserved and rejects its different-byte contender", async () => {
    const files = pair();
    const saved = shot("same.jpg:5:123", { file: files[0]! });
    const resolver = createIngestResolver(files, [saved]);
    expect((await resolver.prepare(files[0]!))?.id).toBe(saved.id);
    await expect(resolver.prepare(files[1]!)).rejects.toThrow("different bytes");
  });

  test("a forged qualified ID still cannot authorize mismatched saved bytes", async () => {
    const files = pair();
    const entry = await createIngestResolver(files, []).prepare(files[0]!);
    const saved = shot(entry!.id, { file: files[1]!, sourceDigest: entry!.sourceDigest });
    await expect(createIngestResolver([files[0]!], [saved]).prepare(files[0]!)).rejects.toThrow(
      "different bytes",
    );
  });

  test("missing fingerprints on legacy previews are still refused", async () => {
    const file = pair()[0]!;
    const saved = shot("same.jpg:5:123", { sourceAvailable: false });
    await expect(createIngestResolver([file], [saved]).prepare(file)).rejects.toThrow(
      "older preview",
    );
  });

  test("same-name ambiguous sidecar targets are withheld without blocking ordinary RAW/JPEG pairs", () => {
    const files = pair();
    expect([...createIngestResolver(files, []).ambiguousSidecarKeys]).toEqual(["same"]);
    const raw = new File(["raw"], "same.ARW", { lastModified: 123 });
    expect(createIngestResolver([files[0]!, raw], []).ambiguousSidecarKeys.size).toBe(0);
    expect(createIngestResolver([files[0]!, files[0]!], []).ambiguousSidecarKeys.size).toBe(0);
  });

  test("read failure and cancellation do not claim an identity or drop a healthy sibling", async () => {
    const files = pair();
    const file = files[0]!;
    const slice = file.slice.bind(file);
    Object.defineProperty(file, "slice", {
      configurable: true,
      value: () => {
        throw new Error("Read refused");
      },
    });
    const resolver = createIngestResolver(files, []);
    await expect(resolver.prepare(file)).rejects.toThrow("Read refused");
    expect(await resolver.prepare(files[1]!)).not.toBeNull();
    Object.defineProperty(file, "slice", { value: slice });
    const controller = new AbortController();
    controller.abort();
    await expect(resolver.prepare(file, controller.signal)).rejects.toThrow("stopped");
    expect(await resolver.prepare(file)).not.toBeNull();
  });
});

function sidecar(path: string, body = "<xmp/>") {
  const file = new File([body], path.split("/").pop()!);
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

const shot = (id: string, patch: Partial<Shot> = {}): Shot => ({
  id,
  file: new File([id], `${id}.jpg`),
  name: `${id}.jpg`,
  isRaw: false,
  previewUrl: null,
  width: 100,
  height: 100,
  sizeMb: 1,
  sharpness: 100,
  brightness: 100,
  clippedHighlights: 0,
  clippedShadows: 0,
  hash: "1".repeat(64),
  score: 75,
  flags: [],
  verdict: "undecided",
  edits: { ...DEFAULT_EDITS },
  ...patch,
});

describe("progressive ingest", () => {
  test("a metadata-identical different original cannot inherit saved edits", () => {
    const original = new File(["first"], "same.jpg", { lastModified: 123 });
    const other = new File(["other"], "same.jpg", { lastModified: 123 });
    const saved = shot("same.jpg:5:123", {
      file: original,
      sourceAvailable: true,
      previewUrl: "blob:saved",
      verdict: "keep",
      edits: { ...DEFAULT_EDITS, exposure: 22 },
    });
    const next = mergeIngestedShots([saved], [shot(saved.id, { file: other })]);
    expect(next[0]).toBe(saved);
  });
  test("an unverified legacy preview cannot silently become a reselected original", () => {
    const saved = shot("a", { sourceAvailable: false, previewUrl: "blob:saved" });
    expect(mergeIngestedShots([saved], [shot("a")])[0]).toBe(saved);
  });
  test("exact sidecar targets keep independent metadata including Unicode and Windows separators", async () => {
    const a = sidecar("Card/IMG.XMP", "keep");
    const b = sidecar("card/IMG.xmp", "reject");
    const c = sidecar("Événement/IMG.xmp", "portrait");
    const result = await readImportSidecars([a, b, c]);
    expect(result.values.get("Card/IMG")).toBe("keep");
    expect(result.values.get("card/IMG")).toBe("reject");
    expect(result.values.get("Événement/IMG")).toBe("portrait");
    expect(sidecarKey(sidecar("Événement\\IMG.JPG"))).toBe("Événement/IMG");
    expect(sidecarReadNotice(result)).toBe("");
  });
  test("duplicate metadata targets are refused in either input order, not last-file-wins", async () => {
    const first = sidecar("Card/IMG.xmp", "keep");
    const conflicting = sidecar("Card/IMG.XMP", "reject");
    for (const files of [
      [first, conflicting],
      [conflicting, first],
    ]) {
      const result = await readImportSidecars(files);
      expect(result.ambiguous).toBe(1);
      expect(result.values.size).toBe(0);
      expect(sidecarReadNotice(result)).toContain("metadata was not applied");
    }
    expect((await readImportSidecars([first, first])).values.get("Card/IMG")).toBe("keep");
  });
  test("case-mismatched or orphan sidecars produce an explicit skipped-metadata notice", async () => {
    const result = await readImportSidecars([sidecar("card/IMG.xmp")]);
    expect(sidecarReadNotice(result, [sidecar("Card/IMG.jpg")])).toContain(
      "without an exact photo match",
    );
    expect(sidecarReadNotice(result, [sidecar("card/IMG.jpg"), sidecar("card/IMG.ARW")])).toBe("");
    expect(sidecarReadNotice(result, [])).toContain("metadata was not applied");
  });
  test("an unreadable candidate cannot hide ambiguity by leaving the other target active", async () => {
    const first = sidecar("IMG.xmp", "keep");
    const broken = sidecar("IMG.XMP");
    Object.defineProperty(broken, "arrayBuffer", {
      value: () => Promise.reject(new Error("denied")),
    });
    const result = await readImportSidecars([first, broken]);
    expect(result.ambiguous).toBe(1);
    expect(result.values.size).toBe(0);
  });
  test("malformed UTF-8 and file read failures do not apply corrupted metadata", async () => {
    const invalid = new File([new Uint8Array([0xff, 0xfe, 0x3c])], "bad.xmp");
    const denied = sidecar("denied.xmp");
    Object.defineProperty(denied, "arrayBuffer", {
      value: () => Promise.reject(new Error("denied")),
    });
    const result = await readImportSidecars([invalid, denied, sidecar("good.xmp")]);
    expect(result.unreadable).toBe(2);
    expect([...result.values.keys()]).toEqual(["good"]);
    expect(sidecarReadNotice(result)).toContain("2 unreadable sidecars");
  });
  test("individual and aggregate sidecar limits bound reads while leaving photos alone", async () => {
    const photo = new File(["not read"], "photo.jpg");
    Object.defineProperty(photo, "arrayBuffer", {
      value: () => {
        throw new Error("Photo must not be read");
      },
    });
    const oversized = sidecar("huge.xmp", "x".repeat(SIDECAR_FILE_LIMIT + 1));
    Object.defineProperty(oversized, "arrayBuffer", {
      value: () => {
        throw new Error("Oversized file must not be read");
      },
    });
    const files = Array.from({ length: SIDECAR_BATCH_LIMIT / SIDECAR_FILE_LIMIT + 1 }, (_, index) =>
      sidecar(`${index}.xmp`, "x".repeat(SIDECAR_FILE_LIMIT)),
    );
    const result = await readImportSidecars([photo, oversized, ...files]);
    expect(result.oversized).toBe(1);
    expect(result.budgetSkipped).toBe(1);
    expect(result.values.size).toBe(SIDECAR_BATCH_LIMIT / SIDECAR_FILE_LIMIT);
    expect(result.unreadable).toBe(0);
  });
  test("cancellation before or during a read starts no subsequent file reads", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(readImportSidecars([sidecar("a.xmp")], controller.signal)).rejects.toThrow(
      "stopped",
    );
    const active = new AbortController();
    const first = sidecar("first.xmp");
    const second = sidecar("second.xmp");
    let reads = 0;
    Object.defineProperty(first, "arrayBuffer", {
      value: async () => {
        active.abort();
        return new ArrayBuffer(first.size);
      },
    });
    Object.defineProperty(second, "arrayBuffer", {
      value: async () => {
        reads++;
        return new ArrayBuffer(second.size);
      },
    });
    await expect(readImportSidecars([first, second], active.signal)).rejects.toThrow("stopped");
    expect(reads).toBe(0);
  });
  test("sidecars never cross case-distinct folders or source names", () => {
    const file = (path: string) => {
      const result = new File([""], path.split("/").pop()!);
      Object.defineProperty(result, "webkitRelativePath", { value: path });
      return result;
    };
    expect(sidecarKey(file("Card/IMG_0001.JPG"))).not.toBe(sidecarKey(file("card/IMG_0001.xmp")));
    expect(sidecarKey(file("Card/IMG_0001.JPG"))).not.toBe(sidecarKey(file("Card/img_0001.xmp")));
    expect(sidecarKey(file("Card/IMG_0001.JPG"))).toBe(sidecarKey(file("Card/IMG_0001.XMP")));
  });
  test("XMP matching isolates cards with repeated camera filenames", () => {
    const file = (path: string) => {
      const result = new File([""], path.split("/").pop()!);
      Object.defineProperty(result, "webkitRelativePath", { value: path });
      return result;
    };
    expect(sidecarKey(file("card-A/IMG_0001.JPG"))).toBe(sidecarKey(file("card-A/IMG_0001.xmp")));
    expect(sidecarKey(file("card-A/IMG_0001.JPG"))).not.toBe(
      sidecarKey(file("card-B/IMG_0001.xmp")),
    );
  });
  test("a failed reconnect cannot degrade a saved preview or decision", () => {
    const saved = shot("a", { previewUrl: "blob:saved", verdict: "keep", sourceAvailable: false });
    const next = mergeIngestedShots([saved], [shot("a", { error: "Decode failed", hash: "" })]);
    expect(next[0]).toBe(saved);
    expect(next[0]?.hash).toBe("1".repeat(64));
  });
  test("late previews preserve decisions and order from live review", async () => {
    const picked = shot("a", { verdict: "keep", edits: { ...DEFAULT_EDITS, exposure: 22 } });
    const incoming = shot("a", { sourceAvailable: true });
    incoming.sourceDigest = await prepareIngestSource(incoming.file, picked);
    const next = mergeIngestedShots([picked, shot("b")], [incoming, shot("c")]);
    expect(next.map((frame) => frame.id)).toEqual(["a", "b", "c"]);
    expect(next[0]?.verdict).toBe("keep");
    expect(next[0]?.edits.exposure).toBe(22);
    expect(next[0]?.sourceAvailable).toBe(true);
    expect(picked.edits.exposure).toBe(22);
  });

  test("content mismatch is refused before decode despite identical visual hashes", async () => {
    const saved = shot("same", { file: new File(["first"], "same.jpg"), verdict: "reject" });
    const incoming = shot("same", { file: new File(["other"], "same.jpg") });
    expect(incoming.hash).toBe(saved.hash);
    await expect(prepareIngestSource(incoming.file, saved)).rejects.toThrow("different bytes");
    expect(mergeIngestedShots([saved], [incoming])[0]).toBe(saved);
  });
  test("a matching saved fingerprint reconnects and keeps every live decision", async () => {
    const source = new File(["original"], "same.jpg");
    const sourceDigest = await fingerprintSource(source);
    const saved = shot("same", {
      file: new File(["small preview"], "same.preview.jpg"),
      sourceAvailable: false,
      sourceDigest,
      previewUrl: "blob:saved",
      verdict: "keep",
      edits: { ...DEFAULT_EDITS, exposure: 22 },
      develop: { origin: "lightroom", at: 1, rating: 5, label: "Red", caption: "Keeper" },
    });
    // Model a persisted/reloaded metadata value, not a live reference to the source.
    const reloaded = { ...saved, sourceDigest: JSON.parse(JSON.stringify(sourceDigest)) };
    const incoming = shot("same", {
      file: new File(["original"], "same.jpg"),
      sourceAvailable: true,
    });
    incoming.sourceDigest = await prepareIngestSource(incoming.file, reloaded);
    saved.edits.contrast = 20;
    const result = mergeIngestedShots([reloaded], [incoming])[0]!;
    expect(result.file).toBe(incoming.file);
    expect(result.sourceAvailable).toBe(true);
    expect(result.edits).toEqual(saved.edits);
    expect(result.edits).not.toBe(saved.edits);
    expect(result.develop).toEqual(saved.develop);
    expect(result.verdict).toBe("keep");
    expect(result.sourceDigest).toBe(sourceDigest);
  });
  test("legacy/malformed fingerprints never read the preview or reinterpret it as an original", async () => {
    for (const sourceDigest of [undefined, "bad", "0".repeat(64)]) {
      const saved = shot("a", { sourceAvailable: false, sourceDigest });
      Object.defineProperty(saved.file, "slice", {
        value: () => {
          throw new Error("Preview read");
        },
      });
      await expect(prepareIngestSource(new File(["a"], "a.jpg"), saved)).rejects.toThrow(
        "older preview",
      );
    }
  });
  test("a copied fingerprint field cannot authorize an unread or replaced incoming File", async () => {
    const file = new File(["original"], "same.jpg");
    const sourceDigest = await fingerprintSource(file);
    const saved = shot("same", { file, sourceDigest });
    const forged = shot("same", { file: new File(["different"], "same.jpg"), sourceDigest });
    expect(mergeIngestedShots([saved], [forged])[0]).toBe(saved);
    await fingerprintSource(forged.file);
    expect(mergeIngestedShots([saved], [forged])[0]).toBe(saved);
  });
  test("changing the saved source after verification refuses the late replacement", async () => {
    const saved = shot("a");
    const incoming = shot("a");
    await prepareIngestSource(incoming.file, saved);
    const changed = { ...saved, file: new File(["different"], "a.jpg") };
    expect(mergeIngestedShots([changed], [incoming])[0]).toBe(changed);
    expect(mergeIngestedShots([saved], [{ ...saved, sourceAvailable: false }])[0]).toBe(saved);
  });
  test("fingerprint format matches independent SHA-256 chain vectors and checks every chunk", async () => {
    const bytes = new Uint8Array(SOURCE_DIGEST_CHUNK_BYTES * 2 + 3).fill(41);
    const file = new File([bytes], "large.raw");
    const reads: number[] = [];
    const slice = file.slice.bind(file);
    Object.defineProperty(file, "arrayBuffer", {
      value: () => {
        throw new Error("Unbounded read");
      },
    });
    Object.defineProperty(file, "slice", {
      value: (start: number, end: number) => {
        reads.push(end - start);
        return slice(start, end);
      },
    });
    let expected = createHash("sha256")
      .update(`LensLabs source v1\n${bytes.length}\n${SOURCE_DIGEST_CHUNK_BYTES}`)
      .digest();
    for (let offset = 0; offset < bytes.length; offset += SOURCE_DIGEST_CHUNK_BYTES)
      expected = createHash("sha256")
        .update(expected)
        .update(bytes.slice(offset, offset + SOURCE_DIGEST_CHUNK_BYTES))
        .digest();
    const actual = await fingerprintSource(file);
    expect(actual).toBe(`sha256-chain-v1:${expected.toString("hex")}`);
    expect(reads).toEqual([SOURCE_DIGEST_CHUNK_BYTES, SOURCE_DIGEST_CHUNK_BYTES, 3]);
    expect(await fingerprintSource(file)).toBe(actual);
    expect(reads).toHaveLength(3);
    for (const index of [0, SOURCE_DIGEST_CHUNK_BYTES, bytes.length - 1]) {
      const changed = bytes.slice();
      changed[index] = 42;
      expect(await fingerprintSource(new File([changed], "large.raw"))).not.toBe(actual);
    }
    expect(await fingerprintSource(new File([bytes.slice(0, -1)], "large.raw"))).not.toBe(actual);
  });
  test("short/failed reads never produce a reusable identity and can retry safely", async () => {
    const file = new File(["abc"], "a.jpg");
    const realSlice = file.slice.bind(file);
    Object.defineProperty(file, "slice", { configurable: true, value: () => new Blob(["ab"]) });
    await expect(fingerprintSource(file)).rejects.toThrow("completely");
    Object.defineProperty(file, "slice", {
      configurable: true,
      value: () => {
        throw new Error("Disconnected");
      },
    });
    await expect(fingerprintSource(file)).rejects.toThrow("Disconnected");
    Object.defineProperty(file, "slice", { value: realSlice });
    expect(await fingerprintSource(file)).toBe(
      await fingerprintSource(new File(["abc"], "other.jpg")),
    );
  });
  test("cancellation interrupts hashing between bounded reads, including cached identities", async () => {
    const controller = new AbortController();
    const file = new File([new Uint8Array(SOURCE_DIGEST_CHUNK_BYTES + 1)], "a.raw");
    let reads = 0;
    const realSlice = file.slice.bind(file);
    Object.defineProperty(file, "slice", {
      configurable: true,
      value: (start: number, end: number) => {
        reads++;
        const part = realSlice(start, end);
        const arrayBuffer = part.arrayBuffer.bind(part);
        Object.defineProperty(part, "arrayBuffer", {
          value: async () => {
            controller.abort();
            return arrayBuffer();
          },
        });
        return part;
      },
    });
    await expect(fingerprintSource(file, controller.signal)).rejects.toThrow("stopped");
    expect(reads).toBe(1);
    Object.defineProperty(file, "slice", { value: realSlice });
    await fingerprintSource(file);
    await expect(fingerprintSource(file, controller.signal)).rejects.toThrow("stopped");
  });

  test("directory extras and duplicate file entries do not become broken frames", () => {
    const jpeg = new File(["photo"], "frame.jpg", { lastModified: 123 });
    const raw = new File(["raw"], "frame.NEF", { lastModified: 123 });
    expect(
      uniquePhotos([jpeg, jpeg, raw, new File([""], ".DS_Store"), new File([""], "frame.xmp")]),
    ).toEqual([jpeg, raw]);
  });
});
