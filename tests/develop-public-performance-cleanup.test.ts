import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createDevelopDocument, developDocumentSchema } from "../src/lib/develop/store";

const source = await readFile(
  new URL("./develop-public-performance-cleanup.browser.js", import.meta.url),
  "utf8",
);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const helpers = new AsyncFunction(
  "globalThis",
  "location",
  "document",
  `${source.split("// BEGIN CLEANUP EXECUTION")[0]}\nreturn {guard, validateRecords, validateAuditSet, verifySourceBytes, snapshot, hash, targets, expected, namespaceFor, keyFor, apply};`,
);
const getHelpers = (
  state: Record<string, unknown> = {},
  route: { origin?: string; pathname?: string; search?: string; hash?: string } = {},
  mounted = false,
) =>
  helpers(
    state,
    { origin: "http://127.0.0.1:8085", pathname: "/shoots", search: "", hash: "", ...route },
    { querySelector: () => (mounted ? {} : null) },
  );

type ExpectedSource = { name: string; digest: string; size: number; isRaw: boolean };
type CleanupHelpers = {
  targets: string[];
  expected: Map<string, ExpectedSource>;
  namespaceFor: (shoot: string) => string;
  keyFor: (shoot: string, id: string) => string;
};
function fixtureRecords(h: CleanupHelpers, shoot: string) {
  const namespace = h.namespaceFor(shoot);
  const photos = [...h.expected].map(([id, original]) => {
    const file = new File([original.name], original.name, { lastModified: 123 });
    // Metadata-validation fixtures do not allocate 25 MiB per RAW. Byte-verification
    // tests below separately hash real bytes and the complete checked-in JPEG.
    Object.defineProperty(file, "size", { value: original.size });
    return {
      namespace,
      key: h.keyFor(shoot, id),
      value: {
        id,
        name: original.name,
        sourceFileName: original.name,
        sourceDigest: id,
        sourceBlob: file,
        previewBlob: new Blob(["public QA preview"]),
        sourceAvailable: true,
        isRaw: original.isRaw,
        width: 100,
        height: 75,
      },
    };
  });
  const documents = photos.map(({ key, value }) => {
    const doc = createDevelopDocument(value.id);
    doc.revision = 9;
    doc.history.push({
      ...structuredClone(doc.history[0]!),
      id: "qa-detail-change",
      label: "Detail QA adjustment",
      settings: { ...doc.history[0]!.settings, exposure: 0.75, grain: 23 },
    });
    doc.cursor = 1;
    doc.metadata = { rating: 4, flag: "pick", colorLabel: "blue" };
    return { namespace, key, value: doc };
  });
  return { photos, documents };
}

