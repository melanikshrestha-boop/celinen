import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("./develop-import-abandoned-cleanup.browser.js", import.meta.url),
  "utf8",
);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const helpers = new AsyncFunction(
  "globalThis",
  "location",
  "document",
  `${source.split("// BEGIN CLEANUP EXECUTION")[0]}\nreturn {guard, validateRecords, snapshot, targets, namespaceFor, keyFor, apply};`,
);
const getHelpers = (state: Record<string, unknown> = {}, path = "/shoots", mounted = false) =>
  helpers(
    state,
    { origin: "http://127.0.0.1:8085", pathname: path },
    { querySelector: () => (mounted ? {} : null) },
  );

test("the complete browser-eval body compiles without executing or accessing storage", () => {
  expect(() => new AsyncFunction(source)).not.toThrow();
});

test("cleanup targets only the two named abandoned runs and defaults to audit", async () => {
  const h = await getHelpers();
  expect(h.targets).toEqual([
    "eeaf3000-1111-4222-8333-1b5720ec8a19",
    "eeaf3000-1111-4222-8333-1a938c57e214",
  ]);
  expect(h.apply).toBe(false);
  expect(() => h.guard()).not.toThrow();
  const state = { fotoAbandonedImportCleanupApply: true };
  expect((await getHelpers(state)).apply).toBe(true);
  expect(state).toEqual({});
  expect(source).not.toMatch(/\.clear\(|deleteDatabase\(/);
});

test("cleanup refuses mounted editors, non-hub routes and an active fixture", async () => {
  expect(() => getHelpers()).not.toThrow();
  const running = await getHelpers({ fotoImportLifecycle: { state: "running" } });
  expect(() => running.guard()).toThrow("still reports running");
  const wrongRoute = await getHelpers({}, "/develop");
  expect(() => wrongRoute.guard()).toThrow("local lab /shoots");
  const mounted = await getHelpers({}, "/shoots", true);
  expect(() => mounted.guard()).toThrow("Unmount Develop");
});

test("cleanup validates exact source identities, namespaces and matching document keys", async () => {
  const h = await getHelpers();
  const shoot = h.targets[0];
  const id = `sha256:${"a".repeat(64)}`;
  const name = "qa-import-1b5720ec8a19-0.jpg";
  const sourceBlob = new File(["fixture"], name, { type: "image/jpeg", lastModified: 100 });
  const expected = new Map([[id, { name, size: sourceBlob.size, lastModified: 100 }]]);
  const namespace = h.namespaceFor(shoot);
  const key = h.keyFor(shoot, id);
  const records = {
    photos: [
      {
        namespace,
        key,
        value: {
          id,
          name,
          sourceFileName: name,
          sourceLastModified: 100,
          sourceDigest: id,
          sourceBlob,
          width: 480,
          height: 320,
          isRaw: false,
        },
      },
    ],
    documents: [{ namespace, key, value: { photoId: id, revision: 3, history: ["preserved"] } }],
  };
  expect(() => h.validateRecords(shoot, records, expected)).not.toThrow();
  expect(() => h.validateRecords(shoot, { photos: [], documents: [] }, expected)).not.toThrow();
  expect(() => h.validateRecords(shoot, { ...records, documents: [] }, expected)).toThrow("count");
  for (const value of [
    { name: "customer.jpg" },
    { id: "different" },
    { sourceDigest: "different" },
    { sourceLastModified: 0 },
    { sourceBlob: new Blob(["changed"], { type: "text/plain" }) },
    { width: 481 },
  ]) {
    const changed = {
      ...records,
      photos: [{ ...records.photos[0], value: { ...records.photos[0]!.value, ...value } }],
    };
    expect(() => h.validateRecords(shoot, changed, expected)).toThrow("identity");
  }
  for (const field of ["namespace", "key"] as const) {
    const changed = { ...records, documents: [{ ...records.documents[0], [field]: "unrelated" }] };
    expect(() => h.validateRecords(shoot, changed, expected)).toThrow("edit identity");
  }
  const copied = structuredClone(records);
  expect(h.snapshot(copied)).toBe(h.snapshot(records));
  copied.documents[0]!.value.revision++;
  expect(h.snapshot(copied)).not.toBe(h.snapshot(records));
  expect(records.documents[0]!.value.revision).toBe(3);
});
