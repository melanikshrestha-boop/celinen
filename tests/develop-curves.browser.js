// Browser-eval body. Edits ONLY the reserved synthetic reconnect fixture, using
// real React handlers and native rendering. Restores its neutral curves/falloff.
return await (async () => {
  const shoot = "eeaf3000-1111-4222-8333-000000000007";
  if (location.hostname !== "127.0.0.1" || location.port !== "8085" ||
      location.pathname !== "/develop" || new URL(location.href).searchParams.get("shoot") !== shoot)
    throw new Error("Use only the reserved reconnect QA route for curve checks.");
  const { createDevelopStore, currentRecipe } = await import("/src/lib/develop/store.ts");
  const store = createDevelopStore({ scope: "device-local", libraryId: `shoot:${shoot}` });
  const root = () => document.querySelector(".foto-develop");
  const checks = [];
  const check = (name, condition) => { if (!condition) throw new Error(name); checks.push(name); };
  const wait = async (predicate, message) => {
    const limit = Date.now() + 22000;
    while (Date.now() < limit) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 70));
    }
    throw new Error(message);
  };
  const tick = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const button = (label) => {
    const buttons = [...(root()?.querySelectorAll("button") ?? [])];
    // A History entry can have the same visible text as a channel control.
    // Prefer the actual control's explicit accessible name before any text match.
    return buttons.find((b) => b.getAttribute("aria-label") === label) ??
      buttons.find((b) => b.textContent.trim() === label);
  };
  const settled = async () => {
    await wait(() => root()?.querySelector(".develop-save-status")?.textContent === "All edits saved" &&
      button("Export") && !button("Export").disabled && root()?.querySelector(".develop-image-frame img")?.naturalWidth > 0,
    "The real preview or saved settings did not settle.");
  };
  const click = async (label, saves = false) => {
    await wait(() => {
      const b = button(label);
      return b && !b.matches(":disabled") && !b.closest("[inert]") && b.getClientRects().length > 0;
    }, `Unavailable control: ${label}`);
    const element = button(label);
    element.focus(); element.click(); await tick();
    if (saves) await settled();
  };
  const number = async (label, values) => {
    const input = root().querySelector(`input[aria-label="${label}"]`);
    if (!input || input.matches(":disabled")) throw new Error(`Unavailable input: ${label}`);
    input.focus();
    for (const value of values) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, String(value));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await tick();
    }
    input.blur();
    await tick(); await settled();
  };
  const snapshot = async () => {
    const library = await store.loadLibrary();
    if (library.photos.length !== 1 || library.photos[0].id !== "studio:qa-reconnect" ||
        library.photos[0].name !== "reconnect-qa.png")
      throw new Error("This is not the expected isolated synthetic fixture.");
    return { photo: library.photos[0], doc: library.documents["studio:qa-reconnect"] };
  };
  const pixels = () => {
    const image = root().querySelector(".develop-image-frame img");
    const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 24;
    const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0, 32, 24);
    return Array.from(ctx.getImageData(0, 0, 32, 24).data).join(",");
  };
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let started = false, result = null, failure = null;
  const cleanupErrors = [];
  try {
    await settled();
    if (root().querySelector("[role=dialog]")) throw new Error("Close the open dialog before testing curve controls.");
    const baseline = await snapshot(), original = currentRecipe(baseline.doc);
    const linear = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    if (!equal(original.curve, linear) || original.filmFalloff !== 0 ||
        !["red", "green", "blue"].every((c) => equal(original.channelCurves[c], linear)))
      throw new Error("The disposable fixture must start with neutral curves and film falloff.");
    started = true;
    for (const title of ["Tone Curve", "Effects"]) {
      const summary = [...root().querySelectorAll("summary")].find((s) => s.textContent.trim() === title);
      if (!summary) throw new Error(`Missing ${title} panel`);
      if (!summary.parentElement.open) summary.click();
    }
    await tick();
    const initialPixels = pixels();
    check("master, red, green and blue curve selectors are accessible", ["Master", "Red", "Green", "Blue"].every((c) => button(`${c} tone curve`)));
    await click("Red tone curve");
    check("red curve selection controls the displayed graph", root().querySelector(".develop-curve").dataset.channel === "red" && button("Red tone curve").getAttribute("aria-pressed") === "true");
    await click("Add red curve point", true);
    const beforeGesture = await snapshot();
    await number("Red curve point 2 output", [60, 65, 75]);
    const redEdited = await snapshot(), redRecipe = currentRecipe(redEdited.doc);
    check("one numeric curve gesture creates one history step", redEdited.doc.history.length === beforeGesture.doc.history.length + 1);
    check("red curve edits leave master, green and blue untouched", redRecipe.channelCurves.red[1].y === 0.75 && equal(redRecipe.curve, original.curve) && equal(redRecipe.channelCurves.green, original.channelCurves.green) && equal(redRecipe.channelCurves.blue, original.channelCurves.blue));
    check("red curve adjustment changes native-rendered pixels", pixels() !== initialPixels);
    await click("Green tone curve"); await click("Add green curve point", true);
    await number("Green curve point 2 output", [40]);
    const greenRecipe = currentRecipe((await snapshot()).doc);
    check("green curve edits preserve the saved red curve", greenRecipe.channelCurves.green[1].y === 0.4 && equal(greenRecipe.channelCurves.red, redRecipe.channelCurves.red));
    await click("Blue tone curve"); await click("Add blue curve point", true);
    await number("Blue curve point 2 output", [65]);
    const blueRecipe = currentRecipe((await snapshot()).doc);
    check("blue curve edits preserve red and green", blueRecipe.channelCurves.blue[1].y === 0.65 && equal(blueRecipe.channelCurves.red, redRecipe.channelCurves.red) && equal(blueRecipe.channelCurves.green, greenRecipe.channelCurves.green));
    await click("Master tone curve"); await number("Curve point 2 output", [90]);
    await click("Reset master curve to linear", true);
    const resetMaster = currentRecipe((await snapshot()).doc);
    check("master reset preserves every individual channel", equal(resetMaster.curve, linear) && equal(resetMaster.channelCurves, blueRecipe.channelCurves));
    await click("Red tone curve"); await click("Reset red curve to linear", true);
    const resetRed = currentRecipe((await snapshot()).doc);
    check("red reset affects only the red channel", equal(resetRed.channelCurves.red, linear) && equal(resetRed.channelCurves.green, greenRecipe.channelCurves.green) && equal(resetRed.channelCurves.blue, blueRecipe.channelCurves.blue));
    await click("Undo", true);
    check("undo restores the previous red curve", equal(currentRecipe((await snapshot()).doc).channelCurves.red, redRecipe.channelCurves.red));
    await click("Redo", true);
    check("redo restores the channel-specific reset", equal(currentRecipe((await snapshot()).doc).channelCurves.red, linear));
    const beforeFalloffPixels = pixels();
    await number("Film falloff value", [80]);
    check("film falloff persists through the real slider handler", currentRecipe((await snapshot()).doc).filmFalloff === 80);
    check("film falloff changes native highlight pixels", pixels() !== beforeFalloffPixels);
    const slider = root().querySelector("input[aria-label='Film falloff']");
    slider.parentElement.querySelector("label").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await tick(); await settled();
    check("film falloff double-click reset returns to neutral", currentRecipe((await snapshot()).doc).filmFalloff === 0);
    const ending = await snapshot();
    check("curve work preserves original identity, metadata and basic treatment", ending.photo.sourceDigest === baseline.photo.sourceDigest && ending.photo.id === baseline.photo.id && equal(ending.doc.metadata, baseline.doc.metadata) && currentRecipe(ending.doc).exposure === original.exposure && currentRecipe(ending.doc).temperature === original.temperature);
    result = { passed: checks.length, checks, note: "Actual React controls, IndexedDB receipts and native pixels on one reserved synthetic image. Curves and film falloff restored in finally." };
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (started) {
        let cleanupSafe = true;
        try {
          const { doc } = await snapshot();
          const withoutCurves = (settings) => {
            const copy = { ...settings }; delete copy.curve; delete copy.channelCurves; delete copy.filmFalloff;
            return JSON.stringify(copy);
          };
          const redo = doc.history.slice(doc.cursor + 1);
          if (doc.history.length > 190 || redo.some((entry) => withoutCurves(entry.settings) !== withoutCurves(currentRecipe(doc))))
            throw new Error("Preserving history: cleanup would trim existing steps or change non-curve settings.");
          for (const _entry of redo) await click("Redo", true);
        } catch (error) { cleanupSafe = false; cleanupErrors.push(error.message); }
        if (cleanupSafe) {
          for (const channel of ["red", "green", "blue", "master"]) {
            try {
              await click(`${channel === "master" ? "Master" : channel[0].toUpperCase() + channel.slice(1)} tone curve`);
              await click(`Reset ${channel} curve to linear`, true);
            } catch (error) { cleanupErrors.push(`${channel}: ${error.message}`); }
          }
          try { await number("Film falloff value", [0]); }
          catch (error) { cleanupErrors.push(`film falloff: ${error.message}`); }
        }
      }
    } finally { store.close(); }
  }
  if (failure) throw new Error(`Curve check failed after ${checks.length} passed checks: ${failure.message}${cleanupErrors.length ? ` | Cleanup also failed: ${cleanupErrors.join("; ")}` : " | Cleanup completed."}`);
  if (cleanupErrors.length) throw new Error(`All ${checks.length} checks passed, but cleanup failed: ${cleanupErrors.join("; ")}`);
  return result;
})()
