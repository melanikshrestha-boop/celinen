// Browser-eval body. Real recovery commit, then a single failed post-commit read.
// Restricted to the reconnected synthetic 007 fixture; no customer data or downloads.
return await (async () => {
  const shoot = "eeaf3000-1111-4222-8333-000000000007";
  const photoId = "studio:qa-reconnect";
  if (location.hostname !== "127.0.0.1" || location.port !== "8085" ||
      location.pathname !== "/develop" || new URL(location.href).searchParams.get("shoot") !== shoot)
    throw new Error("Use only the reserved reconnect QA route for post-commit recovery checks.");
  const module = await import("/src/lib/develop/store.ts");
  const store = module.createDevelopStore({ scope: "device-local", libraryId: `shoot:${shoot}` });
  const root = () => document.querySelector(".foto-develop");
  const checks = [], requests = [], cleanupErrors = [];
  const check = (name, condition) => { if (!condition) throw new Error(name); checks.push(name); };
  const tick = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const wait = async (predicate, message) => {
    const limit = Date.now() + 30000;
    while (Date.now() < limit) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 70));
    }
    throw new Error(message);
  };
  const button = (label, container = root()) => {
    const buttons = [...(container?.querySelectorAll("button") ?? [])];
    return buttons.find((b) => b.getAttribute("aria-label") === label) ??
      buttons.find((b) => b.textContent.trim() === label);
  };
  const click = async (label, container = root()) => {
    await wait(() => {
      const b = button(label, container);
      return b && !b.matches(":disabled") && !b.closest("[inert]") && b.getClientRects().length > 0;
    }, `Unavailable control: ${label}`);
    button(label, container).click(); await tick();
  };
  const settled = () => wait(() => root()?.querySelector(".develop-save-status")?.textContent === "All edits saved" &&
    button("Export") && !button("Export").disabled && root()?.querySelector(".develop-image-frame img")?.naturalWidth > 0,
  "The editor did not settle after a recovered edit.");
  const exposure = async (value) => {
    const summary = [...root().querySelectorAll("summary")].find((s) => s.textContent.trim() === "Basic");
    if (summary && !summary.parentElement.open) { summary.click(); await tick(); }
    const input = root().querySelector("input[aria-label='Exposure value']");
    if (!input || input.matches(":disabled") || input.closest("[inert]")) throw new Error("Exposure is not editable.");
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick(); input.blur(); await tick(); await settled();
  };
  const snapshot = async () => {
    const library = await store.loadLibrary(), photo = library.photos[0], doc = library.documents[photoId];
    if (library.photos.length !== 1 || photo?.id !== photoId || photo?.name !== "reconnect-qa.png" ||
        !photo.sourceAvailable || !doc) throw new Error("The guarded synthetic fixture is missing.");
    return { library, photo, doc };
  };
  const originalPut = IDBObjectStore.prototype.put;
  const originalGetAll = IDBIndex.prototype.getAll;
  const originalFetch = window.fetch;
  let baseline = null, targetExposure = null, began = false, result = null, failure = null;
  let writeObserved = false, transactionCommitted = false, failNextRead = false, failedReads = 0;
  try {
    await settled();
    if (root().querySelector("[role=dialog]")) throw new Error("Close the current dialog before this test.");
    baseline = await snapshot();
    if (baseline.doc.history.length > 190) throw new Error("Preserve the near-cap QA history; use a fresh fixture.");
    const recipe = module.currentRecipe(baseline.doc);
    targetExposure = recipe.exposure <= 3 ? recipe.exposure + 0.75 : recipe.exposure - 0.75;
    const recoveredDoc = module.pushHistory(baseline.doc, { ...recipe, exposure: targetExposure }, "QA post-commit refresh");
    const file = new File([JSON.stringify({ version: 1, namespace: store.namespace,
      documents: { [photoId]: recoveredDoc } })], "recovery-refresh-qa.json", { type: "application/json" });
    const summary = [...root().querySelectorAll("summary")].find((s) => s.textContent.trim() === "Recovery");
    if (!summary) throw new Error("Recovery panel is missing.");
    if (!summary.parentElement.open) summary.click();
    await tick(); await click("Import recovery file");
    await wait(() => root().querySelector(".develop-recovery input[type=file]"), "Recovery dialog did not open.");
    const transfer = new DataTransfer(); transfer.items.add(file);
    const input = root().querySelector(".develop-recovery input[type=file]");
    input.files = transfer.files; input.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(() => root().querySelector(".develop-recovery-photo input[type=checkbox]"), "Recovery file did not load.");
    await click("Select all"); await click("Preview selected");
    await wait(() => button("Restore 1 photos"), "Recovery preview did not become confirmable.");

    // Observe a genuine write and wait for its transaction completion before
    // arming the fault. loadLibrary uses an IDBIndex, not objectStore.getAll.
    IDBObjectStore.prototype.put = function (record, ...args) {
      const request = originalPut.call(this, record, ...args);
      if (this.name === "documents" && this.transaction.db.name === module.DEVELOP_DATABASE_NAME &&
          record?.namespace === store.namespace && record?.value?.photoId === photoId &&
          record.value.history.at(-1)?.label === "Recovered adjustment" &&
          module.currentRecipe(record.value).exposure === targetExposure) {
        writeObserved = true;
        this.transaction.addEventListener("complete", () => {
          transactionCommitted = true; failNextRead = true;
        }, { once: true });
      }
      return request;
    };
    IDBIndex.prototype.getAll = function (query, ...args) {
      if (failNextRead && this.objectStore.transaction.db.name === module.DEVELOP_DATABASE_NAME &&
          this.objectStore.name === "photos" && this.name === "namespace" && query === store.namespace) {
        failNextRead = false; failedReads++;
        throw new DOMException("Injected post-commit refresh failure", "UnknownError");
      }
      return originalGetAll.call(this, query, ...args);
    };
    window.fetch = async function (resource, init) {
      const address = typeof resource === "string" ? resource : resource?.url ?? String(resource);
      if (address.endsWith("/__develop/render") && init?.body instanceof Blob) {
        const size = new DataView(await init.body.slice(0, 4).arrayBuffer()).getUint32(0, false);
        requests.push(JSON.parse(await init.body.slice(4, size + 4).text()));
      }
      return originalFetch.call(this, resource, init);
    };
    began = true;
    await click("Restore 1 photos");
    await wait(() => root().querySelector(".develop-recovery-error")?.textContent.includes("Injected post-commit refresh failure"),
      "The post-commit refresh failure was not disclosed.");
    IDBObjectStore.prototype.put = originalPut;
    IDBIndex.prototype.getAll = originalGetAll;
    check("recovery truly commits before exactly one read failure", writeObserved && transactionCommitted && failedReads === 1);
    const committed = await snapshot();
    check("recovered treatment and revision are durably stored", module.currentRecipe(committed.doc).exposure === targetExposure && committed.doc.revision === baseline.doc.revision + 1);
    check("committed receipt updates parent controls before refresh succeeds", Number(root().querySelector("input[aria-label='Exposure value']").value) === targetExposure);
    check("refresh failure provides Done and a retry without restoring twice", Boolean(button("Done")) && Boolean(button("Reload saved edits")) && !button("Restore 1 photos"));
    await click("Done"); await settled();
    check("closing the failed refresh keeps the recovered editor treatment", !root().querySelector("[role=dialog]") && Number(root().querySelector("input[aria-label='Exposure value']").value) === targetExposure);
    await click("Export"); await click("Preview export");
    await wait(() => { const image = root().querySelector(".develop-export-proof img");
      return image?.complete && image.naturalWidth > 0 && !button("Export JPEG")?.disabled;
    }, "The export proof of the recovered treatment did not render.");
    check("export proof renders the committed recovery, never stale settings", requests.at(-1)?.settings.exposure === targetExposure && requests.at(-1)?.edge === 4096);
    await click("Cancel", root().querySelector("[role=dialog]"));
    const nextExposure = targetExposure + 0.25;
    await exposure(nextExposure);
    const edited = await snapshot();
    check("the next real edit saves against the adopted recovery revision", module.currentRecipe(edited.doc).exposure === nextExposure && edited.doc.revision === committed.doc.revision + 1 && !root().textContent.includes("changed in another tab"));
    check("recovery and later edit preserve source, metadata and existing history", edited.photo.sourceDigest === baseline.photo.sourceDigest && JSON.stringify(edited.doc.metadata) === JSON.stringify(baseline.doc.metadata) && baseline.doc.history.every((old) => edited.doc.history.some((h) => h.id === old.id)));
    result = { passed: checks.length, checks, note: "Real IndexedDB recovery commit, one injected subsequent read failure, actual native export proof and subsequent React save. Original exposure restored during cleanup." };
  } catch (error) { failure = error; }
  finally {
    IDBObjectStore.prototype.put = originalPut;
    IDBIndex.prototype.getAll = originalGetAll;
    window.fetch = originalFetch;
    try {
      const dialog = root()?.querySelector("[role=dialog]");
      if (dialog) {
        const close = button("Done", dialog) ?? button("Cancel", dialog);
        if (close && !close.matches(":disabled")) { close.click(); await tick(); }
      }
      if (began && baseline) await exposure(module.currentRecipe(baseline.doc).exposure);
    } catch (error) { cleanupErrors.push(error.message); }
    finally { store.close(); }
  }
  if (failure) throw new Error(`Recovery refresh check failed after ${checks.length} passed checks: ${failure.message}${cleanupErrors.length ? ` | Cleanup also failed: ${cleanupErrors.join("; ")}` : " | Cleanup completed."}`);
  if (cleanupErrors.length) throw new Error(`All ${checks.length} checks passed but cleanup failed: ${cleanupErrors.join("; ")}`);
  return result;
})()
