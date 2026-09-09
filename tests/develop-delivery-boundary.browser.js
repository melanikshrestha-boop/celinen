/* Run with gstack eval ONLY in an isolated local QA browser at /settings/appearance.
 * No fixtures, photo uploads, customer records, or database clears.
 * First evaluation checks real canonical/legacy routes with scoped controller/write observers.
 * Then use __setDeliveryBoundaryThemeQA("dark" | "light") and
 * __checkDeliveryBoundaryQA() at actual 390/1280px viewports.
 * __openDeliveryColdLegacyQA() checks a cold legacy entry before the working action.
 * __openDeliveryWorkingQA() clicks the real full-navigation link. Evaluate this file again
 * after that navigation to verify exact target, missing-source safety and finish cleanup.
 */
return await (async () => {
  if (location.origin !== "http://127.0.0.1:8085") throw new Error("Isolated local QA only.");
  const projectId = "eeaf3000-1111-4222-8333-193901d95777";
  const frameId = "qa-frame:" + "existing-long-id/".repeat(18) + "?source=original&pick=1";
  const versionId = "qa-historical-version-v1";
  const namespace = JSON.stringify(["device-local", `project:${projectId}`]);
  const storageKey = "foto:qa:delivery-version-boundary";
  const wait = async (predicate, label) => {
    const end = performance.now() + 12000;
    while (performance.now() < end) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error(`Timed out: ${label}`);
  };
  const request = (value) =>
    new Promise((resolve, reject) => {
      value.onsuccess = () => resolve(value.result);
      value.onerror = () => reject(value.error);
    });
  async function reservedRecords() {
    const names = (await indexedDB.databases()).map((db) => db.name);
    const counts = { photos: 0, documents: 0, manifests: 0, importJobs: 0, projects: 0 };
    if (names.includes("foto-develop-v1")) {
      const db = await request(indexedDB.open("foto-develop-v1"));
      try {
        for (const name of ["photos", "documents"]) {
          if (!db.objectStoreNames.contains(name)) continue;
          counts[name] = await request(
            db.transaction(name).objectStore(name).index("namespace").count(namespace),
          );
        }
        for (const name of ["manifests", "importJobs"]) {
          if (!db.objectStoreNames.contains(name)) continue;
          counts[name] = (await request(db.transaction(name).objectStore(name).get(namespace)))
            ? 1
            : 0;
        }
      } finally {
        db.close();
      }
    }
    if (names.includes("lenslabs-projects-v1")) {
      const db = await request(indexedDB.open("lenslabs-projects-v1"));
      try {
        counts.projects = (await request(
          db.transaction("projects").objectStore("projects").get(projectId),
        ))
          ? 1
          : 0;
      } finally {
        db.close();
      }
    }
    return counts;
  }
  const saved = sessionStorage.getItem(storageKey);
  if (saved) {
    const state = JSON.parse(saved);
    if (
      state.projectId !== projectId ||
      state.frameId !== frameId ||
      !["cold-legacy", "working-navigation"].includes(state.stage)
    )
      throw new Error("Prior QA state needs review; refusing to overwrite it.");
    const checks = state.checks;
    const check = (name, condition) => {
      if (!condition) throw new Error(name);
      checks.push(name);
    };
    if (state.stage === "cold-legacy") {
      const boundary = () =>
        [...document.querySelectorAll(".develop-delivery-boundary")].find((node) =>
          node.checkVisibility(),
        );
      await wait(boundary, "cold legacy boundary");
      check(
        "Cold legacy entry used real full navigation",
        performance.timeOrigin > state.timeOrigin,
      );
      check(
        "Cold legacy entry keeps its explicit delivery request",
        location.pathname === "/studio" &&
          new URL(location.href).searchParams.get("deliveryVersion") === versionId,
      );
      check(
        "Cold legacy replaces Studio controller with the exact-version boundary",
        Boolean(
          document.querySelector('[data-workbench-tool="studio"] .develop-delivery-boundary'),
        ) && !document.querySelector(".workbench-embedded-studio"),
      );
      check(
        "Cold legacy has no native editor, export or rendering request",
        !document.querySelector(".develop-workspace, .develop-filmstrip-items") &&
          !performance
            .getEntriesByType("resource")
            .some((entry) => new URL(entry.name).pathname.startsWith("/__develop/")),
      );
      check(
        "Cold legacy created no reserved library records",
        Object.values(await reservedRecords()).every((count) => count === 0),
      );
      const { applyAppearance, DEFAULT_APPEARANCE } = await import("/src/lib/appearance.ts");
      window.__checkDeliveryBoundaryQA = (requireFocus = false) => {
        const node = boundary(),
          action = node.querySelector("a[data-working-edit]");
        const style = getComputedStyle(node),
          actionStyle = getComputedStyle(action);
        const rect = node.getBoundingClientRect(),
          linkRect = action.getBoundingClientRect();
        check(
          "Cold legacy boundary loads its own typography and spacing",
          style.fontFamily.includes("Source Serif 4") && parseFloat(style.paddingLeft) >= 20,
        );
        check(
          "Cold legacy fits real viewport without overflow",
          rect.left >= -1 &&
            rect.right <= innerWidth + 1 &&
            node.scrollWidth <= node.clientWidth + 1,
        );
        check(
          "Cold legacy action is rounded, usable and readable",
          linkRect.height >= 44 &&
            linkRect.width <= rect.width &&
            parseFloat(actionStyle.borderRadius) >= 8 &&
            actionStyle.color === style.backgroundColor &&
            actionStyle.backgroundColor === style.color,
        );
        check(
          "Cold legacy has neutral dark/light background",
          ["rgb(0, 0, 0)", "rgb(247, 247, 250)"].includes(style.backgroundColor),
        );
        if (requireFocus)
          check(
            "Cold legacy real keyboard focus contrasts with canvas",
            document.activeElement === action &&
              action.matches(":focus-visible") &&
              parseFloat(actionStyle.outlineWidth) >= 2 &&
              actionStyle.outlineColor !== style.backgroundColor,
          );
        return {
          width: innerWidth,
          height: innerHeight,
          dark: document.documentElement.classList.contains("dark"),
          font: style.fontFamily,
          background: style.backgroundColor,
          action: {
            width: linkRect.width,
            height: linkRect.height,
            radius: actionStyle.borderRadius,
            focusVisible: action.matches(":focus-visible"),
          },
          checks: checks.length,
        };
      };
      window.__setDeliveryBoundaryThemeQA = (theme) => {
        if (!["light", "dark"].includes(theme)) throw new Error("Use a built-in theme.");
        applyAppearance({ theme, appearance: DEFAULT_APPEARANCE }, false);
        return window.__checkDeliveryBoundaryQA();
      };
      window.__focusDeliveryBoundaryQA = () =>
        boundary().querySelector("a[data-working-edit]").focus();
      window.__openDeliveryWorkingQA = () => {
        const link = boundary().querySelector("a[data-working-edit]");
        check(
          "Cold legacy action preserves exact long frame/project and discards delivery context",
          new URL(link.href).pathname === state.workingPath &&
            new URL(link.href).search === state.workingSearch,
        );
        state.stage = "working-navigation";
        state.timeOrigin = performance.timeOrigin;
        sessionStorage.setItem(storageKey, JSON.stringify(state));
        link.click();
        return "After full navigation evaluate this file again.";
      };
      return { state: "cold-legacy-ready", checks, viewport: window.__checkDeliveryBoundaryQA() };
    }
    check(
      "Working edit used a full navigation, clearing mounted delivery binding",
      performance.timeOrigin > state.timeOrigin,
    );
    check(
      "Working edit preserves exact project and frame URL",
      location.pathname === state.workingPath && location.search === state.workingSearch,
    );
    check(
      "No delivery-version query survives explicit working-edit navigation",
      [...new URL(location.href).searchParams.keys()].join() === "photo",
    );
    await wait(
      () => document.body.textContent.includes("Project not found on this device"),
      "missing project warning",
    );
    check(
      "Missing project opens no alternate photo or version",
      !document.querySelector(".develop-image-frame img") &&
        !document.querySelector(".develop-filmstrip-items button"),
    );
    check(
      "Missing project does not keep the historical-version boundary active",
      ![...document.querySelectorAll(".develop-delivery-boundary")].some((node) =>
        node.checkVisibility(),
      ),
    );
    check(
      "Missing project has no usable import/export/editor controls",
      ![...document.querySelectorAll(".foto-develop button, .foto-develop input")].some(
        (node) =>
          !node.disabled &&
          (/export|import|exposure/i.test(node.getAttribute("aria-label") ?? node.textContent) ||
            node.type === "range"),
      ),
    );
    const after = await reservedRecords();
    check(
      "Exact reserved project/library remains empty after working-edit navigation",
      Object.values(after).every((count) => count === 0),
    );
    document.documentElement.classList.toggle("dark", state.theme.dark);
    if (state.theme.style === null) document.documentElement.removeAttribute("style");
    else document.documentElement.setAttribute("style", state.theme.style);
    sessionStorage.removeItem(storageKey);
    return {
      state: "passed",
      checks,
      count: checks.length,
      records: after,
      cleanup: "Removed only QA status; no project/photo records were created or deleted.",
    };
  }
  if (location.pathname !== "/settings/appearance")
    throw new Error("Start on isolated /settings/appearance.");
  const { isLocalSingleUserMode } = await import("/src/lib/app-mode.ts");
  if (!isLocalSingleUserMode) throw new Error("Local lab identity required.");
  if (!Object.values(await reservedRecords()).every((count) => count === 0))
    throw new Error("Reserved namespace is not empty; no fixture data will be replaced.");
  if (typeof window.__TSR_ROUTER__?.navigate !== "function")
    throw new Error("Actual app router unavailable.");
  const adapterUrl = performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .find((url) => new URL(url).pathname === "/src/lib/projects/studio-adapter.ts");
  if (!adapterUrl) throw new Error("Cannot identify the actual loaded Project controller module.");
  const { ProjectStudioSession } = await import(adapterUrl);
  const state = {
    projectId,
    frameId,
    versionId,
    namespace,
    stage: "boundaries",
    checks: [],
    loads: [],
    writes: [],
    nativeRequests: [],
    timeOrigin: performance.timeOrigin,
    theme: {
      dark: document.documentElement.classList.contains("dark"),
      style: document.documentElement.getAttribute("style"),
    },
  };
  const check = (name, condition) => {
    if (!condition) throw new Error(name);
    state.checks.push(name);
  };
  const originalLoad = ProjectStudioSession.prototype.load;
  ProjectStudioSession.prototype.load = function (...args) {
    if (this.projectId === projectId) {
      state.loads.push({
        projectId: this.projectId,
        hasDeliveryFocus: Boolean(this.deliveryFocus),
      });
      return Promise.reject(new Error("QA observed a forbidden legacy controller load."));
    }
    return originalLoad.apply(this, args);
  };
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = new URL(
      typeof input === "string" ? input : (input.url ?? String(input)),
      location.href,
    );
    if (url.origin === location.origin && url.pathname.startsWith("/__develop/")) {
      state.nativeRequests.push(url.pathname);
      return Promise.reject(
        new Error("QA observed a forbidden native request behind a version boundary."),
      );
    }
    return originalFetch.call(this, input, init);
  };
  const originals = new Map();
  for (const method of ["put", "add", "delete", "clear"]) {
    const original = IDBObjectStore.prototype[method];
    originals.set(method, original);
    IDBObjectStore.prototype[method] = function (...args) {
      const dbName = this.transaction.db.name;
      const value = args[0];
      const target =
        value?.namespace === namespace ||
        value?.key?.startsWith(namespace) ||
        value?.id === projectId ||
        (typeof value === "string" && (value.startsWith(namespace) || value === projectId));
      if (
        (method === "clear" && ["foto-develop-v1", "lenslabs-projects-v1"].includes(dbName)) ||
        target
      ) {
        state.writes.push({ dbName, store: this.name, method });
        throw new Error("QA blocked a write behind the exact-version boundary.");
      }
      return original.apply(this, args);
    };
  }
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    ProjectStudioSession.prototype.load = originalLoad;
    window.fetch = originalFetch;
    for (const [method, original] of originals) IDBObjectStore.prototype[method] = original;
  };
  const visibleBoundary = () =>
    [...document.querySelectorAll(".develop-delivery-boundary")].find((node) =>
      node.checkVisibility(),
    );
  const search = new URLSearchParams({
    project: projectId,
    deliveryFrame: frameId,
    deliveryVersion: versionId,
    deliveryHandoff: "eeaf3001-1111-4222-8333-193901d95777",
  });
  const canonical = `/shoots/${encodeURIComponent(`project:${projectId}`)}/develop?${search}`;
  const noEditor = (label) => {
    check(
      `${label}: hidden Studio controller is replaced by the version boundary`,
      Boolean(
        document.querySelector('[data-workbench-tool="studio"] .develop-delivery-boundary'),
      ) && !document.querySelector(".workbench-embedded-studio"),
    );
    check(
      `${label}: no mounted native photo controls or export`,
      !document.querySelector(
        '.develop-workspace, .develop-filmstrip-items, input[aria-label="Exposure"], input[aria-label="Import photos"]',
      ),
    );
    check(`${label}: hidden legacy controller never loaded`, state.loads.length === 0);
    check(`${label}: no native rendering/status request`, state.nativeRequests.length === 0);
    check(`${label}: no canonical or legacy record writes`, state.writes.length === 0);
    check(
      `${label}: exact requested version is named, not silently replaced`,
      visibleBoundary()?.textContent.includes(versionId),
    );
  };
  try {
    // Warm the exact same project without delivery focus first: preserving the
    // remembered workspace binding must not hide a subsequent explicit URL focus.
    // The reserved project does not exist; its normal controller is stubbed to
    // reject before reading or writing any project contents.
    await window.__TSR_ROUTER__.navigate({
      href: `/shoots/${encodeURIComponent(`project:${projectId}`)}/develop`,
    });
    await wait(() => state.loads.length > 0, "warm same-project controller invocation");
    await new Promise((resolve) => setTimeout(resolve, 150));
    check(
      "Warm same-project fixture used the actual controller without creating records",
      state.loads.length > 0 && state.writes.length === 0,
    );
    state.warmLoads = state.loads.length;
    state.loads.length = 0;
    state.nativeRequests.length = 0;
    for (const [label, href] of [
      ["canonical", canonical],
      ["legacy Studio", `/studio?${search}`],
      ["legacy Develop", `/develop?${search}`],
    ]) {
      // Only the deliberate missing-project warm fixture cannot complete flush.
      // Bypass that fixture's async leave gate; no photo/edit records exist.
      // Subsequent legacy transitions and the final real anchor never bypass it.
      await window.__TSR_ROUTER__.navigate({ href, ignoreBlocker: label === "canonical" });
      await wait(() => visibleBoundary(), `${label} boundary visible`);
      await new Promise((resolve) => setTimeout(resolve, 120));
      noEditor(label);
    }
    await window.__TSR_ROUTER__.navigate({ href: canonical });
    await wait(() => visibleBoundary(), "canonical return");
    const link = visibleBoundary().querySelector("a[data-working-edit]");
    const working = new URL(link.href);
    check(
      "Explicit action keeps the full existing frame ID without truncation",
      working.searchParams.get("photo") === `studio:${frameId}`,
    );
    check(
      "Explicit action keeps exact project library",
      decodeURIComponent(working.pathname) === `/shoots/project:${projectId}/develop`,
    );
    check(
      "Explicit action removes delivery version/handoff and remembered workspace context",
      [...working.searchParams.keys()].join() === "photo",
    );
    state.workingPath = working.pathname;
    state.workingSearch = working.search;
    check(
      "Boundary checks created no reserved project or library records",
      Object.values(await reservedRecords()).every((count) => count === 0),
    );
    const { applyAppearance, DEFAULT_APPEARANCE } = await import("/src/lib/appearance.ts");
    window.__setDeliveryBoundaryThemeQA = (theme) => {
      if (!["light", "dark"].includes(theme)) throw new Error("Use a built-in theme.");
      // Resolve the real presentation tokens without persisting a preference or
      // dispatching any account/data change. Full navigation restores them.
      applyAppearance({ theme, appearance: DEFAULT_APPEARANCE }, false);
      return window.__checkDeliveryBoundaryQA();
    };
    window.__focusDeliveryBoundaryQA = () => {
      visibleBoundary().querySelector("a[data-working-edit]").focus();
      return "Use real Shift+Tab then Tab before checking keyboard focus.";
    };
    window.__checkDeliveryBoundaryQA = (requireFocus = false) => {
      const boundary = visibleBoundary(),
        action = boundary?.querySelector("a[data-working-edit]");
      if (!boundary || !action) throw new Error("Boundary no longer visible.");
      const style = getComputedStyle(boundary),
        actionStyle = getComputedStyle(action);
      const rect = boundary.getBoundingClientRect(),
        linkRect = action.getBoundingClientRect();
      check(
        "Boundary uses actual Wonder Source Serif UI font",
        style.fontFamily.includes("Source Serif 4"),
      );
      check(
        "Boundary stays within actual viewport",
        rect.left >= -1 &&
          rect.right <= innerWidth + 1 &&
          boundary.scrollWidth <= boundary.clientWidth + 1,
      );
      check(
        "Working-edit target is at least44px and fits boundary",
        linkRect.height >= 44 && linkRect.width <= rect.width,
      );
      check(
        "Boundary is rounded and neutral in both themes",
        parseFloat(actionStyle.borderRadius) >= 8 &&
          actionStyle.color === style.backgroundColor &&
          actionStyle.backgroundColor === style.color &&
          ["rgb(0, 0, 0)", "rgb(247, 247, 250)"].includes(style.backgroundColor),
      );
      if (requireFocus)
        check(
          "Real keyboard focus is visible on working-edit action",
          document.activeElement === action &&
            action.matches(":focus-visible") &&
            parseFloat(actionStyle.outlineWidth) >= 2 &&
            actionStyle.outlineColor !== style.backgroundColor,
        );
      noEditor(`viewport${innerWidth}`);
      return {
        width: innerWidth,
        height: innerHeight,
        dark: document.documentElement.classList.contains("dark"),
        font: style.fontFamily,
        background: style.backgroundColor,
        action: {
          width: linkRect.width,
          height: linkRect.height,
          radius: actionStyle.borderRadius,
          focusVisible: action.matches(":focus-visible"),
        },
        checks: state.checks.length,
      };
    };
    window.__openDeliveryWorkingQA = () => {
      noEditor("before explicit working navigation");
      state.stage = "working-navigation";
      sessionStorage.setItem(storageKey, JSON.stringify(state));
      restore();
      visibleBoundary().querySelector("a[data-working-edit]").click();
      return {
        stage: state.stage,
        next: "After full navigation evaluate this file again for final checks/cleanup.",
      };
    };
    window.__openDeliveryColdLegacyQA = () => {
      noEditor("before cold legacy navigation");
      state.stage = "cold-legacy";
      sessionStorage.setItem(storageKey, JSON.stringify(state));
      restore();
      location.assign(`/studio?${search}`);
      return "After full navigation evaluate this file again.";
    };
    return {
      state: "ready-for-visual-and-working-navigation",
      checks: state.checks,
      viewport: window.__checkDeliveryBoundaryQA(),
      nativeRequests: state.nativeRequests,
      writes: state.writes,
      loads: state.loads,
    };
  } catch (error) {
    restore();
    throw error;
  }
})();
