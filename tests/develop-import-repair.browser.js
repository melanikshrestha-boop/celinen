// Isolated real-browser regression. Run once to seed, reload, then run again.
// Uses only a reserved QA library and the repository's public-domain JPEG.
return await (async () => {
  const shoot = "eeaf3000-1111-4222-8333-000000000081";
  if (
    location.origin !== "http://127.0.0.1:8085" ||
    location.pathname !== `/shoots/${shoot}/develop`
  )
    throw new Error("Use only the reserved import-repair QA route");
  const module = await import("/src/lib/develop/store.ts");
  const { defaultDevelopSettings } = await import("/src/lib/develop/contract.ts");
  const store = module.createDevelopStore({ scope: "device-local", libraryId: `shoot:${shoot}` });
  const marker = `foto:qa:import-repair:${shoot}`;
  const action = globalThis.fotoImportRepairAction || "reimport";
  const checks = [];
  const check = (name, value) => {
    if (!value) throw new Error(name);
    checks.push(name);
  };
  const wait = async (predicate, message, duration = 30000) => {
    const end = Date.now() + duration;
    while (!predicate()) {
      if (Date.now() > end) throw new Error(message);
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
  };
  const root = () => document.querySelector(".foto-develop");
  const button = (label) =>
    [...root().querySelectorAll("button")].find(
      (node) => node.getAttribute("aria-label") === label || node.textContent.trim() === label,
    );
  const blob = await (await fetch("/tests/fixtures/photos/basketball-action-usaf-pd.jpg")).blob();
  const file = new File([blob], "qa-reimport-original.jpg", { type: "image/jpeg" });
  const bitmap = await createImageBitmap(blob);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  const identified = await module.developPhotoFromFile(file, blob, dimensions);
  try {
    const saved = sessionStorage.getItem(marker);
    if (action !== "reimport") {
      if (!saved) throw new Error("Seed and verify the original reimport first");
      const baseline = JSON.parse(saved);
      const verifyPreserved = async () => {
        const library = await store.loadLibrary();
        check(
          "all 337 missing records remain",
          library.photos.filter((photo) => photo.id.startsWith("studio:qa-import-repair-"))
            .length === 337,
        );
        check(
          "all 337 legacy photo records remain byte-identical",
          JSON.stringify(
            library.photos.filter((photo) => photo.id.startsWith("studio:qa-import-repair-")),
          ) === JSON.stringify(baseline.legacyPhotos),
        );
        check(
          "every pre-existing edit document is unchanged",
          Object.entries(baseline.documents).every(
            ([id, doc]) => JSON.stringify(library.documents[id]) === JSON.stringify(doc),
          ),
        );
        return library;
      };
      const ready = () =>
        !button("Export")?.disabled &&
        root().querySelector(".develop-image-frame img")?.naturalWidth > 0;
      if (action === "verify-upload") {
        await wait(
          () => root().querySelector('[role="status"]')?.textContent.includes("2 photos imported"),
          "Mixed chooser import did not finish",
          60000,
        );
        await wait(ready, "Chooser import did not display real pixels", 60000);
        const library = await verifyPreserved();
        const originals = library.photos.filter((photo) => photo.sourceBlob?.size);
        check(
          "raster and RAW survived corrupt-first chooser import",
          originals.length === 3 &&
            originals.some((photo) => photo.name === "sony-a7iv-small.ARW") &&
            originals.some((photo) => photo.name === "volleyball-portrait-cc0.jpg"),
        );
        check(
          "each chooser failure is reported",
          root().querySelectorAll(".develop-import-report li").length === 2,
        );
        const raw = originals.find((photo) => photo.name === "sony-a7iv-small.ARW");
        const hash = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", await raw.sourceBlob.arrayBuffer())),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join("");
        check(
          "Sony original bytes retain their verified fixture hash",
          hash === "cbbd0930c7d8706dff84c68a2004454266e6fd0d8354f5f76a106b5d776e0223",
        );
        return { passed: checks.length, checks };
      }
      if (action === "drop") {
        const canvas = document.createElement("canvas");
        canvas.width = 480;
        canvas.height = 320;
        const context = canvas.getContext("2d");
        context.fillStyle = "#736652";
        context.fillRect(0, 0, 480, 320);
        context.fillStyle = "#cfbfb6";
        context.fillRect(130, 80, 210, 190);
        const image = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        const transfer = new DataTransfer();
        transfer.items.add(new File(["not an image"], "bad-drop.jpg", { type: "image/jpeg" }));
        transfer.items.add(new File([image], "qa-live-drop.png", { type: "image/png" }));
        root().dispatchEvent(
          new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
        );
        await wait(
          () => root().querySelector('[role="status"]')?.textContent.includes("1 photo imported"),
          "Drop import did not finish",
          60000,
        );
        await wait(ready, "Dropped image did not render");
        const library = await verifyPreserved();
        check(
          "bad first dropped image does not block valid PNG",
          library.photos.some(
            (photo) => photo.name === "qa-live-drop.png" && photo.sourceBlob?.size,
          ),
        );
        check(
          "drop reports the failing filename",
          root().querySelector(".develop-import-report")?.textContent.includes("bad-drop.jpg"),
        );
        check(
          "newly dropped photo is selected immediately",
          root()
            .querySelector(".develop-filmstrip-items .is-active")
            ?.textContent.includes("qa-live-drop.png"),
        );
        return { passed: checks.length, checks };
      }
      if (action === "reload") {
        await wait(ready, "Reloaded image did not render", 60000);
        const library = await verifyPreserved();
        check(
          "four imported originals survive reload",
          library.photos.filter((photo) => photo.sourceBlob?.size).length === 4,
        );
        check(
          "filmstrip contains real imported media only",
          root().querySelectorAll(".develop-filmstrip-items button").length === 4,
        );
        check("missing photos do not produce 337 placeholder tiles", library.photos.length === 341);
        check(
          "shared sans-serif font is loaded",
          getComputedStyle(root()).fontFamily.includes("OpenAI Sans") &&
            document.fonts.check('14px "OpenAI Sans"'),
        );
        check(
          "viewport has no horizontal page overflow",
          document.documentElement.scrollWidth <= innerWidth,
        );
        return { passed: checks.length, checks };
      }
      throw new Error("Unknown QA action");
    }
    if (!saved) {
      const library = await store.loadLibrary();
      if (library.photos.length)
        throw new Error("Reserved QA library must start empty; refusing to replace it");
      check(
        "empty library has no editing controls",
        !root().querySelector('input[aria-label="Exposure value"]'),
      );
      check(
        "empty library has no placeholder filmstrip",
        !root().querySelector(".develop-filmstrip-items"),
      );
      const missing = Array.from({ length: 337 }, (_, index) => ({
        ...identified,
        id: `studio:qa-import-repair-${index}`,
        name: `legacy-${index}.jpg`,
        sourceFileName: `legacy-${index}.jpg`,
        sourceBlob: null,
        previewBlob: null,
        sourceDigest: null,
        initialState: {
          settings: { ...defaultDevelopSettings(), exposure: (index % 9) / 10 },
          metadata: { rating: index % 6, flag: "pick", colorLabel: "green" },
        },
      }));
      await store.addPhotos([
        ...missing,
        {
          ...identified,
          sourceBlob: null,
          previewOrigin: "raster",
          initialState: {
            settings: { ...defaultDevelopSettings(), exposure: 0.75, temperature: 12 },
            metadata: { rating: 4, flag: "pick", colorLabel: "blue" },
          },
        },
      ]);
      const seeded = await store.loadLibrary();
      sessionStorage.setItem(
        marker,
        JSON.stringify({
          photoId: identified.id,
          documents: seeded.documents,
          legacyPhotos: seeded.photos.filter((photo) =>
            photo.id.startsWith("studio:qa-import-repair-"),
          ),
          beforeChecks: checks,
        }),
      );
      return { seeded: 337, previewOnly: 1, checks, next: "Reload this QA route, then run again" };
    }
    const baseline = JSON.parse(saved);
    check("test source identity unchanged", baseline.photoId === identified.id);
    await wait(
      () => root()?.querySelector('input[aria-label="Exposure value"]'),
      "Preview-only editor did not load",
    );
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = root().querySelector('input[type="file"][aria-label="Import photos"]');
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(
      () => root().querySelector('[role="status"]')?.textContent.includes("imported"),
      "Reimport did not finish",
    );
    await wait(() => !root().querySelector(".develop-workspace").inert, "Import did not settle");
    const after = await store.loadLibrary();
    const restored = after.photos.find((photo) => photo.id === identified.id);
    check(
      "preview-only reimport attaches the exact original",
      restored.sourceBlob?.size === file.size,
    );
    check(
      "reimport is not reported as a skipped duplicate",
      root().querySelector('[role="status"]').textContent.includes("1 photo imported"),
    );
    check("saved photo identity is retained without duplication", after.photos.length === 338);
    check(
      "337 legacy records and all edit documents remain byte-identical",
      JSON.stringify(after.documents) === JSON.stringify(baseline.documents) &&
        JSON.stringify(
          after.photos.filter((photo) => photo.id.startsWith("studio:qa-import-repair-")),
        ) === JSON.stringify(baseline.legacyPhotos),
    );
    const beforeBytes = new Uint8Array(await file.arrayBuffer());
    const afterBytes = new Uint8Array(await restored.sourceBlob.arrayBuffer());
    check(
      "reconnected original bytes are identical",
      beforeBytes.length === afterBytes.length &&
        beforeBytes.every((byte, index) => byte === afterBytes[index]),
    );
    check(
      "saved exposure remains active",
      root().querySelector('input[aria-label="Exposure value"]').value === "0.75",
    );
    return {
      passed: checks.length + baseline.beforeChecks.length,
      checks: [...baseline.beforeChecks, ...checks],
    };
  } finally {
    store.close();
  }
})();
