/* Async browser-eval body. Only creates unique qa-develop-manage-* namespaces.
 * Uses synthetic blobs, never customer photos; no sends, deletions or Studio writes. */
if (!["localhost", "127.0.0.1"].includes(location.hostname))
  throw new Error("Photo management storage checks require a local QA origin.");
const m = await import("/src/lib/develop/store.ts");
const packages = await import("/src/lib/develop/preset-package.ts");
const scope = `qa-develop-manage-${crypto.randomUUID()}`;
const a = m.createDevelopStore({ scope, libraryId: "one" });
const b = m.createDevelopStore({ scope, libraryId: "one" });
const otherLibrary = m.createDevelopStore({ scope, libraryId: "two" });
const otherAccount = m.createDevelopStore({ scope: `${scope}-other`, libraryId: "one" });
const checks = [];
const check = (label, condition) => {
  if (!condition) throw new Error(label);
  checks.push(label);
};
const rejected = async (label, action) => {
  let didReject = false;
  try {
    await action();
  } catch {
    didReject = true;
  }
  check(label, didReject);
};
const originalAdd = IDBObjectStore.prototype.add;
try {
  const input = await m.developPhotoFromFile(
    new File(["FOTO synthetic original"], "source.ARW", {
      type: "application/octet-stream",
      lastModified: 123,
    }),
  );
  input.previewBlob = new Blob(["synthetic preview"], { type: "image/jpeg" });
  await a.addPhotos([input]);
  let library = await a.loadLibrary();
  let sourceDocument = library.documents[input.id];
  sourceDocument = m.pushHistory(
    sourceDocument,
    { ...m.currentRecipe(sourceDocument), exposure: 0.7, temperature: 12 },
    "Warm test",
  );
  sourceDocument = m.addSnapshot(sourceDocument, "Warm snapshot");
  sourceDocument.metadata.rating = 4;
  sourceDocument = await a.saveDocument(sourceDocument);
  const sourceBefore = JSON.stringify(sourceDocument);
  const events = [];
  const stop = a.subscribe((change) => events.push(change));
  await rejected("stale source revision prevents copying", () => a.createVirtualCopy(input.id, 0));
  await rejected("another library cannot copy the same photo ID", () =>
    otherLibrary.createVirtualCopy(input.id, sourceDocument.revision),
  );
  await rejected("another account cannot rename the same photo ID", () =>
    otherAccount.renamePhoto(input.id, "Wrong", input.name),
  );
  const copy = await a.createVirtualCopy(input.id, sourceDocument.revision);
  check(
    "copy receives distinct identity and automatic name",
    copy.photo.id !== input.id &&
      copy.photo.id.startsWith("copy:") &&
      copy.photo.name === "source copy.ARW",
  );
  check(
    "copy stores its own committed edit revision",
    copy.document.photoId === copy.photo.id && copy.document.revision === 1,
  );
  check(
    "copy keeps selected settings and metadata",
    m.currentRecipe(copy.document).exposure === 0.7 && copy.document.metadata.rating === 4,
  );
  check(
    "copy gets independent history and snapshot IDs",
    copy.document.history.every(
      (entry) => !sourceDocument.history.some((original) => original.id === entry.id),
    ) && copy.document.snapshots[0].id !== sourceDocument.snapshots[0].id,
  );
  check(
    "copy retains immutable original identity",
    copy.photo.sourceFileName === input.sourceFileName &&
      copy.photo.sourceDigest === input.sourceDigest &&
      copy.photo.sourceLastModified === input.sourceLastModified,
  );
  check(
    "copy preserves original bytes",
    (await copy.photo.sourceBlob.text()) === "FOTO synthetic original",
  );
  check(
    "successful copy emits its post-commit photo notification",
    events.some((event) => event.kind === "photos" && event.ids.includes(copy.photo.id)),
  );
  const renamed = await a.renamePhoto(copy.photo.id, "Final alternate", copy.photo.name);
  check(
    "display rename never renames the source",
    renamed.name === "Final alternate" &&
      renamed.sourceFileName === "source.ARW" &&
      renamed.sourceDigest === input.sourceDigest,
  );
  await rejected("stale second-tab rename is rejected", () =>
    b.renamePhoto(copy.photo.id, "Stale", copy.photo.name),
  );
  await rejected("case-insensitive duplicate names are rejected", () =>
    b.renamePhoto(copy.photo.id, "SOURCE.ARW", renamed.name),
  );
  await rejected("path-like photo names are rejected", () =>
    a.renamePhoto(copy.photo.id, "../escape", renamed.name),
  );
  const secondCopy = await a.createVirtualCopy(
    input.id,
    sourceDocument.revision,
    "Named alternate",
  );
  await rejected("explicit duplicate copy names do not overwrite", () =>
    a.createVirtualCopy(input.id, sourceDocument.revision, "named alternate"),
  );
  check("named copy is independent", secondCopy.photo.id !== copy.photo.id);
  const concurrent = await Promise.all([
    a.createVirtualCopy(input.id, sourceDocument.revision),
    b.createVirtualCopy(input.id, sourceDocument.revision),
  ]);
  check(
    "concurrent copies resolve names inside their serialized transactions",
    concurrent[0].photo.id !== concurrent[1].photo.id &&
      concurrent[0].photo.name !== concurrent[1].photo.name,
  );
  library = await a.loadLibrary();
  check(
    "source history remains byte-for-byte unchanged",
    JSON.stringify(library.documents[input.id]) === sourceBefore,
  );
  check(
    "renaming does not modify copied edit history",
    JSON.stringify(library.documents[copy.photo.id]) === JSON.stringify(copy.document),
  );
  const countBeforeFailure = library.photos.length;
  let faultInjected = false;
  IDBObjectStore.prototype.add = function (value, ...rest) {
    if (!faultInjected && this.name === "documents" && value?.namespace === a.namespace) {
      faultInjected = true;
      throw new DOMException("Synthetic quota failure after photo insertion", "QuotaExceededError");
    }
    return originalAdd.call(this, value, ...rest);
  };
  await rejected("a failed edit insertion rejects the entire copy", () =>
    a.createVirtualCopy(input.id, sourceDocument.revision),
  );
  IDBObjectStore.prototype.add = originalAdd;
  library = await a.loadLibrary();
  check(
    "copy rollback leaves no orphan photo or document",
    faultInjected &&
      library.photos.length === countBeforeFailure &&
      Object.keys(library.documents).length === countBeforeFailure,
  );
  const originalRename = await a.renamePhoto(input.id, "Original display", input.name);
  await a.addPhotos([input]);
  library = await a.loadLibrary();
  check(
    "ordinary reimport preserves the display rename and originals",
    library.photos.find((photo) => photo.id === input.id).name === originalRename.name &&
      (await library.photos.find((photo) => photo.id === input.id).sourceBlob.text()) ===
        "FOTO synthetic original",
  );
  const previewInput = {
    ...input,
    id: "studio:preview-only",
    name: "Preview only",
    sourceBlob: null,
    sourceDigest: null,
  };
  await a.addPhotos([previewInput]);
  const previewCopy = await a.createVirtualCopy(previewInput.id, 0);
  check(
    "preview-only copy remains explicitly preview-only",
    !previewCopy.photo.sourceAvailable &&
      previewCopy.photo.sourceBlob === null &&
      previewCopy.photo.previewBlob.size > 0,
  );
  const missing = { ...previewInput, id: "studio:missing", name: "Missing", previewBlob: null };
  await a.addPhotos([missing]);
  await rejected("missing-media record cannot create a misleading copy", () =>
    a.createVirtualCopy(missing.id, 0),
  );
  const pkg = packages.createPresetPackage(
    {
      title: "QA look",
      creator: "Synthetic creator",
      license: "Example terms, not a sale",
      description: "A local fixture.",
    },
    m.currentRecipe(sourceDocument),
  );
  const imported = await a.savePreset(
    packages.developPresetFromPackage(
      packages.parsePresetPackage(packages.exportPresetPackage(pkg)),
    ),
  );
  library = await b.loadLibrary();
  const preset = library.presets.find((item) => item.id === imported.id);
  check(
    "preset metadata and treatment survive persistent reload",
    preset.packageMetadata.creator === "Synthetic creator" &&
      preset.packageMetadata.license === pkg.metadata.license &&
      preset.settings.exposure === 0.7,
  );
  check(
    "presets remain account-scoped across libraries",
    (await otherLibrary.loadLibrary()).presets.some((item) => item.id === imported.id) &&
      (await otherAccount.loadLibrary()).presets.length === 0,
  );
  await rejected("stale package preset cannot overwrite the saved preset", () =>
    b.savePreset({ ...preset, name: "Wrong revision" }, 0),
  );
  check(
    "other library photo records stay untouched",
    (await otherLibrary.loadLibrary()).photos.length === 0,
  );
  check(
    "other account photo records stay untouched",
    (await otherAccount.loadLibrary()).photos.length === 0,
  );
  stop();
  return { scope, passed: checks.length, checks };
} finally {
  IDBObjectStore.prototype.add = originalAdd;
  for (const store of [a, b, otherLibrary, otherAccount]) store.close();
}
