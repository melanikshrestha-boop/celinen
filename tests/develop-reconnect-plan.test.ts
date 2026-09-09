import { describe, expect, test } from "bun:test";
import { DEVELOP_RECONNECT_LIMITS, planDevelopReconnect } from "../src/lib/develop/reconnect-plan";
import {
  developPhotoFromFile,
  reconnectDevelopPhoto,
  type DevelopPhoto,
} from "../src/lib/develop/store";
import { fingerprintSource } from "../src/lib/studio/ingest";

function file(content: string, name = "source.ARW", path?: string) {
  const value = new File([content], name, { lastModified: 100, type: "application/octet-stream" });
  if (path) Object.defineProperty(value, "webkitRelativePath", { value: path });
  return value;
}
function photo(id = "studio:saved", patch: Partial<DevelopPhoto> = {}): DevelopPhoto {
  return {
    id,
    name: "Display name",
    sourceFileName: "source.ARW",
    sourceLastModified: 50,
    sourceDigest: null,
    width: 0,
    height: 0,
    isRaw: true,
    sourceBlob: null,
    previewBlob: null,
    previewOrigin: "unknown",
    sourceAvailable: false,
    createdAt: 1,
    ...patch,
  };
}
async function digest(source: File) {
  return (await developPhotoFromFile(source)).sourceDigest!;
}

