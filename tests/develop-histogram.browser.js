// Read-only image measurements and reversible UI interactions on public QA fixtures.
// No changes to photo recipes, customer libraries, or source bytes.
return await (async () => {
  const shoot = "eeaf3000-1111-4222-8333-000000000097";
  if (
    location.origin !== "http://127.0.0.1:8085" ||
    location.pathname !== `/shoots/${shoot}/develop`
  )
    throw new Error("Use only the reserved public-fixture histogram route");
  const root = document.querySelector(".foto-develop");
  if (!root) throw new Error("Develop must be hydrated");
  const { createDevelopStore } = await import("/src/lib/develop/store.ts");
  const { developPixelCoordinate } = await import("/src/lib/develop/pixel-sample.ts");
  const store = createDevelopStore({ scope: "device-local", libraryId: `shoot:${shoot}` });
  const initial = await store.loadLibrary();
  if (
    initial.photos.length !== 3 ||
    !initial.photos.every((photo) =>
      ["sony-a6000.ARW", "sony-a7iv-small.ARW", "volleyball-portrait-cc0.jpg"].includes(photo.name),
    )
  )
    throw new Error("Reserved fixture contents changed");
  const checks = [];
  const check = (name, passed) => {
    if (!passed) throw new Error(name);
    checks.push(name);
  };
  const wait = async (predicate, label, timeout = 18000) => {
    const end = performance.now() + timeout;
    while (!predicate()) {
      if (performance.now() > end) throw new Error(label);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const frame = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const button = (label) =>
    [...root.querySelectorAll("button")].find(
      (node) => node.getAttribute("aria-label") === label || node.textContent.trim() === label,
    );
  const image = () => root.querySelector('.develop-image-frame img[draggable="false"]');
  const histogram = () => root.querySelector(".develop-histogram-control");
  const caption = () => root.querySelector(".develop-histogram-clipping > span");
  const sample = () => caption()?.querySelector("[aria-label]");
  const settled = () =>
    image()?.naturalWidth &&
    image().complete &&
    image().currentSrc === image().src &&
    histogram()?.getAttribute("aria-busy") === "false";
  const move = (x, y) =>
    image().dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerId: 71, clientX: x, clientY: y }),
    );
  const leave = () =>
    image().dispatchEvent(
      new PointerEvent("pointerout", {
        bubbles: true,
        pointerId: 71,
        relatedTarget: document.body,
      }),
    );
  const select = async (label, value) => {
    const node = root.querySelector(`select[aria-label="${label}"]`);
    node.value = value;
    node.dispatchEvent(new Event("change", { bubbles: true }));
    await frame();
  };
  const originalRead = CanvasRenderingContext2D.prototype.getImageData;
  const originalChannel = root.querySelector('[aria-label="Histogram channel"]').value;
  const originalScale = root.querySelector('[aria-label="Histogram scale"]').value;
  const originalBefore = button("Before").getAttribute("aria-pressed") === "true";
  const originalCompare =
    button("Compare before and after").getAttribute("aria-pressed") === "true";
  const originalShadows = button("Show shadow clipping").getAttribute("aria-pressed") === "true";
  const originalHighlights =
    button("Show highlight clipping").getAttribute("aria-pressed") === "true";
  let reads = [];
  try {
    if (originalBefore) button("Before").click();
    if (originalCompare) button("Compare before and after").click();
    await wait(settled, "Histogram never settled");
    await frame();
    const target = image(),
      rect = target.getBoundingClientRect();
    const point = { x: rect.left + rect.width * 0.47, y: rect.top + rect.height * 0.51 };
    const coordinate = developPixelCoordinate(
      point.x,
      point.y,
      rect,
      target.naturalWidth,
      target.naturalHeight,
    );
    if (!coordinate) throw new Error("QA sample is outside the actual image");
    const reference = document.createElement("canvas");
    reference.width = reference.height = 1;
    const context = reference.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
    context.imageSmoothingEnabled = false;
    context.drawImage(target, coordinate.x, coordinate.y, 1, 1, 0, 0, 1, 1);
    const expected = [...context.getImageData(0, 0, 1, 1).data];
    reference.width = reference.height = 0;
    CanvasRenderingContext2D.prototype.getImageData = function (...args) {
      reads.push({ width: args[2], height: args[3] });
      return originalRead.apply(this, args);
    };
    await wait(() => {
      move(point.x, point.y);
      return sample()?.getAttribute("aria-label")?.startsWith("Rendered preview");
    }, "Edited-image RGB readout never became ready");
    await frame();
    reads = [];
    for (let i = 0; i < 100; i++) move(point.x, point.y);
    await frame();
    check(
      `100 pointer moves sample only one source pixel once (observed ${reads.length})`,
      reads.length === 1 && reads[0].width === 1 && reads[0].height === 1,
    );
    check(
      "displayed RGB equals the exact decoded sRGB pixel",
      sample()?.textContent === `R ${expected[0]} · G ${expected[1]} · B ${expected[2]}`,
    );
    check(
      "RGB readout identifies rendered preview provenance",
      sample()
        ?.getAttribute("aria-label")
        ?.includes(`sRGB pixel at ${coordinate.x}, ${coordinate.y}`),
    );
    const url = target.currentSrc;
    check("hover does not replace the rendered photo", image().currentSrc === url);
    leave();
    await frame();
    check(
      "leaving the photo clears the readout",
      !sample() && caption().textContent.includes("Drag to adjust tone"),
    );
    await select("Histogram channel", "red");
    check(
      "red histogram shows one labeled channel",
      root.querySelectorAll(".develop-histogram path").length === 1 &&
        root.querySelector(".develop-histogram svg").getAttribute("aria-label").includes("Red"),
    );
    const linear = root.querySelector(".develop-histogram path").getAttribute("d");
    await select("Histogram scale", "log");
    check(
      "log scale changes the real graph geometry",
      root.querySelector(".develop-histogram path").getAttribute("d") !== linear,
    );
    await select("Histogram channel", "luminance");
    check(
      "luminance is separately labeled",
      root.querySelector(".develop-histogram svg").getAttribute("aria-label").includes("Luminance"),
    );
    await select("Histogram channel", "rgb");
    check(
      "RGB view restores all three channel paths",
      root.querySelectorAll(".develop-histogram path").length === 3,
    );
    button("Before").click();
    await wait(
      () => settled() && image().alt === "Before adjustments",
      "Before view never settled",
    );
    // Cached counts can arrive before React adopts this image's load event.
    await frame();
    const beforeRect = image().getBoundingClientRect();
    await wait(() => {
      move(beforeRect.left + beforeRect.width / 2, beforeRect.top + beforeRect.height / 2);
      return sample()?.getAttribute("aria-label")?.startsWith("Before adjustments");
    }, "Before RGB readout never became ready");
    check(
      "Before readout describes Before pixels",
      sample()?.getAttribute("aria-label")?.startsWith("Before adjustments"),
    );
    button("Before").click();
    await wait(() => settled() && image().alt === "Developed photo", "Edited view did not return");
    await frame();
    check("source changes clear stale RGB values", !sample());
    button("Compare before and after").click();
    await frame();
    const compareRect = image().getBoundingClientRect();
    reads = [];
    move(compareRect.left + compareRect.width / 2, compareRect.top + compareRect.height / 2);
    await frame();
    check(
      "ambiguous compare view does not publish or scan pixels",
      !sample() && reads.length === 0,
    );
    button("Compare before and after").click();
    await frame();
    for (const label of ["Show shadow clipping", "Show highlight clipping"])
      if (button(label).getAttribute("aria-pressed") === "true") button(label).click();
    document.activeElement?.blur?.();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    await wait(
      () =>
        button("Show shadow clipping").getAttribute("aria-pressed") === "true" &&
        getComputedStyle(root.querySelector(".develop-clipping-overlay")).display !== "none",
      "J did not produce clipping overlay",
    );
    const overlay = root.querySelector(".develop-clipping-overlay");
    check(
      "J enables both clipping warnings",
      button("Show highlight clipping").getAttribute("aria-pressed") === "true",
    );
    check(
      "clipping overlay matches the displayed image dimensions",
      overlay.width === image().naturalWidth && overlay.height === image().naturalHeight,
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    await frame();
    check(
      "J hides both warnings without a stale overlay",
      button("Show shadow clipping").getAttribute("aria-pressed") === "false" &&
        button("Show highlight clipping").getAttribute("aria-pressed") === "false" &&
        getComputedStyle(overlay).display === "none",
    );
    await wait(
      () => overlay.width === 0 && overlay.height === 0,
      "Disabled clipping retained its full-image canvas allocation",
    );
    check(
      "disabled clipping releases its full-image backing canvas",
      overlay.width === 0 && overlay.height === 0,
    );
    const after = await store.loadLibrary();
    check(
      "all photo documents remain unchanged",
      JSON.stringify(after.documents) === JSON.stringify(initial.documents),
    );
    return { passed: checks.length, checks, sampledRgb: expected.slice(0, 3), coordinate };
  } finally {
    CanvasRenderingContext2D.prototype.getImageData = originalRead;
    leave();
    await select("Histogram channel", originalChannel);
    await select("Histogram scale", originalScale);
    for (const [label, expected] of [
      ["Show shadow clipping", originalShadows],
      ["Show highlight clipping", originalHighlights],
      ["Before", originalBefore],
      ["Compare before and after", originalCompare],
    ])
      if ((button(label).getAttribute("aria-pressed") === "true") !== expected)
        button(label).click();
    store.close();
  }
})();
