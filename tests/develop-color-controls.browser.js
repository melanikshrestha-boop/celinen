// Detached real-UI HSL sweep. Run only on reserved public fixture 097, selected Sony A6000.
// Poll globalThis.fotoColorControlsQA; no fixtures are created and no customer scope is allowed.
return (() => {
  const shoot = "eeaf3000-1111-4222-8333-000000000097";
  const route = `/shoots/${shoot}/develop`;
  if (location.origin !== "http://127.0.0.1:8085" || location.pathname !== route)
    throw new Error("Color sweep requires the exact reserved 097 public-fixture route");
  if (
    globalThis.fotoColorControlsQA?.state === "running" ||
    globalThis.fotoControlSweepQA?.state === "running"
  )
    throw new Error("A control sweep is already running");
  const result = {
    state: "running",
    checks: [],
    cases: [],
    startedAt: new Date().toISOString(),
    scope: "24 Color Mixer cases only; no Color Grading coverage is claimed",
  };
  globalThis.fotoColorControlsQA = result;
  void (async () => {
    const root = document.querySelector(".foto-develop");
    const create = URL.createObjectURL,
      revoke = URL.revokeObjectURL,
      blobs = new Map();
    let store, initial, photo, currentRecipe, baselineSettings, baselineHash;
    const originalHashes = new Map();
    let instrumented = false;
    const check = (label, value) => {
      if (!value) throw new Error(label);
      result.checks.push(label);
    };
    const button = (label, within = root) =>
      [...within.querySelectorAll("button")].find(
        (node) => node.getAttribute("aria-label") === label || node.textContent.trim() === label,
      );
    const image = () => root.querySelector('.develop-image-frame img[alt="Developed photo"]');
    const selected = () =>
      root.querySelector(".develop-filmstrip-items button.is-active")?.dataset.photoId;
    const assertScope = () => {
      if (
        location.origin !== "http://127.0.0.1:8085" ||
        location.pathname !== route ||
        !root?.isConnected
      )
        throw new Error("Stopped: the reserved Develop surface changed");
      if (result.cancelRequested)
        throw new Error("Color sweep stopped by operator; inspect the active QA adjustment");
      if (photo && selected() !== photo.id)
        throw new Error("Stopped: selected photo changed during sweep");
    };
    const ready = () => {
      const current = image(),
        exportButton = button("Export");
      return Boolean(
        current?.complete &&
        current.naturalWidth &&
        current.currentSrc === current.src &&
        exportButton &&
        !exportButton.disabled &&
        root.querySelector(".develop-histogram-control")?.getAttribute("aria-busy") === "false" &&
        root.querySelector(".develop-save-status")?.textContent === "All edits saved",
      );
    };
    const wait = async (fn, label) => {
      const deadline = performance.now() + 45000;
      for (;;) {
        assertScope();
        if (await fn()) return;
        if (performance.now() > deadline) throw new Error(label);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    };
    const hash = async (blob) => {
      if (!(blob instanceof Blob))
        throw new Error("Expected source/native image Blob was unavailable");
      return [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
    };
    const panel = (name) =>
      [...root.querySelectorAll(".develop-adjustments > details")].find(
        (node) => node.querySelector("summary")?.textContent.trim() === name,
      );
    const setNumber = async (input, value) => {
      assertScope();
      if (
        !input ||
        input.disabled ||
        input.closest("fieldset:disabled,[inert]") ||
        !input.getClientRects().length
      )
        throw new Error("Expected visible enabled numeric control was unavailable");
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        input,
        String(value),
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      // Wait for React to adopt the new handler before blur commits its latest value.
      await new Promise((resolve) => setTimeout(resolve, 30));
      assertScope();
      input.blur();
    };
    try {
      if (!root) throw new Error("Develop is not mounted");
      const module = await import("/src/lib/develop/store.ts");
      const { defaultDevelopSettings, DEVELOP_HSL_CHANNELS } =
        await import("/src/lib/develop/contract.ts");
      currentRecipe = module.currentRecipe;
      store = module.createDevelopStore({ scope: "device-local", libraryId: `shoot:${shoot}` });
      initial = await store.loadLibrary();
      const expectedNames = [
        "sony-a6000.ARW",
        "sony-a7iv-small.ARW",
        "volleyball-portrait-cc0.jpg",
      ].sort();
      check(
        "reserved fixture contains exactly the three public photographs",
        initial.photos.length === 3 &&
          new Set(initial.photos.map((p) => p.id)).size === 3 &&
          JSON.stringify(initial.photos.map((p) => p.name).sort()) ===
            JSON.stringify(expectedNames) &&
          initial.photos.every(
            (p) => p.sourceBlob instanceof Blob && p.sourceBlob.size > 0 && initial.documents[p.id],
          ),
      );
      photo = initial.photos.find((p) => p.name === "sony-a6000.ARW");
      check("selected public RAW is the intended source", selected() === photo.id);
      for (const p of initial.photos) originalHashes.set(p.id, await hash(p.sourceBlob));
      await wait(ready, "Initial editor did not settle");
      URL.createObjectURL = function (blob) {
        const url = create.call(URL, blob);
        blobs.set(url, blob);
        return url;
      };
      URL.revokeObjectURL = function (url) {
        blobs.delete(url);
        return revoke.call(URL, url);
      };
      instrumented = true;

      const basic = panel("Basic");
      if (!basic) throw new Error("Basic panel missing");
      if (!basic.open) basic.querySelector("summary").click();
      const exposure = basic.querySelector('input[aria-label="Exposure value"]');
      let prior = image().currentSrc;
      await setNumber(exposure, Number(exposure?.value) === 0.25 ? 0.5 : 0.25);
      await wait(
        () => ready() && image().currentSrc !== prior,
        "Warm-up native render did not finish",
      );
      // The global Reset is explicitly scoped: the Crop panel also has a Reset button.
      const footer = root.querySelector(".develop-right-footer"),
        reset = footer && button("Reset", footer);
      if (!reset || reset.disabled) throw new Error("Global Reset unavailable");
      prior = image().currentSrc;
      reset.click();
      await wait(() => ready() && image().currentSrc !== prior, "Global reset did not render");
      baselineSettings = JSON.stringify(defaultDevelopSettings());
      await wait(
        async () =>
          JSON.stringify(currentRecipe((await store.loadLibrary()).documents[photo.id])) ===
          baselineSettings,
        "Global reset did not persist a neutral baseline",
      );
      baselineHash = await hash(blobs.get(image().currentSrc));
      check("real global reset establishes neutral stored settings", Boolean(baselineHash));

      const mixer = panel("Color Mixer");
      if (!mixer) throw new Error("Color Mixer panel missing");
      if (!mixer.open) mixer.querySelector("summary").click();
      for (const [index, range] of DEVELOP_HSL_CHANNELS.entries()) {
        assertScope();
        const rangeButton = mixer.querySelector(`button[aria-label="${range}"]`);
        if (!rangeButton || rangeButton.disabled) throw new Error(`Missing color range ${range}`);
        rangeButton.click();
        await wait(
          () =>
            rangeButton.getAttribute("aria-pressed") === "true" &&
            mixer.querySelector(".develop-control-heading")?.textContent === range,
          `${range} did not become the active color range`,
        );
        for (const [key, label, value] of [
          ["hue", "Hue", 65],
          ["saturation", "Saturation", -80],
          ["luminance", "Luminance", 60],
        ]) {
          result.activeControl = `${range} ${label}`;
          await wait(ready, `${result.activeControl}: baseline not ready`);
          const beforeCase = await store.loadLibrary();
          if (JSON.stringify(currentRecipe(beforeCase.documents[photo.id])) !== baselineSettings)
            throw new Error("Stopped: baseline recipe changed outside the sweep");
          const expected = defaultDevelopSettings();
          expected.hsl[index][key] = value;
          const input = mixer.querySelector(`input[aria-label="${label} value"]`);
          prior = image().currentSrc;
          await setNumber(input, value);
          await wait(
            () => ready() && image().currentSrc !== prior,
            `${result.activeControl}: native render/histogram did not finish`,
          );
          await wait(
            async () =>
              JSON.stringify(currentRecipe((await store.loadLibrary()).documents[photo.id])) ===
              JSON.stringify(expected),
            `${result.activeControl}: wrong range/value or extra settings persisted`,
          );
          check(`${range} ${label} persists only the intended channel and value`, true);
          const editedHash = await hash(blobs.get(image().currentSrc));
          check(`${range} ${label} changes the actual native JPEG`, editedHash !== baselineHash);
          check(
            `${range} ${label} completes a real histogram`,
            root.querySelectorAll(".develop-histogram-control svg path").length > 0,
          );
          prior = image().currentSrc;
          const undo = button("Undo");
          if (!undo || undo.disabled) throw new Error(`${result.activeControl}: Undo unavailable`);
          undo.click();
          await wait(
            () => ready() && image().currentSrc !== prior,
            `${result.activeControl}: Undo did not finish`,
          );
          check(
            `${range} ${label} Undo restores exact baseline JPEG`,
            (await hash(blobs.get(image().currentSrc))) === baselineHash,
          );
          await wait(
            async () =>
              JSON.stringify(currentRecipe((await store.loadLibrary()).documents[photo.id])) ===
              baselineSettings,
            `${result.activeControl}: Undo did not restore the exact baseline settings`,
          );
          result.cases.push({
            range,
            channelIndex: index,
            control: label,
            value,
            sha256: editedHash,
          });
        }
      }
      check("all 24 HSL cases completed", result.cases.length === 24);
      result.baselineSha256 = baselineHash;
      result.state = "passed";
    } catch (error) {
      result.state = "failed";
      result.error = error instanceof Error ? error.message : String(error);
      result.failureNote =
        "No automatic reset on failure: inspect the active adjustment in this reserved QA library. An unchanged JPEG can indicate no affected fixture colors, not necessarily a broken control.";
    } finally {
      // Read back preservation even after a partial sweep. Never overwrite a failed or external edit.
      if (store && initial && photo && originalHashes.size === 3) {
        try {
          const after = await store.loadLibrary();
          check(
            "other two photo documents remain byte-for-byte equivalent JSON",
            initial.photos
              .filter((p) => p.id !== photo.id)
              .every(
                (p) =>
                  JSON.stringify(initial.documents[p.id]) === JSON.stringify(after.documents[p.id]),
              ),
          );
          check(
            "all three original source hashes are unchanged",
            after.photos.length === 3 &&
              (
                await Promise.all(
                  after.photos.map(
                    async (p) => (await hash(p.sourceBlob)) === originalHashes.get(p.id),
                  ),
                )
              ).every(Boolean),
          );
          result.restoredBaseline =
            baselineSettings != null &&
            JSON.stringify(currentRecipe(after.documents[photo.id])) === baselineSettings;
          if (result.state === "passed")
            check("final selected recipe is exactly the neutral baseline", result.restoredBaseline);
        } catch (error) {
          result.state = "failed";
          result.preservationError = error instanceof Error ? error.message : String(error);
        }
      }
      if (instrumented) {
        URL.createObjectURL = create;
        URL.revokeObjectURL = revoke;
      }
      blobs.clear();
      store?.close();
      result.passed = result.checks.length;
      result.finishedAt = new Date().toISOString();
      sessionStorage.setItem("foto:qa:color-controls:097", JSON.stringify(result));
    }
  })();
  return result;
})();
