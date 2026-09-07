import { afterEach, expect, test } from "bun:test";
import { hashBlob } from "../src/lib/projects/archive";
import {
  BATCH_BYTES,
  BATCH_FILES,
  checkedDownload,
  downloadBatch,
  downloadBatches,
} from "../src/lib/delivery/downloads";
import type { DeliveryVersion } from "../src/lib/delivery/workflow";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function version(bytes = 100): DeliveryVersion {
  const v = { sha256: "a".repeat(64), bytes, width: 10, height: 10 };
  return {
    id: crypto.randomUUID(),
    photoId: crypto.randomUUID(),
    filename: "goal.jpg",
    source: null,
    number: 1,
    ready: true,
    createdAt: "2026-09-04T00:00:00.000Z",
    publishedAt: "2026-09-04T00:00:00.000Z",
    variants: { proof: { ...v }, phone: { ...v }, full: { ...v } },
  };
}
test("ZIP parts obey both byte and file-count caps without losing or duplicating a final", () => {
  const versions = Array.from({ length: 3000 }, () => version(3 * 1024 * 1024));
  const original = JSON.stringify(versions),
    batches = downloadBatches(versions, "full");
  expect(batches.every((b) => b.bytes <= BATCH_BYTES && b.versions.length <= BATCH_FILES)).toBe(
    true,
  );
  expect(batches.flatMap((b) => b.versions.map((v) => v.id))).toEqual(versions.map((v) => v.id));
  expect(JSON.stringify(versions)).toBe(original);
});
test("missing/unreleased metadata and duplicate versions cannot form a ZIP", () => {
  const v = version();
  expect(() => downloadBatches([v, v], "phone")).toThrow("Duplicate");
  v.variants.phone.sha256 = "";
  expect(() => downloadBatches([v], "phone")).toThrow("released");
  expect(() => downloadBatches([version(BATCH_BYTES + 1)], "full")).toThrow();
});
test("HTTP error bodies, truncated bytes, and wrong hashes cannot become a successful download", async () => {
  const v = version(10);
  globalThis.fetch = (async () => new Response("error body", { status: 403 })) as typeof fetch;
  await expect(checkedDownload("https://test.invalid/file", v, "full")).rejects.toThrow(
    "interrupted",
  );
  globalThis.fetch = (async () => new Response("short")) as typeof fetch;
  await expect(checkedDownload("https://test.invalid/file", v, "full")).rejects.toThrow(
    "integrity",
  );
  globalThis.fetch = (async () => new Response("wrong-hash")) as typeof fetch;
  await expect(checkedDownload("https://test.invalid/file", v, "full")).rejects.toThrow(
    "integrity",
  );
});
test("a ZIP is offered only after every exact-version file passes integrity checks", async () => {
  const blob = new Blob(["verified final bytes"]),
    v = version(blob.size),
    second = version(blob.size);
  v.variants.full.sha256 = second.variants.full.sha256 = await hashBlob(blob);
  globalThis.fetch = (async () => new Response(blob)) as typeof fetch;
  const signed: string[] = [],
    progress: number[] = [];
  const zip = await downloadBatch(
    [v, second],
    "full",
    async (id) => {
      signed.push(id);
      return `https://test.invalid/${id}`;
    },
    (done) => progress.push(done),
    new AbortController().signal,
  );
  expect(signed).toEqual([v.id, second.id]);
  expect(progress).toEqual([1, 2]);
  expect(zip.size).toBeGreaterThan(blob.size * 2);
  const bytes = new Uint8Array(await zip.arrayBuffer());
  expect([...bytes.slice(0, 2)]).toEqual([80, 75]);
  const text = new TextDecoder().decode(bytes);
  expect(text).toContain("001-goal-v1.jpg");
  expect(text).toContain("002-goal-v1.jpg");
});
test("revocation during a batch rejects the entire ZIP instead of handing out partial success", async () => {
  const blob = new Blob(["a"]),
    first = version(1),
    second = version(1);
  first.variants.full.sha256 = second.variants.full.sha256 = await hashBlob(blob);
  globalThis.fetch = (async () => new Response(blob)) as typeof fetch;
  let calls = 0;
  await expect(
    downloadBatch(
      [first, second],
      "full",
      async () => {
        if (++calls === 2) throw new Error("Link revoked");
        return "https://test.invalid/photo";
      },
      () => {},
      new AbortController().signal,
    ),
  ).rejects.toThrow("revoked");
});
test("cancellation stops signing subsequent files", async () => {
  const controller = new AbortController();
  controller.abort();
  let signed = false;
  await expect(
    downloadBatch(
      [version()],
      "phone",
      async () => {
        signed = true;
        return "https://test.invalid/photo";
      },
      () => {},
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(signed).toBe(false);
});
