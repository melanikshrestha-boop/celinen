// Test only preparation/cancellation, never apply or save a removal to the fixture.
return await (async () => {
  const shoot = "eeaf3000-1111-4222-8333-000000000097";
  if (
    location.origin !== "http://127.0.0.1:8085" ||
    location.pathname !== `/shoots/${shoot}/develop`
  )
    throw new Error("Reserved public-fixture route required");
  const root = document.querySelector(".foto-develop");
  const { createDevelopStore } = await import("/src/lib/develop/store.ts");
  const store = createDevelopStore({ scope: "device-local", libraryId: `shoot:${shoot}` });
  const before = await store.loadLibrary();
  if (
    before.photos.length !== 3 ||
    !before.photos.every((p) =>
      ["sony-a6000.ARW", "sony-a7iv-small.ARW", "volleyball-portrait-cc0.jpg"].includes(p.name),
    )
  )
    throw new Error("Unexpected fixtures");
  const checks = [],
    requests = [],
    originalFetch = window.fetch;
  const check = (name, ok) => {
    if (!ok) throw new Error(name);
    checks.push(name);
  };
  const wait = async (predicate, label) => {
    const until = performance.now() + 45000;
    while (!predicate()) {
      if (performance.now() > until) throw new Error(label);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  };
  const button = (label, scope = root) =>
    [...scope.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === label || b.textContent.trim() === label,
    );
  const dialog = () => root.querySelector('[role="dialog"]');
  const image = () => root.querySelector('.develop-image-frame img[alt="Developed photo"]');
  try {
    await wait(() => image()?.complete && !button("Export").disabled, "Editor not ready");
    button("Export").click();
    await wait(dialog, "Export dialog unavailable");
    const input = [...dialog().querySelectorAll("label")]
      .find((n) => n.textContent.trim().startsWith("Long edge"))
      .querySelector("select");
    input.value = "8192";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(
      () =>
        image()?.complete &&
        image().naturalWidth === 6024 &&
        root.querySelector(".develop-histogram-control").getAttribute("aria-busy") === "false",
      "Full-resolution editor not ready",
    );
    button("Cancel", dialog()).click();
    await wait(() => !dialog(), "Export dialog did not close");
    const editorUrl = image().currentSrc;
    window.fetch = async function (resource, init) {
      if (String(resource) === "/__develop/render" && init?.body instanceof Blob) {
        const length = new DataView(await init.body.slice(0, 4).arrayBuffer()).getUint32(0);
        requests.push(JSON.parse(await init.body.slice(4, 4 + length).text()));
      }
      return originalFetch.call(this, resource, init);
    };
    button("Remove Object").click();
    await wait(
      () =>
        dialog()?.querySelector(".foto-object-image img")?.complete &&
        dialog().querySelector(".foto-object-image img").naturalWidth,
      "Removal render did not load",
    );
    const preview = dialog().querySelector(".foto-object-image img");
    check(
      "larger editor stays at its selected resolution",
      image().naturalWidth === 6024 && image().currentSrc === editorUrl,
    );
    check(
      "removal prepares only a bounded4096copy",
      Math.max(preview.naturalWidth, preview.naturalHeight) === 4096,
    );
    check(
      "removal native request uses its independent cap",
      requests.length === 1 && requests[0].edge === 4096,
    );
    check(
      "copy resolution is disclosed",
      dialog().textContent.includes("up to 4,096 px") &&
        dialog().textContent.includes("original and edits stay intact"),
    );
    await wait(
      () => button("Cancel", dialog()) && !button("Cancel", dialog()).disabled,
      "Removal preparation did not release its lock",
    );
    button("Cancel", dialog()).click();
    await wait(
      () => !dialog() && !button("Export").disabled,
      "Cancellation did not unlock editing",
    );
    button("Export").click();
    await wait(dialog, "Export dialog did not reopen");
    const edge = [...dialog().querySelectorAll("label")]
      .find((n) => n.textContent.trim().startsWith("Long edge"))
      .querySelector("select").value;
    check("removal does not overwrite export-size preference", edge === "8192");
    button("Cancel", dialog()).click();
    const after = await store.loadLibrary();
    check(
      "preparation and cancellation leave all photo histories unchanged",
      JSON.stringify(before.documents) === JSON.stringify(after.documents),
    );
    check(
      "no removal copy is saved without confirmation",
      after.photos.length === before.photos.length &&
        after.photos.every((p, i) => p.id === before.photos[i].id),
    );
    return {
      passed: checks.length,
      checks,
      editorDimensions: { width: 6024, height: 4024 },
      removalDimensions: { width: preview.naturalWidth, height: preview.naturalHeight },
    };
  } finally {
    window.fetch = originalFetch;
    const cancel = dialog() && button("Cancel", dialog());
    if (cancel && !cancel.disabled) cancel.click();
    store.close();
  }
})();
