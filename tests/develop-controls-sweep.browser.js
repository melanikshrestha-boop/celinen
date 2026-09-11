// Detached, real-UI sweep; reserved public fixture only. Never customer libraries.
return (() => {
  const shoot = "eeaf3000-1111-4222-8333-000000000097";
  if (
    location.origin !== "http://127.0.0.1:8085" ||
    location.pathname !== `/shoots/${shoot}/develop`
  )
    throw new Error("Control sweep requires the reserved public-fixture route");
  if (globalThis.fotoControlSweepQA?.state === "running") throw new Error("Sweep already running");
  const result = { state: "running", checks: [], cases: [], startedAt: new Date().toISOString() };
  globalThis.fotoControlSweepQA = result;
  void (async () => {
    const root = document.querySelector(".foto-develop");
    const originalCreate = URL.createObjectURL,
      blobs = new Map();
    let store;
    const check = (label, value) => {
      if (!value) throw new Error(label);
      result.checks.push(label);
    };
    const wait = async (fn, label) => {
      const end = performance.now() + 45000;
      while (!fn()) {
        if (performance.now() > end) throw new Error(label);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    };
    const button = (label) =>
      [...root.querySelectorAll("button")].find(
        (node) => node.getAttribute("aria-label") === label || node.textContent.trim() === label,
      );
    const image = () => root.querySelector('.develop-image-frame img[alt="Developed photo"]');
    const ready = () =>
      image()?.complete &&
      image().naturalWidth &&
      image().currentSrc === image().src &&
      !button("Export")?.disabled &&
      root.querySelector(".develop-histogram-control")?.getAttribute("aria-busy") === "false" &&
      root.querySelector(".develop-save-status")?.textContent === "All edits saved";
    const hash = async (blob) => {
      if (!blob) throw new Error("Native image Blob was not observed");
      return [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
    };
    const panel = (name) =>
      [...root.querySelectorAll(".develop-adjustments > details")].find(
        (node) => node.querySelector("summary")?.textContent.trim() === name,
      );
    URL.createObjectURL = function (blob) {
      const url = originalCreate.call(URL, blob);
      blobs.set(url, blob);
      return url;
    };
    try {
      const { createDevelopStore, currentRecipe } = await import("/src/lib/develop/store.ts");
      const { defaultDevelopSettings } = await import("/src/lib/develop/contract.ts");
      store = createDevelopStore({ scope: "device-local", libraryId: `shoot:${shoot}` });
      const initial = await store.loadLibrary();
      check(
        "reserved fixture contains only the three public photographs",
        initial.photos.length === 3 &&
          initial.photos.every((p) =>
            ["sony-a6000.ARW", "sony-a7iv-small.ARW", "volleyball-portrait-cc0.jpg"].includes(
              p.name,
            ),
          ),
      );
      const photo = initial.photos.find((p) => p.name === "sony-a6000.ARW");
      check(
        "selected public RAW is the intended source",
        root.querySelector(".develop-filmstrip-items button.is-active")?.dataset.photoId ===
          photo.id,
      );
      const originalHash = await hash(photo.sourceBlob);
      await wait(ready, "Initial editor is not ready");
      // Make repeated runs deterministic even if the fixture already is neutral.
      const warmup = panel("Basic").querySelector('input[aria-label="Exposure value"]');
      let prior = image().currentSrc;
      warmup.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        warmup,
        Number(warmup.value) === 0.25 ? "0.5" : "0.25",
      );
      warmup.dispatchEvent(new Event("input", { bubbles: true }));
      warmup.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      warmup.blur();
      await wait(
        () => ready() && image().currentSrc !== prior,
        "Warm-up adjustment did not finish",
      );
      // Explicit reset of this disposable photograph, through the real UI.
      prior = image().currentSrc;
      const reset = [...root.querySelectorAll(".develop-right-footer button")].find(
        (node) => node.textContent.trim() === "Reset",
      );
      if (!reset || reset.disabled) throw new Error("Global Reset is not available");
      reset.click();
      await wait(() => ready() && image().currentSrc !== prior, "Reset did not finish");
      const baselineHash = await hash(blobs.get(image().currentSrc));
      const baselineSettings = JSON.stringify(
        currentRecipe((await store.loadLibrary()).documents[photo.id]),
      );
      check(
        "global Reset establishes the exact neutral recipe",
        baselineSettings === JSON.stringify(defaultDevelopSettings()),
      );
      const cases = [
        ...[
          ["Temp", 30],
          ["Tint", 25],
          ["Exposure", 0.7],
          ["Contrast", 40],
          ["Highlights", -60],
          ["Shadows", 55],
          ["Whites", -35],
          ["Blacks", 30],
          ["Texture", 65],
          ["Clarity", 50],
          ["Dehaze", 40],
          ["Vibrance", 60],
          ["Saturation", -45],
        ].map(([label, value]) => ["Basic", label, value]),
        ...[
          ["Grain", 45],
          ["Halation", 60],
          ["Bloom", 55],
          ["Fade", 40],
          ["Vignette", -55],
          ["Film falloff", 65],
        ].map(([label, value]) => ["Effects", label, value]),
        ...[
          ["Sharpening", 65],
          ["Luminance noise", 80],
          ["Color noise", 80],
        ].map(([label, value]) => ["Detail", label, value]),
        ...["Shadows", "Midtones", "Highlights"].map((region) => [
          "Color Grading",
          `${region} saturation`,
          50,
        ]),
      ];
      for (const [panelName, label, value] of cases) {
        result.activeControl = label;
        const container = panel(panelName);
        if (!container) throw new Error(`Missing ${panelName} panel`);
        if (!container.open) container.querySelector("summary").click();
        const input = container.querySelector(`input[aria-label="${label} value"]`);
        if (!input || input.disabled) throw new Error(`Missing/enabled control ${label}`);
        // Expand a grading wheel's numeric disclosure when needed.
        for (
          let ancestor = input.parentElement;
          ancestor && ancestor !== container;
          ancestor = ancestor.parentElement
        )
          if (ancestor.tagName === "DETAILS" && !ancestor.open)
            ancestor.querySelector("summary").click();
        prior = image().currentSrc;
        input.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
          input,
          String(value),
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 30));
        input.blur();
        await wait(
          () => ready() && image().currentSrc !== prior,
          `${label} did not finish rendering/saving`,
        );
        const editedHash = await hash(blobs.get(image().currentSrc));
        check(`${label} changes the actual native JPEG`, editedHash !== baselineHash);
        check(
          `${label} has a completed real histogram`,
          root.querySelectorAll(".develop-histogram-control svg path").length > 0,
        );
        prior = image().currentSrc;
        button("Undo").click();
        await wait(() => ready() && image().currentSrc !== prior, `${label} Undo did not finish`);
        check(
          `${label} Undo restores exact baseline JPEG`,
          (await hash(blobs.get(image().currentSrc))) === baselineHash,
        );
        result.cases.push({ panel: panelName, control: label, value, sha256: editedHash });
      }
      const after = await store.loadLibrary();
      check(
        "all sweep adjustments are undone",
        JSON.stringify(currentRecipe(after.documents[photo.id])) === baselineSettings,
      );
      check(
        "other two photo documents are untouched",
        initial.photos
          .filter((p) => p.id !== photo.id)
          .every(
            (p) =>
              JSON.stringify(initial.documents[p.id]) === JSON.stringify(after.documents[p.id]),
          ),
      );
      check(
        "RAW source bytes are unchanged",
        (await hash(after.photos.find((p) => p.id === photo.id).sourceBlob)) === originalHash,
      );
      result.baselineSha256 = baselineHash;
      result.state = "passed";
    } catch (error) {
      result.state = "failed";
      result.error = error instanceof Error ? error.message : String(error);
    } finally {
      URL.createObjectURL = originalCreate;
      blobs.clear();
      store?.close();
      result.passed = result.checks.length;
      result.finishedAt = new Date().toISOString();
      sessionStorage.setItem("foto:qa:control-sweep:097", JSON.stringify(result));
    }
  })();
  return result;
})();
