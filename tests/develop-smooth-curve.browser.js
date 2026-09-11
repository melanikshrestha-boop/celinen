// Actual UI/native proof. Reserved public RAW only; no customer data or OS download.
return (() => {
  const shoot = "eeaf3000-1111-4222-8333-000000000097";
  const key = "foto:qa:smooth-curve:097";
  if (
    location.origin !== "http://127.0.0.1:8085" ||
    location.pathname !== `/shoots/${shoot}/develop`
  )
    throw new Error("Use the reserved public-photo curve QA route");
  if (globalThis.fotoSmoothCurveQA?.state === "running")
    throw new Error("Curve QA already running");
  const result = { state: "running", checks: [], startedAt: new Date().toISOString() };
  globalThis.fotoSmoothCurveQA = result;
  void (async () => {
    const root = document.querySelector(".foto-develop"),
      blobs = new Map();
    const original = URL.createObjectURL;
    let store;
    const check = (name, value) => {
      if (!value) throw new Error(name);
      result.checks.push(name);
    };
    const button = (name, scope = root) =>
      [...scope.querySelectorAll("button")].find(
        (node) => node.getAttribute("aria-label") === name || node.textContent.trim() === name,
      );
    const image = () => root.querySelector('.develop-image-frame img[alt="Developed photo"]');
    const ready = () =>
      image()?.complete &&
      image().naturalWidth &&
      image().currentSrc === image().src &&
      !button("Export").disabled &&
      root.querySelector(".develop-histogram-control")?.getAttribute("aria-busy") === "false" &&
      root.querySelector(".develop-save-status")?.textContent === "All edits saved";
    const wait = async (fn, name) => {
      const end = performance.now() + 45000;
      while (!fn()) {
        if (performance.now() > end) throw new Error(name);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    };
    const hash = async (blob) => {
      if (!blob) throw new Error("Unobserved native/proof Blob");
      return [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
    };
    const act = async (fn, name) => {
      const old = image().currentSrc;
      fn();
      await wait(() => ready() && image().currentSrc !== old, `${name} render did not finish`);
    };
    const numeric = async (label, value) => {
      const input = root.querySelector(`input[aria-label="${label}"]`);
      if (!input) throw new Error(`Missing ${label}`);
      const old = image().currentSrc;
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        input,
        String(value),
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      input.blur();
      await wait(() => ready() && image().currentSrc !== old, `${label} render did not finish`);
    };
    const proof = async () => {
      button("Export").click();
      await wait(() => root.querySelector('[role="dialog"]'), "Export dialog not open");
      const dialog = root.querySelector('[role="dialog"]');
      button("Preview export", dialog).click();
      await wait(
        () => dialog.querySelector(".develop-export-proof img")?.naturalWidth,
        "Export proof not decoded",
      );
      const sha = await hash(
        blobs.get(dialog.querySelector(".develop-export-proof img").currentSrc),
      );
      button("Cancel", dialog).click();
      await wait(() => !root.querySelector('[role="dialog"]'), "Export dialog not closed");
      return sha;
    };
    URL.createObjectURL = function (blob) {
      const url = original.call(URL, blob);
      blobs.set(url, blob);
      return url;
    };
    try {
      const { createDevelopStore, currentRecipe } = await import("/src/lib/develop/store.ts");
      store = createDevelopStore({ scope: "device-local", libraryId: `shoot:${shoot}` });
      const initial = await store.loadLibrary();
      check(
        "only reserved public fixtures are present",
        initial.photos.length === 3 &&
          initial.photos.every((p) =>
            ["sony-a6000.ARW", "sony-a7iv-small.ARW", "volleyball-portrait-cc0.jpg"].includes(
              p.name,
            ),
          ),
      );
      const photo = initial.photos.find((p) => p.name === "sony-a6000.ARW");
      check(
        "public A6000 source selected",
        root.querySelector(".develop-filmstrip-items button.is-active")?.dataset.photoId ===
          photo.id,
      );
      const sourceHash = await hash(photo.sourceBlob);
      check(
        "source identity is exact",
        sourceHash === "ce8b4957281a817d52a07a691e2468567b6c78223bd0b514ffc1c65b002b8d89",
      );
      await wait(ready, "Editor not ready");
      const summary = [...root.querySelectorAll(".develop-adjustments summary")].find(
        (node) => node.textContent.trim() === "Tone Curve",
      );
      if (!summary.parentElement.open) summary.click();
      const selector = () => root.querySelector('select[aria-label="Curve interpolation"]');
      if (globalThis.fotoSmoothCurveQAPhase === "reload") {
        const prior = JSON.parse(sessionStorage.getItem(key) ?? "null");
        if (!prior?.settings || !prior.proofSha256) throw new Error("No prior smooth-curve proof");
        check(
          "smooth curve and points survive real reload",
          selector().value === "smooth" &&
            JSON.stringify(currentRecipe(initial.documents[photo.id])) ===
              JSON.stringify(prior.settings),
        );
        check("reloaded curve export is byte-identical", (await proof()) === prior.proofSha256);
        result.proofSha256 = prior.proofSha256;
      } else {
        // Make repeatable even if this disposable photo already is neutral.
        const exposure = root.querySelector('input[aria-label="Exposure value"]');
        await numeric("Exposure value", Number(exposure.value) === 0.25 ? 0.5 : 0.25);
        await act(() => button("Reset").click(), "Reset");
        button("Master tone curve").click();
        await wait(() => button("Add master curve point"), "Master channel did not open");
        await act(() => button("Add master curve point").click(), "Add master point");
        await numeric("Curve point 2 output", 70);
        const linearHash = await hash(blobs.get(image().currentSrc));
        const linearPath = root.querySelector(".curve-function").getAttribute("d");
        const beforeMode = (await store.loadLibrary()).documents[photo.id];
        await act(() => {
          selector().value = "smooth";
          selector().dispatchEvent(new Event("change", { bubbles: true }));
        }, "Smooth");
        const smoothHash = await hash(blobs.get(image().currentSrc));
        check("Smooth changes actual native curve output", smoothHash !== linearHash);
        check(
          "displayed curve follows Smooth mode",
          root.querySelector(".develop-curve").dataset.interpolation === "smooth" &&
            root.querySelector(".curve-function").getAttribute("d") !== linearPath,
        );
        const afterMode = (await store.loadLibrary()).documents[photo.id];
        check(
          "mode switch commits one history step",
          afterMode.history.length === beforeMode.history.length + 1 &&
            currentRecipe(afterMode).curveInterpolation === "smooth",
        );
        await act(() => button("Undo").click(), "Undo");
        check(
          "mode Undo restores exact Linear pixels",
          selector().value === "linear" &&
            (await hash(blobs.get(image().currentSrc))) === linearHash,
        );
        await act(() => button("Redo").click(), "Redo");
        check(
          "mode Redo restores exact Smooth pixels",
          selector().value === "smooth" &&
            (await hash(blobs.get(image().currentSrc))) === smoothHash,
        );
        button("Red tone curve").click();
        await wait(() => button("Add red curve point"), "Red channel did not open");
        await act(() => button("Add red curve point").click(), "Add Red point");
        await numeric("Red curve point 2 output", 40);
        const redHash = await hash(blobs.get(image().currentSrc));
        check("independent Red curve changes native output", redHash !== smoothHash);
        const saved = await store.loadLibrary(),
          settings = currentRecipe(saved.documents[photo.id]);
        check(
          "master and Red points persist independently",
          settings.curve.length === 3 &&
            settings.curve[1].y === 0.7 &&
            settings.channelCurves.red.length === 3 &&
            settings.channelCurves.red[1].y === 0.4 &&
            settings.channelCurves.green.length === 2 &&
            settings.channelCurves.blue.length === 2,
        );
        const proofSha256 = await proof();
        check("Smooth editor and export proof are byte-identical", proofSha256 === redHash);
        check(
          "unselected photo histories are untouched",
          initial.photos
            .filter((p) => p.id !== photo.id)
            .every(
              (p) =>
                JSON.stringify(initial.documents[p.id]) === JSON.stringify(saved.documents[p.id]),
            ),
        );
        check(
          "RAW bytes are unchanged after curve editing",
          (await hash(saved.photos.find((p) => p.id === photo.id).sourceBlob)) === sourceHash,
        );
        sessionStorage.setItem(key, JSON.stringify({ settings, proofSha256 }));
        result.proofSha256 = proofSha256;
      }
      result.state = "passed";
    } catch (error) {
      result.state = "failed";
      result.error = error instanceof Error ? error.message : String(error);
    } finally {
      URL.createObjectURL = original;
      blobs.clear();
      store?.close();
      result.finishedAt = new Date().toISOString();
      result.passed = result.checks.length;
      sessionStorage.setItem(`${key}:result`, JSON.stringify(result));
    }
  })();
  return result;
})();
