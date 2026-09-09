// Run only in a disposable local QA browser AFTER importing the three public
// fixtures through the real Studio drop handler. No customer namespace accepted.
return await (async () => {
  const shoot = "eeaf3000-1111-4222-8333-193901d95331";
  const base = `/shoots/${shoot}`;
  if (location.origin !== "http://127.0.0.1:8085" || !location.pathname.startsWith(base + "/"))
    throw new Error("Reserved integration QA shoot required.");
  const checks = [];
  const check = (name, valid) => {
    if (!valid) throw new Error(name);
    checks.push(name);
  };
  const wait = async (name, predicate, timeout = 30000) => {
    const end = performance.now() + timeout;
    while (performance.now() < end) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out: ${name}`);
  };
  const api = await import("/src/lib/develop/store.ts");
  const store = api.createDevelopStore({ scope: "device-local", libraryId: `shoot:${shoot}` });
  const originalCreateURL = URL.createObjectURL;
  const capturedBlobs = new Map();
  URL.createObjectURL = function (blob) {
    const url = originalCreateURL.call(URL, blob);
    capturedBlobs.set(url, blob);
    return url;
  };
  const expected = [
    [
      "basketball-action-usaf-pd.jpg",
      3032556,
      "716ebc16299ef61adf2e73ad798505d67fc4dfa0dfab0bed228f13834d50ab5a",
    ],
    [
      "sony-a6000.ARW",
      25624576,
      "ce8b4957281a817d52a07a691e2468567b6c78223bd0b514ffc1c65b002b8d89",
    ],
    [
      "sony-a7iv-small.ARW",
      22933504,
      "cbbd0930c7d8706dff84c68a2004454266e6fd0d8354f5f76a106b5d776e0223",
    ],
  ];
  const hash = async (blob) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  const verifySources = async (label) => {
    const library = await store.loadLibraryWithManifest();
    check(
      `${label}: exact three-photo order`,
      library.photos.length === 3 &&
        library.photos.every((photo, i) => photo.name === expected[i][0]),
    );
    for (let i = 0; i < expected.length; i++) {
      const photo = library.photos[i];
      check(
        `${label}: ${photo.name} original and identity intact`,
        photo.id === `sha256:${expected[i][2]}` &&
          photo.sourceBlob?.size === expected[i][1] &&
          (await hash(photo.sourceBlob)) === expected[i][2],
      );
    }
    return library;
  };
  const navigate = async (name) => {
    const link = document.querySelector(`.shoot-workflow-tabs a[href$="/${name}"]`);
    if (!link) throw new Error(`Missing ${name} navigation`);
    link.click();
    await wait(`${name} route`, () => location.pathname === `${base}/${name}`);
  };
  const root = () => document.querySelector(".foto-develop");
  const button = (label) =>
    [...(root()?.querySelectorAll("button") ?? [])].find(
      (element) =>
        element.textContent.trim() === label || element.getAttribute("aria-label") === label,
    );
  const ready = () =>
    root()?.querySelector(".develop-image-frame img")?.naturalWidth > 0 &&
    !button("Remove Object")?.disabled;
  try {
    await verifySources("before");
    if (!location.pathname.endsWith("/develop")) await navigate("develop");
    await wait("full Develop image", ready);
    check(
      "sole full Develop controls present",
      !!root().querySelector('[aria-label="Exposure value"]') &&
        root().textContent.includes("Color Grading"),
    );
    const slider = root().querySelector('input[type="range"][aria-label="Exposure"]');
    if (!slider) throw new Error("Exposure slider missing");
    const exposure = slider.value === "0.85" ? "0.95" : "0.85";
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(slider, exposure);
    const started = performance.now();
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const clickAt = performance.now() - started;
    check("navigation begins before legacy 350 ms delay", clickAt < 350);
    await navigate("cull");
    let library = await store.loadLibraryWithManifest();
    const id = library.photos[0].id;
    check(
      "draft is durable before Cull navigation completes",
      api.currentRecipe(library.documents[id]).exposure === Number(exposure),
    );
    const keepButton = () =>
      [...document.querySelectorAll("button")].find(
        (element) => element.textContent.trim() === "Keep · K",
      );
    await wait("Cull review controls ready", () => keepButton() && !keepButton().disabled);
    const keep = keepButton();
    check("Cull can review this same source", !!keep && !keep.disabled);
    keep.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    [...document.querySelectorAll("button[aria-label]")]
      .find((element) => element.getAttribute("aria-label").startsWith(expected[0][0] + " ·"))
      ?.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await navigate("develop");
    await wait("same full Develop source after Cull", ready);
    library = await store.loadLibraryWithManifest();
    check(
      "Cull pick reaches the canonical document",
      library.documents[id].metadata.flag === "pick",
    );
    check("selection survives hidden Cull saves", library.manifest.selectedId === id);
    check(
      "edit survives Cull roundtrip",
      api.currentRecipe(library.documents[id]).exposure === Number(exposure),
    );
    check(
      "rendered editor uses saved exposure",
      root().querySelector('[aria-label="Exposure value"]').value === exposure,
    );
    const shown = capturedBlobs.get(root().querySelector(".develop-image-frame img").src);
    check("displayed edited JPEG has a captured renderer receipt", shown instanceof Blob);
    const shownHash = await hash(shown);
    button("Export").click();
    await wait("export dialog", () => button("Preview export"));
    button("Preview export").click();
    await wait(
      "approved export proof",
      () => root().querySelector(".develop-export-proof img")?.naturalWidth > 0,
    );
    const proof = capturedBlobs.get(root().querySelector(".develop-export-proof img").src);
    check("editor pixels equal export proof bytes", (await hash(proof)) === shownHash);
    const originalClick = HTMLAnchorElement.prototype.click;
    let downloaded;
    try {
      HTMLAnchorElement.prototype.click = function () {
        if (this.download.endsWith(".jpg")) {
          downloaded = capturedBlobs.get(this.href);
          return;
        }
        return originalClick.call(this);
      };
      button("Export JPEG").click();
      await wait("actual downloaded JPEG", () => downloaded);
      check("download is byte-identical to approved proof", (await hash(downloaded)) === shownHash);
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
    }
    await verifySources("after");
    return {
      passed: checks.length,
      checks,
      navigationClickMs: clickAt,
      editedJpegSha256: shownHash,
      exposure,
      next: "Reload this reserved Develop route, then verify exposure and pick are still present.",
    };
  } finally {
    URL.createObjectURL = originalCreateURL;
    store.close();
  }
})();
