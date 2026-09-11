/* Browser-eval body. DO NOT run until Detail QA on shoot ...097 is finished.
 * Open http://127.0.0.1:8085/shoots with Develop unmounted. Default: read-only audit.
 * Explicit apply: globalThis.fotoPublicPerformanceCleanupApply = true; rerun this body.
 * The one-shot flag is consumed. All seven exact namespaces and all 21 complete
 * original SHA-256 digests must match before any deletion is scheduled.
 * Only exact photo/document keys are deleted, atomically. No presets, reports,
 * screenshots, source files, Studio records, or other namespaces are touched.
 */
const targets = Object.freeze([
  "eeaf3000-1111-4222-8333-000000000091",
  "eeaf3000-1111-4222-8333-000000000092",
  "eeaf3000-1111-4222-8333-000000000093",
  "eeaf3000-1111-4222-8333-000000000094",
  "eeaf3000-1111-4222-8333-000000000095",
  "eeaf3000-1111-4222-8333-000000000096",
  "eeaf3000-1111-4222-8333-000000000097",
]);
const scope = "device-local";
const expected = new Map(
  [
    {
      name: "sony-a6000.ARW",
      digest: "ce8b4957281a817d52a07a691e2468567b6c78223bd0b514ffc1c65b002b8d89",
      size: 25624576,
      isRaw: true,
    },
    {
      name: "sony-a7iv-small.ARW",
      digest: "cbbd0930c7d8706dff84c68a2004454266e6fd0d8354f5f76a106b5d776e0223",
      size: 22933504,
      isRaw: true,
    },
    {
      name: "volleyball-portrait-cc0.jpg",
      // Independently hashed tests/fixtures/photos/volleyball-portrait-cc0.jpg.
      digest: "5685e8468969ca05da9de250f5848df5318e6b47b1a14d4aebd5c19675224fce",
      size: 3148228,
      isRaw: false,
    },
  ].map((source) => [`sha256:${source.digest}`, Object.freeze(source)]),
);
const apply = globalThis.fotoPublicPerformanceCleanupApply === true;
delete globalThis.fotoPublicPerformanceCleanupApply;
function guard() {
  if (
    location.origin !== "http://127.0.0.1:8085" ||
    location.pathname !== "/shoots" ||
    location.search ||
    location.hash
  )
    throw new Error("Open the local lab /shoots page without a query or hash before cleanup.");
  if (document.querySelector(".foto-develop"))
    throw new Error("Unmount Develop before auditing or deleting its public QA fixtures.");
  if (
    globalThis.fotoImportLifecycle?.state === "running" ||
    globalThis.fotoLargeLibraryQA?.state === "running"
  )
    throw new Error("Another QA fixture reports running; finish it before cleanup.");
}
function assertTarget(shoot) {
  if (!targets.includes(shoot))
    throw new Error("Cleanup target is not one of the seven reserved shoots.");
}
const namespaceFor = (shoot) => {
  assertTarget(shoot);
  return JSON.stringify([scope, `shoot:${shoot}`]);
};
const keyFor = (shoot, id) => {
  assertTarget(shoot);
  if (!expected.has(id)) throw new Error("Cleanup photo ID is not an exact public fixture digest.");
  return JSON.stringify([scope, `shoot:${shoot}`, id]);
};
const hash = async (blob) =>
  `sha256:${[...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
async function verifySourceBytes(photo) {
  const source = expected.get(photo?.id);
  if (!source || !(photo.sourceBlob instanceof Blob) || photo.sourceBlob.size !== source.size)
    throw new Error("Original source identity or size differs from the public fixture.");
  if ((await hash(photo.sourceBlob)) !== photo.id)
    throw new Error("Original SHA-256 differs from the public fixture; nothing will be deleted.");
}
function validateRecords(shoot, records, documentSchema) {
  const namespace = namespaceFor(shoot);
  if (
    !records ||
    !Array.isArray(records.photos) ||
    !Array.isArray(records.documents) ||
    records.photos.length !== 3 ||
    records.documents.length !== 3
  )
    throw new Error(
      `Expected exactly three photo/document pairs in ${namespace}; cleanup refused.`,
    );
  const photosSeen = new Set();
  for (const record of records.photos) {
    const photo = record?.value;
    const source = expected.get(photo?.id);
    if (
      !source ||
      photosSeen.has(photo.id) ||
      record.namespace !== namespace ||
      record.key !== keyFor(shoot, photo.id) ||
      photo.sourceDigest !== photo.id ||
      photo.name !== source.name ||
      photo.sourceFileName !== source.name ||
      photo.isRaw !== source.isRaw ||
      photo.sourceAvailable !== true ||
      !(photo.sourceBlob instanceof Blob) ||
      photo.sourceBlob.size !== source.size ||
      (photo.sourceBlob instanceof File && photo.sourceBlob.name !== source.name)
    )
      throw new Error(`Unexpected photo identity in ${namespace}; nothing will be deleted.`);
    photosSeen.add(photo.id);
  }
  const documentsSeen = new Set();
  for (const record of records.documents) {
    const doc = record?.value;
    if (
      !photosSeen.has(doc?.photoId) ||
      documentsSeen.has(doc.photoId) ||
      record.namespace !== namespace ||
      record.key !== keyFor(shoot, doc.photoId) ||
      !Number.isSafeInteger(doc.revision) ||
      doc.revision < 0 ||
      !documentSchema.safeParse(doc).success
    )
      throw new Error(
        `Unexpected edit identity or invalid history in ${namespace}; cleanup refused.`,
      );
    documentsSeen.add(doc.photoId);
  }
}
function snapshot(records) {
  // Exact history/metadata CAS; source bytes are separately verified before this.
  // Never stringify original pixels or output edit contents in the audit report.
  return JSON.stringify(records, (_key, value) =>
    value instanceof Blob
      ? {
          qaBlob: true,
          size: value.size,
          type: value.type,
          name: value instanceof File ? value.name : null,
          lastModified: value instanceof File ? value.lastModified : null,
        }
      : value,
  );
}
function validateAuditSet(audits, current, documentSchema) {
  if (
    audits.length !== targets.length ||
    current.length !== targets.length ||
    audits.some((audit, index) => audit.shoot !== targets[index])
  )
    throw new Error("All seven exact QA shoots must be verified together before any deletion.");
  audits.forEach((audit, index) => {
    validateRecords(audit.shoot, current[index], documentSchema);
    if (snapshot(current[index]) !== audit.snapshot)
      throw new Error(
        "A QA photo or edit changed after audit; nothing was deleted. Inspect other tabs.",
      );
  });
}
const requestResult = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("QA storage read failed."));
  });
async function readNamespace(tx, shoot) {
  const namespace = namespaceFor(shoot);
  const [photos, documents] = await Promise.all(
    ["photos", "documents"].map((name) =>
      requestResult(tx.objectStore(name).index("namespace").getAll(namespace)),
    ),
  );
  return { photos, documents };
}
// BEGIN CLEANUP EXECUTION
guard();
if (globalThis.fotoPublicPerformanceCleanup?.state === "running")
  throw new Error("This cleanup is already running. Wait for its audit or readback result.");
const status = {
  state: "running",
  mode: apply ? "apply" : "audit",
  stage: "opening",
  verifiedOriginals: 0,
  committed: false,
};
globalThis.fotoPublicPerformanceCleanup = status;
let db;
try {
  const { isLocalSingleUserMode } = await import("/src/lib/app-mode.ts");
  if (!isLocalSingleUserMode)
    throw new Error("Cleanup is only available in device-local lab mode.");
  const { DEVELOP_DATABASE_NAME, developDocumentSchema } =
    await import("/src/lib/develop/store.ts");
  db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DEVELOP_DATABASE_NAME);
    let absent = false;
    request.onupgradeneeded = () => {
      absent = true;
      request.transaction.abort(); // Never create a database just to clean it.
    };
    request.onerror = () => (absent ? resolve(null) : reject(request.error));
    request.onblocked = () => reject(new Error("QA cleanup is blocked by a database upgrade."));
    request.onsuccess = () => resolve(request.result);
  });
  if (!db)
    throw new Error("Develop database is absent; no public QA records were verified or deleted.");
  const audits = [];
  for (const shoot of targets) {
    guard();
    status.stage = `verifying ${shoot}`;
    const records = await readNamespace(db.transaction(["photos", "documents"], "readonly"), shoot);
    validateRecords(shoot, records, developDocumentSchema);
    // Serial hashing bounds temporary buffers to one original (largest is 25 MiB).
    for (const { value } of records.photos) {
      await verifySourceBytes(value);
      status.verifiedOriginals++;
    }
    audits.push({ shoot, records, snapshot: snapshot(records) });
  }
  const summary = audits.map(({ shoot, records }) => ({
    shoot,
    namespace: namespaceFor(shoot),
    photos: records.photos.map(({ value }) => ({
      id: value.id,
      name: value.name,
      bytes: value.sourceBlob.size,
    })),
    documents: records.documents.map(({ value }) => ({
      photoId: value.photoId,
      revision: value.revision,
      historyEntries: value.history.length,
      snapshots: value.snapshots.length,
    })),
  }));
  if (!apply) {
    status.state = "passed";
    status.stage = "audit complete; no writes";
    return (status.result = {
      mode: "audit",
      verified: true,
      targets: summary,
      verifiedOriginals: 21,
      removedPhotos: 0,
      removedDocuments: 0,
      next: "After Detail QA finishes, set globalThis.fotoPublicPerformanceCleanupApply = true and rerun. Only these 21 public QA photos and their edited QA documents will be removed.",
    });
  }
  guard();
  status.stage = "comparing all seven namespaces atomically";
  const tx = db.transaction(["photos", "documents"], "readwrite");
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error ?? new Error("QA cleanup did not commit."));
    tx.onerror = () => undefined;
  });
  void done.catch(() => undefined);
  try {
    const current = await Promise.all(audits.map(({ shoot }) => readNamespace(tx, shoot)));
    validateAuditSet(audits, current, developDocumentSchema);
    guard();
    // No delete is queued until EVERY namespace, source receipt, and history matches.
    for (const records of current)
      for (const storeName of ["photos", "documents"])
        for (const record of records[storeName]) tx.objectStore(storeName).delete(record.key);
    await done;
    status.committed = true;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // An already-aborted transaction did not commit partial deletions.
    }
    await done.catch(() => undefined);
    throw error;
  }
  status.stage = "reading back exact namespaces";
  const remaining = await Promise.all(
    targets.map(async (shoot) => {
      const records = await readNamespace(
        db.transaction(["photos", "documents"], "readonly"),
        shoot,
      );
      return { shoot, photos: records.photos.length, documents: records.documents.length };
    }),
  );
  if (remaining.some((record) => record.photos || record.documents))
    throw new Error(
      "Cleanup committed, but readback found recreated QA records. Inspect other tabs.",
    );
  status.state = "passed";
  status.stage = "committed and readback verified";
  return (status.result = {
    mode: "apply",
    verified: true,
    targets: summary,
    verifiedOriginals: 21,
    removedPhotos: 21,
    removedDocuments: 21,
    remainingPhotos: 0,
    remainingDocuments: 0,
    readback: remaining,
    note: "Only the exact public-fixture photo/document pairs were deleted. Public source files, reports, screenshots, presets and other namespaces remain untouched. QA edits are deleted; reimporting the public sources does not restore those edits.",
  });
} catch (error) {
  status.state = "failed";
  status.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  db?.close();
  status.finishedAt = new Date().toISOString();
}
