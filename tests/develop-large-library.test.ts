import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { developDocumentForImport, developPhotoFromFile } from "../src/lib/develop/store";
import { defaultDevelopSettings } from "../src/lib/develop/contract";

const source = await readFile(
  new URL("./develop-large-library.browser.js", import.meta.url),
  "utf8",
);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const pure = new Function(`${source.split("// END PURE GUARDS")[0]}
  return {qaCommand,qaGuard,qaManifest,qaRecords,qaSnapshot,qaStats,qaMetadata,qaName,qaNamespace,qaKey,qaFilmstripInfo,qaGridInfo,qaGridLookup,qaGridPhotoId};`)();
const runId = "abcdefab-1234-4567-89ab-abcdefabcdef";
const shoot = "eeaf3000-1111-4222-8333-2123456789ab";
function manifest(count = 337) {
  return {
    version: 1,
    runId,
    shoot,
    scope: "device-local",
    count,
    libraryId: `shoot:${shoot}`,
    namespace: pure.qaNamespace(shoot),
    entries: Array.from({ length: count }, (_, index) => ({
      index,
      id: `sha256:${index.toString(16).padStart(64, "0")}`,
      name: pure.qaName(shoot, index),
      size: 1000 + index,
      committed: true,
      documentHash: `sha256:${"a".repeat(64)}`,
    })),
  };
}

