import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createDevelopDocument, developDocumentSchema } from "../src/lib/develop/store";

const source = await readFile(
  new URL("./develop-navigation-stress.browser.js", import.meta.url),
  "utf8",
);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const pure = new Function(
  `${source.split("// END PURE GUARDS")[0]}\nreturn {nsGuard,nsCycles,nsRecords,nsOrder,nsSnapshot,NS_SHOOT,NS_NAMESPACE,NS_SOURCES,NS_PATH};`,
)();
const readySurface = {
  origin: "http://127.0.0.1:8085",
  path: pure.NS_PATH,
  search: "",
  hash: "",
  mounted: true,
  mode: "develop",
  filter: "all",
  dialog: false,
  busy: false,
  ready: true,
  active: false,
  tool: false,
};
type PublicSource = { name: string; size: number; isRaw: boolean };
function records() {
  const photos = [...(pure.NS_SOURCES as Map<string, PublicSource>)].map(([id, item]) => {
    const sourceBlob = new File([item.name], item.name, { lastModified: 123 });
    Object.defineProperty(sourceBlob, "size", { value: item.size }); // Metadata-only guard fixture.
    return {
      namespace: pure.NS_NAMESPACE,
      key: JSON.stringify(["device-local", `shoot:${pure.NS_SHOOT}`, id]),
      value: {
        id,
        name: item.name,
        sourceFileName: item.name,
        sourceDigest: id,
        sourceAvailable: true,
        sourceBlob,
        previewBlob: new Blob(["preview"]),
        isRaw: item.isRaw,
        width: 4000,
        height: 3000,
      },
    };
  });
  return {
    photos,
    documents: photos.map((photo) => {
      const value = createDevelopDocument(photo.value.id);
      value.revision = 8;
      value.history.push({
        ...structuredClone(value.history[0]!),
        id: "detail-qa",
        label: "Detail QA",
        settings: { ...value.history[0]!.settings, exposure: 0.75, grain: 31 },
      });
      value.cursor = 1;
      value.metadata.rating = 4;
      return { namespace: photo.namespace, key: photo.key, value };
    }),
  };
}

