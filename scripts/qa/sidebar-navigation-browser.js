// Run with the local browse daemon's `eval` command in an isolated QA session.
// This test navigates existing UI only. It never imports, deletes, or rewrites photo records.
if (location.origin !== "http://127.0.0.1:8085") throw new Error("Use the local QA app.");
const start = location.pathname.match(/^\/shoots\/([^/]+)\//);
if (!start) throw new Error("Open a QA shoot's Cull or Develop tab first.");
const key = start[1];
const results = [];
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  results.push(message);
};
const wait = async (predicate, label) => {
  const deadline = performance.now() + 12000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
const visible = (element) => !!element?.getClientRects().length;
const nav = () => [
  ...document.querySelectorAll('.workbench-sidebar nav[aria-label="Primary navigation"] a'),
];
assert(
  nav()
    .map((item) => item.getAttribute("aria-label"))
    .join("|") === "Tonight|Shoots|Library|Deliver|Money",
  "exact five primary destinations",
);
assert(
  document.querySelectorAll('.workbench-sidebar button[aria-label="New shoot"]').length === 1,
  "one New shoot action",
);
assert(
  !document.querySelector('.workbench-sidebar a[href="/develop"]'),
  "Develop is not a global sidebar item",
);
assert(
  !document.querySelector('.workbench-sidebar [aria-label="Customize appearance"]'),
  "palette is not a sidebar action",
);
const six = ["Overview", "Cull", "Develop", "Gallery", "Social", "SmartFile"];
assert(
  [...document.querySelectorAll(".shoot-workflow-tabs a")]
    .map((item) => item.textContent.trim())
    .join("|") === six.join("|"),
  "six workflow tabs in order",
);
for (const [label, suffix] of [
  ["Overview", ""],
  ["Cull", "/cull"],
  ["Develop", "/develop"],
  ["Gallery", "/gallery"],
  ["Social", "/social"],
  ["SmartFile", "/smart-file"],
]) {
  const link = [...document.querySelectorAll(".shoot-workflow-tabs a")].find(
    (item) => item.textContent.trim() === label,
  );
  link.click();
  await wait(() => location.pathname === `/shoots/${key}${suffix}`, label);
  await wait(
    () =>
      document.querySelector('.shoot-workflow-tabs a[aria-current="page"]')?.textContent.trim() ===
      label,
    `${label} active`,
  );
  assert(
    visible(document.querySelector(".workbench-tool-pane")),
    `${label} opens a visible content pane`,
  );
  assert(
    nav()
      .find((item) => item.getAttribute("aria-current") === "page")
      ?.getAttribute("aria-label") === "Shoots",
    `${label} remains in Shoots`,
  );
  if (label === "Develop") {
    await wait(() => document.querySelector(".foto-develop"), "Develop module");
    assert(
      visible(document.querySelector(".foto-develop")),
      "existing Develop editor is visibly mounted",
    );
  }
  if (label === "Cull")
    assert(
      visible(document.querySelector('[data-workbench-tool="studio"]')),
      "Cull keeps the persistent Studio controller",
    );
}
for (const label of ["Tonight", "Shoots", "Library", "Deliver", "Money"]) {
  const link = nav().find((item) => item.getAttribute("aria-label") === label);
  const target = new URL(link.href).pathname;
  link.click();
  await wait(() => location.pathname === target, label);
  await wait(
    () =>
      nav()
        .find((item) => item.getAttribute("aria-current") === "page")
        ?.getAttribute("aria-label") === label,
    `${label} active`,
  );
  assert(
    visible(document.querySelector(".workbench-tool-pane")),
    `${label} navigates to a visible workspace`,
  );
  assert(
    !visible(document.querySelector(".workbench-conversation")),
    `${label} does not show a competing chat pane`,
  );
}
const first = nav()[0];
assert(
  getComputedStyle(first).fontFamily.includes("OpenAI Sans"),
  "primary navigation uses OpenAI Sans",
);
assert(
  first.getBoundingClientRect().height >= 44,
  "primary navigation targets are at least 44px high",
);
assert(document.documentElement.scrollWidth <= innerWidth, "no page-level horizontal overflow");
return { passed: results.length, results, shootKey: key, finalPath: location.pathname };