test("complete detached browser body compiles without running or reaching storage", () => {
  expect(() => new AsyncFunction(source)).not.toThrow();
  expect(source).not.toMatch(/\.clear\(|deleteDatabase\(/);
});

test("commands restrict fixture sizes, force fresh preparation and require explicit run IDs", () => {
  expect(pure.qaCommand({ action: "prepare" })).toEqual({ action: "prepare", count: 337 });
  expect(pure.qaCommand({ action: "prepare", count: 1000 }).count).toBe(1000);
  expect(pure.qaCommand({ action: "measure", runId })).toEqual({ action: "measure", runId });
  expect(pure.qaCommand({ action: "grid-measure", runId })).toEqual({
    action: "grid-measure",
    runId,
  });
  expect(pure.qaCommand({ action: "cleanup", runId }).action).toBe("cleanup");
  for (const value of [
    null,
    [],
    {},
    { action: "delete" },
    { action: "cleanup" },
    { action: "prepare", count: 1001 },
    { action: "prepare", count: 1 },
    { action: "prepare", shoot },
    { action: "prepare", scope: "account-id" },
    { action: "cleanup", runId, force: true },
    { action: "measure", runId: "../../customer" },
    { action: "grid-measure" },
    { action: "grid-measure", runId, scope: "account-id" },
    { action: "grid-measure", runId, count: 1000 },
    { action: "grid-measure", runId: `shoot:${shoot}` },
  ]) {
    expect(() => pure.qaCommand(value)).toThrow();
  }
});

test("runtime guard refuses customer origins/routes, queries, active editors and overlapping QA", () => {
  expect(() => pure.qaGuard("http://127.0.0.1:8085", "/shoots", "", false, false)).not.toThrow();
  for (const args of [
    ["https://lenslab.dev", "/shoots", "", false, false],
    ["http://127.0.0.1:8085", "/develop", "", false, false],
    ["http://127.0.0.1:8085", "/shoots", "?shoot=customer", false, false],
    ["http://127.0.0.1:8085", "/shoots", "", true, false],
    ["http://127.0.0.1:8085", "/shoots", "", false, true],
  ])
    expect(() => pure.qaGuard(...args)).toThrow();
});

test("durable manifests accept only exact reserved identities and bounded generated receipts", () => {
  const valid = manifest();
  expect(pure.qaManifest(valid, runId)).toBe(valid);
  expect(pure.qaManifest(manifest(1000), runId).entries.length).toBe(1000);
  for (const change of [
    { runId: "other" },
    { version: 2 },
    { scope: "account-id" },
    { shoot: "eeaf3000-1111-4222-8333-1123456789ab" },
    { shoot: "85ae3692-2b3f-4b70-aecf-c89980910ed8" },
    { namespace: '["device-local","customer"]' },
    { libraryId: "shoot:customer" },
    { count: 338 },
    { count: 0 },
    { entries: Array(338).fill(valid.entries[0]) },
  ])
    expect(() => pure.qaManifest({ ...valid, ...change }, runId)).toThrow();
  for (const change of [
    { index: 1 },
    { id: "studio:original" },
    { name: "customer.jpg" },
    { size: 0 },
    { size: 32769 },
    { size: 1.1 },
    { committed: "true" },
    { documentHash: null },
    { documentHash: "invalid" },
  ]) {
    const entries = [...valid.entries];
    entries[0] = { ...entries[0]!, ...change } as (typeof entries)[0];
    expect(() => pure.qaManifest({ ...valid, entries }, runId)).toThrow();
  }
  const interrupted = {
    ...valid,
    entries: [{ ...valid.entries[0], committed: false, documentHash: null }],
  };
  expect(pure.qaManifest(interrupted, runId).entries.length).toBe(1);
  const repeated = { ...valid, entries: [...valid.entries] };
  repeated.entries[1] = { ...repeated.entries[1]!, id: repeated.entries[0]!.id };
  expect(() => pure.qaManifest(repeated, runId)).toThrow();
});

test("manifest validation survives JSON persistence for 1000 distinct IDs without mutation", () => {
  const value = manifest(1000),
    before = JSON.stringify(value);
  expect(pure.qaManifest(JSON.parse(before), runId)).toEqual(value);
  for (let index = 0; index < 1000; index++) {
    const entry = value.entries[index]!;
    expect(entry.name.endsWith(`-${String(index).padStart(4, "0")}.jpg`)).toBe(true);
    expect(entry.id).not.toBe(value.entries[(index + 1) % 1000]!.id);
  }
  expect(JSON.stringify(value)).toBe(before);
});

test("real store import documents are neutral, revision-zero and filterable without later writes", async () => {
  const value = manifest();
  value.entries = [];
  const records: { photos: unknown[]; documents: unknown[] } = { photos: [], documents: [] };
  for (let index = 0; index < 12; index++) {
    const name = pure.qaName(shoot, index);
    const file = new File([`synthetic JPEG placeholder ${index}`], name, {
      type: "image/jpeg",
      lastModified: 1000 + index,
    });
    const input = {
      ...(await developPhotoFromFile(file, file, { width: 64, height: 48 })),
      initialState: { settings: defaultDevelopSettings(), metadata: pure.qaMetadata(index) },
    };
    const doc = developDocumentForImport(input),
      key = pure.qaKey(shoot, input.id);
    value.entries.push({
      index,
      id: input.id,
      name,
      size: file.size,
      committed: false,
      documentHash: null,
    } as unknown as (typeof value.entries)[0]);
    records.photos.push({ namespace: value.namespace, key, value: input });
    records.documents.push({ namespace: value.namespace, key, value: doc });
    expect(doc.revision).toBe(0);
    expect(doc.history.length).toBe(1);
    expect(doc.history[0]!.settings).toEqual(defaultDevelopSettings());
  }
  const before = pure.qaSnapshot(records);
  expect(() => pure.qaRecords(value, records)).not.toThrow();
  expect(() => pure.qaRecords(value, records, true)).toThrow("counts");
  expect(() => pure.qaRecords(value, { photos: records.photos, documents: [] })).toThrow("counts");
  const copy = structuredClone(records) as {
    photos: Array<{ value: { name: string } }>;
    documents: Array<{ value: { revision: number } }>;
  };
  copy.documents[0]!.value.revision = 1;
  expect(() => pure.qaRecords(value, copy)).toThrow("document changed");
  copy.documents[0]!.value.revision = 0;
  copy.photos[0]!.value.name = "Actual customer original.jpg";
  expect(() => pure.qaRecords(value, copy)).toThrow("synthetic");
  expect(pure.qaSnapshot(records)).toBe(before);
});

test("p95 and long-task summaries report real observations and no invented empty percentile", () => {
  expect(pure.qaStats([])).toEqual({ count: 0, total: 0, max: 0, p95: null });
  const values = Array.from({ length: 100 }, (_, index) => index + 1);
  expect(pure.qaStats(values)).toEqual({ count: 100, total: 5050, max: 100, p95: 95 });
  expect(values[0]).toBe(1);
  expect(pure.qaStats([125])).toEqual({ count: 1, total: 125, max: 125, p95: 125 });
});

test("windowed filmstrip measurements distinguish logical photos from mounted buttons and spacers", () => {
  const element = (count: string | null, stride: string | null, buttons: number) => ({
    children: [
      { tagName: "DIV" },
      ...Array.from({ length: buttons }, () => ({ tagName: "BUTTON" })),
      { tagName: "DIV" },
    ],
    clientWidth: 1160,
    getAttribute(name: string) {
      return name === "data-photo-count" ? count : name === "data-item-stride" ? stride : null;
    },
  });
  expect(pure.qaFilmstripInfo(element("1000", "112", 20))).toEqual({
    logicalCount: 1000,
    buttons: 20,
    virtualized: true,
    mountedBound: 21,
  });
  expect(pure.qaFilmstripInfo(element(null, null, 1000))).toEqual({
    logicalCount: 1000,
    buttons: 1000,
    virtualized: false,
    mountedBound: null,
  });
  expect(pure.qaFilmstripInfo(element("499", "112", 18)).logicalCount).toBe(499);
  expect(pure.qaFilmstripInfo(null).buttons).toBe(0);
  for (const [count, stride] of [
    ["-1", "112"],
    ["1000.5", "112"],
    ["1000", null],
    ["1000", "0"],
    ["NaN", "112"],
  ]) {
    expect(() => pure.qaFilmstripInfo(element(count!, stride!, 20))).toThrow("bounds");
  }
});

test("separate grid measurements report all-card legacy DOM and bounded virtual rows without confusing spacers", () => {
  const element = (
    count: string | null,
    stride: string | null,
    columns: string | null,
    buttons: number,
  ) => ({
    children: [
      { tagName: "DIV" },
      ...Array.from({ length: buttons }, () => ({ tagName: "BUTTON" })),
      { tagName: "DIV" },
    ],
    clientHeight: 700,
    getAttribute(name: string) {
      return name === "data-photo-count"
        ? count
        : name === "data-row-stride"
          ? stride
          : name === "data-column-count"
            ? columns
            : null;
    },
  });
  expect(pure.qaGridInfo(element(null, null, null, 1000))).toEqual({
    logicalCount: 1000,
    buttons: 1000,
    virtualized: false,
    mountedBound: null,
    rowStride: null,
    columns: null,
  });
  expect(pure.qaGridInfo(element("1000", "196", "6", 49))).toEqual({
    logicalCount: 1000,
    buttons: 49,
    virtualized: true,
    mountedBound: 55,
    rowStride: 196,
    columns: 6,
  });
  expect(pure.qaGridInfo(element("337", "196", "1", 7)).mountedBound).toBe(10);
  expect(pure.qaGridInfo(null).logicalCount).toBe(0);
  for (const [count, stride, columns] of [
    ["-1", "196", "6"],
    ["337.5", "196", "6"],
    ["NaN", "196", "6"],
    ["1000", null, "6"],
    ["1000", "0", "6"],
    ["1000", "Infinity", "6"],
    ["1000", "196", null],
    ["1000", "196", "0"],
    ["1000", "196", "1.5"],
  ])
    expect(() => pure.qaGridInfo(element(count!, stride!, columns!, 30))).toThrow("bounds");
});

test("grid cards must match exact manifest IDs and logical indices, with legacy filename-only fallback scoped to synthetic receipts", () => {
  const entries = manifest().entries;
  const lookup = pure.qaGridLookup(entries);
  const card = (id: string | null, index: string | null, name: string) => ({
    getAttribute(attribute: string) {
      return attribute === "data-photo-id" ? id : attribute === "data-photo-index" ? index : null;
    },
    querySelector() {
      return { textContent: name };
    },
  });
  const last = entries.at(-1)!;
  expect(pure.qaGridPhotoId(card(last.id, "336", last.name), lookup)).toBe(last.id);
  expect(pure.qaGridPhotoId(card(null, null, last.name), lookup)).toBe(last.id);
  expect(pure.qaGridPhotoId(card(null, null, "customer.jpg"), lookup)).toBeNull();
  for (const [id, index] of [
    [last.id, "0"],
    [last.id, null],
    [last.id, "336.0"],
    ["sha256:unrelated", "336"],
  ])
    expect(() => pure.qaGridPhotoId(card(id!, index!, last.name), lookup)).toThrow(
      "synthetic photo/index",
    );
  expect(pure.qaGridPhotoId(card(last.id, "336", "a changed caption"), lookup)).toBe(last.id);
});

test("grid benchmark is a separate action and timing origin, with real controls and exact cleanup", () => {
  const start = source.indexOf("async function measureGrid()");
  const end = source.indexOf('if (command.action === "prepare") {', start);
  const gridSource = source.slice(start, end);
  expect(start).toBeGreaterThan(0);
  expect(gridSource).toContain('const openLibrary = button("Library")');
  expect(gridSource.indexOf("nativeReady(first.id)")).toBeLessThan(
    gridSource.indexOf("gridAt = performance.now()"),
  );
  expect(gridSource.indexOf("gridAt = performance.now()")).toBeLessThan(
    gridSource.indexOf("openLibrary.click()"),
  );
  expect(gridSource).toContain("grid().scrollTop = grid().scrollHeight");
  expect(gridSource).toContain("activeId() === selectedBeforeScroll");
  expect(gridSource).toContain('new MouseEvent("dblclick"');
  expect(gridSource).toContain("nativeReady(last.id)");
  expect(gridSource).toContain("await verifyRecords(await readStored(), true)");
  expect(gridSource).toContain("status.cleanup = await cleanup()");
  expect(gridSource).toContain("window.fetch = originalFetch");
  expect(gridSource).toContain("URL.createObjectURL = originalCreate");
  expect(gridSource).toContain("URL.revokeObjectURL = originalRevoke");
  expect(source).toContain('if (command.action === "grid-measure")');
  const oldMeasure = source.slice(source.indexOf('stage("measure-navigation-and-initial-editor")'));
  expect(oldMeasure).toContain("startAt = performance.now()");
  expect(oldMeasure).toContain('checkpoint("initial-native-owned-ready")');
  expect(oldMeasure).toContain('"next-photo"');
  expect(oldMeasure).toContain('"last-photo"');
  expect(oldMeasure).not.toContain("gridAt");
});

test("local-mode failure is persisted before any seeding and returns a detached acknowledgement", async () => {
  const isolated: Record<string, unknown> = { fotoLargeLibraryQACommand: { action: "prepare" } };
  const saved = new Map<string, string>();
  const run = new AsyncFunction(
    "globalThis",
    "location",
    "document",
    "sessionStorage",
    "fakeImport",
    "crypto",
    source.replaceAll("await import(", "await fakeImport("),
  );
  const ack = await run(
    isolated,
    { origin: "http://127.0.0.1:8085", pathname: "/shoots", search: "" },
    { querySelector: () => null },
    { setItem: (key: string, value: string) => saved.set(key, value) },
    async () => ({ isLocalSingleUserMode: false }),
    crypto,
  );
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(ack.started).toBe(true);
  expect(saved.size).toBe(1);
  expect(JSON.parse(saved.get(ack.statusKey)!)).toMatchObject({
    state: "failed",
    action: "prepare",
    shoot: null,
  });
  expect(isolated["fotoLargeLibraryQACommand"]).toBeUndefined();
});
