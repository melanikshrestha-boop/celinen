/* Browser-eval body for TWO exact abandoned synthetic import-lifecycle runs.
 * Run from /shoots in the local lab after unmounting any Develop editor.
 * Default is a read-only audit. To apply, set
 * globalThis.fotoAbandonedImportCleanupApply = true, then run this body again.
 * The flag is consumed, every source is regenerated and SHA-256 verified, and
 * both exact namespaces are compared again in one atomic delete transaction.
 * No presets, customer namespaces, database clearing, or session evidence edits.
 */
const targets = ["eeaf3000-1111-4222-8333-1b5720ec8a19", "eeaf3000-1111-4222-8333-1a938c57e214"];
const scope = "device-local";
const apply = globalThis.fotoAbandonedImportCleanupApply === true;
delete globalThis.fotoAbandonedImportCleanupApply;
function guard() {
  if (location.origin !== "http://127.0.0.1:8085" || location.pathname !== "/shoots")
    throw new Error("Open the local lab /shoots page before auditing these two abandoned QA runs.");
  if (document.querySelector(".foto-develop"))
    throw new Error("Unmount Develop before cleaning its synthetic fixtures.");
  if (globalThis.fotoImportLifecycle?.state === "running")
    throw new Error("An import fixture still reports running. Inspect it before cleanup.");
}
const namespaceFor = (shoot) => JSON.stringify([scope, `shoot:${shoot}`]);
const keyFor = (shoot, id) => JSON.stringify([scope, `shoot:${shoot}`, id]);
const requestResult = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("QA storage read failed."));
  });
