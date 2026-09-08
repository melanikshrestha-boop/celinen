// Recover only the reserved synthetic curve-test fixture after an interrupted run.
// Uses actual controls; never clears history, sources, metadata or Basic settings.
return await (async () => {
  const shoot = "eeaf3000-1111-4222-8333-000000000007";
  if (location.hostname !== "127.0.0.1" || location.port !== "8085" ||
      location.pathname !== "/develop" || new URL(location.href).searchParams.get("shoot") !== shoot)
    throw new Error("Use only the reserved reconnect QA route for curve reset.");
  const { createDevelopStore, currentRecipe } = await import("/src/lib/develop/store.ts");
  const store = createDevelopStore({ scope: "device-local", libraryId: `shoot:${shoot}` });
  const root = () => document.querySelector(".foto-develop");
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
    return buttons.find((b) => b.getAttribute("aria-label") === label) ??
      buttons.find((b) => b.textContent.trim() === label);
  };
  const settled = () => wait(() => root()?.querySelector(".develop-save-status")?.textContent === "All edits saved" &&
    button("Export") && !button("Export").disabled, "The fixture has unsettled edits or an unavailable preview.");
  const click = async (label) => {
    await wait(() => {
      const b = button(label);
      return b && !b.matches(":disabled") && !b.closest("[inert]") && b.getClientRects().length > 0;
    }, `Unavailable reset control: ${label}`);
    button(label).click(); await tick(); await settled();
  };
  try {
    await settled();
    if (root().querySelector("[role=dialog]")) throw new Error("Close the open dialog before resetting the curve fixture.");
    const before = await store.loadLibrary(), photo = before.photos[0], doc = before.documents[photo?.id];
    if (before.photos.length !== 1 || photo?.id !== "studio:qa-reconnect" || photo?.name !== "reconnect-qa.png" ||
        !photo.sourceAvailable || !doc)
      throw new Error("This is not the expected single reconnected synthetic photo.");
    const recipeBefore = currentRecipe(doc);
    const withoutCurves = (settings) => {
      const copy = { ...settings }; delete copy.curve; delete copy.channelCurves; delete copy.filmFalloff;
      return JSON.stringify(copy);
    };
    if (doc.history.length > 190) throw new Error("Fixture history is near its cap; preserve it and use a fresh QA fixture.");
    // The prior failed test could have selected an older History row. Redo only
    // curve-only steps first, so a new reset never truncates existing redo history.
    const redo = doc.history.slice(doc.cursor + 1);
    if (redo.some((entry) => withoutCurves(entry.settings) !== withoutCurves(recipeBefore)))
      throw new Error("Redo history contains non-curve edits; refusing to change Basic settings during curve-only cleanup.");
    for (const _entry of redo) await click("Redo");
    for (const title of ["Tone Curve", "Effects"]) {
      const summary = [...root().querySelectorAll("summary")].find((s) => s.textContent.trim() === title);
      if (!summary) throw new Error(`Missing ${title} panel`);
      if (!summary.parentElement.open) summary.click();
    }
    await tick();
    for (const channel of ["red", "green", "blue", "master"]) {
      await click(`${channel === "master" ? "Master" : channel[0].toUpperCase() + channel.slice(1)} tone curve`);
      await click(`Reset ${channel} curve to linear`);
    }
    const input = root().querySelector("input[aria-label='Film falloff value']");
    if (!input || input.matches(":disabled")) throw new Error("Film falloff control is unavailable.");
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "0");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick(); input.blur(); await tick(); await settled();
    const after = await store.loadLibrary(), updated = after.documents[photo.id], recipeAfter = currentRecipe(updated);
    const { curve: oldCurve, channelCurves: oldChannels, filmFalloff: oldFalloff, ...untouchedBefore } = recipeBefore;
    const { curve: newCurve, channelCurves: newChannels, filmFalloff: newFalloff, ...untouchedAfter } = recipeAfter;
    const linear = [{ x: 0, y: 0 }, { x: 1, y: 1 }], equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (!equal(newCurve, linear) || !["red", "green", "blue"].every((c) => equal(newChannels[c], linear)) || newFalloff !== 0)
      throw new Error("The synthetic fixture did not return to neutral curves/falloff.");
    if (!equal(untouchedBefore, untouchedAfter) || !equal(doc.metadata, updated.metadata) ||
        photo.sourceDigest !== after.photos[0].sourceDigest || !doc.history.every((old) => updated.history.some((h) => h.id === old.id)))
      throw new Error("Curve reset changed unrelated fixture data.");
    return { reset: "Master/R/G/B curves and film falloff only", preserved: "Photo ID, source fingerprint, Basic settings, metadata and every pre-existing history entry", historySteps: updated.history.length };
  } finally { store.close(); }
})()
