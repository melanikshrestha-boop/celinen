/* Browser-eval fixture, ONLY in a fresh isolated Chromium QA profile at 127.0.0.1:8085.
 * Set fotoIsolatedQaProfile=true and fotoImportObserverQaRole="owner" in tab A.
 * Run this body, copy its runId, then in tab B set the flag, role="observer", and
 * fotoImportObserverQaRunId to that exact ID and run the same body.
 * Wait for tab B state="watching-owner"; in A call fotoImportObserverQaControl("finish").
 * Wait for B state="awaiting-next-owner"; in A call fotoImportObserverQaControl("next").
 * B must reach passed. Reload B, set flag, role="reload", same runId and rerun.
 * Each tab uses its own module/session origin, exercising actual BroadcastChannel.
 * No customer database, native decoder, network photo upload or deletion is used.
 */
if (location.origin !== "http://127.0.0.1:8085" || globalThis.fotoIsolatedQaProfile !== true)
  throw new Error("Explicit isolated LAB profile confirmation is required.");
const role = globalThis.fotoImportObserverQaRole;
if (!["owner", "observer", "reload"].includes(role))
  throw new Error("Choose the explicit QA role.");
if (
  globalThis.fotoImportObserverQa &&
  !["passed", "failed", "closed"].includes(globalThis.fotoImportObserverQa.state)
)
  throw new Error("This fixture is already running.");
const runId = role === "owner" ? crypto.randomUUID() : globalThis.fotoImportObserverQaRunId;
if (typeof runId !== "string" || !/^[0-9a-f-]{36}$/.test(runId))
  throw new Error("Use the exact owner's synthetic runId.");
const databaseName = `foto-import-observer-qa:${runId}`;
const result = {
  state: "running",
  role,
  runId,
  databaseName,
  checks: [],
  report: null,
  error: null,
};
globalThis.fotoImportObserverQa = result;
void (async () => {
  const { createDevelopStore, DEVELOP_DATABASE_NAME } = await import("/src/lib/develop/store.ts");
  const { createDevelopImportSession, developImportSummary } =
    await import("/src/lib/develop/import-session.ts");
  const factory = {
    open(name, version) {
      if (name !== DEVELOP_DATABASE_NAME) throw new Error("Foreign database refused.");
      return indexedDB.open(databaseName, version);
    },
  };
  const options = { scope: `qa-observer:${runId}`, libraryId: `shoot:${runId}`, factory };
  const store = createDevelopStore(options);
  const check = (name, condition) => {
    if (!condition) throw new Error(name);
    result.checks.push(name);
  };
  const wait = async (check) => {
    const deadline = performance.now() + 120000;
    while (!(await check())) {
      if (performance.now() >= deadline)
        throw new Error("Timed out waiting for the other isolated QA tab.");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  const digest = async (blob) =>
    "sha256:" +
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  const report = (session) => {
    const value = session.getSnapshot();
    return {
      jobId: value.jobId,
      phase: value.phase,
      saved: value.saved,
      found: value.found,
      observing: value.observing,
      observationError: value.observationError,
      note: developImportSummary(value),
    };
  };
  if (role === "owner") {
    check("fresh isolated owner database", (await store.loadLibrary()).photos.length === 0);
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const session = createDevelopImportSession(options, {
      store,
      preparePreview: async (_, input, signal) => {
        if (input.isRaw) await gate;
        signal.throwIfAborted();
        return { ...input, width: 2, height: 2, previewBlob: new Blob(["synthetic preview"]) };
      },
    });
    const running = session.startFiles([
      new File([`saved original ${runId}`], "saved.jpg"),
      new File([`gated original ${runId}`], "pending.arw"),
    ]);
    globalThis.fotoImportObserverQaControl = async (action) => {
      if (action === "finish") {
        release();
        await running;
        result.state = "owner-complete";
      } else if (action === "next") {
        await session.startFiles([new File([`next original ${runId}`], "next.jpg")]);
        result.state = "next-owner-complete";
      } else if (action === "close") {
        session.cancel();
        release();
        await session.whenSettled();
        store.close();
        result.state = "closed";
      } else throw new Error("Unknown scoped QA action.");
      result.report = report(session);
      return result;
    };
    await wait(async () => (await store.readImportJob())?.saved === 1);
    result.report = report(session);
    result.state = "owner-waiting";
    return;
  }
  const session = createDevelopImportSession(options, { store, unloadTarget: null });
  const unsubscribe = session.subscribe(() => {
    result.report = report(session);
  });
  globalThis.fotoImportObserverQaControl = async (action) => {
    if (action !== "close")
      throw new Error("An observer cannot finish, restart or cancel another owner's import.");
    unsubscribe();
    session.stopObserving();
    store.close();
    result.state = "closed";
    return result;
  };
  try {
    await session.restore();
    check("restored as a passive report", session.getSnapshot().observing === true);
    check(
      "observer has no cancellation authority",
      session.cancel() === false && !session.isRunning(),
    );
    if (role !== "reload") {
      check(
        "live journal not mislabeled interrupted",
        session.getSnapshot().phase === "processing",
      );
      check(
        "activity explicitly unverified",
        developImportSummary(session.getSnapshot()).includes("Activity is unverified"),
      );
      const firstJob = session.getSnapshot().jobId;
      result.state = "watching-owner";
      await wait(
        () => session.getSnapshot().phase === "complete" && session.getSnapshot().saved === 2,
      );
      check(
        "remote completion followed without manual restore",
        session.getSnapshot().jobId === firstJob,
      );
      result.state = "awaiting-next-owner";
      await wait(
        () =>
          session.getSnapshot().jobId !== firstJob && session.getSnapshot().phase === "complete",
      );
      check("next remote job followed", session.getSnapshot().saved === 1);
    }
    const library = await store.loadLibrary();
    check("three exact original records preserved", library.photos.length === 3);
    for (const photo of library.photos)
      check(`original SHA identity: ${photo.name}`, (await digest(photo.sourceBlob)) === photo.id);
    check(
      "unknown observer timing not invented",
      Object.values(session.getSnapshot().timing).every((value) => value === null),
    );
    check("no status read failure", session.getSnapshot().observationError === null);
    result.report = report(session);
    result.state = "passed";
  } finally {
    unsubscribe();
    session.stopObserving();
    store.close();
  }
})().catch((error) => {
  result.state = "failed";
  result.error = error instanceof Error ? error.message : String(error);
});
return result;
