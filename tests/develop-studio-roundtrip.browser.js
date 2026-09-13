// Run in a fresh, disposable LAB browser at the reserved Studio URL below.
// Re-run after a real reload when state says reload-required. Never a RAW benchmark.
// Exercises the actual file-input change event, React router, save queue and IndexedDB.
const shoot = new URL(location.href).searchParams.get("shoot") ?? location.pathname.split("/")[2];
if (!/^eeaf3000-1111-4222-8333-1c13570904[0-9]{2}$/.test(shoot ?? ""))
  throw new Error("An explicitly reserved QA shoot is required.");
const marker = `foto:qa:studio-roundtrip:${shoot}`;
if (location.origin !== "http://127.0.0.1:8085")
  throw new Error("This fixture only accepts the isolated local LAB.");
if (window.celinenStudioRoundtrip?.state === "running") return window.celinenStudioRoundtrip;
window.celinenStudioRoundtrip = { state: "running", checks: [] };
void (async () => {
  const result = window.celinenStudioRoundtrip;
  const check = (name, valid) => {
    if (!valid) throw new Error(name);
    result.checks.push(name);
  };
  const wait = async (name, predicate) => {
    const end = performance.now() + 30000;
    while (performance.now() < end) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error(`Timed out: ${name}`);
  };
  const { isLocalSingleUserMode } = await import("/src/lib/app-mode.ts");
  check("isolated LAB identity", isLocalSingleUserMode);
  const api = await import("/src/lib/develop/store.ts");
  const store = api.createDevelopStore({ scope: "device-local", libraryId: `shoot:${shoot}` });
  const root = () => document.querySelector(".foto-develop");
  const exposure = () => root()?.querySelector('[aria-label="Exposure value"]');
  const ready = () =>
    exposure() &&
    !exposure().disabled &&
    root()?.querySelector(".develop-image-frame img")?.naturalWidth > 0;
  const hash = async (blob) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  const base = `/shoots/${shoot}`;
  const router = window.__TSR_ROUTER__;
  check("actual app router available", typeof router?.navigate === "function");
  const previous = sessionStorage.getItem(marker);
  const createURL = URL.createObjectURL;
  const confirm = window.confirm;
  result.confirmations = [];
  window.confirm = (message) => {
    result.confirmations.push(String(message));
    if (String(message).startsWith("Develop still has work that has not finished saving."))
      return true;
    throw new Error(`Unexpected confirmation: ${message}`);
  };
  const blobs = new Map();
  URL.createObjectURL = function (blob) {
    const url = createURL.call(URL, blob);
    blobs.set(url, blob);
    return url;
  };
  try {
    if (!previous) {
      check(
        "reserved standalone Studio route",
        location.pathname === "/studio" &&
          new URL(location.href).searchParams.get("shoot") === shoot,
      );
      const before = await store.loadLibraryWithManifest();
      check(
        "no existing library will be overwritten",
        !before.photos.length && !before.manifest.photoIds.length,
      );
      const files = [];
      for (const [i, color] of ["#887755", "#447766", "#665588"].entries()) {
        const canvas = document.createElement("canvas");
        canvas.width = 480;
        canvas.height = 320;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 480, 320);
        ctx.fillStyle = "#cfcfcf";
        ctx.fillRect(30, 30, 80 + i * 50, 200);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
        files.push(
          new File([blob], `qa-studio-${i + 1}.jpg`, { type: "image/jpeg", lastModified: 1 }),
        );
      }
      const digests = await Promise.all(files.map(hash));
      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));
      const input = document.querySelector("#foto-files");
      check("real Studio file input ready", input && !input.disabled);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await wait("automatic full Develop route", () => location.pathname === `${base}/develop`);
      await wait("usable full editor", ready);
      check(
        "full editor, not legacy Canvas controls",
        root().textContent.includes("Color Grading"),
      );
      await wait(
        "three durable originals",
        async () => (await store.loadLibraryWithManifest()).photos.length === 3,
      );
      const imported = await store.loadLibraryWithManifest();
      const ids = imported.photos.map((p) => p.id);
      check(
        "first imported photo is active",
        root().querySelector("button[data-photo-id].is-active")?.dataset.photoId === ids[0],
      );
      check(
        "exact verified IDs in original file order",
        ids.every((id, i) => id === `sha256:${digests[i]}`),
      );
      for (const [i, photo] of imported.photos.entries())
        check(
          `original bytes preserved: ${photo.name}`,
          (await hash(photo.sourceBlob)) === digests[i],
        );
      const slider = root().querySelector('input[type="range"][aria-label="Exposure"]');
      check("real Exposure slider ready", slider && !slider.disabled);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(slider, "0.85");
      const editAt = performance.now();
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise(requestAnimationFrame);
      check("edited draft is visible", Number(exposure().value) === 0.85);
      result.navigationMs = performance.now() - editAt;
      check("Cull navigation starts before legacy 350ms delay", result.navigationMs < 350);
      await router.navigate({ href: `${base}/cull` });
      await wait("Cull route", () => location.pathname === `${base}/cull`);
      const saved = await store.loadLibraryWithManifest();
      check(
        "edit committed before Cull navigation completes",
        api.currentRecipe(saved.documents[ids[0]]).exposure === 0.85,
      );
      const keep = () =>
        [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Keep · K");
      await wait("Cull same-photo controls", () => keep() && !keep().disabled);
      keep().click();
      await wait(
        "Cull pick committed",
        async () => (await store.readPhoto(ids[0])).document.metadata.flag === "pick",
      );
      await router.navigate({ href: `${base}/develop?photo=${encodeURIComponent(ids[0])}` });
      await wait("Develop roundtrip", ready);
      check("roundtrip kept exposure", Number(exposure().value) === 0.85);
      sessionStorage.setItem(
        marker,
        JSON.stringify({
          shoot,
          ids,
          digests,
          checks: result.checks,
          navigationMs: result.navigationMs,
          timeOrigin: performance.timeOrigin,
        }),
      );
      result.state = "reload-required";
      return;
    }
    const state = JSON.parse(previous);
    check(
      "owned QA reload state",
      state.shoot === shoot && state.ids.length === 3 && state.digests.length === 3,
    );
    result.checks = [...state.checks, ...result.checks];
    check("real reload occurred", performance.timeOrigin > state.timeOrigin);
    check(
      "exact reload route",
      location.pathname === `${base}/develop` &&
        new URL(location.href).searchParams.get("photo") === state.ids[0],
    );
    await wait("reloaded full editor", ready);
    const library = await store.loadLibraryWithManifest();
    check(
      "IDs and order survive reload",
      JSON.stringify(library.photos.map((p) => p.id)) === JSON.stringify(state.ids),
    );
    check(
      "edit and history survive reload",
      Number(exposure().value) === 0.85 &&
        api.currentRecipe(library.documents[state.ids[0]]).exposure === 0.85 &&
        library.documents[state.ids[0]].history.length >= 2,
    );
    check("Cull pick survives reload", library.documents[state.ids[0]].metadata.flag === "pick");
    for (const [i, photo] of library.photos.entries())
      check(
        `reload original bytes preserved: ${photo.name}`,
        (await hash(photo.sourceBlob)) === state.digests[i],
      );
    const button = (label) =>
      [...root().querySelectorAll("button")].find(
        (b) => b.textContent.trim() === label || b.getAttribute("aria-label") === label,
      );
    await wait("finished edited preview", () => {
      const remove = button("Remove Object");
      return remove && !remove.disabled;
    });
    const pixels = async (img) => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return {
        width: canvas.width,
        height: canvas.height,
        digest: await hash(new Blob([ctx.getImageData(0, 0, canvas.width, canvas.height).data])),
      };
    };
    const displayed = await pixels(root().querySelector(".develop-image-frame img"));
    button("Export").click();
    await wait("export dialog", () => button("Preview export"));
    button("Preview export").click();
    await wait(
      "export proof",
      () => root().querySelector(".develop-export-proof img")?.naturalWidth > 0,
    );
    const proof = blobs.get(root().querySelector(".develop-export-proof img").src);
    check("real rendered proof captured", proof instanceof Blob);
    check(
      "displayed edit pixels equal export proof",
      JSON.stringify(displayed) ===
        JSON.stringify(await pixels(root().querySelector(".develop-export-proof img"))),
    );
    const click = HTMLAnchorElement.prototype.click;
    let download;
    try {
      HTMLAnchorElement.prototype.click = function () {
        if (this.download.endsWith(".jpg")) {
          download = blobs.get(this.href);
          return;
        }
        return click.call(this);
      };
      button("Export JPEG").click();
      await wait("real export download bytes", () => download);
      check(
        "download byte-identical to approved proof",
        (await hash(download)) === (await hash(proof)),
      );
    } finally {
      HTMLAnchorElement.prototype.click = click;
    }
    result.state = "passed";
    result.proofSha256 = await hash(proof);
    result.navigationMs = state.navigationMs;
    result.cleanup =
      "Reserved synthetic fixture remains in the disposable QA browser for inspection; no customer records accessed.";
  } finally {
    window.confirm = confirm;
    URL.createObjectURL = createURL;
    store.close();
  }
})().catch((error) => {
  window.celinenStudioRoundtrip.state = "failed";
  window.celinenStudioRoundtrip.error = String(error?.stack ?? error);
});
return window.celinenStudioRoundtrip;