test("detached navigation stress body compiles and has no persistence or cleanup mutation calls", () => {
  expect(() => new AsyncFunction(source)).not.toThrow();
  expect(source).not.toMatch(
    /deleteDatabase\(|objectStore\([^)]*\)\.(delete|clear|put|add)\(|"readwrite"|\.saveDocument\(|\.addPhotos/,
  );
  expect(source).toContain('db.transaction(["photos", "documents"], "readonly")');
  expect(source).toContain(".getAll(NS_NAMESPACE)");
  expect(source).toContain("void (async () =>");
  expect(source).toContain("foto:qa:navigation-stress:");
  expect(source).toContain("window.fetch = originalFetch");
  expect(source).toContain("URL.createObjectURL = originalCreate");
  expect(source).toContain("URL.revokeObjectURL = originalRevoke");
  expect(source).toContain("liveUrls.delete(url)");
  expect(source).toContain("hashQueue.length >= 4");
  expect(source).toContain("await Promise.allSettled([...pendingHashTasks])");
});

test("only exact local 097 normal Develop is accepted, with no initial busy state, tools, dialogs or other QA", () => {
  expect(pure.NS_SHOOT).toBe("eeaf3000-1111-4222-8333-000000000097");
  expect(pure.NS_NAMESPACE).toBe('["device-local","shoot:eeaf3000-1111-4222-8333-000000000097"]');
  expect(() => pure.nsGuard(readySurface, true)).not.toThrow();
  for (const change of [
    { origin: "https://lenslab.dev" },
    { origin: "http://localhost:8085" },
    { path: "/develop" },
    { path: "/shoots/eeaf3000-1111-4222-8333-000000000096/develop" },
    { path: "/shoots/85ae3692-2b3f-4b70-aecf-c89980910ed8/develop" },
    { search: "?shoot=customer" },
    { hash: "#customer" },
    { mounted: false },
    { mode: "library" },
    { filter: "rated" },
    { dialog: true },
    { busy: true },
    { ready: false },
    { active: true },
    { tool: true },
  ])
    expect(() => pure.nsGuard({ ...readySurface, ...change }, true)).toThrow();
  // The fixture must allow rendering/cancellation between arrows, but never busy writes/dialogs.
  expect(() => pure.nsGuard({ ...readySurface, ready: false, active: true })).not.toThrow();
  expect(() => pure.nsGuard({ ...readySurface, ready: false, dialog: true })).toThrow();
});

test("twelve burst cycles plus interleaved native completions stay below sixty transitions and visit all three photos", () => {
  const cycles = pure.nsCycles() as Array<{ cycle: number; burst: string[]; settled: string[] }>;
  expect(cycles).toHaveLength(12);
  let position = 0,
    transitions = 0;
  const burstPositions = new Set(),
    completedPositions = new Set([0]);
  for (const [index, cycle] of cycles.entries()) {
    expect(cycle.cycle).toBe(index + 1);
    expect(cycle.burst).toEqual(["ArrowRight", "ArrowRight", "ArrowLeft", "ArrowLeft"]);
    for (const key of cycle.burst) {
      position += key === "ArrowRight" ? 1 : -1;
      expect(position >= 0 && position <= 2).toBe(true);
      transitions++;
      burstPositions.add(position);
    }
    expect(position).toBe(0);
    for (const key of cycle.settled) {
      position += key === "ArrowRight" ? 1 : -1;
      expect(position >= 0 && position <= 2).toBe(true);
      transitions++;
      completedPositions.add(position);
    }
    expect(position).toBe(0);
  }
  expect(transitions).toBe(56);
  expect(transitions + 2 + 1).toBe(59); // Worst bootstrap plus final real-card restore.
  expect([...burstPositions].sort()).toEqual([0, 1, 2]);
  expect([...completedPositions].sort()).toEqual([0, 1, 2]);
  expect(source).toContain("await delay(40)");
  expect(source).toContain('new KeyboardEvent("keydown"');
  expect(source).toContain("event.defaultPrevented");
  expect(source).toContain("clickPhoto(originalSelection)");
});

test("preflight accepts edited QA documents but rejects any changed source identity, namespace, key or missing pair", () => {
  const original = records(),
    before = pure.nsSnapshot(original);
  expect(() => pure.nsRecords(original, developDocumentSchema)).not.toThrow();
  expect(pure.nsSnapshot(original)).toBe(before);
  expect(original.documents[0]!.value.history[1]!.settings.exposure).toBe(0.75);
  expect(original.documents[0]!.value.metadata.rating).toBe(4);
  for (const changed of [
    { photos: [], documents: [] },
    { ...original, photos: original.photos.slice(1) },
    { ...original, documents: original.documents.slice(1) },
    { ...original, photos: [original.photos[0], original.photos[0], original.photos[2]] },
  ])
    expect(() => pure.nsRecords(changed, developDocumentSchema)).toThrow();
  const photo = original.photos[0]!;
  for (const change of [
    { namespace: '["user:customer","shoot:eeaf3000-1111-4222-8333-000000000097"]' },
    { key: photo.key.replace("097", "096") },
    { value: { ...photo.value, sourceDigest: "sha256:" + "0".repeat(64) } },
    { value: { ...photo.value, sourceFileName: "customer.ARW" } },
    { value: { ...photo.value, name: "renamed.ARW" } },
    { value: { ...photo.value, sourceBlob: new Blob(["changed"]) } },
    { value: { ...photo.value, isRaw: false } },
  ])
    expect(() =>
      pure.nsRecords(
        { ...original, photos: [{ ...photo, ...change }, ...original.photos.slice(1)] },
        developDocumentSchema,
      ),
    ).toThrow("original");
  const doc = original.documents[0]!;
  for (const change of [
    { namespace: "other" },
    { key: "wrong" },
    { value: { ...doc.value, revision: -1 } },
    { value: { ...doc.value, history: [] } },
    { value: { ...doc.value, photoId: "unknown" } },
  ])
    expect(() =>
      pure.nsRecords(
        { ...original, documents: [{ ...doc, ...change }, ...original.documents.slice(1)] },
        developDocumentSchema,
      ),
    ).toThrow("edit identity");
  original.documents[2]!.value.metadata.rating = 5;
  expect(pure.nsSnapshot(original)).not.toBe(before); // Final guard compares all history and metadata, not only revision.
});

test("filmstrip order accepts only the exact three IDs, names and indices without assuming import ordering", () => {
  const expected = [...(pure.NS_SOURCES as Map<string, PublicSource>)].reverse();
  const nodes = expected.map(([id, item], index) => ({
    getAttribute(name: string) {
      return name === "data-photo-id"
        ? id
        : name === "data-photo-index"
          ? String(index)
          : name === "aria-label"
            ? `${index + 1}. ${item.name}`
            : null;
    },
  }));
  expect(pure.nsOrder(nodes)).toEqual(expected.map(([id]) => id));
  expect(() => pure.nsOrder(nodes.slice(1))).toThrow("three public photos");
  expect(() => pure.nsOrder([nodes[0], nodes[0], nodes[2]])).toThrow();
  expect(() => pure.nsOrder([...nodes].reverse())).toThrow("index");
  const wrong = { getAttribute: () => "customer" };
  expect(() => pure.nsOrder([wrong, ...nodes.slice(1)])).toThrow("identity");
});