test("public cleanup body compiles without executing or accessing any browser storage", () => {
  expect(() => new AsyncFunction(source)).not.toThrow();
  expect(source).not.toMatch(/\.clear\(|deleteDatabase\(|localStorage\.|sessionStorage\./);
  expect(source).not.toContain('objectStore("presets")');
  expect(source).toContain(".getAll(namespace)");
});

test("only the exact seven public shoots are allowed, with a consumed strict boolean apply flag", async () => {
  const h = await getHelpers();
  expect(h.targets).toEqual(
    [91, 92, 93, 94, 95, 96, 97].map(
      (number) => `eeaf3000-1111-4222-8333-${String(number).padStart(12, "0")}`,
    ),
  );
  expect(h.apply).toBe(false);
  for (const value of [undefined, false, "true", 1, {}, []]) {
    const state = { fotoPublicPerformanceCleanupApply: value };
    expect((await getHelpers(state)).apply).toBe(false);
    expect(state).toEqual({});
  }
  const state = { fotoPublicPerformanceCleanupApply: true, unrelated: "preserved" };
  expect((await getHelpers(state)).apply).toBe(true);
  expect(state).toEqual({ unrelated: "preserved" });
  for (const shoot of [
    "",
    "*",
    "eeaf3000-1111-4222-8333-000000000090",
    "eeaf3000-1111-4222-8333-000000000098",
    "85ae3692-2b3f-4b70-aecf-c89980910ed8",
    `shoot:${h.targets[0]}`,
  ])
    expect(() => h.namespaceFor(shoot)).toThrow("seven reserved shoots");
  expect(() => h.keyFor(h.targets[0], `sha256:${"0".repeat(64)}`)).toThrow(
    "exact public fixture digest",
  );
});

test("audit and apply both require the exact local hub with Develop and other QA unmounted", async () => {
  const ready = await getHelpers();
  expect(() => ready.guard()).not.toThrow();
  for (const route of [
    { origin: "https://lenslab.dev" },
    { origin: "http://localhost:8085" },
    { pathname: "/develop" },
    { pathname: "/shoots/eeaf3000-1111-4222-8333-000000000097/develop" },
    { search: "?shoot=unrelated" },
    { hash: "#develop" },
  ]) {
    const h = await getHelpers({}, route);
    expect(() => h.guard()).toThrow("local lab /shoots");
  }
  const mounted = await getHelpers({}, {}, true);
  expect(() => mounted.guard()).toThrow("Unmount Develop");
  for (const key of ["fotoImportLifecycle", "fotoLargeLibraryQA"]) {
    const running = await getHelpers({ [key]: { state: "running" } });
    expect(() => running.guard()).toThrow("QA fixture reports running");
  }
});

test("all expected identities include exact byte lengths and independently match the repo JPEG", async () => {
  const h = await getHelpers();
  expect(
    [...h.expected.values()].map((item: ExpectedSource) => [item.name, item.size, item.isRaw]),
  ).toEqual([
    ["sony-a6000.ARW", 25624576, true],
    ["sony-a7iv-small.ARW", 22933504, true],
    ["volleyball-portrait-cc0.jpg", 3148228, false],
  ]);
  expect(
    h.expected.has("sha256:ce8b4957281a817d52a07a691e2468567b6c78223bd0b514ffc1c65b002b8d89"),
  ).toBe(true);
  expect(
    h.expected.has("sha256:cbbd0930c7d8706dff84c68a2004454266e6fd0d8354f5f76a106b5d776e0223"),
  ).toBe(true);
  const jpeg = await readFile(
    new URL("./fixtures/photos/volleyball-portrait-cc0.jpg", import.meta.url),
  );
  const id = `sha256:${createHash("sha256").update(jpeg).digest("hex")}`;
  expect(id).toBe("sha256:5685e8468969ca05da9de250f5848df5318e6b47b1a14d4aebd5c19675224fce");
  expect(jpeg.byteLength).toBe(3148228);
  expect(h.expected.get(id).name).toBe("volleyball-portrait-cc0.jpg");
  await expect(h.verifySourceBytes({ id, sourceBlob: new Blob([jpeg]) })).resolves.toBeUndefined();
  const changed = Buffer.from(jpeg);
  changed[changed.byteLength - 1] = changed[changed.byteLength - 1]! ^ 1;
  await expect(h.verifySourceBytes({ id, sourceBlob: new Blob([changed]) })).rejects.toThrow(
    "SHA-256 differs",
  );
  expect(jpeg[0]).toBe(255); // The source buffer itself was not mutated.
  await expect(h.verifySourceBytes({ id, sourceBlob: new Blob(["truncated"]) })).rejects.toThrow(
    "size differs",
  );
  await expect(
    h.verifySourceBytes({ id: "sha256:unknown", sourceBlob: new Blob([jpeg]) }),
  ).rejects.toThrow("identity");
});

test("edited valid documents are accepted, but missing/extra/duplicate records are not", async () => {
  const h = await getHelpers();
  const shoot = h.targets[0];
  const records = fixtureRecords(h, shoot);
  const before = h.snapshot(records);
  expect(() => h.validateRecords(shoot, records, developDocumentSchema)).not.toThrow();
  expect(records.documents[0]!.value.history[1]!.settings.exposure).toBe(0.75);
  expect(records.documents[0]!.value.revision).toBe(9);
  expect(h.snapshot(records)).toBe(before);
  for (const invalid of [
    { photos: [], documents: [] },
    { photos: records.photos.slice(1), documents: records.documents },
    { photos: records.photos, documents: records.documents.slice(1) },
    { photos: [...records.photos, records.photos[0]], documents: records.documents },
  ])
    expect(() => h.validateRecords(shoot, invalid, developDocumentSchema)).toThrow("exactly three");
  expect(() =>
    h.validateRecords(
      shoot,
      { ...records, photos: [records.photos[0], records.photos[0], records.photos[2]] },
      developDocumentSchema,
    ),
  ).toThrow("photo identity");
  expect(() =>
    h.validateRecords(
      shoot,
      { ...records, documents: [records.documents[0], records.documents[0], records.documents[2]] },
      developDocumentSchema,
    ),
  ).toThrow("edit identity");
});

test("malformed scopes, library bindings, keys, IDs and original filename claims fail closed", async () => {
  const h = await getHelpers();
  const shoot = h.targets[0];
  const records = fixtureRecords(h, shoot);
  const photo = records.photos[0]!;
  for (const override of [
    { namespace: JSON.stringify(["user:someone", `shoot:${shoot}`]) },
    { namespace: JSON.stringify(["device-local", `project:${shoot}`]) },
    { key: JSON.stringify(["user:someone", `shoot:${shoot}`, photo.value.id]) },
    { key: JSON.stringify(["device-local", `shoot:${h.targets[1]}`, photo.value.id]) },
    { key: photo.key + " " },
  ])
    expect(() =>
      h.validateRecords(
        shoot,
        { ...records, photos: [{ ...photo, ...override }, ...records.photos.slice(1)] },
        developDocumentSchema,
      ),
    ).toThrow("photo identity");
  for (const override of [
    { name: "renamed-customer.ARW" },
    { sourceFileName: "different-original.ARW" },
    { sourceDigest: "sha256:" + "f".repeat(64) },
    { id: "copy:" + photo.value.id },
    { isRaw: false },
    { sourceAvailable: false },
    { sourceBlob: null },
    { sourceBlob: new Blob(["wrong bytes and size"]) },
  ])
    expect(() =>
      h.validateRecords(
        shoot,
        {
          ...records,
          photos: [
            { ...photo, value: { ...photo.value, ...override } },
            ...records.photos.slice(1),
          ],
        },
        developDocumentSchema,
      ),
    ).toThrow("photo identity");
  const doc = records.documents[0]!;
  for (const override of [
    { namespace: JSON.stringify(["device-local", `shoot:${h.targets[1]}`]) },
    { key: JSON.stringify(["device-local", `shoot:${shoot}`, "missing-id"]) },
  ])
    expect(() =>
      h.validateRecords(
        shoot,
        { ...records, documents: [{ ...doc, ...override }, ...records.documents.slice(1)] },
        developDocumentSchema,
      ),
    ).toThrow("edit identity");
  for (const override of [
    { revision: -1 },
    { revision: 0.5 },
    { revision: NaN },
    { revision: Number.MAX_SAFE_INTEGER },
    { cursor: 4 },
    { history: [] },
    { photoId: "unknown" },
  ])
    expect(() =>
      h.validateRecords(
        shoot,
        {
          ...records,
          documents: [
            { ...doc, value: { ...doc.value, ...override } },
            ...records.documents.slice(1),
          ],
        },
        developDocumentSchema,
      ),
    ).toThrow("edit identity");
});

test("all seven CAS snapshots must match, including a changed last library and history content", async () => {
  const h = await getHelpers();
  const current = h.targets.map((shoot: string) => fixtureRecords(h, shoot));
  const audits = h.targets.map((shoot: string, index: number) => ({
    shoot,
    snapshot: h.snapshot(current[index]),
  }));
  expect(() => h.validateAuditSet(audits, current, developDocumentSchema)).not.toThrow();
  expect(() =>
    h.validateAuditSet(audits.slice(1), current.slice(1), developDocumentSchema),
  ).toThrow("All seven");
  expect(() => h.validateAuditSet([...audits].reverse(), current, developDocumentSchema)).toThrow(
    "All seven",
  );
  const last = current[6]!;
  last.documents[2]!.value.history[1]!.settings.exposure = 1.25;
  // Deliberately unchanged revision: full document history, not just CAS version, is checked.
  expect(() => h.validateAuditSet(audits, current, developDocumentSchema)).toThrow(
    "changed after audit",
  );
  last.documents[2]!.value.history[1]!.settings.exposure = 0.75;
  expect(() => h.validateAuditSet(audits, current, developDocumentSchema)).not.toThrow();
  last.photos[2]!.value.width++;
  expect(() => h.validateAuditSet(audits, current, developDocumentSchema)).toThrow(
    "changed after audit",
  );
  expect(source.indexOf("validateAuditSet(audits, current, developDocumentSchema)")).toBeLessThan(
    source.indexOf(".delete(record.key)"),
  );
  expect(source).toContain('db.transaction(["photos", "documents"], "readwrite")');
  expect(source).toContain("await done;");
  expect(source).toContain("remaining.some((record) => record.photos || record.documents)");
});
