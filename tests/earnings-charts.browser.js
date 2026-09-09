/* Run with gstack eval in an isolated local-lab browser at /earnings.
 * Refuses existing financial records. Fixtures never enter a user's browser or server.
 * Call window.__checkEarningsChartLayoutQA() after a real viewport resize for narrow QA.
 * Call window.__showEarningsCompactQA() for the one-expense/zero-collections screenshot.
 * Call window.__restoreEarningsChartQA() after screenshots to restore the empty state. */
return await (async () => {
  if (location.origin !== "http://127.0.0.1:8085" || location.pathname !== "/earnings")
    throw new Error("Use the isolated local Earnings page.");
  const { isLocalSingleUserMode } = await import("/src/lib/app-mode.ts");
  if (!isLocalSingleUserMode) throw new Error("Local mode required.");
  const key = "lenslabs.local-finance.v1";
  const original = localStorage.getItem(key);
  if (original !== null)
    throw new Error("Refusing to overwrite saved financial data. Use a fresh QA browser.");
  const checks = [];
  const check = (label, result) => {
    if (!result) throw new Error(label);
    checks.push(label);
  };
  const until = async (label, test) => {
    const end = performance.now() + 6000;
    while (performance.now() < end) {
      if (test()) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error(`Timed out: ${label}`);
  };
  const page = () => document.querySelector(".earnings-workspace");
  const chart = () => page()?.querySelector(".earnings-insights");
  const panels = () => [...chart().querySelectorAll(".earnings-metric-chart")];
  const primaryPanels = () => [
    ...chart().querySelectorAll(".earnings-charts-grid > .earnings-metric-chart"),
  ];
  const panel = (key) => chart().querySelector(`[data-metric="${key}"]`);
  const graphs = () => [...chart().querySelectorAll(".earnings-metric-chart .earnings-plot")];
  const readout = (key) => panel(key).querySelector(".earnings-chart-readout").textContent;
  const amount = (key) => panel(key).querySelector(".earnings-chart-legend strong").textContent;
  const chartKey = (graph, key) =>
    graph.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  const pulse = () => page()?.querySelector(".earnings-pulse").textContent;
  const select = async (label, value, ready) => {
    const control = page().querySelector(`select[aria-label="${label}"]`);
    control.value = value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
    await until(label, ready);
  };
  await until("loaded empty charts", () =>
    chart()?.textContent.includes("No net collections in this period"),
  );
  check("empty data has no fabricated chart or pie", chart().querySelectorAll("svg").length === 0);
  check(
    "empty data keeps three primary labels and secondary Refunds",
    primaryPanels().length === 3 && panels().length === 4,
  );
  check(
    "empty primary plots are compact, not 180px zero charts",
    primaryPanels().every(
      (item) =>
        item.dataset.empty === "true" &&
        item.querySelector(".earnings-plot-wrap").getBoundingClientRect().height <= 60,
    ),
  );
  const theme = {
    dark: document.documentElement.classList.contains("dark"),
    style: document.documentElement.getAttribute("style"),
  };
  const entries = [
    ["2026-07-03", "income", "Game Coverage", 80000, "USD"],
    ["2026-07-05", "expense", "Studio Rental", 100000, "USD"],
    ["2026-08-03", "income", "Game Coverage", 175000, "USD"],
    ["2026-08-08", "expense", "Travel", 22000, "USD"],
    ["2026-09-01", "income", "Game Coverage", 175000, "USD"],
    ["2026-09-03", "income", "Commercial", 70000, "USD"],
    ["2026-09-08", "income", "Licensing", 40000, "USD"],
    ["2026-09-01", "expense", "Equipment", 30000, "USD"],
    ["2026-09-03", "expense", "Travel", 20000, "USD"],
    ["2026-09-08", "expense", "Software", 4900, "USD"],
    ["2026-09-01", "income", "Game Coverage", 12345, "JPY"],
  ].map(([occurredOn, kind, category, amountCents, currency], index) => ({
    id: `qa-earnings-chart-${index}`,
    occurredOn,
    kind,
    category,
    amountCents,
    currency,
    description: `QA Chart Fixture ${index}`,
    shootId: "eeaf3000-1111-4222-8333-000000000051",
    source: "manual",
    createdAt: "2026-09-08T12:00:00Z",
    updatedAt: "2026-09-08T12:00:00Z",
  }));
  const fixture = JSON.stringify({
    version: 1,
    revision: 1,
    entries,
    invoices: [],
    updatedAt: "2026-09-08T12:00:00Z",
  });
  let currentFixture = fixture;
  window.__restoreEarningsChartQA = () => {
    if (localStorage.getItem(key) !== currentFixture)
      throw new Error("Financial state changed during QA; refusing cleanup.");
    localStorage.removeItem(key);
    document.documentElement.classList.toggle("dark", theme.dark);
    if (theme.style === null) document.documentElement.removeAttribute("style");
    else document.documentElement.setAttribute("style", theme.style);
    window.dispatchEvent(new Event("foto:earnings-changed"));
    delete window.__checkEarningsChartLayoutQA;
    delete window.__showEarningsCompactQA;
    delete window.__restoreEarningsChartQA;
    return "Removed only reserved QA fixture; restored original empty financial state and theme.";
  };
  // Read-only layout checks can be repeated at actual narrow/coarse-pointer
  // viewports. They never resize the window, alter the ledger or synthesize media queries.
  window.__checkEarningsChartLayoutQA = () => {
    if (localStorage.getItem(key) !== currentFixture)
      throw new Error("Reserved fixture changed; refusing layout QA.");
    const layoutChecks = [];
    const assert = (label, condition) => {
      if (!condition) throw new Error(label);
      layoutChecks.push(label);
    };
    const metricPanels = primaryPanels();
    const plotNodes = graphs();
    const workspaceStyle = getComputedStyle(page());
    const workspaceContentWidth =
      page().clientWidth -
      parseFloat(workspaceStyle.paddingLeft) -
      parseFloat(workspaceStyle.paddingRight);
    const columns = workspaceContentWidth < 700 ? 1 : 2;
    const grid = chart().querySelector(".earnings-charts-grid");
    assert(
      "three primary panels and each actual plot is focusable",
      metricPanels.length === 3 &&
        plotNodes.length === (currentFixture === fixture ? 3 : 2) &&
        plotNodes.every((plot) => plot.tabIndex === 0),
    );
    assert(
      "responsive equal-column layout",
      getComputedStyle(grid).gridTemplateColumns.split(/\s+/).length === columns,
    );
    const widths = metricPanels.map((item) => item.getBoundingClientRect().width);
    assert("panels have equal widths", Math.max(...widths) - Math.min(...widths) < 2);
    assert(
      "panels stay flat without decorative cards",
      metricPanels.every((item) => {
        const style = getComputedStyle(item);
        return (
          style.borderTopWidth === "0px" &&
          style.borderBottomWidth === "0px" &&
          style.boxShadow === "none" &&
          style.backgroundColor === "rgba(0, 0, 0, 0)"
        );
      }),
    );
    assert(
      "actual graph heights match",
      plotNodes.every((plot) => Math.abs(plot.getBoundingClientRect().height - 180) < 1),
    );
    assert(
      "metric panels have no horizontal overflow",
      metricPanels.every((item) => item.scrollWidth <= item.clientWidth + 1),
    );
    assert(
      "chart preserves vertical touch scrolling",
      plotNodes.every((plot) => getComputedStyle(plot).touchAction === "pan-y"),
    );
    const uiText = [...chart().querySelectorAll("h3, .earnings-chart-readout, summary")];
    const numericText = [
      ...chart().querySelectorAll(
        ".earnings-chart-legend strong, .earnings-plot text, .earnings-chart-average-label span, .earnings-refunds-detail > summary span",
      ),
    ];
    const font = getComputedStyle(page()).fontFamily;
    assert(
      "Wonder Source Serif interface font reaches every chart label",
      font.includes("Source Serif 4") &&
        uiText.every((item) => getComputedStyle(item).fontFamily === font),
    );
    assert(
      "Wonder numeric typography uses SF Mono independently of UI text",
      numericText.every((item) => getComputedStyle(item).fontFamily.includes("SF Mono")),
    );
    assert(
      "visible chart labels remain at least 12px",
      [...uiText, ...numericText].every(
        (item) => parseFloat(getComputedStyle(item).fontSize) >= 12,
      ),
    );
    if (matchMedia("(max-width: 680px)").matches)
      assert(
        "narrow disclosure targets are at least 44px",
        [...chart().querySelectorAll("summary")].every(
          (item) => item.getBoundingClientRect().height >= 44,
        ),
      );
    return {
      checks: layoutChecks,
      viewport: { width: innerWidth, height: innerHeight },
      columns,
      dark: document.documentElement.classList.contains("dark"),
      coarsePointer: matchMedia("(pointer: coarse)").matches,
    };
  };
  // This is another reserved fixture, not a manipulation of customer records.
  // It reproduces the reported zero-collections case without empty chart acreage.
  window.__showEarningsCompactQA = async () => {
    if (localStorage.getItem(key) !== currentFixture)
      throw new Error("Financial state changed during QA; refusing fixture switch.");
    currentFixture = JSON.stringify({
      version: 1,
      revision: 2,
      entries: entries.filter((entry) => entry.kind === "expense" && entry.category === "Software"),
      invoices: [],
      updatedAt: "2026-09-08T12:00:00Z",
    });
    localStorage.setItem(key, currentFixture);
    window.dispatchEvent(new Event("foto:earnings-changed"));
    await select("Currency", "USD", () => chart().textContent.includes("USD"));
    await select("Earnings period", "all", () => chart().textContent.includes("All Dates"));
    await until(
      "one expense compact fixture",
      () => amount("expensesMinor") === "$49.00" && amount("netMinor") === "-$49.00",
    );
    const refunds = chart().querySelector(".earnings-refunds-detail");
    if (refunds.open) refunds.querySelector("summary").click();
    const collected = panel("collectedMinor");
    if (
      collected.querySelector("svg") ||
      !collected.textContent.includes("No net collections in this period")
    )
      throw new Error("Zero collections fabricated a graph.");
    if (collected.querySelector(".earnings-plot-wrap").getBoundingClientRect().height > 60)
      throw new Error("Zero collections retained the tall empty plotting area.");
    return {
      fixture: "QA-only expense; no customer data",
      amounts: ["collectedMinor", "expensesMinor", "netMinor"].map(amount),
      ...window.__checkEarningsChartLayoutQA(),
    };
  };
  localStorage.setItem(key, fixture);
  window.dispatchEvent(new Event("foto:earnings-changed"));
  await until("three actual primary plots", () => graphs().length === 3);
  await select("Earnings period", "all", () => chart().textContent.includes("All Dates"));
  check("all-date collected reconciles", pulse().includes("$5,400.00"));
  check("all-date net reconciles including loss month", pulse().includes("$3,631.00"));
  check(
    "canonical totals including secondary zero Refunds",
    ["collectedMinor", "expensesMinor", "netMinor", "refundsMinor"].map(amount).join("|") ===
      "$5,400.00|$1,769.00|$3,631.00|$0.00",
  );
  check(
    "all metric panels have real line, fading area, dots and dotted average",
    graphs().every(
      (graph) =>
        graph.querySelectorAll("circle").length === 3 &&
        graph.querySelector('path[fill="none"]') &&
        graph.querySelector('path[fill^="url("]') &&
        graph.querySelectorAll('stop[stop-opacity="0.26"]').length >= 1 &&
        graph.querySelector(".earnings-chart-average") &&
        !graph.querySelector("rect"),
    ),
  );
  check(
    "monthly averages are labeled estimates over three actual calendar intervals",
    ["collectedMinor", "expensesMinor", "netMinor"]
      .map((key) => panel(key).querySelector(".earnings-chart-average-label").textContent)
      .join("|") ===
      "Monthly average $1,800.00|Monthly average ≈ $589.67|Monthly average ≈ $1,210.33",
  );
  const refunds = chart().querySelector(".earnings-refunds-detail");
  check(
    "Refunds is secondary and closed with a visible exact total",
    !refunds.open &&
      refunds.querySelector("summary").textContent.includes("$0.00") &&
      !panel("refundsMinor").checkVisibility(),
  );
  refunds.querySelector("summary").click();
  await until("Refunds disclosure opened", () => refunds.open);
  check(
    "Refunds expands to truthful compact zero state",
    panel("refundsMinor").checkVisibility() &&
      panel("refundsMinor").textContent.includes("No refunds recorded") &&
      !panel("refundsMinor").querySelector("svg"),
  );
  refunds.querySelector("summary").click();
  const breakdown = chart().querySelector(".earnings-chart-breakdown");
  check(
    "Breakdown starts closed with both pies hidden",
    !breakdown.open &&
      [...breakdown.querySelectorAll(".earnings-pie-visual")].every(
        (pie) => !pie.checkVisibility(),
      ),
  );
  breakdown.querySelector("summary").click();
  await until("secondary Breakdown open", () => breakdown.open);
  check(
    "Collection Mix and Expense Mix categories reflect records",
    chart().textContent.includes("Collection Mix") &&
      chart().textContent.includes("Expense Mix") &&
      chart().textContent.includes("Game Coverage") &&
      chart().textContent.includes("Software"),
  );
  check(
    "three months in underlying chart data",
    chart().querySelectorAll(".earnings-chart-data tbody tr").length === 3,
  );
  check(
    "July loss stays exact in Chart Data",
    [...chart().querySelectorAll(".earnings-chart-data tbody tr")].some(
      (row) => row.textContent.includes("Jul 2026") && row.textContent.includes("-$200.00"),
    ),
  );
  breakdown.querySelector("summary").click();
  await until("Breakdown collapsed after inspection", () => !breakdown.open);
  check(
    "both pies are hidden again after collapsing Breakdown",
    [...breakdown.querySelectorAll(".earnings-pie-visual")].every((pie) => !pie.checkVisibility()),
  );
  const saved = localStorage.getItem(key);
  document.documentElement.style.setProperty("--wb-user-bg", "#0e1419");
  document.documentElement.style.setProperty("--wb-user-fg", "#000000");
  document.documentElement.classList.add("dark");
  check(
    "dark finance canvas ignores saved blue tint",
    getComputedStyle(page()).backgroundColor === "rgb(0, 0, 0)",
  );
  check(
    "dark finance text ignores mismatched custom foreground",
    getComputedStyle(page()).color === "rgb(237, 237, 237)",
  );
  const netDots = () => [...panel("netMinor").querySelectorAll(".earnings-plot circle")];
  check(
    "dark Net dots distinguish negative July from positive August",
    getComputedStyle(netDots()[0]).fill === "rgb(255, 77, 79)" &&
      getComputedStyle(netDots()[1]).fill === "rgb(22, 199, 132)",
  );
  check(
    "other activity series use one blue in dark mode",
    ["collectedMinor", "expensesMinor"].every((key) =>
      [...panel(key).querySelectorAll(".earnings-plot circle")].every(
        (dot) => getComputedStyle(dot).fill === "rgb(158, 203, 255)",
      ),
    ),
  );
  checks.push(...window.__checkEarningsChartLayoutQA().checks.map((label) => `dark: ${label}`));
  document.documentElement.classList.remove("dark");
  check(
    "light finance canvas matches Wonder's light surface",
    getComputedStyle(page()).backgroundColor === "rgb(247, 247, 250)",
  );
  check("light finance text stays readable", getComputedStyle(page()).color === "rgb(26, 28, 34)");
  check(
    "light Net dots keep signed contrast",
    getComputedStyle(netDots()[0]).fill === "rgb(201, 42, 42)" &&
      getComputedStyle(netDots()[1]).fill === "rgb(18, 129, 62)",
  );
  check(
    "other activity series use one blue in light mode",
    ["collectedMinor", "expensesMinor"].every((key) =>
      [...panel(key).querySelectorAll(".earnings-plot circle")].every(
        (dot) => getComputedStyle(dot).fill === "rgb(37, 99, 235)",
      ),
    ),
  );
  checks.push(...window.__checkEarningsChartLayoutQA().checks.map((label) => `light: ${label}`));
  document.documentElement.classList.add("dark");
  const payouts = [...page().querySelectorAll(".earnings-filters button")].find(
    (e) => e.textContent === "Payouts",
  );
  payouts.click();
  await until("payout filter", () => page().textContent.includes("No recorded payouts"));
  check(
    "payout tab does not erase period charts",
    graphs().length === 3 && amount("collectedMinor") === "$5,400.00",
  );
  await select("Currency", "JPY", () => chart().textContent.includes("JPY"));
  check("currencies never combine", pulse().includes("12,345") && !pulse().includes("$5,400"));
  check(
    "no fake expense pie for income-only currency",
    chart().querySelectorAll(".earnings-pie-visual").length === 1,
  );
  check(
    "one-point currency plots only its two nonzero series without inventing expenses or refunds",
    graphs().length === 2 &&
      graphs().every(
        (graph) =>
          graph.querySelectorAll("circle").length === 1 &&
          !graph.querySelector('path[fill^="url("]') &&
          !/NaN|Infinity/.test(graph.innerHTML),
      ),
  );
  await select("Currency", "USD", () => chart().textContent.includes("USD"));
  const input = page().querySelector('[aria-label="Search ledger"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
    input,
    "no match at all",
  );
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  check("ledger search does not change chart totals", chart().textContent.includes("$5,400.00"));
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  [...page().querySelectorAll(".earnings-filters button")]
    .find((e) => e.textContent === "All")
    .click();
  const graph = panel("collectedMinor").querySelector(".earnings-plot");
  graph.focus();
  chartKey(graph, "End");
  await until("keyboard inspection", () => readout("collectedMinor").includes("Sep"));
  check(
    "keyboard graph inspection reads exact month values",
    amount("collectedMinor") === "$2,850.00",
  );
  check(
    "exact value and date share an atomic accessible readout",
    panel("collectedMinor").querySelector(
      '.earnings-chart-legend[aria-live="polite"][aria-atomic="true"]',
    ) !== null,
  );
  chartKey(graph, "Escape");
  graph.blur();
  await until("period totals restored", () => readout("collectedMinor") === "Selected period");
  const netGraph = panel("netMinor").querySelector(".earnings-plot");
  netGraph.focus();
  chartKey(netGraph, "Home");
  await until("keyboard July loss", () => readout("netMinor").includes("Jul"));
  check("negative Net keyboard value is exact", amount("netMinor") === "-$200.00");
  chartKey(netGraph, "ArrowRight");
  await until("keyboard August positive Net", () => readout("netMinor").includes("Aug"));
  check("positive Net keyboard value is exact", amount("netMinor") === "$1,530.00");
  chartKey(netGraph, "Escape");
  netGraph.blur();
  const rect = netGraph.getBoundingClientRect();
  const viewBox = netGraph.viewBox.baseVal;
  const touchX = rect.left + ((viewBox.width - 12) / viewBox.width) * rect.width;
  netGraph.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerId: 91,
      pointerType: "touch",
      isPrimary: true,
      clientX: touchX,
      clientY: rect.top + 40,
    }),
  );
  await until("touch picks nearest September point", () => readout("netMinor").includes("Sep"));
  check("touch inspection reads exact September Net", amount("netMinor") === "$2,301.00");
  const tooltip = panel("netMinor").querySelector(".earnings-chart-tooltip");
  check("touch tooltip matches exact amount", tooltip?.textContent.includes("$2,301.00"));
  const tipRect = tooltip.getBoundingClientRect(),
    panelRect = panel("netMinor").getBoundingClientRect();
  check(
    "right-edge tooltip stays inside its panel",
    tipRect.left >= panelRect.left - 1 && tipRect.right <= panelRect.right + 1,
  );
  netGraph.dispatchEvent(
    new PointerEvent("pointerleave", { bubbles: false, pointerId: 91, pointerType: "touch" }),
  );
  chartKey(netGraph, "Escape");
  await until(
    "touch inspection clears to canonical period",
    () => readout("netMinor") === "Selected period",
  );
  check(
    "refunds remain an exact secondary zero value with no invented graph",
    amount("refundsMinor") === "$0.00" && !panel("refundsMinor").querySelector("svg"),
  );
  check("filters and themes never write finance history", localStorage.getItem(key) === saved);
  check(
    "page uses the verified Wonder Source Serif UI font",
    getComputedStyle(page()).fontFamily.includes("Source Serif 4"),
  );
  return {
    checks,
    count: checks.length,
    fixture: "QA-only, not customer data",
    viewport: { width: innerWidth, height: innerHeight },
    narrow:
      "Resize the real browser to 390px and 944px, then run window.__checkEarningsChartLayoutQA(); repeat in light/dark for screenshots. Call window.__showEarningsCompactQA() for zero-collections screenshot.",
    cleanup: "Call window.__restoreEarningsChartQA() after visual checks.",
  };
})();
