// Public-fixture only. Set fotoDetailQAPhase='reload' after reloading for persistence proof.
return await (async () => {
  const shoot = "eeaf3000-1111-4222-8333-000000000097";
  const storageKey = `foto:qa:detail:${shoot}`;
  if (
    location.origin !== "http://127.0.0.1:8085" ||
    location.pathname !== `/shoots/${shoot}/develop`
  )
    throw new Error("Use only the reserved public-fixture Detail route");
  const root = document.querySelector(".foto-develop");
  if (!root) throw new Error("Develop must be hydrated");
  const { createDevelopStore, currentRecipe } = await import("/src/lib/develop/store.ts");
  const store = createDevelopStore({ scope: "device-local", libraryId: `shoot:${shoot}` });
  const initial = await store.loadLibrary();
  if (
    initial.photos.length !== 3 ||
    !initial.photos.every((p) =>
      ["sony-a6000.ARW", "sony-a7iv-small.ARW", "volleyball-portrait-cc0.jpg"].includes(p.name),
    )
  )
    throw new Error("Reserved fixture contents changed");
  const photo = initial.photos.find((p) => p.name === "sony-a6000.ARW");
  const checks = [],
    urls = new Map();
  const check = (label, value) => {
    if (!value) throw new Error(label);
    checks.push(label);
  };
  const wait = async (predicate, label) => {
    const until = performance.now() + 45000;
    while (!predicate()) {
      if (performance.now() > until) throw new Error(label);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  const button = (label, scope = root) =>
    [...scope.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === label || b.textContent.trim() === label,
    );
  const image = () => root.querySelector('.develop-image-frame img[alt="Developed photo"]');
  const ready = () =>
    image()?.complete &&
    image().currentSrc === image().src &&
    image().naturalWidth &&
    !button("Export").disabled &&
    root.querySelector(".develop-histogram-control").getAttribute("aria-busy") === "false";
  const hash = async (blob) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  const createURL = URL.createObjectURL;
  URL.createObjectURL = function (blob) {
    const url = createURL.call(URL, blob);
    urls.set(url, blob);
    return url;
  };
  const openDetail = () => {
    const summary = [...root.querySelectorAll("summary")].find(
      (n) => n.textContent.trim() === "Detail",
    );
    if (!summary) throw new Error("Missing Detail panel");
    if (!summary.parentElement.open) summary.click();
  };
  const setValue = async (label, value) => {
    const input = root.querySelector(`input[aria-label="${label} value"]`);
    if (!input) throw new Error(`Missing control ${label}`);
    if (Number(input.value) === value) return;
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
    await wait(
      () => ready() && image().currentSrc !== old,
      `${label} did not produce a finished render`,
    );
  };
  const proofHash = async () => {
    button("Export").click();
    await wait(() => root.querySelector('[role="dialog"]'), "Export did not open");
    const dialog = root.querySelector('[role="dialog"]');
    button("Preview export", dialog).click();
    await wait(
      () => dialog.querySelector(".develop-export-proof img")?.naturalWidth,
      "Detail export proof did not load",
    );
    const value = await hash(
      urls.get(dialog.querySelector(".develop-export-proof img").currentSrc),
    );
    button("Cancel", dialog).click();
    await wait(() => !root.querySelector('[role="dialog"]'), "Export did not close");
    return value;
  };
  try {
    await wait(ready, "Initial Detail image not ready");
    openDetail();
    const fields = {
      sharpening: "Sharpening",
      sharpeningRadius: "Sharpening radius",
      sharpeningDetail: "Sharpening fine detail",
      sharpeningMasking: "Sharpening edge masking",
    };
    const originalSha = await hash(photo.sourceBlob);
    if (globalThis.fotoDetailQAPhase === "reload") {
      const prior = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (!prior || prior.photoId !== photo.id || prior.edge !== 4096)
        throw new Error("No matching prior Detail proof");
      const current = currentRecipe(initial.documents[photo.id]);
      check(
        "saved Detail values survive a real page reload",
        Object.keys(fields).every(
          (key) =>
            current[key] === prior.settings[key] &&
            Number(root.querySelector(`input[aria-label="${fields[key]} value"]`).value) ===
              prior.settings[key],
        ),
      );
      check("reloaded Detail export is byte-identical", (await proofHash()) === prior.proofSha256);
      check("reload preserves original source bytes", originalSha === prior.originalSha256);
      return { phase: "reload", passed: checks.length, checks, proofSha256: prior.proofSha256 };
    }
    check(
      "standard export size is active for reproducible Detail QA",
      image().naturalWidth === 4096,
    );
    await setValue("Sharpening", 0);
    await setValue("Sharpening radius", 1);
    await setValue("Sharpening fine detail", 100);
    await setValue("Sharpening edge masking", 0);
    await setValue("Sharpening", 60);
    const amountHash = await hash(urls.get(image().currentSrc));
    await setValue("Sharpening radius", 2.2);
    const radiusHash = await hash(urls.get(image().currentSrc));
    check("Radius changes actual native pixels", radiusHash !== amountHash);
    await setValue("Sharpening fine detail", 25);
    const detailHash = await hash(urls.get(image().currentSrc));
    check("Fine detail changes actual native pixels", detailHash !== radiusHash);
    await setValue("Sharpening edge masking", 70);
    const maskedHash = await hash(urls.get(image().currentSrc));
    check("Edge masking changes actual native pixels", maskedHash !== detailHash);
    let oldUrl = image().currentSrc;
    button("Undo").click();
    await wait(() => ready() && image().currentSrc !== oldUrl, "Undo did not render");
    check(
      "Undo restores exact pre-masking pixels",
      (await hash(urls.get(image().currentSrc))) === detailHash,
    );
    oldUrl = image().currentSrc;
    button("Redo").click();
    await wait(() => ready() && image().currentSrc !== oldUrl, "Redo did not render");
    check(
      "Redo restores exact masked pixels",
      (await hash(urls.get(image().currentSrc))) === maskedHash,
    );
    const proofSha256 = await proofHash();
    check("Detail export proof is byte-identical to editor", proofSha256 === maskedHash);
    const saved = await store.loadLibrary(),
      settings = currentRecipe(saved.documents[photo.id]);
    check(
      "all four Detail values persist in history",
      settings.sharpening === 60 &&
        settings.sharpeningRadius === 2.2 &&
        settings.sharpeningDetail === 25 &&
        settings.sharpeningMasking === 70,
    );
    check(
      "other two photo histories remain unchanged",
      initial.photos
        .filter((p) => p.id !== photo.id)
        .every(
          (p) => JSON.stringify(initial.documents[p.id]) === JSON.stringify(saved.documents[p.id]),
        ),
    );
    check(
      "Detail never modifies original source bytes",
      (await hash(saved.photos.find((p) => p.id === photo.id).sourceBlob)) === originalSha,
    );
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        photoId: photo.id,
        edge: 4096,
        settings,
        proofSha256,
        originalSha256: originalSha,
      }),
    );
    return {
      phase: "edit",
      passed: checks.length,
      checks,
      proofSha256,
      originalSha256: originalSha,
    };
  } finally {
    URL.createObjectURL = createURL;
    urls.clear();
    store.close();
  }
})();
