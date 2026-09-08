// Run on reserved synthetic reconnect007 or imported public RAW fixture009 only.
return await (async () => {
  const shoot = new URL(location.href).searchParams.get("shoot");
  if (
    location.hostname !== "127.0.0.1" ||
    location.port !== "8085" ||
    !["eeaf3000-1111-4222-8333-000000000007", "eeaf3000-1111-4222-8333-000000000009"].includes(
      shoot,
    )
  )
    throw new Error("Only reserved export-proof QA projects are allowed");
  const root = () => document.querySelector(".foto-develop");
  const checks = [],
    requests = [],
    blobs = new Map();
  const check = (name, value) => {
    if (!value) throw new Error(name);
    checks.push(name);
  };
  const wait = async (predicate, message, timeout = 45000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 80));
    }
    throw new Error(message);
  };
  const button = (label) =>
    [...root().querySelectorAll("button")].find(
      (b) => b.textContent.trim() === label || b.getAttribute("aria-label") === label,
    );
  const click = async (label) => {
    const b = button(label);
    if (!b || b.matches(":disabled")) throw new Error(`Unavailable ${label}`);
    b.click();
    await new Promise((r) => setTimeout(r, 100));
  };
  const readyProof = () => {
    const image = root().querySelector(".develop-export-proof img");
    return image?.complete && image.naturalWidth > 0 && !button("Export JPEG")?.disabled;
  };
  const fetchOriginal = window.fetch,
    createURL = URL.createObjectURL,
    anchorClick = HTMLAnchorElement.prototype.click;
  let exported = null;
  try {
    await wait(() => button("Export") && !button("Export").disabled, "Editor not ready");
    window.fetch = async function (resource, init) {
      if (String(resource).endsWith("/__develop/render") && init?.body instanceof Blob) {
        const bytes = await init.body.slice(0, 4).arrayBuffer();
        const size = new DataView(bytes).getUint32(0, false);
        requests.push(JSON.parse(await init.body.slice(4, size + 4).text()));
      }
      return fetchOriginal.call(this, resource, init);
    };
    URL.createObjectURL = function (blob) {
      const url = createURL.call(URL, blob);
      blobs.set(url, blob);
      return url;
    };
    HTMLAnchorElement.prototype.click = function () {
      if (this.download.endsWith("-foto.jpg")) {
        exported = blobs.get(this.href);
        return;
      }
      return anchorClick.call(this);
    };
    await click("Export");
    check("dialog offers an explicit real export preview", Boolean(button("Preview export")));
    const source = [...root().querySelectorAll("[role=dialog] select")].find((s) =>
      [...s.options].some((o) => o.value === "raw"),
    );
    const expectedSource = source ? "raw" : "preview";
    await click("Preview export");
    await wait(readyProof, "First native export proof did not render");
    check(
      "proof uses requested source and full selected export edge",
      requests.at(-1)?.sourceMode === expectedSource && requests.at(-1)?.edge === 4096,
    );
    const firstImage = root().querySelector(".develop-export-proof img");
    const firstBlob = blobs.get(firstImage.src);
    const bytes = new Uint8Array(await firstBlob.arrayBuffer());
    check(
      "proof is a decodable JPEG, not an editor screenshot",
      bytes[0] === 255 && bytes[1] === 216 && firstImage.naturalWidth > 0,
    );
    check(
      "proof disclosure explains exact downloadable bytes and soft-proof limit",
      root()
        .querySelector(".develop-export-proof figcaption")
        .textContent.includes("this exact file") &&
        root()
          .querySelector(".develop-export-proof figcaption")
          .textContent.includes("not a print soft proof"),
    );
    await click("Export preview at 100 percent");
    check(
      "actual-pixel inspection provides a scrollable preview",
      root().querySelector(".develop-export-proof > div").classList.contains("is-actual-size"),
    );
    await click("Export preview at 100 percent");
    const quality = root().querySelector("[role=dialog] input[type=number]");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(quality, "80");
    quality.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(
      () => !root().querySelector(".develop-export-proof img"),
      "Old proof remained visible after quality changed",
    );
    check(
      "changed quality immediately hides the stale proof",
      root().textContent.includes("Preview again to inspect the new file"),
    );
    if (source) {
      source.value = "preview";
      source.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      await click("Preview export");
      await wait(readyProof, "Embedded preview proof failed");
      check(
        "changing RAW source renders the explicitly selected preview",
        requests.at(-1)?.sourceMode === "preview",
      );
      source.value = "raw";
      source.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(
        () => !root().querySelector(".develop-export-proof img"),
        "RAW source switch retained old proof",
      );
      check(
        "switching back to sensor RAW invalidates preview-source pixels",
        Boolean(button("Preview export")),
      );
    }
    await click("Preview export");
    await wait(readyProof, "Updated proof failed");
    check("changed quality reaches native renderer", requests.at(-1)?.quality === 0.8);
    const proofBlob = blobs.get(root().querySelector(".develop-export-proof img").src);
    const count = requests.length;
    await click("Export JPEG");
    await wait(() => exported && !root().querySelector("[role=dialog]"), "Proof download failed");
    check("download reuses the exact Blob inspected in preview", exported === proofBlob);
    check(
      "downloading a current proof does not rerender different bytes",
      requests.length === count,
    );
    await click("Export");
    check(
      "reopening export does not retain an old proof",
      !root().querySelector(".develop-export-proof img"),
    );
    await click("Cancel");
    return {
      passed: checks.length,
      checks,
      source: expectedSource,
      renders: requests.length,
      note: "Real native requests and exact downloadable Blob identity; test projects only. No customer edits or exports.",
    };
  } finally {
    window.fetch = fetchOriginal;
    URL.createObjectURL = createURL;
    HTMLAnchorElement.prototype.click = anchorClick;
  }
})();
