/* Async gstack browser eval body. Run on the fresh local lab /workspace, desktop
 * expanded sidebar, pointer away from the history rows. Writes only reserved QA
 * directory/organization IDs 51–53 through application APIs; never clears data.
 * A real gstack hover is still needed for trusted pointer proof: eval cannot
 * manufacture browser :hover with synthetic MouseEvents. The live focus-visible
 * reveal below and CSSOM assertion exercise the shared hover/focus declaration. */
return await (async () => {
  if (location.origin !== "http://127.0.0.1:8085")
    throw new Error("This QA fixture requires the isolated loopback lab on port 8085.");
  if (!/^\/(?:workspace|shoots(?:\/[^/]+)?)\/?$/.test(location.pathname))
    throw new Error("Open /workspace in the fresh isolated lab first.");
  const { isLocalSingleUserMode } = await import("/src/lib/app-mode.ts");
  if (!isLocalSingleUserMode) throw new Error("Device-local lab mode is required; no writes made.");
  if (!indexedDB.databases)
    throw new Error("Database inventory is required before safe QA seeding.");
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches || innerWidth < 900)
    throw new Error("Use a desktop fine-pointer viewport at least 900px wide for the 29px check.");

  const scope = "device-local";
  const directoryName = "lenslabs-shoot-directory-v1";
  const fixtures = [
    { id: "eeaf3000-1111-4222-8333-000000000051", title: "QA Keep THIS Title · new chat" },
    { id: "eeaf3000-1111-4222-8333-000000000052", title: "QA Compact / Two" },
    { id: "eeaf3000-1111-4222-8333-000000000053", title: "QA Compact / Three" },
  ];
  const allowed = new Map(fixtures.map((row) => [row.id, row]));
  const checks = [];
  const check = (label, condition) => {
    if (!condition) throw new Error(label);
    checks.push(label);
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function until(label, predicate) {
    const deadline = performance.now() + 6000;
    while (performance.now() < deadline) {
      if (await predicate()) return;
      await sleep(25);
    }
    throw new Error(`Timed out: ${label}`);
  }
  const visible = (element) => Boolean(element?.getClientRects().length);
  function sidebar() {
    const value = [...document.querySelectorAll(".workbench-sidebar")].find(visible);
    if (!value || value.getBoundingClientRect().width < 200)
      throw new Error("Open the expanded desktop sidebar before running QA.");
    return value;
  }
  // Read raw stores, including rows hidden by ghost/recent filters. Never open a
  // database absent from inventory: that would otherwise create it during a guard.
  async function readStore(name, storeName) {
    const inventory = await indexedDB.databases();
    if (!inventory.some((db) => db.name === name)) return [];
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        request.transaction.abort();
        reject(new Error("QA refuses database creation during guard."));
      };
      request.onsuccess = () => resolve(request.result);
    });
    try {
      if (!db.objectStoreNames.contains(storeName)) return [];
      return await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }
  async function guard() {
    const inventory = await indexedDB.databases();
    for (const entry of inventory.filter((db) => db.name?.startsWith(directoryName))) {
      const rows = await readStore(entry.name, "shoots");
      if (entry.name !== directoryName && rows.length)
        throw new Error(
          "Refusing QA seeding: another account has saved directories in this browser.",
        );
      if (rows.some((row) => !allowed.has(row.id)))
        throw new Error(
          "Refusing QA seeding: non-QA directories exist. Use a fresh isolated browser.",
        );
      if (
        entry.name === directoryName &&
        rows.some(
          (row) =>
            row.title !== allowed.get(row.id).title || row.count !== 0 || row.recoveryPending,
        )
      )
        throw new Error("Reserved QA IDs contain unexpected content; nothing was changed.");
    }
    if ((await readStore("lenslabs-projects-v1", "projects")).length)
      throw new Error("Refusing QA seeding: saved local projects exist in this browser.");
    const organization = await readStore(directoryName, "organization");
    if (organization.some((row) => !allowed.has(row.key)))
      throw new Error("Refusing QA seeding: non-QA organization records exist.");
    return { rows: await readStore(directoryName, "shoots"), organization };
  }

  await until("expanded sidebar and ready history", () => {
    const value = document.querySelector(".workbench-sidebar [data-history-new]");
    return visible(value) && !value.disabled;
  });
  sidebar();
  const initial = await guard();
  if (initial.organization.some((row) => row.pinned || row.archived))
    throw new Error(
      "QA organization has existing pin/archive choices. Restore those reserved QA choices before retrying.",
    );
  check("fresh device-local directories contain no non-QA data", true);
  const directory = await import("/src/lib/studio/shoot-directory.ts");
  const recentRows = () => [...sidebar().querySelectorAll(".foto-recent-item")].filter(visible);
  const recentHeading = () =>
    [...sidebar().querySelectorAll(".foto-library-recents h2")].find(visible);
  const originalFocus = document.activeElement;
  let restoreThird = false;

  async function seed(row) {
    await guard();
    if (!(await directory.listRecentShoots(scope)).some((saved) => saved.id === row.id)) {
      await directory.rememberShoot(scope, row.id, 0, row.title);
      await directory.renameShoot(scope, row.id, row.title);
    }
    // A normal automatic directory refresh must not rename an authored title.
    await directory.rememberShoot(scope, row.id, 0, "Ignored automatic QA title");
    const saved = (await directory.listRecentShoots(scope)).find((entry) => entry.id === row.id);
    check(
      `authored title preserved for ${row.id.slice(-2)}`,
      saved?.title === row.title && saved.named,
    );
  }

  try {
    // Re-running needs no deletion: temporarily hide just the reserved third QA row.
    if (initial.rows.some((row) => row.id === fixtures[2].id)) {
      await directory.updateShootOrganization(
        scope,
        fixtures[2].id,
        { archived: true },
        { archived: false },
      );
      restoreThird = true;
    }
    await seed(fixtures[0]);
    await seed(fixtures[1]);
    // Do not accidentally pass by observing the pre-seed empty render while the
    // IndexedDB-triggered navigation refresh is still awaiting its transaction.
    await sleep(150);
    await until(
      "Recent hidden with two visible saved shoots",
      () => !recentHeading() && recentRows().length === 0,
    );
    const two = (await directory.listRecentShoots(scope)).filter(
      (row) => row.id !== fixtures[2].id,
    );
    check("two real directory rows remain saved while Recent is hidden", two.length === 2);
    check("Recent heading and rows absent at two", !recentHeading() && recentRows().length === 0);

    if (restoreThird) {
      await directory.updateShootOrganization(
        scope,
        fixtures[2].id,
        { archived: false },
        { archived: true },
      );
      restoreThird = false;
    } else await seed(fixtures[2]);
    await until(
      "three rows and Recent heading rendered",
      () => recentRows().length === 3 && recentHeading()?.textContent === "Recent",
    );
    check("Recent appears when the third directory shoot is saved", true);

    for (const row of fixtures) {
      const rendered = recentRows().find((element) => element.dataset.shootKey === row.id);
      check(
        `exact authored title displayed for ${row.id.slice(-2)}`,
        rendered?.querySelector(".foto-library-row > span")?.textContent === row.title,
      );
    }
    // Use real app navigation to exercise selected styling, not an injected class.
    const firstLink = sidebar().querySelector(
      `[data-shoot-key="${fixtures[0].id}"] .foto-library-row`,
    );
    firstLink.click();
    await until(
      "selected QA shoot navigation completed",
      () =>
        location.pathname.includes(fixtures[0].id) &&
        sidebar().querySelector(`[data-shoot-key="${fixtures[0].id}"].is-active`),
    );
    await until(
      "history ready after opening QA shoot",
      () => !sidebar().querySelector("[data-history-new]")?.disabled,
    );

    const side = sidebar(),
      rows = recentRows();
    const nav = [
      ...side.querySelectorAll(".foto-primary-item, .foto-new-shoot, .foto-secondary-nav"),
    ].filter(visible);
    const heights = [...nav, ...rows].map((element) =>
      Number(element.getBoundingClientRect().height.toFixed(2)),
    );
    check(
      "navigation and recent rows all have Wonder's compact 29px height",
      heights.length >= 9 && heights.every((height) => Math.abs(height - 29) < 0.6),
    );
    check(
      "recent names are single-line 13px Source Serif 4",
      rows.every((row) => {
        const style = getComputedStyle(row.querySelector(".foto-library-row > span"));
        return (
          style.fontSize === "13px" &&
          style.whiteSpace === "nowrap" &&
          style.fontFamily.includes("Source Serif 4")
        );
      }),
    );
    const recent = side.querySelector(".foto-library-recents"),
      history = side.querySelector(".foto-sidebar-chats");
    const gap = history.getBoundingClientRect().top - recent.getBoundingClientRect().bottom;
    check("Recent-to-Shoots gap stays compact without a spacer", gap >= 0 && gap <= 12);
    check(
      "history heading is Shoots",
      history.querySelector(".ll-chat-heading > span")?.textContent === "Shoots",
    );
    const global = [...side.querySelectorAll(".foto-new-shoot")].filter(visible);
    check(
      "one prominent global New Shoot action",
      global.length === 1 &&
        global[0].getAttribute("aria-label") === "New Shoot" &&
        global[0].textContent.trim() === "New Shoot",
    );
    const contextual = history.querySelector("[data-history-new]");
    check(
      "context New Shoot remains one icon-only plus",
      contextual?.getAttribute("aria-label") === "New Shoot" &&
        contextual.textContent.trim() === "" &&
        Boolean(contextual.querySelector("svg")),
    );

    const selected = [
      ...side.querySelectorAll(".foto-primary-item.is-active, .foto-recent-item.is-active"),
    ];
    check("a real selected row exists for marker checks", selected.length > 0);
    check(
      "selected rows have no vertical pseudo-element, border or inset bar",
      selected.every((element) => {
        const before = getComputedStyle(element, "::before"),
          after = getComputedStyle(element, "::after"),
          style = getComputedStyle(element);
        const absent = (pseudo) =>
          pseudo.content === "none" || pseudo.content === "normal" || pseudo.display === "none";
        return (
          absent(before) &&
          absent(after) &&
          parseFloat(style.borderLeftWidth) === 0 &&
          style.boxShadow === "none"
        );
      }),
    );

    global[0].focus({ preventScroll: true });
    await sleep(130);
    const resting = rows.filter((row) => !row.matches(":hover, :focus-within"));
    check("unhovered rows exist for action visibility proof", resting.length >= 2);
    check(
      "all resting row actions are hidden and non-interactive",
      resting.every((row) => {
        const style = getComputedStyle(row.querySelector(".history-row-actions"));
        return style.opacity === "0" && style.pointerEvents === "none";
      }),
    );
    const row = resting[0],
      action = row.querySelector(".history-row-action");
    action.focus({ preventScroll: true, focusVisible: true });
    await until(
      "keyboard focus visibly reveals only the current row controls",
      () =>
        action.matches(":focus-visible") &&
        getComputedStyle(row.querySelector(".history-row-actions")).opacity === "1",
    );
    check(
      "focused row actions revealed through live CSS",
      getComputedStyle(row.querySelector(".history-row-actions")).pointerEvents === "auto",
    );
    check(
      "other resting rows stay hidden",
      resting
        .slice(1)
        .every(
          (other) => getComputedStyle(other.querySelector(".history-row-actions")).opacity === "0",
        ),
    );
    global[0].focus({ preventScroll: true });
    await until(
      "row actions hidden again after focus leaves",
      () => getComputedStyle(row.querySelector(".history-row-actions")).opacity === "0",
    );
    check("row actions restore their hidden state after focus leaves", true);
    const rules = [];
    function collect(list) {
      for (const rule of list) {
        if (rule.selectorText) rules.push(rule);
        if (rule.cssRules) collect(rule.cssRules);
      }
    }
    for (const sheet of document.styleSheets) {
      try {
        collect(sheet.cssRules);
      } catch {
        /* Cross-origin font sheets are irrelevant. */
      }
    }
    check(
      "actual row-hover and focus-visible selectors share the reveal rule",
      [
        ".history-row:hover > .history-row-actions",
        ".history-row:has(:focus-visible) > .history-row-actions",
      ].every((selector) =>
        rules.some(
          (rule) =>
            rule.selectorText.includes(selector) &&
            rule.style.opacity === "1" &&
            rule.style.pointerEvents === "auto",
        ),
      ),
    );
    const saved = await guard();
    check(
      "exactly the three reserved zero-photo QA directories remain",
      saved.rows.length === 3 &&
        saved.rows.every(
          (item) =>
            allowed.has(item.id) && item.title === allowed.get(item.id).title && item.count === 0,
        ),
    );
    return {
      passed: checks.length,
      checks,
      rowHeights: heights,
      recentHistoryGap: gap,
      reservedIds: fixtures.map((row) => row.id),
      sourceMediaWritten: false,
      trustedPointerHoverStillRequired: true,
      nextHoverSelector: `[data-shoot-key="${fixtures[1].id}"]`,
    };
  } finally {
    if (restoreThird)
      await directory.updateShootOrganization(
        scope,
        fixtures[2].id,
        { archived: false },
        { archived: true },
      );
    if (originalFocus instanceof HTMLElement && originalFocus.isConnected)
      originalFocus.focus({ preventScroll: true });
  }
})();