describe("read-only reviewed batch reconnect preflight", () => {
  test("known full-byte SHA-256 variants offer verified matches under the original filename", async () => {
    const original = file("original bytes");
    const hash = await digest(original);
    for (const sourceDigest of [
      hash,
      hash.toUpperCase(),
      hash.slice(7),
      hash.slice(7).toUpperCase(),
    ]) {
      const saved = photo("studio:one", { sourceDigest });
      const plan = await planDevelopReconnect([saved], [original]);
      expect(plan.entries[0]?.status).toBe("verified");
      expect(plan.entries[0]?.selectedByDefault).toBe(true);
      expect(plan.entries[0]?.file).toBe(original);
      expect(plan.entries[0]?.targetId).toBe(saved.id);
      expect(plan.entries[0]?.targetName).toBe("Display name");
      expect(plan.entries[0]?.reason).toContain("Image decode");
      // Execution still independently verifies the current saved record.
      expect((await reconnectDevelopPhoto(saved, original, new Blob(["decoded preview"]))).id).toBe(
        saved.id,
      );
    }
  });

  test("legacy full-byte chain fingerprints remain distinguishable from ordinary SHA-256", async () => {
    const original = file("legacy full-byte source");
    const saved = photo("legacy", { sourceDigest: await fingerprintSource(original) });
    const plan = await planDevelopReconnect([saved], [original]);
    expect(plan.entries[0]?.status).toBe("verified");
    expect(plan.entries[0]?.candidates[0]?.sha256).toBe(await digest(original));
    expect(plan.entries[0]?.candidates[0]?.sha256).not.toBe(saved.sourceDigest);
    expect(
      (await reconnectDevelopPhoto(saved, original, new Blob(["decoded preview"]))).sourceDigest,
    ).toBe(saved.sourceDigest);
  });

  test("unique filename-only candidates require explicit selection and never claim identity proof", async () => {
    const original = file("unknown old bytes");
    const saved = photo();
    const result = (await planDevelopReconnect([saved], [original])).entries[0]!;
    expect(result.status).toBe("unverified");
    expect(result.file).toBe(original);
    expect(result.selectedByDefault).toBe(false);
    expect(result.reason).toContain("no saved fingerprint");
    expect(result.reason).toContain("Select it explicitly");
    expect(saved.sourceDigest).toBeNull();
    expect(saved.sourceBlob).toBeNull();
  });

  test("an empty stored fingerprint is invalid, never an executable unknown-identity offer", async () => {
    const plan = await planDevelopReconnect(
      [photo("empty-digest", { sourceDigest: "" })],
      [file("source")],
    );
    expect(plan.entries[0]?.status).toBe("mismatch");
    expect(plan.entries[0]?.file).toBeNull();
    expect(plan.entries[0]?.selectedByDefault).toBe(false);
  });

  test("execution namespace is canonical and exact scan-time identities are retained", async () => {
    const original = file("known");
    const sourceDigest = (await digest(original)).toUpperCase();
    const namespace = JSON.stringify(["account-one", "shoot:one"]);
    const plan = await planDevelopReconnect([photo("known", { sourceDigest })], [original], {
      namespace,
    });
    expect(plan.namespace).toBe(namespace);
    expect(plan.entries[0]?.expectedSourceDigest).toBe(sourceDigest);
    expect(plan.entries[0]?.status).toBe("verified");
    for (const invalid of ["", "[]", '["one"]', '["one",null]', '["", "two"]', '["one", "two"]'])
      await expect(
        planDevelopReconnect([photo()], [original], { namespace: invalid }),
      ).rejects.toThrow("scope");
  });

  test("two folders with same filename remain ambiguous for an unknown source", async () => {
    const a = file("one", "source.ARW", "day-one/source.ARW");
    const b = file("two", "source.ARW", "day-two/source.ARW");
    const entry = (await planDevelopReconnect([photo()], [a, b])).entries[0]!;
    expect(entry.status).toBe("ambiguous");
    expect(entry.file).toBeNull();
    expect(entry.selectedByDefault).toBe(false);
    expect(entry.candidates.map((candidate) => candidate.path)).toEqual([
      "day-one/source.ARW",
      "day-two/source.ARW",
    ]);
    expect(entry.candidates.map((candidate) => candidate.file)).toEqual([a, b]);
  });

  test("known hashes resolve different same-name source bytes, but repeated identical candidates stay ambiguous", async () => {
    const a = file("one"),
      b = file("two");
    const savedA = photo("first", { sourceDigest: await digest(a) });
    const savedB = photo("second", { sourceDigest: await digest(b) });
    const resolved = await planDevelopReconnect([savedA, savedB], [a, b]);
    expect(resolved.entries.map((entry) => entry.status)).toEqual(["verified", "verified"]);
    expect(resolved.entries.map((entry) => entry.file)).toEqual([a, b]);
    for (const candidates of [
      [a, file("one")],
      [a, a],
    ]) {
      const entry = (await planDevelopReconnect([savedA], candidates)).entries[0]!;
      expect(entry.status).toBe("ambiguous");
      expect(entry.file).toBeNull();
      expect(entry.selectedByDefault).toBe(false);
    }
  });

  test("duplicate saved IDs and one candidate claimed by multiple records are not silently assigned", async () => {
    const original = file("one");
    const saved = photo("duplicate", { sourceDigest: await digest(original) });
    const duplicate = await planDevelopReconnect([saved, { ...saved }], [original]);
    expect(duplicate.entries).toHaveLength(1);
    expect(duplicate.entries[0]?.status).toBe("ambiguous");
    expect(duplicate.entries[0]?.reason).toContain("ID appears more than once");
    for (const targets of [
      [saved, { ...saved, id: "copy" }],
      [saved, photo("unknown")],
    ]) {
      const plan = await planDevelopReconnect(targets, [original]);
      expect(
        plan.entries.every(
          (entry) => entry.status === "ambiguous" && !entry.file && !entry.selectedByDefault,
        ),
      ).toBe(true);
    }
  });

  test("filename guard stays exact even when bytes match; mismatched and unsupported receipts never downgrade to unverified", async () => {
    const original = file("one");
    const saved = photo("known", { sourceDigest: await digest(original) });
    expect(
      (await planDevelopReconnect([saved], [file("one", "SOURCE.ARW")])).entries[0]?.status,
    ).toBe("unmatched");
    expect(
      (await planDevelopReconnect([saved], [file("one", "renamed.ARW")])).entries[0]?.status,
    ).toBe("unmatched");
    expect((await planDevelopReconnect([saved], [file("two")])).entries[0]?.status).toBe(
      "mismatch",
    );
    const unsupported = (
      await planDevelopReconnect(
        [photo("future", { sourceDigest: "sha512:not-supported" })],
        [original],
      )
    ).entries[0]!;
    expect(unsupported.status).toBe("mismatch");
    expect(unsupported.file).toBeNull();
    expect(unsupported.selectedByDefault).toBe(false);
  });

  test("available originals are skipped; preview-only sources remain reconnectable without changing their preview", async () => {
    const original = file("one");
    const preview = new Blob(["saved preview"]);
    const ready = photo("ready", { sourceBlob: original, sourceAvailable: true });
    const previewOnly = photo("preview", { previewBlob: preview });
    const plan = await planDevelopReconnect([ready, previewOnly], [original]);
    expect(plan.skippedIds).toEqual(["ready"]);
    expect(plan.entries.map((entry) => entry.targetId)).toEqual(["preview"]);
    expect(plan.entries[0]?.status).toBe("unverified");
    expect(previewOnly.previewBlob).toBe(preview);
    expect(ready.sourceBlob).toBe(original);
    expect(
      (await planDevelopReconnect([photo("invalid", { sourceBlob: new Blob() })], [original]))
        .entries[0]?.status,
    ).toBe("mismatch");
    const inconsistent = await planDevelopReconnect(
      [photo("missing", { sourceAvailable: true })],
      [original],
    );
    expect(inconsistent.skippedIds).toEqual([]);
    expect(inconsistent.entries[0]?.status).toBe("mismatch");
  });

  test("empty, unsupported, oversized, unreadable and truncated files warn individually while valid files continue", async () => {
    const bad = file("unreadable", "bad.ARW");
    Object.defineProperty(bad, "arrayBuffer", {
      value: async () => {
        throw new Error("Read permission lost");
      },
    });
    const truncated = file("incomplete", "truncated.ARW");
    Object.defineProperty(truncated, "arrayBuffer", { value: async () => new ArrayBuffer(1) });
    const oversized = file("not allocated", "large.ARW");
    Object.defineProperty(oversized, "size", { value: DEVELOP_RECONNECT_LIMITS.maxFileBytes + 1 });
    const good = file("source", "good.ARW");
    const batch = [
      file("", "empty.ARW"),
      file("sidecar", "notes.txt"),
      oversized,
      bad,
      truncated,
      good,
    ];
    const plan = await planDevelopReconnect(
      batch.map((source, i) => photo(`target-${i}`, { sourceFileName: source.name })),
      batch,
    );
    expect(plan.warnings).toHaveLength(5);
    expect(plan.filesChecked).toBe(6);
    expect(plan.cancelled).toBe(false);
    expect(plan.entries.at(-1)?.status).toBe("unverified");
    expect(plan.entries.at(-1)?.file).toBe(good);
    expect(
      plan.entries.slice(0, 5).every((entry) => entry.status === "mismatch" && !entry.file),
    ).toBe(true);
    expect(plan.warnings.map((warning) => warning.reason).join(" ")).toContain("read completely");
  });

  test("a bad same-name alternative cannot turn filename-only identity into a unique verified offer", async () => {
    const original = file("one");
    const empty = file("");
    const unknown = await planDevelopReconnect([photo()], [empty, original]);
    expect(unknown.entries[0]?.status).toBe("ambiguous");
    expect(unknown.entries[0]?.file).toBeNull();
    const known = await planDevelopReconnect(
      [photo("known", { sourceDigest: await digest(original) })],
      [empty, original],
    );
    expect(known.entries[0]?.status).toBe("verified");
    expect(known.warnings).toHaveLength(1);
  });

  test("cancellation before, between and during reads makes every entry unselectable", async () => {
    const sources = [file("one", "one.ARW"), file("two", "two.ARW")];
    const targets = await Promise.all(
      sources.map(async (source, i) =>
        photo(`target-${i}`, { sourceFileName: source.name, sourceDigest: await digest(source) }),
      ),
    );
    const before = new AbortController();
    before.abort();
    const between = new AbortController();
    const during = new AbortController();
    const delayed = file("one", "one.ARW");
    const originalRead = delayed.arrayBuffer.bind(delayed);
    Object.defineProperty(delayed, "arrayBuffer", {
      value: async () => {
        const bytes = await originalRead();
        during.abort();
        return bytes;
      },
    });
    const plans = [
      await planDevelopReconnect(targets, sources, { signal: before.signal }),
      await planDevelopReconnect(targets, sources, {
        signal: between.signal,
        onProgress: ({ index }) => {
          if (index === 2) between.abort();
        },
      }),
      await planDevelopReconnect(targets, [delayed, sources[1]!], { signal: during.signal }),
    ];
    for (const plan of plans) {
      expect(plan.cancelled).toBe(true);
      expect(plan.entries).toHaveLength(2);
      expect(
        plan.entries.every(
          (entry) => !entry.file && !entry.selectedByDefault && entry.candidates.length === 0,
        ),
      ).toBe(true);
    }
  });

  test("planning preserves every target field/blob and does not read unmatched originals", async () => {
    const original = file("saved original");
    const saved = Object.freeze(
      photo("preserved", {
        sourceDigest: await digest(original),
        previewBlob: new Blob(["preview"]),
      }),
    );
    const before = { ...saved };
    const unrelated = file("unrelated", "other.ARW");
    let unrelatedReads = 0;
    Object.defineProperty(unrelated, "arrayBuffer", {
      value: async () => {
        unrelatedReads++;
        throw new Error("Should not read");
      },
    });
    const targets = Object.freeze([saved]);
    const files = Object.freeze([unrelated, original]);
    const plan = await planDevelopReconnect(targets, files, {
      onProgress: () => {
        throw new Error("Broken progress UI");
      },
    });
    expect(plan.entries[0]?.status).toBe("verified");
    expect(unrelatedReads).toBe(0);
    expect(saved).toEqual(before);
    expect(saved.previewBlob).toBe(before.previewBlob);
    expect(await original.text()).toBe("saved original");
    expect(targets[0]).toBe(saved);
  });

  test("metadata is snapshotted while scanning; executor must reject changed current identities", async () => {
    const original = file("one");
    const saved = photo("saved", { sourceDigest: await digest(original) });
    const plan = await planDevelopReconnect([saved], [original], {
      onProgress: () => {
        saved.sourceDigest = "sha256:" + "0".repeat(64);
      },
    });
    expect(plan.entries[0]?.status).toBe("verified");
    await expect(reconnectDevelopPhoto(saved, original, new Blob(["preview"]))).rejects.toThrow(
      "different bytes",
    );
  });

  test("resource bounds reject explicitly rather than truncating candidate lists", async () => {
    const original = file("one");
    await expect(
      planDevelopReconnect(
        [photo()],
        Array.from({ length: 10001 }, () => original),
      ),
    ).rejects.toThrow("10,000 files");
    await expect(
      planDevelopReconnect(
        Array.from({ length: 10001 }, (_, i) => photo(`p${i}`)),
        [original],
      ),
    ).rejects.toThrow("10,000 saved photos");
    await expect(
      planDevelopReconnect(
        Array.from({ length: 400 }, (_, i) => photo(`p${i}`)),
        Array.from({ length: 300 }, () => original),
      ),
    ).rejects.toThrow("Too many same-name matches");
  });

  test("a 337-record synthetic legacy library retains every identity and unchecked filename-only candidate", async () => {
    const sources = Array.from({ length: 337 }, (_, index) =>
      file(
        `original-${index}`,
        `DSC${String(index).padStart(5, "0")}.ARW`,
        `folder/${index}/original.ARW`,
      ),
    );
    const saved = sources.map((source, index) =>
      Object.freeze(
        photo(`studio:legacy-${index}`, {
          name: `Edited display name ${index}`,
          sourceFileName: source.name,
          previewBlob: index % 3 === 0 ? new Blob([`old-preview-${index}`]) : null,
        }),
      ),
    );
    const before = saved.map((value) => ({ ...value }));
    const plan = await planDevelopReconnect(
      Object.freeze(saved),
      Object.freeze([...sources].reverse()),
    );
    expect(plan.entries).toHaveLength(337);
    expect(new Set(plan.entries.map((entry) => entry.targetId)).size).toBe(337);
    expect(plan.filesChecked).toBe(337);
    expect(plan.warnings).toEqual([]);
    expect(plan.skippedIds).toEqual([]);
    for (const [index, entry] of plan.entries.entries()) {
      expect(entry.targetId).toBe(saved[index]!.id);
      expect(entry.file).toBe(sources[index]!);
      expect(entry.status).toBe("unverified");
      expect(entry.selectedByDefault).toBe(false);
      expect(saved[index]).toEqual(before[index]);
    }
  });
});
