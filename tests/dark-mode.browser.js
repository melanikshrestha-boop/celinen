/* Run with gstack eval at local /earnings. Display-only; no saved data is changed. */
return await (async () => {
  if (location.origin !== "http://127.0.0.1:8085" || location.pathname !== "/earnings")
    throw new Error("Use the local Earnings QA page.");
  const { applyAppearance, DEFAULT_APPEARANCE, THEME_PRESETS } =
    await import("/src/lib/appearance.ts");
  const root = document.documentElement;
  const original = {
    dark: root.classList.contains("dark"),
    style: root.getAttribute("style"),
    dataset: { ...root.dataset },
  };
  const checks = [];
  const check = (name, passed) => {
    if (!passed) throw new Error(name);
    checks.push(name);
  };
  const style = (selector) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing rendered surface: ${selector}`);
    return getComputedStyle(element);
  };
  const settle = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try {
    for (const [name, palette] of [
      ["Default", DEFAULT_APPEARANCE],
      ["Midnight", { ...DEFAULT_APPEARANCE, preset: "midnight", ...THEME_PRESETS.midnight }],
      ["Warm", { ...DEFAULT_APPEARANCE, preset: "warm", ...THEME_PRESETS.warm }],
      [
        "Custom Gradient",
        {
          ...DEFAULT_APPEARANCE,
          preset: "custom",
          background: "#0e1419",
          backgroundEnd: "#233353",
          backgroundStyle: "gradient",
        },
      ],
      [
        "Custom Light",
        { ...DEFAULT_APPEARANCE, preset: "custom", background: "#ffffff", foreground: "#171717" },
      ],
    ]) {
      const saved = JSON.stringify(palette);
      applyAppearance({ theme: "dark", appearance: palette }, false);
      await settle();
      for (const selector of [
        "body",
        ".photo-workbench",
        ".workbench-header",
        ".earnings-workspace",
      ])
        check(`${name}: ${selector} is black`, style(selector).backgroundColor === "rgb(0, 0, 0)");
      check(`${name}: no workspace gradient`, style(".photo-workbench").backgroundImage === "none");
      check(
        `${name}: black sidebar material`,
        root.style.getPropertyValue("--foto-sidebar-material") === "#000000cc",
      );
      check(`${name}: palette unchanged`, JSON.stringify(palette) === saved);
    }
    applyAppearance({ theme: "light", appearance: DEFAULT_APPEARANCE }, true);
    await settle();
    check(
      "Light shell remains white",
      style(".photo-workbench").backgroundColor === "rgb(255, 255, 255)",
    );
    check(
      "Light Earnings remains off-white",
      style(".earnings-workspace").backgroundColor === "rgb(250, 250, 250)",
    );
    applyAppearance({ theme: "system", appearance: DEFAULT_APPEARANCE }, true);
    await settle();
    check("System dark is black", style(".photo-workbench").backgroundColor === "rgb(0, 0, 0)");
    return { passed: checks.length, checks, persistence: "No saved data written" };
  } finally {
    root.classList.toggle("dark", original.dark);
    if (original.style === null) root.removeAttribute("style");
    else root.setAttribute("style", original.style);
    for (const key of Object.keys(root.dataset))
      if (!(key in original.dataset)) delete root.dataset[key];
    Object.assign(root.dataset, original.dataset);
  }
})();
