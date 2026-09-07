import { describe, expect, test } from "bun:test";
import {
  createProjectArchive,
  hashBlob,
  parseProjectArchive,
  PROJECT_ARCHIVE_LIMITS,
  PROJECT_ARCHIVE_MIME,
} from "../src/lib/projects/archive";

function pack(manifest: unknown, payload: BlobPart[] = []): Blob {
  const json = new TextEncoder().encode(
    typeof manifest === "string" ? manifest : JSON.stringify(manifest),
  );
  const header = new Uint8Array(16);
  header.set(new TextEncoder().encode("LENSPACK"));
  new DataView(header.buffer).setUint32(8, 1, true);
  new DataView(header.buffer).setUint32(12, json.byteLength, true);
  return new Blob([header, json, ...payload]);
}
const envelope = (blobs: unknown[] = [], document: unknown = { id: "project-a" }) => ({
  format: "lenslabs-project-archive",
  version: 1,
  document,
  blobs,
});
const fakeLargeBlob = (size: number) => {
  const blob = new Blob(["small"]);
  Object.defineProperty(blob, "size", { value: size });
  return blob;
};

describe("portable lenspack archives", () => {
  test("round-trips binary bytes, Unicode metadata and original media types", async () => {
    const jpeg = new Blob(
      [new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 255, 217])],
      { type: "image/jpeg" },
    );
    const raw = new Blob([new Uint8Array([73, 73, 42, 0, 8, 0, 0, 0, 128, 0, 255])], {
      type: "application/octet-stream",
    });
    const ids = [await hashBlob(jpeg), await hashBlob(raw)];
    const document = {
      id: "project-a",
      name: "Saturday · खेल",
      assets: ids,
      originalsIncluded: true,
    };
    const archive = await createProjectArchive(
      document,
      new Map([
        [ids[0]!, jpeg],
        [ids[1]!, raw],
      ]),
    );
    expect(archive.type).toBe(PROJECT_ARCHIVE_MIME);
    const restored = await parseProjectArchive(archive);
    expect(restored.document).toEqual(document);
    expect([...restored.blobs.keys()]).toEqual(ids);
    expect(restored.blobs.get(ids[0]!)?.type).toBe("image/jpeg");
    expect(new Uint8Array(await restored.blobs.get(ids[1]!)!.arrayBuffer())).toEqual(
      new Uint8Array(await raw.arrayBuffer()),
    );
  });

  test("supports metadata-only projects and zero-byte blobs", async () => {
    expect(
      (await parseProjectArchive(await createProjectArchive(null, new Map()))).document,
    ).toBeNull();
    const empty = new Blob([]);
    const id = await hashBlob(empty);
    expect(id).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    const result = await parseProjectArchive(
      await createProjectArchive({ id: "empty" }, new Map([[id, empty]])),
    );
    expect(result.blobs.get(id)?.size).toBe(0);
  });

  test("rejects mismatched source IDs and missing source values before export", async () => {
    await expect(
      createProjectArchive({}, new Map([["0".repeat(64), new Blob(["photo"])]])),
    ).rejects.toThrow("SHA-256 ID");
    await expect(
      createProjectArchive({}, new Map([["0".repeat(64), undefined as unknown as Blob]])),
    ).rejects.toThrow("missing");
    await expect(createProjectArchive({}, new Map([["../photo", new Blob([])]]))).rejects.toThrow(
      "SHA-256",
    );
  });

  test("rejects corrupted payload, missing bytes and trailing content", async () => {
    const source = new Blob([new Uint8Array([0, 1, 2, 255])]);
    const archive = await createProjectArchive({}, new Map([[await hashBlob(source), source]]));
    const bytes = new Uint8Array(await archive.arrayBuffer());
    bytes[bytes.length - 1] = 0;
    await expect(parseProjectArchive(new Blob([bytes]))).rejects.toThrow("corrupted");
    await expect(parseProjectArchive(archive.slice(0, archive.size - 1))).rejects.toThrow(
      "truncated",
    );
    await expect(parseProjectArchive(new Blob([archive, new Uint8Array([0])]))).rejects.toThrow(
      "trailing",
    );
  });

  test("rejects bad magic, unsupported versions and truncated or invalid manifest headers", async () => {
    await expect(parseProjectArchive(new Blob(["LENSPACK"]))).rejects.toThrow("header");
    const archive = await createProjectArchive({}, new Map());
    const bytes = new Uint8Array(await archive.arrayBuffer());
    const badMagic = bytes.slice();
    badMagic[0] = 0;
    await expect(parseProjectArchive(new Blob([badMagic]))).rejects.toThrow("not a lenspack");
    const badVersion = bytes.slice();
    new DataView(badVersion.buffer).setUint32(8, 2, true);
    await expect(parseProjectArchive(new Blob([badVersion]))).rejects.toThrow("version");
    const badLength = bytes.slice();
    new DataView(badLength.buffer).setUint32(12, PROJECT_ARCHIVE_LIMITS.manifestBytes + 1, true);
    await expect(parseProjectArchive(new Blob([badLength]))).rejects.toThrow("manifest length");
    await expect(parseProjectArchive(archive.slice(0, 20))).rejects.toThrow(
      "manifest is truncated",
    );
    await expect(parseProjectArchive(pack("{broken"))).rejects.toThrow("invalid JSON");
  });

  test("rejects duplicate IDs, invalid sizes and unsupported envelope schema", async () => {
    const source = new Blob(["frame"]);
    const descriptor = { id: await hashBlob(source), size: source.size, type: "image/jpeg" };
    await expect(
      parseProjectArchive(pack(envelope([descriptor, descriptor]), [source, source])),
    ).rejects.toThrow("duplicate");
    for (const size of [-1, 1.5, "5", null, PROJECT_ARCHIVE_LIMITS.blobBytes + 1]) {
      await expect(
        parseProjectArchive(pack(envelope([{ ...descriptor, size }]), [source])),
      ).rejects.toThrow("descriptor");
    }
    const infiniteSize = JSON.stringify(envelope([descriptor])).replace('"size":5', '"size":1e999');
    await expect(parseProjectArchive(pack(infiniteSize, [source]))).rejects.toThrow("descriptor");
    await expect(parseProjectArchive(pack({ ...envelope(), version: 2 }))).rejects.toThrow(
      "schema",
    );
    await expect(
      parseProjectArchive(pack({ format: "lenslabs-project-archive", version: 1, blobs: [] })),
    ).rejects.toThrow("schema");
    await expect(
      parseProjectArchive(
        pack(envelope([{ ...descriptor, id: descriptor.id.toUpperCase() }]), [source]),
      ),
    ).rejects.toThrow("descriptor");
  });

  test("rejects a manifest that declares blobs whose bytes are missing", async () => {
    const source = new Blob(["missing"]);
    await expect(
      parseProjectArchive(
        pack(envelope([{ id: await hashBlob(source), size: source.size, type: "" }])),
      ),
    ).rejects.toThrow("source blob is missing");
  });

  test("enforces size/count limits before reading oversized sources", async () => {
    await expect(hashBlob(fakeLargeBlob(PROJECT_ARCHIVE_LIMITS.blobBytes + 1))).rejects.toThrow(
      "128 MiB",
    );
    await expect(
      parseProjectArchive(fakeLargeBlob(PROJECT_ARCHIVE_LIMITS.archiveBytes + 1)),
    ).rejects.toThrow("256 MiB");
    const many = new Map<string, Blob>();
    for (let i = 0; i <= PROJECT_ARCHIVE_LIMITS.blobCount; i++)
      many.set(i.toString(16).padStart(64, "0"), new Blob([]));
    await expect(createProjectArchive({}, many)).rejects.toThrow("20,000");
    await expect(
      parseProjectArchive(
        pack(envelope(Array.from({ length: PROJECT_ARCHIVE_LIMITS.blobCount + 1 }, () => ({})))),
      ),
    ).rejects.toThrow("20,000");
    const twoLarge = new Map([
      ["0".repeat(64), fakeLargeBlob(PROJECT_ARCHIVE_LIMITS.blobBytes)],
      ["1".repeat(64), fakeLargeBlob(PROJECT_ARCHIVE_LIMITS.blobBytes)],
    ]);
    await expect(createProjectArchive({}, twoLarge)).rejects.toThrow("256 MiB");
    await expect(
      createProjectArchive("x".repeat(PROJECT_ARCHIVE_LIMITS.manifestBytes), new Map()),
    ).rejects.toThrow("16 MiB");
  });

  test("rejects documents that JSON would silently change or drop", async () => {
    for (const document of [
      undefined,
      { score: NaN },
      { date: Infinity },
      { missing: undefined },
      { unsupported: 1n },
    ]) {
      await expect(createProjectArchive(document, new Map())).rejects.toThrow("serializable JSON");
    }
    const circular: { self?: unknown } = {};
    circular.self = circular;
    await expect(createProjectArchive(circular, new Map())).rejects.toThrow("serializable JSON");
  });

  test("never invokes metadata getters or serialization hooks", async () => {
    let calls = 0;
    const hook = {
      toJSON: () => {
        calls++;
        return {};
      },
    };
    const getter = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => {
        calls++;
        return "surprise";
      },
    });
    const hiddenHook = Object.defineProperty({}, "toJSON", { value: hook.toJSON });
    await expect(createProjectArchive(hook, new Map())).rejects.toThrow("serializable JSON");
    await expect(createProjectArchive(getter, new Map())).rejects.toThrow("serializable JSON");
    await expect(createProjectArchive(hiddenHook, new Map())).rejects.toThrow("serializable JSON");
    expect(calls).toBe(0);
  });
});
