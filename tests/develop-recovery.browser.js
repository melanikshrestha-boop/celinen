/*
 * Async browser-eval body for a local, isolated QA origin. Uses only new synthetic
 * qa-develop-recovery-* namespaces. Never reads or changes Studio or customer data.
 */
if (!["localhost", "127.0.0.1"].includes(location.hostname))
  throw new Error("Recovery storage checks require a local QA origin.");
const module = await import("/src/lib/develop/store.ts");
const scope = `qa-develop-recovery-${crypto.randomUUID()}`;
const target = { scope, libraryId: "one" };
const a = module.createDevelopStore(target);
const b = module.createDevelopStore(target);
const other = module.createDevelopStore({ scope, libraryId: "two" });
const checks = [];
function check(name, condition) {
  if (!condition) throw new Error(name);
  checks.push(name);
}
const edit = (doc, exposure) =>
  module.pushHistory(doc, { ...module.currentRecipe(doc), exposure }, "QA exposure");
const originalPut = IDBObjectStore.prototype.put;
try {
  const first = await module.developPhotoFromFile(new File(["Recovery protected A"], "first.ARW"));
  const second = await module.developPhotoFromFile(
    new File(["Recovery protected B"], "second.ARW"),
  );
  await a.addPhotos([first, second]);
  let library = await a.loadLibrary();
  const firstEdited = module.addSnapshot(
    edit(library.documents[first.id], 1),
    "Protected snapshot",
  );
  firstEdited.metadata = { rating: 5, flag: "pick", colorLabel: "green" };
  await a.saveDocument(firstEdited);
  library = await a.loadLibrary();
  const exportedDocuments = module.developRecoveryDocuments(library.documents, first.id, {
    ...module.currentRecipe(library.documents[first.id]),
    exposure: -2,
  });
  exportedDocuments[second.id] = edit(exportedDocuments[second.id], 2);
  exportedDocuments[first.id].metadata = { rating: 1, flag: "reject", colorLabel: "red" };
  const recovery = module.parseDevelopRecovery(
    JSON.stringify({ version: 1, namespace: a.namespace, documents: exportedDocuments }),
    target,
  );
  const photoIds = [first.id, second.id];
  let plan = module.prepareDevelopRecovery(recovery, library, { ...target, photoIds });
  check(
    "recovery planning is read-only and names exact current revisions",
    plan.updates.length === 2 &&
      plan.expectedRevisions[first.id] === library.documents[first.id].revision &&
      module.currentRecipe((await a.loadLibrary()).documents[first.id]).exposure === 1,
  );
  await b.saveDocument(edit(library.documents[second.id], 0.5));
  let stale = null;
  try {
    await a.restoreRecovery(recovery, plan);
  } catch (error) {
    stale = error;
  }
  library = await a.loadLibrary();
  check(
    "one stale revision rejects the entire recovery before any edit writes",
    stale instanceof module.DevelopSaveConflict &&
      module.currentRecipe(library.documents[first.id]).exposure === 1 &&
      module.currentRecipe(library.documents[second.id]).exposure === 0.5,
  );

  const before = library;
  plan = module.prepareDevelopRecovery(recovery, library, { ...target, photoIds });
  const restored = await a.restoreRecovery(recovery, plan);
  library = await b.loadLibrary();
  check(
    "explicit recovery atomically saves each selected active treatment",
    restored.restoredPhotoIds.length === 2 &&
      restored.unchangedPhotoIds.length === 0 &&
      module.currentRecipe(library.documents[first.id]).exposure === -2 &&
      module.currentRecipe(library.documents[second.id]).exposure === 2,
  );
  check(
    "recovery increments current revisions rather than trusting exported revisions",
    library.documents[first.id].revision === before.documents[first.id].revision + 1 &&
      library.documents[second.id].revision === before.documents[second.id].revision + 1,
  );
  check(
    "current ratings, flags and snapshots survive conflicting recovery metadata",
    library.documents[first.id].metadata.rating === 5 &&
      library.documents[first.id].metadata.flag === "pick" &&
      library.documents[first.id].metadata.colorLabel === "green" &&
      JSON.stringify(library.documents[first.id].snapshots) ===
        JSON.stringify(before.documents[first.id].snapshots),
  );
  check(
    "saved histories survive recovery and undo returns to the previous treatment",
    JSON.stringify(
      library.documents[first.id].history.slice(0, before.documents[first.id].history.length),
    ) === JSON.stringify(before.documents[first.id].history) &&
      module.currentRecipe(module.undoHistory(library.documents[first.id])).exposure === 1 &&
      module.currentRecipe(module.undoHistory(library.documents[second.id])).exposure === 0.5,
  );
  check(
    "recovery never writes original bytes, source receipts or extra photos",
    library.photos.length === 2 &&
      (await library.photos.find((photo) => photo.id === first.id).sourceBlob.text()) ===
        "Recovery protected A" &&
      (await library.photos.find((photo) => photo.id === second.id).sourceBlob.text()) ===
        "Recovery protected B" &&
      library.photos.find((photo) => photo.id === first.id).sourceDigest === first.sourceDigest &&
      library.photos.find((photo) => photo.id === first.id).sourceFileName === first.sourceFileName,
  );

  const noOpPlan = module.prepareDevelopRecovery(recovery, library, { ...target, photoIds });
  const noOp = await a.restoreRecovery(recovery, noOpPlan);
  check(
    "identical recovery is an explicit no-op without new history or revision",
    noOp.restoredPhotoIds.length === 0 &&
      noOp.unchangedPhotoIds.length === 2 &&
      noOp.documents.every((doc) => doc.revision === library.documents[doc.photoId].revision),
  );
  await b.saveDocument({
    ...library.documents[first.id],
    metadata: { ...library.documents[first.id].metadata, rating: 4 },
  });
  let staleNoOp = null;
  try {
    await a.restoreRecovery(recovery, noOpPlan);
  } catch (error) {
    staleNoOp = error;
  }
  check(
    "even a no-op recovery requires the previewed revision to stay current",
    staleNoOp instanceof module.DevelopSaveConflict &&
      (await a.loadLibrary()).documents[first.id].metadata.rating === 4,
  );

  let wrongNamespace = null;
  try {
    await other.restoreRecovery(recovery, noOpPlan);
  } catch (error) {
    wrongNamespace = error;
  }
  check(
    "recovery cannot cross a project boundary or create records there",
    wrongNamespace instanceof Error &&
      (await other.loadLibrary()).photos.length === 0 &&
      Object.keys((await other.loadLibrary()).documents).length === 0,
  );
  const missingId = "studio:qa-recovery-missing";
  const missingRecovery = module.parseDevelopRecovery(
    JSON.stringify({
      version: 1,
      namespace: a.namespace,
      documents: { [missingId]: module.createDevelopDocument(missingId) },
    }),
    target,
  );
  let missing = null;
  try {
    await a.restoreRecovery(missingRecovery, {
      photoIds: [missingId],
      expectedRevisions: { [missingId]: 0 },
    });
  } catch (error) {
    missing = error;
  }
  check(
    "recovery never fabricates a missing photo or document",
    missing instanceof Error &&
      (await a.loadLibrary()).photos.length === 2 &&
      !(await a.loadLibrary()).documents[missingId],
  );
  let unpreviewed = null;
  try {
    await a.restoreRecovery(recovery, { photoIds, expectedRevisions: {} });
  } catch (error) {
    unpreviewed = error;
  }
  check("restoring without an explicit revision preview is rejected", unpreviewed instanceof Error);

  library = await a.loadLibrary();
  const quotaDocuments = {
    [first.id]: edit(library.documents[first.id], 3),
    [second.id]: edit(library.documents[second.id], -3),
  };
  const quotaRecovery = module.parseDevelopRecovery(
    JSON.stringify({ version: 1, namespace: a.namespace, documents: quotaDocuments }),
    target,
  );
  const quotaPlan = module.prepareDevelopRecovery(quotaRecovery, library, { ...target, photoIds });
  let queuedWrites = 0;
  IDBObjectStore.prototype.put = function (value, ...args) {
    if (value?.namespace === a.namespace && value?.value?.photoId === second.id)
      throw new DOMException("QA quota injection", "QuotaExceededError");
    if (value?.namespace === a.namespace) queuedWrites += 1;
    return originalPut.call(this, value, ...args);
  };
  let quotaError = null;
  try {
    await a.restoreRecovery(quotaRecovery, quotaPlan);
  } catch (error) {
    quotaError = error;
  }
  IDBObjectStore.prototype.put = originalPut;
  const afterQuota = await b.loadLibrary();
  check(
    "storage failure is reported without a partially restored batch",
    quotaError instanceof module.DevelopStorageUnavailable &&
      queuedWrites > 0 &&
      JSON.stringify(afterQuota.documents) === JSON.stringify(library.documents),
  );

  return {
    passed: checks.length,
    checks,
    scope,
    note: "Synthetic edit-recovery storage fixtures, not photo-render or real quota-exhaustion proof.",
  };
} finally {
  IDBObjectStore.prototype.put = originalPut;
  a.close();
  b.close();
  other.close();
}
