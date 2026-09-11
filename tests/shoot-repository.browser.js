/* Async browser-eval body. All IndexedDB calls use one new, guarded QA database.
 * Never reads the real FOTO database, Studio sessions, or customer namespaces. */
if (!["127.0.0.1", "localhost"].includes(location.hostname)) throw new Error("Local QA only.");
const api = await import("/src/lib/develop/store.ts");
const { DEFAULT_EDITS } = await import("/src/lib/imaging.ts");
const runId = crypto.randomUUID();
const databaseName = `foto-shoot-repository-qa:${runId}`;
const scope = `qa-shoot-repository:${runId}`;
const namespace = JSON.stringify([scope, "one"]);
const key = (id) => JSON.stringify([scope, "one", id]);
const checks = [];
const check = (name, condition) => {
  if (!condition) throw new Error(name);
  checks.push(name);
};
const request = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
const complete = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error ?? new Error("QA transaction aborted"));
  });
const stores = [];
let channel = null;
let cleanup = null;
const oldPut = IDBObjectStore.prototype.put;
try {
  const source = new File(["original"], "legacy.jpg", { type: "image/jpeg", lastModified: 1 });
  const shot = {
    id: "legacy",
    name: "legacy.jpg",
    file: source,
    previewBlob: new Blob(["preview"]),
    previewUrl: null,
    sourceAvailable: true,
    isRaw: false,
    width: 0,
    height: 0,
    sizeMb: 0.000008,
    sharpness: 50,
    brightness: 90,
    clippedHighlights: 0,
    clippedShadows: 0,
    hash: "101",
    score: 70,
    flags: [],
    verdict: "keep",
    edits: { ...DEFAULT_EDITS, crop: "4:5" },
    develop: { origin: "sidecar", at: 1, rating: 4, caption: "Preserve caption" },
  };
  const input = api.developPhotoFromShot(shot);
  const { legacy: _legacy, initialState: _initial, ...media } = input;
  const originalDocument = api.developDocumentForImport(input);
  originalDocument.revision = 8;
  const serializedDocument = JSON.stringify(originalDocument);
  const seed = indexedDB.open(databaseName, 1);
  seed.onupgradeneeded = () => {
    seed.result
      .createObjectStore("photos", { keyPath: "key" })
      .createIndex("namespace", "namespace");
    seed.result
      .createObjectStore("documents", { keyPath: "key" })
      .createIndex("namespace", "namespace");
    seed.result.createObjectStore("presets", { keyPath: "key" }).createIndex("scope", "scope");
  };
  const seedDb = await request(seed);
  const seedTx = seedDb.transaction(["photos", "documents"], "readwrite");
  seedTx
    .objectStore("photos")
    .add({
      key: key(input.id),
      namespace,
      value: { ...media, createdAt: 1, sourceAvailable: true },
    });
  seedTx.objectStore("documents").add({ key: key(input.id), namespace, value: originalDocument });
  await complete(seedTx);
  seedDb.close();
  const factory = {
    open(name, version) {
      if (
        name !== api.DEVELOP_DATABASE_NAME ||
        !/^foto-shoot-repository-qa:[0-9a-f-]{36}$/.test(databaseName)
      )
        throw new Error("Foreign database refused.");
      return indexedDB.open(databaseName, version);
    },
  };
  const writer = api.createDevelopStore({ scope, libraryId: "one", factory });
  const reader = api.createDevelopStore({ scope, libraryId: "one", factory });
  const other = api.createDevelopStore({ scope, libraryId: "other", factory });
  stores.push(writer, reader, other);
  const initial = await writer.loadLibraryWithManifest();
  check(
    "v1 upgrade retains existing photo and exact editing document",
    initial.photos.length === 1 &&
      JSON.stringify(initial.documents[input.id]) === serializedDocument,
  );
  check(
    "read-only compatibility manifest has revision zero",
    initial.manifest.revision === 0 && initial.manifest.photoIds[0] === input.id,
  );
  const events = [],
    unrelated = [];
  reader.subscribe((change) => events.push(change));
  other.subscribe((change) => unrelated.push(change));
  const sidecar = {
    name: "legacy.xmp",
    path: "original/legacy.xmp",
    text: "<xmp>Exact \u2603 source text</xmp>",
  };
  const archived = await writer.addPhotosWithDocuments([{ ...input, sidecar }]);
  check(
    "same-window commit is delivered after save and carries exact revision",
    events.length === 1 && events[0].commit.documents[input.id].revision === 8,
  );
  check("other shoot receives no notification", unrelated.length === 0);
  check(
    "archival enrichment retains original bytes and editing history",
    (await archived.photos[0].sourceBlob.text()) === "original" &&
      JSON.stringify(archived.documents[input.id]) === serializedDocument,
  );
  events[0].commit.photos[0].legacy.metadata.edits.crop = "orig";
  check(
    "observer receives detached metadata",
    (await writer.readPhoto(input.id)).photo.legacy.metadata.edits.crop === "4:5",
  );
  shot.edits.crop = "1:1";
  shot.develop.caption = "Later edited legacy state";
  await writer.addPhotosWithDocuments([
    { ...api.developPhotoFromShot(shot), sidecar: { ...sidecar, text: "replacement" } },
  ]);
  const retained = await writer.readPhoto(input.id);
  check(
    "repeated import preserves first immutable legacy and sidecar snapshot",
    retained.photo.legacy.metadata.develop.caption === "Preserve caption" &&
      retained.photo.sidecar.text === sidecar.text &&
      JSON.stringify(retained.document) === serializedDocument,
  );
  const first = await api.developPhotoFromFile(new File(["z"], "z.jpg"), new Blob(["z-preview"]));
  const second = await api.developPhotoFromFile(new File(["a"], "a.jpg"), new Blob(["a-preview"]));
  await writer.addPhotosWithDocuments([first, second]);
  const ordered = await reader.loadLibraryWithManifest();
  check(
    "atomic manifest appends in supplied order rather than name order",
    JSON.stringify(ordered.manifest.photoIds) === JSON.stringify([input.id, first.id, second.id]),
  );
  const competing = await Promise.allSettled([
    writer.saveManifest({ ...ordered.manifest, selectedId: first.id }, ordered.manifest.revision),
    reader.saveManifest({ ...ordered.manifest, selectedId: second.id }, ordered.manifest.revision),
  ]);
  check(
    "two manifest writers produce exactly one successful CAS",
    competing.filter((result) => result.status === "fulfilled").length === 1,
  );
  const beforeFailure = await writer.loadLibraryWithManifest();
  const eventCount = events.length;
  IDBObjectStore.prototype.put = function (value, ...args) {
    if (
      this.transaction.db.name === databaseName &&
      this.name === "documents" &&
      value.value.photoId === second.id
    )
      throw new DOMException("Synthetic full disk", "QuotaExceededError");
    return oldPut.call(this, value, ...args);
  };
  const updates = [first, second].map((p) => ({
    document: {
      ...beforeFailure.documents[p.id],
      metadata: { rating: 5, flag: "pick", colorLabel: null },
    },
    expectedRevision: beforeFailure.documents[p.id].revision,
  }));
  let rejected = false;
  try {
    await writer.saveDocuments(updates);
  } catch {
    rejected = true;
  }
  IDBObjectStore.prototype.put = oldPut;
  check(
    "failed atomic edit emits no commit and preserves all documents",
    rejected &&
      events.length === eventCount &&
      JSON.stringify((await writer.loadLibrary()).documents) ===
        JSON.stringify(beforeFailure.documents),
  );
  const targeted = await writer.readPhotosWithDocuments([second.id, input.id]);
  check(
    "targeted read follows requested IDs and exact saved documents",
    targeted.photos[0].id === second.id &&
      targeted.photos.length === 2 &&
      targeted.documents[input.id].revision === 8,
  );
  const copied = await writer.createVirtualCopy(
    first.id,
    beforeFailure.documents[first.id].revision,
  );
  check(
    "virtual copy membership and source bytes commit together",
    (await writer.readManifest()).photoIds.includes(copied.photo.id) &&
      (await copied.photo.sourceBlob.text()) === "z",
  );
  const job = {
    version: 1,
    revision: 0,
    id: "job",
    phase: "processing",
    startedAt: 1,
    finishedAt: null,
    rows: [{ id: "row", name: "z.jpg", path: "z.jpg", status: "saved", photoId: first.id }],
    found: 1,
    previewReady: 1,
    analyzed: 0,
    saved: 1,
    failed: 0,
    duplicates: 0,
    error: null,
  };
  const savedJob = await writer.saveImportJob(job, 0);
  check(
    "import report persists with scoped revision",
    (await reader.readImportJob()).revision === 1 && (await other.readImportJob()) === null,
  );
  let staleRejected = false;
  try {
    await reader.saveImportJob(job, 0);
  } catch {
    staleRejected = true;
  }
  check(
    "stale job write preserves durable receipt",
    staleRejected && (await writer.readImportJob()).rows[0].photoId === first.id,
  );
  await writer.saveImportJob({ ...savedJob, phase: "cancelled", finishedAt: 4 }, 1);
  check("cancelled report retains saved receipt", (await writer.readImportJob()).saved === 1);
  if (typeof BroadcastChannel !== "undefined") {
    const count = events.length;
    channel = new BroadcastChannel(`foto-develop:${scope}`);
    channel.postMessage({
      namespace,
      kind: "documents",
      ids: [input.id],
      origin: `external-${runId}`,
    });
    for (let i = 0; i < 50 && events.length === count; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    check(
      "cross-context notification accepts identifiers without media payload",
      events.length === count + 1 && !events.at(-1).commit,
    );
  }
} finally {
  IDBObjectStore.prototype.put = oldPut;
  channel?.close();
  stores.forEach((store) => store.close());
  if (
    databaseName !== `foto-shoot-repository-qa:${runId}` ||
    !/^foto-shoot-repository-qa:[0-9a-f-]{36}$/.test(databaseName)
  )
    throw new Error("QA cleanup scope mismatch.");
  await request(indexedDB.deleteDatabase(databaseName));
  const remaining = (await indexedDB.databases()).filter(
    (database) => database.name === databaseName,
  ).length;
  cleanup = { databaseName, remaining, complete: remaining === 0 };
  if (remaining) throw new Error("QA database cleanup failed.");
}
return { checks, passed: checks.length, cleanup };
