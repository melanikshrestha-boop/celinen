/** Drives the real loopback app through the existing isolated browse daemon. No auth cookies imported. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { SETTINGS_SECTIONS, settingsPath } from "../../src/lib/settings-catalog";
import { SETTINGS_CONTROLS } from "../../src/lib/settings-inventory";
const [binary, href] = process.argv.slice(2);
if (!binary || !href)
  throw new Error("Pass browse executable and an explicit synthetic QA shoot URL.");
const url = new URL(href);
const shoot = url.searchParams.get("shoot");
if (url.origin !== "http://127.0.0.1:8085" || shoot !== "592c4eee-0c8e-4f6c-bd43-4fd583bd1b9a")
  throw new Error("Only the dedicated synthetic Settings QA shoot is allowed.");
const artifact = "/private/tmp/lenslabs-settings-qa-20260907";
mkdirSync(artifact, { recursive: true });
const run = (...args: string[]) =>
  execFileSync(binary, args, { encoding: "utf8", timeout: 25_000 });
const js = (expression: string) => JSON.parse(run("js", expression));
const checks: { name: string; result: unknown }[] = [];
const check = (name: string, value: unknown) => {
  if (!value) throw new Error(name);
  checks.push({ name, result: value });
};
const go = (id: (typeof SETTINGS_SECTIONS)[number]["id"], mobile = false) => {
  if (mobile) run("click", '[aria-label="Open settings navigation"]');
  run("click", `[data-section="${id}"]`);
  const title = SETTINGS_SECTIONS.find((entry) => entry.id === id)!.label;
  run("wait", `.settings-content h1:has-text(${JSON.stringify(title)})`);
};
run("goto", href);
run("wait", ".settings-shell");
const rows: Record<string, string[]> = {};
for (const [width, height] of [
  [1528, 992],
  [1440, 900],
  [1024, 768],
  [390, 844],
]) {
  run("viewport", `${width}x${height}`);
  for (const entry of SETTINGS_SECTIONS) {
    go(entry.id, width === 390);
    if (width === 1528) {
      run("reload");
      run("wait", `[data-section="${entry.id}"][aria-current="page"]`);
    }
    const state = js(
      `({title:document.title,heading:document.querySelector('.settings-content h1').textContent,path:location.pathname,shoot:new URL(location.href).searchParams.get('shoot'),overflow:document.documentElement.scrollWidth>innerWidth||document.querySelector('.settings-main').scrollWidth>document.querySelector('.settings-main').clientWidth,rows:[...document.querySelectorAll('[data-setting-id]')].map(n=>n.dataset.settingId),duplicateIds:[...document.querySelectorAll('[id]')].map(n=>n.id).filter((id,i,all)=>all.indexOf(id)!==i)})`,
    );
    check(
      `${width}: ${entry.label} route, title, refresh, scope, overflow and IDs`,
      state.heading === entry.label &&
        state.title === `${entry.label} — Celinen Settings` &&
        state.path === settingsPath(entry.id) &&
        state.shoot === shoot &&
        !state.overflow &&
        state.duplicateIds.length === 0,
    );
    if (width === 1528) rows[entry.id] = state.rows;
  }
  go("appearance", width === 390);
  run("screenshot", `${artifact}/appearance-${width}.png`, "--viewport");
  console.log(`Viewport ${width}: all 23 sections passed`);
}
run("viewport", "1528x992");
run("fill", '[aria-label="Search settings"]', "pointer");
run("press", "Enter");
run("wait", "#setting-use-pointer-cursors");
check(
  "Search selects and focuses a real row",
  js(
    `location.pathname==='/settings/appearance'&&location.hash==='#setting-use-pointer-cursors'&&document.activeElement.id==='setting-use-pointer-cursors'`,
  ),
);
go("general");
go("import");
run("back");
run("wait", '[data-section="general"][aria-current="page"]');
run("forward");
run("wait", '[data-section="import"][aria-current="page"]');
check(
  "Browser back/forward preserves shoot",
  js(`new URL(location.href).searchParams.get('shoot')===${JSON.stringify(shoot)}`),
);
const sidecarBefore = js(
  `document.querySelector('[aria-label="Read Adobe XMP sidecars"]').getAttribute('aria-checked')`,
);
run("click", '[aria-label="Read Adobe XMP sidecars"]');
run("reload");
run("wait", '[aria-label="Read Adobe XMP sidecars"]');
check(
  "Import preference survives reload",
  js(
    `document.querySelector('[aria-label="Read Adobe XMP sidecars"]').getAttribute('aria-checked')!==${JSON.stringify(sidecarBefore)}`,
  ),
);
run("click", '[aria-label="Read Adobe XMP sidecars"]');
go("appearance");
run("click", '.settings-theme-options button:has-text("Light")');
run("reload");
run("wait", ".settings-theme-options");
check("Light persists", js(`!document.documentElement.classList.contains('dark')`));
run("screenshot", `${artifact}/appearance-light.png`, "--viewport");
run("click", '.settings-theme-options button:has-text("System")');
check(
  "System follows current OS scheme",
  js(
    `document.documentElement.classList.contains('dark')===matchMedia('(prefers-color-scheme: dark)').matches`,
  ),
);
run("click", '.settings-theme-options button:has-text("Dark")');
go("profile");
run("fill", "#profile-display-name", "Celine QA unsaved");
run("dialog-dismiss");
run("click", '[data-section="appearance"]');
// Native confirmation defaults to dismiss in this isolated browser: the guard must retain the draft.
check(
  "Unsaved profile prevents navigation",
  js(
    `location.pathname==='/settings/profile'&&document.querySelector('#profile-display-name').value==='Celine QA unsaved'`,
  ),
);
run("click", '.settings-profile-form button:has-text("Cancel")');
go("general");
run("screenshot", `${artifact}/general-1528.png`, "--viewport");
const missing = SETTINGS_CONTROLS.filter(
  (control) => !(rows[control.page] ?? []).includes(control.id),
).map((control) => ({ page: control.page, label: control.label, id: control.id }));
check(`All indexed search controls exist: ${JSON.stringify(missing)}`, missing.length === 0);
writeFileSync(
  `${artifact}/report.json`,
  JSON.stringify({ status: "passed", checks, rows, unmatchedSearchControls: missing }, null, 2),
);
console.log(
  JSON.stringify(
    { status: "passed", checks: checks.length, unmatchedSearchControls: missing, artifact },
    null,
    2,
  ),
);
