/*
 * Actual React UI regression. Only the reserved 007 synthetic reconnect fixture.
 * Run once, reload the browser tab, then run this same body again. Phase two
 * requires a genuinely new reload navigation and verifies persisted Undo/Redo.
 * Leaves the synthetic recovered treatment active; never resets saved history.
 */
return await (async () => {
  const shoot = "eeaf3000-1111-4222-8333-000000000007";
  const photoId = "studio:qa-reconnect";
  const receiptKey = "foto-develop-recovery-ui:007";
  if (
    location.hostname !== "127.0.0.1" ||
    location.port !== "8085" ||
    location.pathname !== "/develop" ||
    new URL(location.href).searchParams.get("shoot") !== shoot ||
    new URL(location.href).searchParams.has("project")
  )
    throw new Error("Use only the reserved 007 synthetic Develop recovery route.");

  const module = await import("/src/lib/develop/store.ts");
  const target = { scope: "device-local", libraryId: `shoot:${shoot}` };
  const store = module.createDevelopStore(target);
  const root = () => document.querySelector(".foto-develop");
  const dialog = () => root()?.querySelector("[role=dialog]");
  const checks = [];
  const check = (name, condition) => {
    if (!condition) throw new Error(name);
    checks.push(name);
  };
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const wait = async (predicate, message, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 70));
    }
    throw new Error(message);
  };
  const button = (label) => {
    const candidates = [...(root()?.querySelectorAll("button") ?? [])];
    return (
      candidates.find((value) => value.getAttribute("aria-label") === label) ??
      candidates.find((value) => value.textContent.trim() === label)
    );
  };
  const clickable = (element) =>
    element &&
    !element.matches(":disabled") &&
    !element.closest("[inert]") &&
    element.getClientRects().length > 0;
  const click = async (label) => {
    await wait(() => clickable(button(label)), `Unavailable recovery UI control: ${label}`);
    button(label).focus();
    button(label).click();
    await tick();
  };
  const settled = () =>
    wait(
      () =>
        root()?.querySelector(".develop-save-status")?.textContent === "All edits saved" &&
        button("Export") &&
        !button("Export").disabled &&
        root()?.querySelector(".develop-image-frame img")?.naturalWidth > 0,
      "The synthetic fixture's preview or saved edits did not settle.",
    );
  const digest = async (blob) =>
    blob
      ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("")
      : null;
  const readFixture = async () => {
    const library = await store.loadLibrary();
    const photo = library.photos[0],
      doc = library.documents[photoId];
    if (
      library.photos.length !== 1 ||
      photo?.id !== photoId ||
      photo?.name !== "reconnect-qa.png" ||
      !photo.sourceAvailable ||
      !photo.sourceBlob ||
      photo.sourceBlob.size > 4 * 1024 * 1024 ||
      !doc
    )
      throw new Error("The expected single, reconnected synthetic PNG fixture is not present.");
    return { library, photo, doc };
  };
  const mediaReceipt = async (photo) => ({
    id: photo.id,
    name: photo.name,
    width: photo.width,
    height: photo.height,
    isRaw: photo.isRaw,
    sourceAvailable: photo.sourceAvailable,
    sourceDigest: photo.sourceDigest,
    sourceFileName: photo.sourceFileName,
    sourceLastModified: photo.sourceLastModified,
    createdAt: photo.createdAt,
    previewOrigin: photo.previewOrigin,
    originalHash: await digest(photo.sourceBlob),
    previewHash: await digest(photo.previewBlob),
  });
  const upload = async (payload, fileName, expectedError = null) => {
    const input = dialog()?.querySelector('.develop-recovery input[type="file"]');
    if (!input || input.matches(":disabled"))
      throw new Error("Recovery file chooser is unavailable.");
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(payload)], fileName, { type: "application/json" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    await wait(() => {
      if (!dialog()?.querySelector('.develop-recovery[aria-busy="false"]')) return false;
      return expectedError
        ? dialog().querySelector('[role="alert"]')?.textContent.includes(expectedError)
        : dialog().querySelector(".develop-recovery-filename")?.textContent === fileName;
    }, `Recovery file “${fileName}” did not produce its expected result.`);
  };
  const openRecovery = async () => {
    await click("Import recovery file");
    await wait(() => dialog()?.querySelector(".develop-recovery"), "Recovery dialog did not open.");
  };
  const createURL = URL.createObjectURL,
    anchorClick = HTMLAnchorElement.prototype.click;
  try {
    await settled();
    if (dialog()) throw new Error("Close the open dialog before testing recovery.");
    const initial = await readFixture();
    check(
      "test is bound to the single reserved synthetic photo",
      root().querySelectorAll(".develop-filmstrip-items button").length === 1 &&
        root()
          .querySelector(".develop-filmstrip-items .is-active")
          ?.textContent.includes("reconnect-qa.png"),
    );
    const previousReceipt = JSON.parse(sessionStorage.getItem(receiptKey) || "null");
    if (previousReceipt?.phase === "awaiting-reload") {
      if (previousReceipt.route !== location.href || previousReceipt.photoId !== photoId)
        throw new Error("The recovery reload receipt belongs to a different test route.");
      if (
        previousReceipt.timeOrigin === performance.timeOrigin ||
        performance.getEntriesByType("navigation")[0]?.type !== "reload"
      )
        return {
          phase: "awaiting-reload",
          passed: previousReceipt.checks.length,
          checks: previousReceipt.checks,
          next: "Reload this browser tab, then run tests/develop-recovery-ui.browser.js again. A fresh reload is required.",
        };
      check(
        "a full browser reload restores the recovered per-photo recipe",
        equal(module.currentRecipe(initial.doc), previousReceipt.recoveredRecipe) &&
          Number(root().querySelector('input[aria-label="Exposure value"]').value) ===
            previousReceipt.recoveredRecipe.exposure,
      );
      check(
        "reload preserves the original bytes, metadata, snapshots and old history IDs",
        equal(await mediaReceipt(initial.photo), previousReceipt.media) &&
          equal(initial.doc.metadata, previousReceipt.metadata) &&
          equal(initial.doc.snapshots, previousReceipt.snapshots) &&
          previousReceipt.historyIds.every((id) =>
            initial.doc.history.some((entry) => entry.id === id),
          ) &&
          initial.doc.revision === previousReceipt.restoredRevision,
      );
      await click("Undo");
      await settled();
      const undone = await readFixture();
      check(
        "real Undo after reload returns to the pre-recovery active treatment",
        equal(module.currentRecipe(undone.doc), previousReceipt.beforeRecipe) &&
          Number(root().querySelector('input[aria-label="Exposure value"]').value) ===
            previousReceipt.beforeRecipe.exposure,
      );
      await click("Redo");
      await settled();
      const redone = await readFixture();
      check(
        "real Redo restores the recovery treatment without dropping history",
        equal(module.currentRecipe(redone.doc), previousReceipt.recoveredRecipe) &&
          previousReceipt.historyIds.every((id) =>
            redone.doc.history.some((entry) => entry.id === id),
          ),
      );
      check(
        "Undo and Redo never touch the original or review metadata",
        equal(await mediaReceipt(redone.photo), previousReceipt.media) &&
          equal(redone.doc.metadata, previousReceipt.metadata) &&
          equal(redone.doc.snapshots, previousReceipt.snapshots),
      );
      const allChecks = [...previousReceipt.checks, ...checks];
      sessionStorage.setItem(
        receiptKey,
        JSON.stringify({ ...previousReceipt, phase: "complete", checks: allChecks }),
      );
      return {
        phase: "complete",
        passed: allChecks.length,
        checks: allChecks,
        note: "Actual UI download, file-change, selection, preview, restore, cancel, reload and Undo/Redo. Only the reserved synthetic PNG was edited.",
      };
    }
    if (initial.doc.history.length > 185)
      throw new Error(
        "Preserve this near-full QA history and use a fresh fixture before recovery testing.",
      );

    const recoveryPanel = [...root().querySelectorAll("summary")].find(
      (summary) => summary.textContent.trim() === "Recovery",
    );
    if (!recoveryPanel) throw new Error("The Recovery panel is missing.");
    if (!recoveryPanel.parentElement.open) recoveryPanel.click();
    await tick();
    const captured = new Map();
    let downloaded = null;
    URL.createObjectURL = function (blob) {
      const url = createURL.call(URL, blob);
      if (blob.type === "application/json") captured.set(url, blob);
      return url;
    };
    HTMLAnchorElement.prototype.click = function () {
      if (this.download === "foto-develop-recovery.json") {
        downloaded = captured.get(this.href);
        return;
      }
      return anchorClick.call(this);
    };
    await click("Save recovery file");
    await wait(() => downloaded instanceof Blob, "The real recovery download was not generated.");
    URL.createObjectURL = createURL;
    HTMLAnchorElement.prototype.click = anchorClick;
    const exported = JSON.parse(await downloaded.text());
    const verified = module.parseDevelopRecovery(JSON.stringify(exported), target);
    const baseline = await readFixture();
    const beforeRecipe = module.currentRecipe(baseline.doc);
    const media = await mediaReceipt(baseline.photo);
    check(
      "the actual recovery download contains v1 namespace and current saved edits",
      verified.version === 1 &&
        verified.namespace === store.namespace &&
        equal(module.currentRecipe(verified.documents[photoId]), beforeRecipe),
    );

    const recoveredRecipe = {
      ...beforeRecipe,
      exposure: Number(
        (beforeRecipe.exposure < 4
          ? beforeRecipe.exposure + 0.35
          : beforeRecipe.exposure - 0.35
        ).toFixed(2),
      ),
    };
    const payload = {
      ...exported,
      documents: module.developRecoveryDocuments(verified.documents, photoId, recoveredRecipe),
    };
    payload.documents[photoId].metadata = {
      rating: baseline.doc.metadata.rating === 0 ? 5 : 0,
      flag: "reject",
      colorLabel: "red",
    };
    const unmatchedId = "studio:qa-recovery-unmatched";
    payload.documents[unmatchedId] = module.createDevelopDocument(unmatchedId);
    await openRecovery();
    check(
      "opening recovery never selects or applies photos automatically",
      dialog().querySelectorAll('input[type="checkbox"]').length === 0 &&
        button("Preview selected").matches(":disabled"),
    );
    await upload(
      { ...payload, namespace: JSON.stringify([target.scope, "shoot:wrong-qa-project"]) },
      "wrong-project-recovery.json",
      "different workspace or project",
    );
    check(
      "the UI rejects a recovery from the wrong namespace",
      dialog()
        .querySelector('[role="alert"]')
        ?.textContent.includes("different workspace or project") &&
        !dialog().querySelector('input[type="checkbox"]') &&
        button("Preview selected").matches(":disabled"),
    );
    check(
      "wrong-project file reading performs no photo or edit writes",
      equal((await readFixture()).doc, baseline.doc) &&
        equal(await mediaReceipt((await readFixture()).photo), media),
    );

    await upload(payload, "synthetic-recovery.json");
    await wait(
      () => dialog()?.querySelectorAll('input[type="checkbox"]').length === 1,
      "The existing photo checklist did not load.",
    );
    const checkbox = dialog().querySelector('input[type="checkbox"]');
    check(
      "valid file reading lists only existing IDs with no default selection",
      !checkbox.checked &&
        checkbox.closest("label").textContent.includes("reconnect-qa.png") &&
        button("Preview selected").matches(":disabled"),
    );
    check(
      "unmatched recovery photos are explained and cannot be selected",
      dialog()
        .querySelector(".develop-recovery-missing")
        ?.textContent.includes("1 recovery photos are not in this project") &&
        dialog().querySelectorAll('input[type="checkbox"]').length === 1,
    );
    checkbox.click();
    await tick();
    await click("Preview selected");
    await wait(
      () => clickable(button("Restore 1 photos")),
      "Selected recovery did not produce an explicit confirmation.",
    );
    check(
      "preview describes an undoable change without saving it",
      dialog()
        .querySelector(".develop-recovery-preview")
        ?.textContent.includes("new, undoable recovery step") &&
        equal((await readFixture()).doc, baseline.doc),
    );
    await click("Cancel");
    await wait(() => !dialog(), "Recovery cancel did not close the dialog.");
    check(
      "cancel preserves the current recipe, metadata and full history",
      equal((await readFixture()).doc, baseline.doc),
    );

    await openRecovery();
    await upload(payload, "synthetic-recovery.json");
    await wait(
      () => dialog()?.querySelectorAll('input[type="checkbox"]').length === 1,
      "The reopened recovery checklist did not load.",
    );
    check(
      "reopening discards the cancelled selection and preview",
      !dialog().querySelector('input[type="checkbox"]').checked && !button("Restore 1 photos"),
    );
    await click("Select all");
    await click("Preview selected");
    await wait(
      () => clickable(button("Restore 1 photos")),
      "Explicit select-all preview did not finish.",
    );
    dialog().querySelector('input[type="checkbox"]').click();
    await tick();
    check(
      "changing the selection invalidates the old confirmation",
      !button("Restore 1 photos") && button("Preview selected").matches(":disabled"),
    );
    dialog().querySelector('input[type="checkbox"]').click();
    await tick();
    await click("Preview selected");
    await wait(
      () => clickable(button("Restore 1 photos")),
      "The final explicit recovery preview failed.",
    );
    const restoreButton = button("Restore 1 photos");
    restoreButton.click();
    restoreButton.click();
    await wait(() => !dialog(), "The confirmed recovery was not saved and adopted.");
    await settled();
    const after = await readFixture();
    check(
      "confirm saves the selected treatment exactly once despite repeat activation",
      equal(module.currentRecipe(after.doc), recoveredRecipe) &&
        after.doc.revision === baseline.doc.revision + 1,
    );
    check(
      "restoration preserves every old history entry, rating, flag and snapshot",
      equal(after.doc.history.slice(0, baseline.doc.history.length), baseline.doc.history) &&
        equal(after.doc.metadata, baseline.doc.metadata) &&
        equal(after.doc.snapshots, baseline.doc.snapshots),
    );
    check(
      "restoration neither imports unmatched IDs nor changes original or preview bytes",
      after.library.photos.length === 1 &&
        !Object.hasOwn(after.library.documents, unmatchedId) &&
        equal(await mediaReceipt(after.photo), media),
    );
    check(
      "the rendered editor adopts the recovered adjustment",
      Number(root().querySelector('input[aria-label="Exposure value"]').value) ===
        recoveredRecipe.exposure &&
        root().querySelector(".develop-save-status").textContent === "All edits saved",
    );

    sessionStorage.setItem(
      receiptKey,
      JSON.stringify({
        phase: "awaiting-reload",
        route: location.href,
        timeOrigin: performance.timeOrigin,
        photoId,
        beforeRecipe,
        recoveredRecipe,
        metadata: baseline.doc.metadata,
        snapshots: baseline.doc.snapshots,
        historyIds: baseline.doc.history.map((entry) => entry.id),
        media,
        restoredRevision: after.doc.revision,
        checks,
      }),
    );
    return {
      phase: "awaiting-reload",
      passed: checks.length,
      checks,
      next: "Reload this browser tab, then run tests/develop-recovery-ui.browser.js again to verify saved state and real Undo/Redo.",
    };
  } finally {
    URL.createObjectURL = createURL;
    HTMLAnchorElement.prototype.click = anchorClick;
    store.close();
  }
})();
