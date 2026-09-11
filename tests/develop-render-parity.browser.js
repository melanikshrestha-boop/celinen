// Real browser control test on the reserved public-fixture benchmark shoot only.
// No customer library writes, external transfers, or OS downloads.
return await (async () => {
  const shoot = "eeaf3000-1111-4222-8333-000000000097";
  const requestedEdge = globalThis.fotoParityExportEdge === 8192 ? 8192 : 4096;
  if (
    location.origin !== "http://127.0.0.1:8085" ||
    location.pathname !== `/shoots/${shoot}/develop`
  )
    throw new Error("Use only the reserved public-fixture parity route");
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
    throw new Error("Reserved fixture contents changed; refusing writes");
  const check = (name, passed) => {
    if (!passed) throw new Error(name);
    checks.push(name);
  };
  const checks = [],
    urls = new Map();
  const createURL = URL.createObjectURL,
    clickAnchor = HTMLAnchorElement.prototype.click;
  let download = null;
  URL.createObjectURL = function (blob) {
    const url = createURL.call(URL, blob);
    urls.set(url, blob);
    return url;
  };
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && this.href.startsWith("blob:")) {
      download = { name: this.download, blob: urls.get(this.href) };
      return;
    }
    return clickAnchor.call(this);
  };
  const wait = async (predicate, label, ms = 45000) => {
    const end = performance.now() + ms;
    while (!predicate()) {
      if (performance.now() > end) throw new Error(label);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  const button = (label, scope = root) =>
    [...scope.querySelectorAll("button")].find(
      (node) => node.getAttribute("aria-label") === label || node.textContent.trim() === label,
    );
  const image = () => root.querySelector('.develop-image-frame img[alt="Developed photo"]');
  const settled = () =>
    image()?.naturalWidth &&
    !button("Export")?.disabled &&
    root.querySelector(".develop-histogram-control")?.getAttribute("aria-busy") === "false";
  const hash = async (blob) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  const setValue = async (label, value) => {
    const input = root.querySelector(`input[aria-label="${label}"]`);
    if (!input) throw new Error(`Missing ${label}`);
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
      input,
      String(value),
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    input.blur();
  };
  try {
    await wait(settled, "Initial image did not settle");
    const originalHash = await hash(
      initial.photos.find((p) => p.name === "sony-a6000.ARW").sourceBlob,
    );
    const initialRecipe = currentRecipe(
      initial.documents[initial.photos.find((p) => p.name === "sony-a6000.ARW").id],
    );
    const exposure = initialRecipe.exposure === 0.75 ? -0.35 : 0.75;
    const grain = initialRecipe.grain === 24 ? 12 : 24;
    const oldUrl = image().currentSrc;
    const oldPath = root.querySelector(".develop-histogram path")?.getAttribute("d");
    await setValue("Exposure value", exposure);
    await wait(
      () => image()?.currentSrc !== oldUrl && settled(),
      "Exposure did not produce a current image",
    );
    check(
      "exposure changes the measured histogram",
      root.querySelector(".develop-histogram path")?.getAttribute("d") !== oldPath,
    );
    const effects = [...root.querySelectorAll("summary")].find((node) =>
      node.textContent.includes("Effects"),
    );
    if (!effects.parentElement.open) effects.click();
    const exposureUrl = image().currentSrc;
    await setValue("Grain value", grain);
    await wait(
      () => image()?.currentSrc !== exposureUrl && settled(),
      "Grain did not finish rendering",
    );
    check("real grain control updates the displayed image", image().currentSrc !== exposureUrl);
    const persisted = await store.loadLibrary(),
      selected = persisted.photos.find((p) => p.name === "sony-a6000.ARW");
    const recipe = currentRecipe(persisted.documents[selected.id]);
    check(
      "exposure and grain are saved in the selected photo history",
      recipe.exposure === exposure && recipe.grain === grain,
    );
    check("source bytes remain unchanged", (await hash(selected.sourceBlob)) === originalHash);
    button("Export").click();
    await wait(() => root.querySelector('[role="dialog"]'), "Export dialog did not open");
    const dialog = root.querySelector('[role="dialog"]');
    const edgeInput = [...dialog.querySelectorAll("label")]
      .find((node) => node.textContent.trim().startsWith("Long edge"))
      ?.querySelector("select");
    if (!edgeInput) throw new Error("Missing export size control");
    if (Number(edgeInput.value) !== requestedEdge) {
      const previousUrl = image().currentSrc;
      edgeInput.value = String(requestedEdge);
      edgeInput.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(
        () => image()?.currentSrc !== previousUrl && settled(),
        "Selected export size did not produce the matching editor image",
      );
    }
    const editorBlob = urls.get(image().currentSrc);
    check(
      "editor is displaying captured native JPEG bytes",
      editorBlob instanceof Blob && editorBlob.type === "image/jpeg",
    );
    const editorHash = await hash(editorBlob);
    const dimensions = { width: image().naturalWidth, height: image().naturalHeight };
    if (requestedEdge === 8192)
      check(
        "opt-in preserves the public A6000 full sensor output dimensions",
        dimensions.width === 6024 && dimensions.height === 4024,
      );
    else
      check(
        "default export remains bounded to4096",
        Math.max(dimensions.width, dimensions.height) === 4096,
      );
    button("Preview export", dialog).click();
    await wait(
      () => dialog.querySelector(".develop-export-proof img")?.naturalWidth > 0,
      "Export proof did not load",
    );
    const proof = dialog.querySelector(".develop-export-proof img");
    check(
      "export proof is byte-identical to the edited image",
      (await hash(urls.get(proof.currentSrc))) === editorHash,
    );
    const exportButton = [...dialog.querySelectorAll("button")].find(
      (node) => /^Export/.test(node.textContent.trim()) && !node.disabled,
    );
    if (!exportButton) throw new Error("Missing final Export action");
    exportButton.click();
    await wait(() => download !== null, "Export did not hand off a download payload");
    check(
      "download payload is byte-identical to proof and editor",
      download.blob instanceof Blob && (await hash(download.blob)) === editorHash,
    );
    check("download retains the photo name as JPEG", download.name === "sony-a6000.jpg");
    const after = await store.loadLibrary();
    check(
      "the other two photo documents are untouched",
      initial.photos
        .filter((p) => p.id !== selected.id)
        .every(
          (p) => JSON.stringify(initial.documents[p.id]) === JSON.stringify(after.documents[p.id]),
        ),
    );
    return {
      passed: checks.length,
      checks,
      requestedEdge,
      dimensions,
      editorProofDownloadSha256: editorHash,
      originalSha256: originalHash,
      downloadName: download.name,
      note: "Download anchor intercepted to inspect payload; no OS save or customer photo claimed.",
    };
  } finally {
    URL.createObjectURL = createURL;
    HTMLAnchorElement.prototype.click = clickAnchor;
    urls.clear();
    store.close();
  }
})();
