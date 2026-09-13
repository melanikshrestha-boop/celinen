/* Run only with browse eval in an explicitly isolated Chromium LAB QA profile.
 * Set fotoIsolatedQaProfile=true. Every run creates a new UUID database; no
 * customer database, photograph, upload, native decode or deletion is used.
 * This checks real IndexedDB handle cloning, not photo import throughput.
 */
if (location.origin !== "http://127.0.0.1:8085" || globalThis.fotoIsolatedQaProfile !== true)
  throw new Error("Explicit isolated LAB profile confirmation is required.");
const runId = crypto.randomUUID();
const databaseName = `foto-source-refresh-qa:${runId}`;
const result = { state: "running", runId, databaseName, checks: [], error: null };
globalThis.fotoSourceRefreshQa = result;
void (async () => {
  const { createDevelopStore, developPhotoFromFile, DEVELOP_DATABASE_NAME } =
    await import("/src/lib/develop/store.ts");
  const { createShootRepository } = await import("/src/lib/develop/shoot-repository.ts");
  const { createCullShootView } = await import("/src/lib/develop/cull-view.ts");
  const { admitImportCull, attachImportAnalysis, takeImportCullIds, applyImportCull } =
    await import("/src/lib/studio/cull-on-import.ts");
  const factory = {
    open(name, version) {
      if (name !== DEVELOP_DATABASE_NAME) throw new Error("Foreign database refused.");
      return indexedDB.open(databaseName, version);
    },
  };
  const options = { scope: `qa-source-refresh:${runId}`, libraryId: `shoot:${runId}`, factory };
  const repository = createShootRepository(options);
  const check = (name, condition) => {
    if (!condition) throw new Error(name);
    result.checks.push(name);
  };
  try {
    check("fresh isolated database", (await repository.read()).photos.length === 0);
    const input = await developPhotoFromFile(
      new File([`synthetic original ${runId}`], "refresh.jpg", {
        type: "image/jpeg",
        lastModified: 12,
      }),
    );
    await repository.store.addPhotosWithDocuments([input]);
    const before = await repository.read();
    const again = await repository.read();
    check(
      "real IndexedDB reads clone original Blob handles",
      before.photos[0].sourceBlob !== again.photos[0].sourceBlob,
    );
    const history = JSON.stringify(before.documents[input.id].history);
    const view = createCullShootView(repository);
    const initial = await view.read();
    const pending = new Map();
    admitImportCull(pending, initial.shots, [input.id]);
    check("only new photo admitted", pending.size === 1);
    for (let repeat = 0; repeat < 3; repeat++) {
      const refreshed = await view.read();
      check(
        `reread ${repeat + 1} retains verified File handle`,
        refreshed.shots[0].file === initial.shots[0].file,
      );
      check(
        `reread ${repeat + 1} awaits real analysis`,
        takeImportCullIds(pending, refreshed.shots).size === 0 && pending.size === 1,
      );
      check(
        `reread ${repeat + 1} leaves verdict undecided`,
        refreshed.shots[0].verdict === "undecided",
      );
    }
    // Explicit synthetic mechanical receipt: a correctness fixture, not decoded evidence.
    const analyzed = attachImportAnalysis((await view.read()).shots[0], {
      width: 10,
      height: 10,
      backend: "native-cpp",
      analysis: {
        sharpness: 200,
        brightness: 120,
        clippedHighlights: 0,
        clippedShadows: 0,
        hash: "0".repeat(64),
      },
    });
    const onlyIds = takeImportCullIds(pending, [analyzed]);
    check(
      "ready admission consumed exactly once",
      onlyIds.size === 1 && onlyIds.has(input.id) && pending.size === 0,
    );
    const reviewed = applyImportCull([analyzed], { onlyIds });
    check("new analyzed photo is kept", reviewed.shots[0].verdict === "keep");
    await view.save(reviewed.shots, input.id, "all");
    const reopened = createDevelopStore(options);
    try {
      const saved = await reopened.loadLibraryWithManifest();
      check(
        "reopen preserves exact ID and order",
        JSON.stringify(saved.manifest.photoIds) === JSON.stringify([input.id]),
      );
      check("reopen preserves saved pick", saved.documents[input.id].metadata.flag === "pick");
      check(
        "native history untouched",
        JSON.stringify(saved.documents[input.id].history) === history,
      );
      const verified = await developPhotoFromFile(
        new File([saved.photos[0].sourceBlob], "refresh.jpg"),
      );
      check(
        "original bytes reverified after save and reopen",
        verified.sourceDigest === input.sourceDigest,
      );
      check(
        "original source metadata intact",
        saved.photos[0].sourceFileName === "refresh.jpg" &&
          saved.photos[0].sourceLastModified === 12,
      );
    } finally {
      reopened.close();
    }
    result.state = "passed";
  } finally {
    repository.close();
  }
})().catch((error) => {
  result.state = "failed";
  result.error = error.message;
});
JSON.stringify(result);
