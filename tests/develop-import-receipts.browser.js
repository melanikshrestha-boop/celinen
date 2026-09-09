/* Async browser-eval body. Synthetic, uniquely scoped local Develop data only.
 * Does not read or modify customer/Studio records or clear any database.
 */
if (!["localhost", "127.0.0.1"].includes(location.hostname))
  throw new Error("Develop receipt checks require a local QA origin.");
const module = await import("/src/lib/develop/store.ts");
const { runDevelopImport } = await import("/src/lib/develop/import.ts");
const scope = `qa-develop-receipts-${crypto.randomUUID()}`;
const store = module.createDevelopStore({ scope, libraryId: "one" });
const reader = module.createDevelopStore({ scope, libraryId: "one" });
const other = module.createDevelopStore({ scope, libraryId: "other" });
const checks = [];
function check(name, condition) {
  if (!condition) throw new Error(name);
  checks.push(name);
}
const originalPut = IDBObjectStore.prototype.put;
const originalAdd = IDBObjectStore.prototype.add;
const originalTransaction = IDBDatabase.prototype.transaction;
const originalGetAll = IDBIndex.prototype.getAll;
const originalPost = BroadcastChannel.prototype.postMessage;
let unsubscribe = null;
let cleanup = null;
async function removeOwnFixtures() {
  if (!/^qa-develop-receipts-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(scope))
    throw new Error("Refusing cleanup outside this receipt test's unique QA scope.");
  const targets = [
    ...["photos", "documents"].flatMap((name) =>
      ["one", "other"].map((libraryId) => ({
        name,
        index: "namespace",
        query: JSON.stringify([scope, libraryId]),
        libraryId,
      })),
    ),
    { name: "presets", index: "scope", query: scope, libraryId: null },
  ];
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(module.DEVELOP_DATABASE_NAME);
    let absent = false;
    request.onupgradeneeded = () => {
      absent = true;
      request.transaction.abort(); // Cleanup must not create a missing database.
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => (absent ? resolve(null) : reject(request.error));
    request.onblocked = () => reject(new Error("QA fixture cleanup is blocked."));
  });
  if (!db) return { complete: true, deletedRecords: 0, remainingRecords: 0 };
  let deletedRecords = 0;
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["photos", "documents", "presets"], "readwrite");
      let failure = null;
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(failure ?? tx.error ?? new Error("QA cleanup aborted."));
      for (const target of targets) {
        const objectStore = tx.objectStore(target.name);
        const request = objectStore.index(target.index).getAllKeys(target.query);
        request.onsuccess = () => {
          try {
            for (const key of request.result) {
              const parts = typeof key === "string" ? JSON.parse(key) : null;
              if (
                !Array.isArray(parts) ||
                parts[0] !== scope ||
                parts.length !== (target.libraryId === null ? 2 : 3) ||
                (target.libraryId !== null && parts[1] !== target.libraryId) ||
                JSON.stringify(parts) !== key
              )
                throw new Error("Refusing to delete a QA index entry with a foreign key.");
              objectStore.delete(key);
              deletedRecords++;
            }
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
      }
    });
    const remainingRecords = await new Promise((resolve, reject) => {
      const tx = db.transaction(["photos", "documents", "presets"], "readonly");
      let count = 0;
      tx.oncomplete = () => resolve(count);
      tx.onabort = () => reject(tx.error ?? new Error("QA cleanup readback failed."));
      for (const target of targets) {
        const request = tx.objectStore(target.name).index(target.index).count(target.query);
        request.onsuccess = () => {
          count += request.result;
        };
      }
    });
    if (remainingRecords !== 0) throw new Error("QA fixture cleanup left scoped records behind.");
    return { complete: true, deletedRecords, remainingRecords };
  } finally {
    db.close();
  }
}
try {
  const original = new File(["QA exact source"], "receipt.jpg", {
    type: "image/jpeg",
    lastModified: 11,
  });
  const preview = new Blob(["QA preview"], { type: "image/jpeg" });
  const input = await module.developPhotoFromFile(original, preview);
  let transactionCompleted = false;
  const receiptTransactions = new WeakSet();
  // Observe completion before the store installs its resolving oncomplete handler.
  // A listener registered inside put/add may run after that Promise's continuation.
  IDBDatabase.prototype.transaction = function (...args) {
    const tx = originalTransaction.apply(this, args);
    if (this.name === module.DEVELOP_DATABASE_NAME && tx.mode === "readwrite")
      tx.addEventListener("complete", () => {
        if (receiptTransactions.has(tx)) transactionCompleted = true;
      });
    return tx;
  };
  function observeReceiptWrite(objectStore, value) {
    if (
      value?.namespace === store.namespace &&
      (value?.value?.id === input.id || value?.value?.photoId === input.id)
    )
      receiptTransactions.add(objectStore.transaction);
  }
  IDBObjectStore.prototype.put = function (value, ...args) {
    observeReceiptWrite(this, value);
    return originalPut.call(this, value, ...args);
  };
  IDBObjectStore.prototype.add = function (value, ...args) {
    observeReceiptWrite(this, value);
    return originalAdd.call(this, value, ...args);
  };
  IDBIndex.prototype.getAll = function (query, ...args) {
    if (query === store.namespace) throw new Error("Unexpected full-library import read");
    return originalGetAll.call(this, query, ...args);
  };
  const receipt = await store.addPhotosWithDocuments([input]);
  IDBObjectStore.prototype.put = originalPut;
  IDBObjectStore.prototype.add = originalAdd;
  IDBDatabase.prototype.transaction = originalTransaction;
  IDBIndex.prototype.getAll = originalGetAll;
  check(
    "incremental receipt resolves after the atomic transaction completes",
    transactionCompleted,
  );
  check(
    "receipt returns matching media and edit identities without a full-library read",
    receipt.photos.length === 1 &&
      Object.keys(receipt.documents).length === 1 &&
      receipt.documents[input.id]?.photoId === input.id,
  );
  let loaded = await reader.loadLibrary();
  check(
    "receipt history IDs and revisions equal fresh persistent readback",
    JSON.stringify(receipt.documents[input.id]) === JSON.stringify(loaded.documents[input.id]),
  );
  check(
    "receipt original bytes equal independent persistent readback",
    (await receipt.photos[0].sourceBlob.text()) === "QA exact source" &&
      (await loaded.photos[0].sourceBlob.text()) === "QA exact source",
  );
  check(
    "receipt stays within its library namespace",
    (await other.loadLibrary()).photos.length === 0,
  );
  const addDetached = store.addPhotos;
  const legacyArray = await addDetached([input]);
  check(
    "legacy detached addPhotos remains a photo-array API",
    Array.isArray(legacyArray) && legacyArray[0].id === input.id,
  );
  const empty = await store.addPhotosWithDocuments([]);
  check(
    "empty receipt creates neither photos nor documents",
    !empty.photos.length && !Object.keys(empty.documents).length,
  );

  const missing = {
    ...input,
    id: "studio:qa-receipt-missing",
    sourceBlob: null,
    sourceDigest: input.sourceDigest,
  };
  await store.addPhotos([missing]);
  loaded = await reader.loadLibrary();
  const oldPhoto = loaded.photos.find((photo) => photo.id === missing.id);
  let treatment = module.pushHistory(
    loaded.documents[missing.id],
    { ...module.currentRecipe(loaded.documents[missing.id]), exposure: 0.75 },
    "Saved exposure",
  );
  treatment = module.addSnapshot(
    { ...treatment, metadata: { rating: 4, flag: "pick", colorLabel: "green" } },
    "Saved look",
  );
  const saved = await store.saveDocument(treatment);
  const attached = await store.addPhotosWithDocuments([{ ...input, id: missing.id }]);
  check(
    "progressive original attachment retains the legacy ID and creation date",
    attached.photos[0].id === oldPhoto.id && attached.photos[0].createdAt === oldPhoto.createdAt,
  );
  check(
    "progressive original attachment returns the exact saved treatment and metadata",
    JSON.stringify(attached.documents[missing.id]) === JSON.stringify(saved),
  );
  check(
    "progressive original attachment retains the saved preview and original filename",
    (await attached.photos[0].previewBlob.text()) === "QA preview" &&
      attached.photos[0].sourceFileName === original.name,
  );
  check(
    "progressive original attachment has real original bytes",
    attached.photos[0].sourceAvailable &&
      (await attached.photos[0].sourceBlob.text()) === "QA exact source",
  );
  loaded = await reader.loadLibrary();
  check(
    "attachment receipt equals persistent history after reload",
    JSON.stringify(attached.documents[missing.id]) === JSON.stringify(loaded.documents[missing.id]),
  );

  unsubscribe = store.subscribe(() => {
    throw new Error("Synthetic display observer failed");
  });
  BroadcastChannel.prototype.postMessage = function (...args) {
    if (this.name === `foto-develop:${scope}`)
      throw new DOMException("Synthetic channel unavailable", "InvalidStateError");
    return originalPost.apply(this, args);
  };
  const notificationReceipt = await store.addPhotosWithDocuments([input]);
  BroadcastChannel.prototype.postMessage = originalPost;
  check(
    "notification and local observer failures cannot reject committed receipts",
    notificationReceipt.photos[0].id === input.id,
  );
  unsubscribe();
  unsubscribe = null;

  const failedA = await module.developPhotoFromFile(
    new File(["QA atomic A"], "atomic-a.jpg"),
    preview,
  );
  const failedB = await module.developPhotoFromFile(
    new File(["QA atomic B"], "atomic-b.jpg"),
    preview,
  );
  IDBObjectStore.prototype.add = function (value, ...args) {
    if (value?.namespace === store.namespace && value?.value?.photoId === failedB.id)
      throw new DOMException("Synthetic quota failure", "QuotaExceededError");
    return originalAdd.call(this, value, ...args);
  };
  let failure = null;
  try {
    await store.addPhotosWithDocuments([failedA, failedB]);
  } catch (error) {
    failure = error;
  }
  IDBObjectStore.prototype.add = originalAdd;
  loaded = await reader.loadLibrary();
  check(
    "failed receipt transaction reports storage failure",
    failure instanceof module.DevelopStorageUnavailable,
  );
  check(
    "failed receipt transaction leaves neither queued photo nor document",
    !loaded.photos.some((photo) => [failedA.id, failedB.id].includes(photo.id)) &&
      !loaded.documents[failedA.id] &&
      !loaded.documents[failedB.id],
  );
  check(
    "failed import leaves prior legacy history intact",
    JSON.stringify(loaded.documents[missing.id]) === JSON.stringify(saved),
  );

  const controller = new AbortController();
  const observed = [];
  const report = await runDevelopImport(
    [
      new File(["QA observed commit"], "observed.jpg"),
      new File(["QA should not save"], "later.jpg"),
    ],
    {
      existingIds: [],
      signal: controller.signal,
      preparePreview: async (_file, identified) => ({ ...identified, previewBlob: preview }),
      save: async (identified) => {
        const committed = await store.addPhotosWithDocuments([identified]);
        controller.abort();
        return committed;
      },
      onCommitted: async (committed) => {
        const fresh = await reader.loadLibrary();
        check(
          "progressive callback observes already durable exact history",
          JSON.stringify(committed.documents[committed.photos[0].id]) ===
            JSON.stringify(fresh.documents[committed.photos[0].id]),
        );
        observed.push(committed.photos[0].id);
        throw new Error("Synthetic post-commit display failure");
      },
    },
  );
  check(
    "cancellation after actual commit still reports and publishes exactly one photo",
    report.stopped &&
      report.imported.length === 1 &&
      observed.length === 1 &&
      report.selectedId === observed[0],
  );
  check("display failure after commit is not a persistence failure", report.fatalError === null);
  loaded = await reader.loadLibrary();
  check(
    "cancelled later original is not present",
    !loaded.photos.some((photo) => photo.name === "later.jpg"),
  );
} finally {
  IDBObjectStore.prototype.put = originalPut;
  IDBObjectStore.prototype.add = originalAdd;
  IDBDatabase.prototype.transaction = originalTransaction;
  IDBIndex.prototype.getAll = originalGetAll;
  BroadcastChannel.prototype.postMessage = originalPost;
  unsubscribe?.();
  store.close();
  reader.close();
  other.close();
  cleanup = await removeOwnFixtures();
}
return {
  passed: checks.length,
  checks,
  scope,
  cleanup,
  note: "Disposable synthetic IndexedDB fixtures with scoped cleanup/readback; no customer files, processing benchmark, native photo decode, or crash durability claim.",
};
