/* Async browser-eval body. Run ONLY in an isolated Chromium QA profile at
 * http://127.0.0.1:8085. Set globalThis.fotoIsolatedQaProfile = true first.
 * Returns immediately; poll globalThis.fotoImportOrderQa. When reload-required,
 * reload the page, set the flag again and run this same body to verify persistence.
 * Uses unique synthetic original bytes + a canvas JPEG preview, never a decoder
 * or RAW-speed benchmark. A custom IDB factory permits only a fresh UUID QA DB.
 * No customer database is opened and no database/record is deleted.
 */
if (location.origin !== "http://127.0.0.1:8085" || globalThis.fotoIsolatedQaProfile !== true)
  throw new Error("Explicit isolated LAB browser confirmation is required.");
if (globalThis.fotoImportOrderQa?.state === "running") return globalThis.fotoImportOrderQa;
const markerKey = "foto:qa:import-order:active-v1";
const previous = JSON.parse(sessionStorage.getItem(markerKey) || "null");
const runId = previous?.state === "reload-required" ? previous.runId : crypto.randomUUID();
if (!/^[0-9a-f-]{36}$/.test(runId)) throw new Error("Invalid QA run identity.");
const databaseName = `foto-import-order-qa:${runId}`;
const result = { state: "running", runId, databaseName, checks: [], error: null };
globalThis.fotoImportOrderQa = result;
void (async () => {
  const api = await import("/src/lib/develop/store.ts");
  const { createDevelopImportSession } = await import("/src/lib/develop/import-session.ts");
  const { createShootRepository } = await import("/src/lib/develop/shoot-repository.ts");
  const { createCullShootView } = await import("/src/lib/develop/cull-view.ts");
  const check = (name, condition) => {
    if (!condition) throw new Error(name);
    result.checks.push(name);
  };
  const wait = async (name, predicate) => {
    const deadline = performance.now() + 30000;
    while (performance.now() < deadline) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out: ${name}`);
  };
  const digest = async (blob) =>
    "sha256:" +
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  const factory = {
    open(name, version) {
      if (
        name !== api.DEVELOP_DATABASE_NAME ||
        !/^foto-import-order-qa:[0-9a-f-]{36}$/.test(databaseName)
      )
        throw new Error("Foreign database refused.");
      return indexedDB.open(databaseName, version);
    },
  };
  const options = { scope: `qa-import-order:${runId}`, libraryId: `shoot:${runId}`, factory };
  const repository = createShootRepository(options);
  const store = repository.store;
  const verify = async (expected, label) => {
    const saved = await store.loadLibraryWithManifest();
    check(
      `${label}: exact manifest order`,
      JSON.stringify(saved.manifest.photoIds) === JSON.stringify(expected.ids),
    );
    check(`${label}: exact membership`, saved.photos.length === expected.ids.length);
    for (const photo of saved.photos)
      check(
        `${label}: original bytes ${photo.name}`,
        (await digest(photo.sourceBlob)) === photo.id && expected.ids.includes(photo.id),
      );
    const document = saved.documents[expected.pickedId];
    check(`${label}: saved keep`, document.metadata.flag === "pick");
    check(
      `${label}: history preserved`,
      JSON.stringify(document.history) === expected.history && document.cursor === expected.cursor,
    );
    check(`${label}: selected photo preserved`, saved.manifest.selectedId === expected.pickedId);
    check(`${label}: filter preserved`, saved.manifest.filter === "keepers");
    const reopened = await createCullShootView(repository).read();
    check(
      `${label}: Cull selection/filter restored`,
      reopened.selectedId === expected.shotId && reopened.filter === "keepers",
    );
    check(
      `${label}: Cull pick restored`,
      reopened.shots.find((shot) => shot.id === expected.shotId)?.verdict === "keep",
    );
  };
  if (previous?.state === "reload-required") {
    check(
      "same isolated QA database after real page reload",
      previous.databaseName === databaseName,
    );
    await verify(previous.expected, "page reload");
    result.state = "passed";
    result.method =
      "Real IndexedDB, synthetic gated preview; no photo-throughput or subject-accuracy claim.";
    sessionStorage.setItem(markerKey, JSON.stringify(result));
    return;
  }
  check("fresh empty isolated namespace", (await store.loadLibrary()).photos.length === 0);
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const context = canvas.getContext("2d");
  context.fillStyle = "#526b83";
  context.fillRect(0, 0, 8, 8);
  const preview = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  check("real tiny JPEG preview generated", preview instanceof Blob && preview.size > 0);
  const files = [
    new File([`synthetic RAW gate ${runId}`], "first.arw"),
    ...Array.from(
      { length: 12 },
      (_, index) =>
        new File([`synthetic unique JPEG original ${runId}:${index}`], `frame-${index}.jpg`, {
          type: "image/jpeg",
        }),
    ),
  ];
  const ids = await Promise.all(files.map(digest));
  let releaseRaw;
  const rawGate = new Promise((resolve) => {
    releaseRaw = resolve;
  });
  const session = createDevelopImportSession(options, {
    store,
    preparePreview: async (file, input, signal) => {
      if (file === files[0]) await rawGate;
      signal.throwIfAborted();
      return { ...input, width: 8, height: 8, previewBlob: preview, previewOrigin: "unknown" };
    },
  });
  const running = session.startFiles(files);
  let expected;
  try {
    await wait(
      "twelve JPEGs durably committed before gated RAW",
      async () => (await store.loadLibrary()).photos.length === 12,
    );
    // IDB completion precedes the coordinator's batched subscriber publication.
    // Keep the RAW gate closed until both durable bytes and the report acknowledge 12.
    await wait("twelve JPEG acknowledgments published", () => session.getSnapshot().saved === 12);
    check("RAW gate did not block later durable commits", session.getSnapshot().saved === 12);
    const view = createCullShootView(repository);
    const partial = await view.read();
    const picked = partial.shots[4];
    const pickedId = view.photoId(picked.id);
    const before = (await store.loadLibrary()).documents[pickedId];
    expected = {
      ids,
      pickedId,
      shotId: picked.id,
      history: JSON.stringify(before.history),
      cursor: before.cursor,
    };
    await view.save(
      partial.shots.map((shot) => (shot.id === picked.id ? { ...shot, verdict: "keep" } : shot)),
      picked.id,
      "keepers",
    );
    check(
      "K-equivalent gesture persisted while RAW was pending",
      (await store.loadLibrary()).documents[pickedId].metadata.flag === "pick",
    );
  } finally {
    releaseRaw();
    await running;
  }
  check(
    "all thirteen originals acknowledged",
    session.getSnapshot().saved === 13 && session.getSnapshot().phase === "complete",
  );
  await verify(expected, "completed import");

  // Independent cancellation owner/namespace. One committed JPEG remains; the
  // held RAW never gains Saved and cannot alter the first test's shoot.
  const cancelId = crypto.randomUUID();
  const cancelOptions = {
    scope: `qa-import-order:${cancelId}`,
    libraryId: `shoot:${cancelId}`,
    factory,
  };
  const cancelStore = api.createDevelopStore(cancelOptions);
  let rawEntered = false;
  const cancelled = createDevelopImportSession(cancelOptions, {
    store: cancelStore,
    preparePreview: async (file, input, signal) => {
      if (file.name.endsWith(".arw")) {
        rawEntered = true;
        await new Promise((_, reject) => {
          const abort = () => reject(new DOMException("QA cancellation", "AbortError"));
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
      }
      signal.throwIfAborted();
      return { ...input, width: 8, height: 8, previewBlob: preview, previewOrigin: "unknown" };
    },
  });
  const cancelRun = cancelled.startFiles([
    new File([`${cancelId}:saved`], "saved.jpg"),
    new File([`${cancelId}:pending`], "pending.arw"),
  ]);
  try {
    await wait(
      "cancellation fixture saved JPEG and blocked RAW",
      async () => rawEntered && (await cancelStore.loadLibrary()).photos.length === 1,
    );
  } finally {
    cancelled.cancel();
    await cancelRun;
  }
  check(
    "cancel leaves exactly the acknowledged original",
    (await cancelStore.loadLibrary()).photos.length === 1 && cancelled.getSnapshot().saved === 1,
  );
  check(
    "cancelled owner drains",
    !cancelled.isRunning() && cancelled.getSnapshot().phase === "cancelled",
  );
  await verify(expected, "after independent cancellation");
  result.state = "reload-required";
  result.expected = expected;
  result.cancelNamespace = cancelStore.namespace;
  result.method =
    "Reload page, set isolated-profile flag, rerun this body. Databases retained; no cleanup/deletion.";
  sessionStorage.setItem(markerKey, JSON.stringify(result));
})().catch((error) => {
  result.state = "failed";
  result.error = error instanceof Error ? error.message : String(error);
});
return result;
