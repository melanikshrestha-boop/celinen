/* Async browser-eval body; run only on a fresh local QA route:
 * /shoots/eeaf3000-1111-4222-8333-1<11 random lowercase hex digits>/develop
 * Uses generated JPEGs, real React handlers, native JPEG previews, and real IDB.
 * No uploads, customer photos, fake native responses, or database clearing.
 * Finally navigates to Shoots, removes only this run's exact photo/document keys,
 * and verifies zero remaining records in its unique QA library.
 * Returns immediately; poll globalThis.fotoImportLifecycle for stages/checks/result.
 * Progress survives reload in sessionStorage at the returned storageKey. This is
 * evidence, not automatic test resumption: a reload can leave a running record.
 */
if (globalThis.fotoImportLifecycle?.state === "running")
  throw new Error("An import-lifecycle fixture is already running; inspect its status first.");
const lifecycle = {
  state: "running",
  stage: "validate-route",
  runId: crypto.randomUUID(),
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  finishedAt: null,
  initialPath: location.pathname,
  waitingFor: null,
  checks: [],
  stages: [],
  result: null,
  error: null,
  failedStage: null,
  failedWait: null,
  cleanup: null,
  cleanupError: null,
  persistenceError: null,
  storageKey: null,
};
lifecycle.storageKey = `foto:qa:import-lifecycle:${lifecycle.runId}`;
globalThis.fotoImportLifecycle = lifecycle;
function persistLifecycle() {
  if (
    location.origin !== "http://127.0.0.1:8085" ||
    !/^eeaf3000-1111-4222-8333-1[0-9a-f]{11}$/.test(lifecycle.shoot ?? "")
  )
    return;
  try {
    // Only test IDs, checks, UI summaries and cleanup receipts, never original bytes.
    sessionStorage.setItem(lifecycle.storageKey, JSON.stringify(lifecycle));
  } catch (error) {
    lifecycle.persistenceError = error instanceof Error ? error.message : String(error);
  }
}
const stage = (name) => {
  lifecycle.stage = name;
  lifecycle.updatedAt = new Date().toISOString();
  lifecycle.stages.push({ name, at: lifecycle.updatedAt, checks: lifecycle.checks.length });
  persistLifecycle();
};
void (async () => {
  const match = location.pathname.match(
    /^\/shoots\/(eeaf3000-1111-4222-8333-1[0-9a-f]{11})\/develop$/,
  );
  if (location.origin !== "http://127.0.0.1:8085" || !match || location.search)
    throw new Error("Use a fresh reserved 1xxxxxxxxxxx import-lifecycle QA route without a query.");
  const shoot = match[1];
  lifecycle.shoot = shoot;
  stage("load-local-modules");
  const { isLocalSingleUserMode } = await import("/src/lib/app-mode.ts");
  if (!isLocalSingleUserMode)
    throw new Error("This fixture is only for the isolated local lab identity.");
  const module = await import("/src/lib/develop/store.ts");
  const scope = "device-local",
    libraryId = `shoot:${shoot}`;
  const store = module.createDevelopStore({ scope, libraryId });
  lifecycle.namespace = store.namespace;
  lifecycle.photoIds = [];
  lifecycle.ownsFixtures = false;
  persistLifecycle();
  const originalFetch = window.fetch;
  const ownPhotoIds = new Set();
  const checks = lifecycle.checks;
  const root = () => document.querySelector(".foto-develop");
  const tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const check = (name, condition) => {
    observeUi();
    if (!condition) throw new Error(name);
    checks.push(name);
    lifecycle.updatedAt = new Date().toISOString();
    persistLifecycle();
  };
  const wait = async (predicate, message, duration = 30000) => {
    lifecycle.waitingFor = message;
    persistLifecycle();
    const until = Date.now() + duration;
    while (Date.now() < until) {
      observeUi();
      if (await predicate()) {
        lifecycle.waitingFor = null;
        persistLifecycle();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    throw new Error(message);
  };
  const button = (label) =>
    [...(root()?.querySelectorAll("button") ?? [])].find(
      (element) =>
        element.getAttribute("aria-label") === label || element.textContent.trim() === label,
    );
  const saveStatus = () => root()?.querySelector(".develop-save-status")?.textContent;
  const range = () => root()?.querySelector('input[type="range"][aria-label="Exposure"]');
  const exposure = () => Number(root()?.querySelector('input[aria-label="Exposure value"]')?.value);
  const currentImage = () => root()?.querySelector('.develop-image-frame img[draggable="false"]');
  const status = () => root()?.querySelector('[role="status"]')?.textContent ?? "";
  function observeUi() {
    const ui = {
      path: location.pathname,
      status: status(),
      saveStatus: saveStatus() ?? null,
      exposure: Number.isFinite(exposure()) ? exposure() : null,
      stopImport: Boolean(button("Stop import")),
      exportDisabled: button("Export")?.disabled ?? null,
      photoTiles: root()?.querySelectorAll(".develop-filmstrip-items button").length ?? 0,
    };
    if (JSON.stringify(ui) !== JSON.stringify(lifecycle.ui)) {
      lifecycle.ui = ui;
      lifecycle.updatedAt = new Date().toISOString();
      persistLifecycle();
    }
  }
  const idle = () => !button("Stop import") && !root()?.querySelector(".develop-workspace")?.inert;
  const ready = () =>
    idle() &&
    saveStatus() === "All edits saved" &&
    button("Export") &&
    !button("Export").disabled &&
    currentImage()?.complete &&
    currentImage().naturalWidth > 0;
  const digest = async (blob) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  const serialized = (value) => JSON.stringify(value);
  let ownsFixtures = false,
    holdReject = null,
    pendingFolderSuccess = null;
  let failure = null,
    cleanup = null,
    result = null;

  async function generatedFile(index) {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 320;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The QA browser has no canvas.");
    context.fillStyle = ["#344f60", "#755736", "#39654e"][index];
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = ["#d3bba3", "#adced4", "#dbc88c"][index];
    context.fillRect(60 + index * 43, 50, 240, 210);
    context.fillStyle = "#101010";
    context.font = "18px sans-serif";
    context.fillText(`Synthetic import QA ${shoot.slice(-12)} / ${index}`, 12, 304);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("Could not create the synthetic JPEG.");
    canvas.width = canvas.height = 0;
    return new File([blob], `qa-import-${shoot.slice(-12)}-${index}.jpg`, {
      type: "image/jpeg",
      lastModified: 100 + index,
    });
  }
  async function choose(files) {
    const chooser = root()?.querySelector('input[type="file"][aria-label="Import photos"]');
    if (!chooser || button("Import")?.disabled) throw new Error("Import chooser is unavailable.");
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    chooser.files = transfer.files;
    chooser.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
  }
  async function stageDraft(value) {
    const basic = [...root().querySelectorAll("details.develop-panel")].find(
      (panel) => panel.querySelector("summary")?.textContent.trim() === "Basic",
    );
    if (basic && !basic.open) basic.open = true;
    const input = range();
    if (!input || input.matches(":disabled") || input.closest("[inert]"))
      throw new Error("Exposure must be editable before staging a draft.");
    // Real range onChange, with no focus, blur, keyup, or pointerup to commit it.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
      input,
      String(value),
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    check(
      `exposure ${value} is an actual uncommitted UI draft`,
      exposure() === value && saveStatus() === "Unsaved adjustment",
    );
  }
  async function commitExposure(value) {
    await stageDraft(value);
    range().dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
    await wait(
      ready,
      "The subsequent real edit did not save/render; inspect for a stale revision conflict.",
    );
  }
  function dropFolder(readEntries, name) {
    const transfer = new DataTransfer();
    const placeholder = new File(["synthetic directory handle"], name);
    transfer.items.add(placeholder);
    const trace = {
      name,
      entryCaptures: 0,
      fileCaptures: 0,
      readerCreations: 0,
      readerCalls: 0,
      eventUsesFixtureHandles: false,
    };
    lifecycle.folderDrop = trace;
    const entry = {
      isDirectory: true,
      isFile: false,
      name,
      fullPath: `/${name}`,
      createReader: () => {
        trace.readerCreations++;
        persistLifecycle();
        return {
          readEntries: (...args) => {
            trace.readerCalls++;
            persistLifecycle();
            return readEntries(...args);
          },
        };
      },
    };
    const captureEntry = () => {
      trace.entryCaptures++;
      persistLifecycle();
      return entry;
    };
    // Chromium exposes different wrappers for items.add() and items[index].
    // Expando methods on the former do not survive captureDrop's Array.from.
    // This test drives the real React drop handler with explicit synthetic entry
    // handles; it does not claim to exercise an OS-originated directory gesture.
    const handles = {
      files: [placeholder],
      types: ["Files"],
      items: [
        {
          kind: "file",
          type: "",
          getAsEntry: captureEntry,
          webkitGetAsEntry: captureEntry,
          getAsFile: () => {
            trace.fileCaptures++;
            persistLifecycle();
            return placeholder;
          },
        },
      ],
    };
    const event = new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    });
    Object.defineProperty(event, "dataTransfer", { value: handles });
    trace.eventUsesFixtureHandles = event.dataTransfer === handles;
    persistLifecycle();
    if (!trace.eventUsesFixtureHandles)
      throw new Error("The synthetic folder handles were not attached to the test event.");
    root().dispatchEvent(event);
    if (trace.entryCaptures !== 1 || trace.readerCalls !== 1)
      throw new Error("The actual drop handler did not capture the synthetic directory reader.");
  }
  function assertHistory(before, after, value, name) {
    check(
      `${name}: current saved recipe is exact`,
      serialized(module.currentRecipe(after)) ===
        serialized({ ...module.currentRecipe(before), exposure: value }),
    );
    check(
      `${name}: exactly one revision and history entry was added`,
      after.revision === before.revision + 1 &&
        after.history.length === before.history.length + 1 &&
        after.cursor === after.history.length - 1,
    );
    check(
      `${name}: previous history and metadata are unchanged`,
      before.history.every(
        (step, index) => serialized(after.history[index]) === serialized(step),
      ) && serialized(after.metadata) === serialized(before.metadata),
    );
    check(
      `${name}: displayed recipe agrees with persistent current recipe`,
      exposure() === value && saveStatus() === "All edits saved",
    );
  }
  async function removeExactFixtures() {
    if (!ownsFixtures) return { complete: true, deletedRecords: 0, remainingRecords: 0 };
    if (!/^eeaf3000-1111-4222-8333-1[0-9a-f]{11}$/.test(shoot))
      throw new Error("Refusing cleanup outside the unique import-lifecycle QA namespace.");
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(module.DEVELOP_DATABASE_NAME);
      let aborted = false;
      request.onupgradeneeded = () => {
        aborted = true;
        request.transaction.abort();
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          request.error ??
            new Error(
              aborted
                ? "QA database was removed before cleanup."
                : "QA cleanup could not open storage.",
            ),
        );
    });
    let deletedRecords = 0;
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["photos", "documents"], "readwrite");
        let problem = null;
        tx.oncomplete = resolve;
        tx.onabort = () =>
          reject(problem ?? tx.error ?? new Error("QA cleanup transaction aborted."));
        for (const name of ["photos", "documents"]) {
          const table = tx.objectStore(name);
          const request = table.index("namespace").getAllKeys(store.namespace);
          request.onsuccess = () => {
            try {
              for (const key of request.result) {
                const parts = typeof key === "string" ? JSON.parse(key) : null;
                if (
                  !Array.isArray(parts) ||
                  parts.length !== 3 ||
                  parts[0] !== scope ||
                  parts[1] !== libraryId ||
                  !ownPhotoIds.has(parts[2]) ||
                  JSON.stringify(parts) !== key
                )
                  throw new Error(
                    "Refusing to remove an unexpected record from this QA namespace.",
                  );
                table.delete(key);
                deletedRecords++;
              }
            } catch (error) {
              problem = error;
              tx.abort();
            }
          };
        }
      });
      const remainingRecords = await new Promise((resolve, reject) => {
        const tx = db.transaction(["photos", "documents"], "readonly");
        let count = 0;
        tx.oncomplete = () => resolve(count);
        tx.onabort = () => reject(tx.error ?? new Error("QA cleanup readback failed."));
        for (const name of ["photos", "documents"]) {
          const request = tx.objectStore(name).index("namespace").count(store.namespace);
          request.onsuccess = () => {
            count += request.result;
          };
        }
      });
      if (remainingRecords !== 0)
        throw new Error("Import-lifecycle cleanup left QA records behind.");
      return { complete: true, deletedRecords, remainingRecords };
    } finally {
      db.close();
    }
  }

  try {
    stage("wait-for-empty-editor");
    await wait(
      () => root() && button("Import") && !button("Import").disabled,
      "The empty QA editor did not mount.",
    );
    const exitLink = document.querySelector('.foto-primary-nav a[href="/shoots"]');
    if (!exitLink)
      throw new Error("The fixture needs the real Shoots navigation to unmount before cleanup.");
    const initial = await store.loadLibrary();
    if (
      initial.photos.length ||
      Object.keys(initial.documents).length ||
      root().querySelector(".develop-filmstrip-items")
    )
      throw new Error(
        "QA library is not empty; choose a new random reserved ID instead of replacing it.",
      );
    ownsFixtures = true;
    lifecycle.ownsFixtures = true;
    stage("generate-synthetic-jpegs");
    const files = await Promise.all([0, 1, 2].map(generatedFile));
    const identified = await Promise.all(
      files.map((file) => module.developPhotoFromFile(file, null)),
    );
    for (const photo of identified) ownPhotoIds.add(photo.id);
    lifecycle.photoIds = [...ownPhotoIds];
    persistLifecycle();
    const [baselineId, firstId, secondId] = identified.map((photo) => photo.id);
    stage("baseline-import");
    await choose([files[0]]);
    await wait(ready, "The real native baseline JPEG import did not finish.");
    let saved = await store.loadLibrary();
    check(
      "baseline JPEG was imported by the real UI into the exact QA library",
      saved.photos.length === 1 &&
        saved.photos[0].id === baselineId &&
        saved.photos[0].sourceBlob?.size === files[0].size,
    );
    const originalBytesHash = await digest(saved.photos[0].sourceBlob);
    const firstDocument = saved.documents[baselineId];

    stage("dirty-draft-before-enumeration");
    await stageDraft(0.75);
    check(
      "draft staging does not itself write history",
      serialized((await store.loadLibrary()).documents[baselineId]) === serialized(firstDocument),
    );
    let readerStarted = false;
    stage("cancel-delayed-folder-enumeration");
    dropFolder((success) => {
      readerStarted = true;
      pendingFolderSuccess = success;
    }, "qa-delayed-folder");
    await wait(
      () => readerStarted && button("Stop import"),
      "Delayed folder reading did not enter cancellable import state.",
    );
    check("folder enumeration keeps the uncommitted draft in view", exposure() === 0.75);
    check(
      "folder enumeration locks background edits and export",
      root().querySelector(".develop-workspace").inert && button("Export").disabled,
    );
    button("Stop import").click();
    await wait(
      () => idle() && saveStatus() === "All edits saved" && status().includes("Import stopped"),
      "Stopping enumeration did not flush and reopen the saved draft.",
    );
    saved = await store.loadLibrary();
    assertHistory(firstDocument, saved.documents[baselineId], 0.75, "cancelled enumeration");
    check("stopping enumeration imports no folder placeholder", saved.photos.length === 1);
    // A late browser directory callback must not resume the aborted import.
    pendingFolderSuccess([]);
    pendingFolderSuccess = null;
    await tick();
    check(
      "late folder completion leaves the exact committed document untouched",
      serialized((await store.loadLibrary()).documents[baselineId]) ===
        serialized(saved.documents[baselineId]),
    );
    const afterCancel = saved.documents[baselineId];
    stage("edit-after-enumeration-cancel");
    await wait(ready, "The retained cancelled draft did not render.");
    await commitExposure(1);
    saved = await store.loadLibrary();
    assertHistory(afterCancel, saved.documents[baselineId], 1, "edit after cancellation");
    check(
      "subsequent edit has no CAS/save error",
      !root().querySelector(".develop-status.is-error") &&
        !root().textContent.includes("changed in another tab"),
    );

    const beforeReaderFailure = saved.documents[baselineId];
    stage("unreadable-folder-warning");
    await stageDraft(1.25);
    let failedReaderCalls = 0;
    dropFolder(() => {
      failedReaderCalls++;
      throw new Error("Synthetic unreadable folder");
    }, "qa-unreadable-folder");
    await wait(
      () =>
        failedReaderCalls === 1 &&
        idle() &&
        saveStatus() === "All edits saved" &&
        status().includes("folder warnings"),
      "Unreadable folder did not finish as a visible warning.",
    );
    saved = await store.loadLibrary();
    assertHistory(beforeReaderFailure, saved.documents[baselineId], 1.25, "unreadable enumeration");
    check(
      "reader failure is reported without an invented imported photo",
      saved.photos.length === 1 &&
        root()
          .querySelector(".develop-import-report")
          ?.textContent.includes("qa-unreadable-folder"),
    );
    const baselineDocument = saved.documents[baselineId];
    await wait(ready, "The reader-warning draft did not render.");

    const delayedHash = await digest(files[2]);
    stage("install-second-source-delay");
    let gateEntered = false,
      gateAborted = false,
      gateCount = 0;
    window.fetch = async function (resource, init) {
      const href = typeof resource === "string" ? resource : (resource?.url ?? String(resource));
      const address = new URL(href, location.href);
      if (
        location.pathname === `/shoots/${shoot}/develop` &&
        address.origin === location.origin &&
        address.pathname === "/__develop/render" &&
        init?.body instanceof Blob
      ) {
        const prefix = await init.body.slice(0, 4).arrayBuffer();
        if (prefix.byteLength === 4) {
          const length = new DataView(prefix).getUint32(0, false);
          if (
            length > 0 &&
            length < 65536 &&
            length + 4 < init.body.size &&
            (await digest(init.body.slice(length + 4))) === delayedHash
          ) {
            gateCount++;
            gateEntered = true;
            lifecycle.networkGate = { entered: gateCount, aborted: false, fileName: files[2].name };
            persistLifecycle();
            await new Promise((resolve, reject) => {
              const signal = init.signal;
              const finish = (error) => {
                clearTimeout(timer);
                signal?.removeEventListener("abort", abort);
                holdReject = null;
                if (error) reject(error);
                else resolve();
              };
              const abort = () => {
                gateAborted = true;
                lifecycle.networkGate.aborted = true;
                persistLifecycle();
                finish(signal.reason ?? new DOMException("QA import stopped", "AbortError"));
              };
              const timer = setTimeout(
                () => finish(new Error("The QA gate timed out; Stop import was not received.")),
                30000,
              );
              holdReject = (error) => finish(error);
              signal?.addEventListener("abort", abort, { once: true });
              if (signal?.aborted) abort();
            });
          }
        }
      }
      return originalFetch.call(this, resource, init);
    };
    stage("progressive-two-photo-import");
    await choose([files[1], files[2]]);
    await wait(
      () => gateEntered && button("Stop import"),
      "Second source did not reach its deliberate QA processing gate.",
    );
    stage("verify-first-preview-while-second-is-held");
    await wait(() => {
      const tile = [...root().querySelectorAll(".develop-filmstrip-items button")].find((element) =>
        element.textContent.includes(files[1].name),
      );
      const thumbnail = tile?.querySelector("img");
      return (
        tile?.classList.contains("is-active") &&
        thumbnail?.complete &&
        thumbnail.naturalWidth > 0 &&
        currentImage()?.complete &&
        currentImage().naturalWidth > 0
      );
    }, "First committed thumbnail/current preview was not visible before later import work finished.");
    check(
      "first committed preview is visible while import is still busy",
      Boolean(button("Stop import")) && status().includes(files[2].name),
    );
    check(
      "busy import preview is identified and cannot be exported or edited",
      root().textContent.includes("Import preview") &&
        button("Export").disabled &&
        range().matches(":disabled"),
    );
    saved = await store.loadLibrary();
    const firstImportedDocument = saved.documents[firstId];
    check(
      "first progressive receipt is already durable before Stop",
      saved.photos.length === 2 &&
        saved.photos.some(
          (photo) => photo.id === firstId && photo.sourceBlob?.size && photo.previewBlob?.size,
        ) &&
        firstImportedDocument &&
        !saved.documents[secondId],
    );
    check(
      "progressive adoption preserves the previously edited photo document exactly",
      serialized(saved.documents[baselineId]) === serialized(baselineDocument),
    );
    stage("stop-after-first-durable-photo");
    button("Stop import").click();
    await wait(
      () => idle() && status().includes("Import stopped") && saveStatus() === "All edits saved",
      "Stopping the second source did not retain the first durable receipt.",
    );
    window.fetch = originalFetch;
    check(
      "only the exact second synthetic request was delayed and aborted",
      gateCount === 1 && gateAborted,
    );
    saved = await store.loadLibrary();
    const committedPhoto = saved.photos.find((photo) => photo.id === firstId);
    check(
      "Stop retains the first original's exact source bytes",
      committedPhoto && (await digest(committedPhoto.sourceBlob)) === (await digest(files[1])),
    );
    check(
      "Stop retains the first committed history and creates no second photo/document",
      saved.photos.length === 2 &&
        serialized(saved.documents[firstId]) === serialized(firstImportedDocument) &&
        !saved.photos.some((photo) => photo.id === secondId) &&
        !saved.documents[secondId],
    );
    check(
      "baseline original bytes and edits remain unchanged across the stopped batch",
      (await digest(saved.photos.find((photo) => photo.id === baselineId).sourceBlob)) ===
        originalBytesHash &&
        serialized(saved.documents[baselineId]) === serialized(baselineDocument),
    );
    stage("edit-after-progressive-stop");
    await wait(ready, "The first imported photo did not become editable after Stop.");
    await commitExposure(-0.5);
    saved = await store.loadLibrary();
    assertHistory(
      firstImportedDocument,
      saved.documents[firstId],
      -0.5,
      "edit after progressive Stop",
    );
    check(
      "post-stop edit retains both originals and previous photo history",
      saved.photos.length === 2 &&
        serialized(saved.documents[baselineId]) === serialized(baselineDocument) &&
        (await digest(saved.photos.find((photo) => photo.id === firstId).sourceBlob)) ===
          (await digest(files[1])),
    );
    result = {
      passed: checks.length,
      checks,
      shoot,
      note: "Actual UI/native JPEG/IDB regression with an intentionally gated second request, not a throughput benchmark. No customer photos or native response substitution.",
    };
  } catch (error) {
    failure = error;
    lifecycle.failedStage = lifecycle.stage;
    lifecycle.failedWait = lifecycle.waitingFor;
    lifecycle.error = error instanceof Error ? error.message : String(error);
  } finally {
    stage("cleanup-stop-pending-work");
    window.fetch = originalFetch;
    try {
      if (ownsFixtures) {
        button("Stop import")?.click();
        holdReject?.(new DOMException("QA fixture finished", "AbortError"));
        holdReject = null;
        pendingFolderSuccess?.([]);
        pendingFolderSuccess = null;
        await wait(idle, "QA import did not stop before fixture cleanup.");
        if (saveStatus() === "Unsaved adjustment" && range()) {
          range().dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
          await wait(
            () => saveStatus() === "All edits saved",
            "QA draft did not settle before cleanup.",
          );
        }
        // Unmount the actual editor so no delayed save can recreate cleaned records.
        stage("cleanup-unmount-editor");
        const exitLink = document.querySelector('.foto-primary-nav a[href="/shoots"]');
        if (!exitLink) throw new Error("Cannot safely unmount the QA editor before cleanup.");
        exitLink.click();
        await wait(
          () => !root(),
          "QA editor remained mounted; refusing cleanup with possible pending writes.",
        );
      }
      store.close();
      stage("cleanup-exact-qa-storage");
      cleanup = await removeExactFixtures();
      lifecycle.cleanup = cleanup;
      persistLifecycle();
    } catch (error) {
      lifecycle.cleanupError = error instanceof Error ? error.message : String(error);
      failure = new Error(
        `${failure ? `${failure.message}\n` : ""}Cleanup: ${error.message} (QA namespace ${store.namespace})`,
      );
    } finally {
      store.close();
    }
  }
  if (failure)
    throw new Error(
      `${failure.message}\nCleanup: ${JSON.stringify(cleanup)}\nCompleted checks: ${checks.length}`,
    );
  return { ...result, cleanup };
})().then(
  (result) => {
    lifecycle.result = result;
    lifecycle.cleanup = result.cleanup;
    lifecycle.state = "passed";
    lifecycle.waitingFor = null;
    lifecycle.finishedAt = new Date().toISOString();
    stage("complete");
  },
  (error) => {
    lifecycle.failedStage ??= lifecycle.stage;
    lifecycle.failedWait ??= lifecycle.waitingFor;
    lifecycle.error = error instanceof Error ? error.message : String(error);
    lifecycle.state = "failed";
    lifecycle.waitingFor = null;
    lifecycle.finishedAt = new Date().toISOString();
    stage("failed");
  },
);
return {
  started: true,
  runId: lifecycle.runId,
  status: "globalThis.fotoImportLifecycle",
  storageKey: lifecycle.storageKey,
};
