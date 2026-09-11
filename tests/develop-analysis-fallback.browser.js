// Real browser worker/cooperative-fallback comparison using only the public QA export.
return (() => {
  const shoot = "eeaf3000-1111-4222-8333-000000000097";
  if (
    location.origin !== "http://127.0.0.1:8085" ||
    location.pathname !== `/shoots/${shoot}/develop`
  )
    throw new Error("Use only the reserved public-photo analysis route");
  if (globalThis.fotoAnalysisFallbackQA?.state === "running")
    throw new Error("Analysis QA already running");
  const result = { state: "running", checks: [], startedAt: new Date().toISOString() };
  globalThis.fotoAnalysisFallbackQA = result;
  void (async () => {
    const root = document.querySelector(".foto-develop"),
      blobs = new Map();
    const originalCreate = URL.createObjectURL;
    let worker, fallback, store;
    const check = (name, value) => {
      if (!value) throw new Error(name);
      result.checks.push(name);
    };
    const button = (name, scope = root) =>
      [...scope.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-label") === name || b.textContent.trim() === name,
      );
    const wait = async (fn, label) => {
      const end = performance.now() + 45000;
      while (!fn()) {
        if (performance.now() > end) throw new Error(label);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    };
    URL.createObjectURL = function (blob) {
      const url = originalCreate.call(URL, blob);
      blobs.set(url, blob);
      return url;
    };
    try {
      if (!root || root.querySelector('[role="dialog"]') || button("Export")?.disabled)
        throw new Error("Start from an idle, export-ready Develop image");
      const { createDevelopStore } = await import("/src/lib/develop/store.ts");
      store = createDevelopStore({ scope: "device-local", libraryId: `shoot:${shoot}` });
      const initial = await store.loadLibrary();
      check(
        "only the three public fixtures are present",
        initial.photos.length === 3 &&
          initial.photos.every((p) =>
            ["sony-a6000.ARW", "sony-a7iv-small.ARW", "volleyball-portrait-cc0.jpg"].includes(
              p.name,
            ),
          ),
      );
      button("Export").click();
      await wait(() => root.querySelector('[role="dialog"]'), "Export dialog missing");
      const dialog = root.querySelector('[role="dialog"]');
      button("Preview export", dialog).click();
      await wait(
        () => dialog.querySelector(".develop-export-proof img")?.naturalWidth,
        "Export proof missing",
      );
      const image = dialog.querySelector(".develop-export-proof img");
      const blob = blobs.get(image.currentSrc),
        width = image.naturalWidth,
        height = image.naturalHeight;
      check("actual native export Blob is observed", blob instanceof Blob && blob.size > 0);
      button("Cancel", dialog).click();
      await wait(() => !root.querySelector('[role="dialog"]'), "Dialog did not close");
      const { createDevelopPixelAnalyzer } = await import("/src/lib/develop/pixel-analysis.ts");
      worker = createDevelopPixelAnalyzer();
      fallback = createDevelopPixelAnalyzer({ workerFactory: () => null });
      let start = performance.now();
      const workerResult = await worker.analyze(blob);
      result.workerMs = performance.now() - start;
      let frames = 0,
        last = performance.now(),
        maxGap = 0,
        token;
      const tick = (now) => {
        frames++;
        maxGap = Math.max(maxGap, now - last);
        last = now;
        token = requestAnimationFrame(tick);
      };
      token = requestAnimationFrame(tick);
      let fallbackResult;
      try {
        start = performance.now();
        fallbackResult = await fallback.analyze(blob);
        result.fallbackMs = performance.now() - start;
      } finally {
        cancelAnimationFrame(token);
      }
      check(
        "worker counts every rendered pixel",
        workerResult.width === width &&
          workerResult.height === height &&
          workerResult.histogram.pixels === width * height,
      );
      check(
        "cooperative fallback bins and clipping counts exactly match worker",
        JSON.stringify(fallbackResult.histogram) === JSON.stringify(workerResult.histogram),
      );
      check("browser paints during cooperative full-image analysis", frames > 0);
      result.dimensions = { width, height, pixels: width * height };
      result.fallbackAnimationFrames = frames;
      result.fallbackMaxFrameGapMs = maxGap;
      const fresh = new Blob([blob], { type: blob.type });
      const abort = new AbortController();
      const canceled = worker
        .analyze(fresh, { signal: abort.signal, clipping: { shadows: true, highlights: true } })
        .then(
          () => "completed",
          (error) => error.name,
        );
      const follow = worker.analyze(new Blob([blob], { type: blob.type }));
      abort.abort();
      check("cancelled worker job reports AbortError", (await canceled) === "AbortError");
      check(
        "queued worker job succeeds after cancellation",
        JSON.stringify((await follow).histogram) === JSON.stringify(workerResult.histogram),
      );
      const fallbackAbort = new AbortController();
      const canceledFallback = fallback.analyze(fresh, { signal: fallbackAbort.signal }).then(
        () => "completed",
        (error) => error.name,
      );
      const timer = setTimeout(() => fallbackAbort.abort(), 15);
      try {
        check(
          "cooperative analysis honors cancellation",
          (await canceledFallback) === "AbortError",
        );
      } finally {
        clearTimeout(timer);
      }
      check(
        "fallback lane remains usable after cancellation",
        JSON.stringify(
          (await fallback.analyze(new Blob([blob], { type: blob.type }))).histogram,
        ) === JSON.stringify(workerResult.histogram),
      );
      const after = await store.loadLibrary();
      check(
        "analysis leaves every saved document unchanged",
        JSON.stringify(initial.documents) === JSON.stringify(after.documents),
      );
      result.state = "passed";
    } catch (error) {
      result.state = "failed";
      result.error = error instanceof Error ? error.message : String(error);
    } finally {
      worker?.dispose();
      fallback?.dispose();
      store?.close();
      URL.createObjectURL = originalCreate;
      blobs.clear();
      result.passed = result.checks.length;
      result.finishedAt = new Date().toISOString();
      sessionStorage.setItem("foto:qa:analysis-fallback:097", JSON.stringify(result));
    }
  })();
  return result;
})();
