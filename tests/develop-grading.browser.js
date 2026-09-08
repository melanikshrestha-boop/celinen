// Browser-eval body. Real React handlers, IndexedDB receipts and native previews.
// ONLY the reserved synthetic reconnect fixture is permitted. Pointer-capture
// methods are shimmed on one wheel for synthetic pointer events, never globally.
// Cleanup undoes this run's edits, preserving the initial recipe and old history.
return await (async () => {
  const shoot = "eeaf3000-1111-4222-8333-000000000007";
  if (
    location.hostname !== "127.0.0.1" ||
    location.port !== "8085" ||
    location.pathname !== "/develop" ||
    new URL(location.href).searchParams.get("shoot") !== shoot
  )
    throw new Error("Use only the reserved reconnect QA route for color grading checks.");
  const { createDevelopStore, currentRecipe } = await import("/src/lib/develop/store.ts");
  const store = createDevelopStore({ scope: "device-local", libraryId: `shoot:${shoot}` });
  const root = () => document.querySelector(".foto-develop");
  const checks = [];
  const check = (name, pass) => {
    if (!pass) throw new Error(name);
    checks.push(name);
  };
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const wait = async (predicate, message) => {
    const limit = Date.now() + 22000;
    while (Date.now() < limit) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 70));
    }
    throw new Error(message);
  };
  const button = (label) => {
    const buttons = [...(root()?.querySelectorAll("button") ?? [])];
    return (
      buttons.find((b) => b.getAttribute("aria-label") === label) ??
      buttons.find((b) => b.textContent.trim() === label)
    );
  };
  const settled = async () => {
    await tick();
    await wait(
      () =>
        root()?.querySelector(".develop-save-status")?.textContent === "All edits saved" &&
        button("Export") &&
        !button("Export").disabled &&
        root()?.querySelector(".develop-image-frame img")?.naturalWidth > 0,
      "The saved recipe and native preview did not settle.",
    );
  };
  const click = async (label, saves = false) => {
    await wait(() => {
      const b = button(label);
      return b && !b.matches(":disabled") && b.getClientRects().length > 0;
    }, `Unavailable control: ${label}`);
    const b = button(label);
    b.focus();
    b.click();
    await tick();
    if (saves) await settled();
  };
  const snapshot = async () => {
    const library = await store.loadLibrary();
    if (
      library.photos.length !== 1 ||
      library.photos[0].id !== "studio:qa-reconnect" ||
      library.photos[0].name !== "reconnect-qa.png" ||
      !library.photos[0].sourceBlob?.size
    )
      throw new Error("This is not the expected isolated reconnected synthetic fixture.");
    return { photo: library.photos[0], doc: library.documents["studio:qa-reconnect"] };
  };
  const grade = async (range = "shadows") => currentRecipe((await snapshot()).doc).grading[range];
  const wheel = (range = "Shadows") => button(`${range} color wheel`);
  const number = async (label, value) => {
    const input = root().querySelector(`input[aria-label="${label} value"]`);
    if (!input || input.matches(":disabled") || !input.getClientRects().length)
      throw new Error(`Unavailable input: ${label}`);
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
      input,
      String(value),
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    input.blur();
    await settled();
  };
  const pixels = () => {
    const img = root().querySelector(".develop-image-frame img");
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 24;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, 32, 24);
    return Array.from(ctx.getImageData(0, 0, 32, 24).data).join(",");
  };
  const pointer = async (points, modifiers = {}, cancel = false, during = null) => {
    const target = wheel();
    if (!target || target.matches(":disabled")) throw new Error("Shadows wheel is unavailable");
    target.scrollIntoView({ block: "center" });
    const box = target.getBoundingClientRect();
    if (box.width < 30 || box.height < 30) throw new Error("Wheel has no usable geometry");
    const saved = new Map();
    let captured = false;
    const methods = {
      setPointerCapture: () => {
        captured = true;
      },
      hasPointerCapture: () => captured,
      releasePointerCapture: () => {
        captured = false;
      },
    };
    for (const [key, value] of Object.entries(methods)) {
      saved.set(key, Object.getOwnPropertyDescriptor(target, key));
      Object.defineProperty(target, key, { configurable: true, value });
    }
    const dispatch = async (type, p) => {
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 739,
          pointerType: "mouse",
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
          clientX: box.left + box.width / 2 + (p[0] * box.width) / 2,
          clientY: box.top + box.height / 2 + (p[1] * box.height) / 2,
          ...modifiers,
        }),
      );
      await tick();
    };
    try {
      await dispatch("pointerdown", points[0]);
      if (during) await during();
      for (const p of points.slice(1)) await dispatch("pointermove", p);
      await dispatch(cancel ? "pointercancel" : "pointerup", points.at(-1));
    } finally {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(target, key, descriptor);
        else delete target[key];
      }
    }
    await settled();
  };
  const key = async (type, name, options = {}) => {
    const target = wheel();
    target.focus();
    target.dispatchEvent(
      new KeyboardEvent(type, { bubbles: true, cancelable: true, key: name, ...options }),
    );
    await tick();
  };
  let baseline = null,
    failure = null;
  const cleanupErrors = [];
  try {
    const existing = await store.loadLibrary();
    if (
      !existing.photos.length &&
      !Object.keys(existing.documents).length &&
      !existing.presets.length
    ) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 128;
      const context = canvas.getContext("2d");
      const ramp = context.createLinearGradient(0, 0, 256, 0);
      ramp.addColorStop(0, "#080808");
      ramp.addColorStop(1, "#f8f8f8");
      context.fillStyle = ramp;
      context.fillRect(0, 0, 256, 128);
      for (const [index, color] of ["#522a22", "#274a32", "#253754"].entries()) {
        context.fillStyle = color;
        context.fillRect(index * 64 + 16, 88, 48, 24);
      }
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not generate synthetic QA image");
      const file = new File([blob], "reconnect-qa.png", { type: "image/png", lastModified: 1 });
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
      );
      const { defaultDevelopSettings } = await import("/src/lib/develop/contract.ts");
      const settings = defaultDevelopSettings();
      settings.exposure = 0.5;
      settings.temperature = 12;
      await store.addPhotos([
        {
          id: "studio:qa-reconnect",
          name: file.name,
          width: 256,
          height: 128,
          isRaw: false,
          sourceBlob: file,
          previewBlob: blob,
          previewOrigin: "raster",
          sourceFileName: file.name,
          sourceLastModified: file.lastModified,
          sourceDigest: `sha256:${Array.from(digest, (v) => v.toString(16).padStart(2, "0")).join("")}`,
          initialState: { settings, metadata: { rating: 4, flag: null, colorLabel: null } },
        },
      ]);
      return {
        phase: "seeded",
        photoId: "studio:qa-reconnect",
        note: "Generated one synthetic gradient PNG only in empty reserved QA7 library. Reload this same route, then run this script again.",
      };
    }
    await settled();
    if (root().querySelector("[role=dialog]"))
      throw new Error("Close dialogs before running this regression.");
    baseline = await snapshot();
    if (
      baseline.doc.cursor !== baseline.doc.history.length - 1 ||
      baseline.doc.history.length > 150
    ) {
      baseline = null;
      throw new Error("Fixture must have no existing redo branch and enough history capacity.");
    }
    const summary = [...root().querySelectorAll("summary")].find(
      (s) => s.textContent.trim() === "Color Grading",
    );
    if (!summary) throw new Error("Color Grading panel is missing");
    if (!summary.parentElement.open) summary.click();
    await tick();
    await click("Three-way color grading");
    check(
      "three-way view presents three actual hue/saturation wheels",
      root().querySelectorAll(".develop-grade-wheel").length === 3,
    );
    check(
      "wheels are accessible colored controls, not inert grey swatches",
      wheel().getAttribute("role") === "slider" &&
        getComputedStyle(wheel()).backgroundImage.includes("conic-gradient"),
    );
    check(
      "compact three-way wheel geometry fits the editing rail",
      wheel().getBoundingClientRect().width <= 96.5,
    );
    await click("Reset all color grading", true);
    const neutralPixels = pixels(),
      beforeDrag = await snapshot();
    await pointer([
      [0.2, 0],
      [0.3, 0],
      [0.4, 0],
      [0.5, 0],
    ]);
    const dragged = await snapshot();
    check(
      "pointer moves save one undo step",
      dragged.doc.history.length === beforeDrag.doc.history.length + 1,
    );
    check(
      "pointer radius and hue persist through the real handler",
      equal(await grade(), { hue: 0, saturation: 50, luminance: 0 }),
    );
    check("the wheel changes native-rendered image pixels", pixels() !== neutralPixels);
    await click("Undo", true);
    check("undo removes the whole wheel gesture", (await grade()).saturation === 0);
    await click("Redo", true);
    check("redo restores the whole wheel gesture", (await grade()).saturation === 50);
    await pointer(
      [
        [0, 0.5],
        [0, 0.8],
      ],
      { shiftKey: true },
    );
    check(
      "Shift drags saturation without changing hue",
      equal(await grade(), { hue: 0, saturation: 80, luminance: 0 }),
    );
    await pointer(
      [
        [0.8, 0],
        [0, -0.3],
      ],
      { metaKey: true },
    );
    check(
      "Command drags hue without changing saturation",
      equal(await grade(), { hue: 270, saturation: 80, luminance: 0 }),
    );
    await pointer(
      [
        [0.5, 0],
        [Math.cos(Math.PI / 18) * 0.6, Math.sin(Math.PI / 18) * 0.6],
      ],
      { altKey: true },
    );
    check(
      "Alt fine adjustment has no initial jump and applies one-tenth deltas",
      Math.abs((await grade()).hue - 271) < 0.11 &&
        Math.abs((await grade()).saturation - 81) < 0.11,
    );
    const beforeCancel = await snapshot(),
      cancelGrade = await grade();
    await pointer(
      [
        [-0.5, 0],
        [-0.3, 0.7],
      ],
      {},
      true,
      async () => {
        const other = wheel("Highlights");
        check(
          "another wheel and numeric grading controls are disabled during a pointer gesture",
          other.matches(":disabled") &&
            root().querySelector('input[aria-label="Balance"]').matches(":disabled"),
        );
        const box = other.getBoundingClientRect();
        other.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            pointerId: 740,
            button: 0,
            buttons: 1,
            clientX: box.left + box.width * 0.75,
            clientY: box.top + box.height / 2,
          }),
        );
        other.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
        other.dispatchEvent(
          new PointerEvent("pointerup", { bubbles: true, pointerId: 740, button: 0 }),
        );
        await tick();
        check(
          "second-pointer and keyboard attempts cannot introduce another wheel's draft",
          other.getAttribute("aria-valuenow") === "0",
        );
      },
    );
    check(
      "pointer cancellation restores preview without an undo entry",
      equal(await grade(), cancelGrade) &&
        (await snapshot()).doc.history.length === beforeCancel.doc.history.length,
    );
    const beforeKeys = await snapshot();
    await key("keydown", "ArrowDown");
    await key("keydown", "ArrowDown", { repeat: true });
    await key("keydown", "ArrowDown", { repeat: true });
    await key("keyup", "ArrowDown");
    await settled();
    check(
      "held keyboard arrows save one undo step",
      (await snapshot()).doc.history.length === beforeKeys.doc.history.length + 1 &&
        Math.abs((await grade()).saturation - 78) < 0.11,
    );
    const escapeBefore = await snapshot(),
      escapeGrade = await grade();
    await key("keydown", "ArrowUp");
    await key("keydown", "Escape");
    await key("keyup", "ArrowUp");
    await settled();
    check(
      "Escape cancels keyboard edits without saving",
      equal(await grade(), escapeGrade) &&
        (await snapshot()).doc.history.length === escapeBefore.doc.history.length,
    );
    await click("Global color grading");
    check(
      "Global is its own wheel and omits irrelevant balance/blending controls",
      root().querySelectorAll(".develop-grade-wheel").length === 1 &&
        wheel("Global") &&
        !root().querySelector('input[aria-label="Blending"]') &&
        !root().querySelector('input[aria-label="Balance"]'),
    );
    await number("Global hue", 215);
    await number("Global saturation", 30);
    await number("Global luminance", 10);
    check(
      "global hue, saturation and luminance persist independently",
      equal(await grade("global"), { hue: 215, saturation: 30, luminance: 10 }) &&
        equal(await grade(), escapeGrade),
    );
    await click("Reset global color grading", true);
    check(
      "global reset preserves the other tonal wheels",
      equal(await grade("global"), { hue: 0, saturation: 0, luminance: 0 }) &&
        equal(await grade(), escapeGrade),
    );
    await click("Three-way color grading");
    const ending = await snapshot();
    const excludingGrade = (doc) => {
      const value = { ...currentRecipe(doc) };
      delete value.grading;
      return value;
    };
    check(
      "grading preserves source identity, metadata and every non-grading adjustment",
      ending.photo.id === baseline.photo.id &&
        ending.photo.sourceDigest === baseline.photo.sourceDigest &&
        equal(ending.doc.metadata, baseline.doc.metadata) &&
        equal(excludingGrade(ending.doc), excludingGrade(baseline.doc)),
    );
  } catch (error) {
    failure = error;
  } finally {
    if (baseline) {
      try {
        for (
          let count = 0;
          count < 60 && (await snapshot()).doc.cursor > baseline.doc.cursor;
          count++
        )
          await click("Undo", true);
        if (!equal(currentRecipe((await snapshot()).doc), currentRecipe(baseline.doc)))
          throw new Error("Original recipe not restored");
      } catch (error) {
        cleanupErrors.push(error.message);
      }
    }
    store.close();
  }
  if (failure || cleanupErrors.length)
    throw new Error(
      `Grading: ${checks.length} passed; ${failure?.message ?? "checks passed"}${cleanupErrors.length ? `; cleanup: ${cleanupErrors.join("; ")}` : "; initial recipe restored"}`,
    );
  return {
    passed: checks.length,
    checks,
    note: "Synthetic pointer/keyboard events invoke real React handlers; per-wheel capture shim only. Real IndexedDB and C++ preview pixels. Initial recipe restored by Undo, test redo steps retained.",
  };
})();
