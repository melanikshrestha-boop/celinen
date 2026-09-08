// Run with gstack browse eval on the local app after Vite finishes compiling.
// Uses real compiled styles in a temporary same-origin iframe; never changes
// account preferences, photo records, the current route, or parent-page styles.
return await (async () => {
  if (location.hostname !== "127.0.0.1" || location.port !== "8085")
    throw new Error("Typography QA is restricted to the local FOTO lab");
  const styles = await Promise.all(
    [
      "/src/styles.css?inline",
      "/src/components/workbench/workbench.css?inline",
      "/src/components/account/settings-workspace.css?inline",
      "/src/components/account/accent-color-picker.css?inline",
      "/src/components/clients/clients-sheet.css?inline",
      "/src/components/earnings/earnings-finances.css?inline",
      "/src/components/outbound/outbound.css?inline",
      "/src/components/develop/develop.css?inline",
    ].map(async (path) => (await import(path)).default),
  );
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText =
    "position:fixed;left:-10000px;width:1440px;height:1000px;pointer-events:none";
  const checks = [];
  const check = (name, pass) => {
    if (!pass) throw new Error(name);
    checks.push(name);
  };
  try {
    document.body.append(frame);
    const doc = frame.contentDocument;
    const style = doc.createElement("style");
    style.textContent = styles.join("\n");
    doc.head.append(style);
    doc.body.innerHTML = `
      <p data-font="body">FOTO Photo Lab</p>
      <p class="font-sans" data-font="sans utility">FOTO Photo Lab</p>
      <p class="font-display" data-font="display utility">FOTO Photo Lab</p>
      <p class="font-mono" data-font="legacy UI labels">Photo metadata</p>
      <button data-font="button">Import photos</button>
      <input data-font="input" value="FOTO Photo Lab">
      <div class="photo-workbench">
        <aside class="workbench-sidebar" data-font="sidebar">Projects</aside>
        <main class="foto-develop"><label data-font="develop">Exposure</label></main>
        <section class="clients-sheet"><h1 class="clients-title" data-font="clients">Clients</h1></section>
        <section class="iris-finances"><p data-font="books">Earnings</p><span class="bk-pie-hole-main" data-font="book chart">100</span></section>
        <section class="outbound-page" data-font="outbound">Outreach</section>
        <section class="workbench-empty-photos"><p data-font="workspace empty state">Import photos</p></section>
      </div>
      <section class="settings-shell"><p data-font="settings">Appearance</p></section>
      <div class="settings-accent-menu" data-font="portaled accent menu">Blue</div>
      <code data-code>source_id</code><kbd data-code>⌘K</kbd>`;
    const font = (element) => frame.contentWindow.getComputedStyle(element).fontFamily;
    const probes = [...doc.querySelectorAll("[data-font]")];
    const verify = (choice, expected) => {
      for (const element of probes)
        check(`${choice}: ${element.dataset.font}`, font(element).startsWith(expected));
    };
    doc.documentElement.style.setProperty("--ll-ui-font", "var(--foto-font-sans)");
    doc.documentElement.style.setProperty("--ll-code-font", "var(--foto-font-mono)");
    await doc.fonts.load('14px "OpenAI Sans"');
    check("bundled sans-serif font loads successfully", doc.fonts.check('14px "OpenAI Sans"'));
    verify("default sans", '"OpenAI Sans"');
    doc.documentElement.style.setProperty("--ll-ui-font", "Georgia, serif");
    verify("explicit serif", "Georgia");
    for (const element of doc.querySelectorAll("[data-code]"))
      check(`code font stays independent: ${element.tagName}`, font(element).includes("Mono"));
    doc.documentElement.style.setProperty("--ll-ui-font", "var(--foto-font-sans)");
    verify("restored sans", '"OpenAI Sans"');
    doc.documentElement.style.setProperty(
      "--ll-code-font",
      'Menlo, Consolas, "Liberation Mono", monospace',
    );
    for (const element of doc.querySelectorAll("[data-code]"))
      check(`explicit code font: ${element.tagName}`, font(element).startsWith("Menlo"));
    return { passed: checks.length, checks };
  } finally {
    frame.remove();
  }
})();