const hash = async (blob) =>
  `sha256:${[...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
async function expectedSources(shoot) {
  const expected = new Map();
  for (let index = 0; index < 3; index++) {
    // Exact generator in develop-import-lifecycle.browser.js, not a filename-only allowance.
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 320;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is needed to verify the exact synthetic originals.");
    context.fillStyle = ["#344f60", "#755736", "#39654e"][index];
    context.fillRect(0, 0, 480, 320);
    context.fillStyle = ["#d3bba3", "#adced4", "#dbc88c"][index];
    context.fillRect(60 + index * 43, 50, 240, 210);
    context.fillStyle = "#101010";
    context.font = "18px sans-serif";
    context.fillText(`Synthetic import QA ${shoot.slice(-12)} / ${index}`, 12, 304);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    canvas.width = canvas.height = 0;
    if (!blob) throw new Error("Synthetic original verification could not run.");
    expected.set(await hash(blob), {
      name: `qa-import-${shoot.slice(-12)}-${index}.jpg`,
      size: blob.size,
      lastModified: 100 + index,
    });
  }
  return expected;
}
function validateRecords(shoot, records, expected) {
  const namespace = namespaceFor(shoot);
  if (records.photos.length > 3 || records.documents.length !== records.photos.length)
    throw new Error(`Unexpected photo/document count in ${namespace}; nothing will be deleted.`);
  const seen = new Set();
  for (const record of records.photos) {
    const photo = record.value;
    const generated = expected.get(photo?.id);
    if (
      !generated ||
      seen.has(photo.id) ||
      record.namespace !== namespace ||
      record.key !== keyFor(shoot, photo.id) ||
      photo.name !== generated.name ||
      photo.sourceFileName !== generated.name ||
      photo.sourceLastModified !== generated.lastModified ||
      photo.sourceDigest !== photo.id ||
      photo.isRaw !== false ||
      photo.width !== 480 ||
      photo.height !== 320 ||
      !(photo.sourceBlob instanceof Blob) ||
      photo.sourceBlob.size !== generated.size ||
      photo.sourceBlob.type !== "image/jpeg"
    )
      throw new Error(`Unexpected photo identity in ${namespace}; nothing will be deleted.`);
    seen.add(photo.id);
  }
  const documentsSeen = new Set();
  for (const record of records.documents) {
    const doc = record.value;
    if (
      !seen.has(doc?.photoId) ||
      documentsSeen.has(doc.photoId) ||
      record.namespace !== namespace ||
      record.key !== keyFor(shoot, doc.photoId) ||
      !Number.isSafeInteger(doc.revision) ||
      doc.revision < 0
    )
      throw new Error(`Unexpected edit identity in ${namespace}; nothing will be deleted.`);
    documentsSeen.add(doc.photoId);
  }
}
function snapshot(records) {
  // Includes exact edit histories and all media metadata for the apply-time CAS.
  // Blob contents were separately verified against regenerated originals before this.
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
const { isLocalSingleUserMode } = await import("/src/lib/app-mode.ts");
if (!isLocalSingleUserMode) throw new Error("Cleanup is only available for local lab QA fixtures.");
const { DEVELOP_DATABASE_NAME } = await import("/src/lib/develop/store.ts");
const db = await new Promise((resolve, reject) => {
  const request = indexedDB.open(DEVELOP_DATABASE_NAME);
  let absent = false;
  request.onupgradeneeded = () => {
    absent = true;
    request.transaction.abort(); // Do not create a database just to inspect cleanup.
  };
  request.onerror = () => (absent ? resolve(null) : reject(request.error));
  request.onblocked = () => reject(new Error("QA cleanup is blocked by another database upgrade."));
  request.onsuccess = () => resolve(request.result);
});
if (!db) return { mode: apply ? "apply" : "audit", databaseAbsent: true, removed: 0, targets };
try {
  const audits = [];
  for (const shoot of targets) {
    const records = await readNamespace(db.transaction(["photos", "documents"], "readonly"), shoot);
    const expected = records.photos.length ? await expectedSources(shoot) : new Map();
    validateRecords(shoot, records, expected);
    for (const record of records.photos) {
      if ((await hash(record.value.sourceBlob)) !== record.value.id)
        throw new Error(
          "Stored original bytes differ from the exact synthetic fixture; cleanup refused.",
        );
    }
    audits.push({ shoot, records, expected, snapshot: snapshot(records) });
  }
  const summary = audits.map(({ shoot, records }) => ({
    shoot,
    namespace: namespaceFor(shoot),
    photos: records.photos.map(({ value }) => ({ id: value.id, name: value.name })),
    documentRevisions: records.documents.map(({ value }) => ({
      photoId: value.photoId,
      revision: value.revision,
    })),
  }));
  if (!apply)
    return {
      mode: "audit",
      verified: true,
      targets: summary,
      next: "Set globalThis.fotoAbandonedImportCleanupApply = true and rerun to remove only these verified synthetic originals and their QA edits.",
    };
  guard();
  const tx = db.transaction(["photos", "documents"], "readwrite");
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error ?? new Error("QA cleanup was not committed."));
    tx.onerror = () => undefined;
  });
  void done.catch(() => undefined);
  try {
    const current = await Promise.all(audits.map(({ shoot }) => readNamespace(tx, shoot)));
    audits.forEach((audit, index) => {
      validateRecords(audit.shoot, current[index], audit.expected);
      if (snapshot(current[index]) !== audit.snapshot)
        throw new Error(
          "A QA photo or edit changed after audit; nothing was deleted. Inspect the other tab.",
        );
    });
    for (const records of current)
      for (const name of ["photos", "documents"])
        for (const record of records[name]) tx.objectStore(name).delete(record.key);
    await done;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // An already-aborted transaction has not committed partial deletes.
    }
    await done.catch(() => undefined);
    throw error;
  }
  for (const shoot of targets) {
    const remaining = await readNamespace(
      db.transaction(["photos", "documents"], "readonly"),
      shoot,
    );
    if (remaining.photos.length || remaining.documents.length)
      throw new Error(
        `Cleanup committed, but readback found recreated QA records in ${namespaceFor(shoot)}.`,
      );
  }
  return {
    mode: "apply",
    verified: true,
    targets: summary,
    removed: audits.reduce((count, audit) => count + audit.records.photos.length, 0),
    remainingPhotos: 0,
    remainingDocuments: 0,
    note: "Only exact regenerated synthetic originals and their QA edit documents were removed. They can be regenerated; no customer data or session evidence was touched.",
  };
} finally {
  db.close();
}
