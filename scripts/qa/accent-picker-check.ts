/** Scoped to a separate launched QA browser; never import the user's browser session. */
import { execFileSync } from "node:child_process";
import { ACCENT_COLORS } from "../../src/lib/appearance";

const binary = process.argv[2];
if (!binary) throw new Error("Pass the browse executable");
const run = (...args: string[]) => execFileSync(binary, args, { encoding: "utf8", timeout: 25000 });
const js = (source: string) => JSON.parse(run("js", `({value:(${source})})`)).value;
if (!run("status").includes("Mode: launched"))
  throw new Error("An isolated QA browser is required");
const checks: string[] = [];
function check(name: string, value: unknown) {
  if (!value) throw new Error(name);
  checks.push(name);
}
run("goto", "http://127.0.0.1:8085/settings/appearance");
run("wait", ".settings-accent-trigger");
for (const [name, hex] of ACCENT_COLORS) {
  run("click", ".settings-accent-trigger");
  run("wait", ".settings-accent-menu");
  check(
    `${name}: all eight labels`,
    JSON.stringify(
      js(`[...document.querySelectorAll('.settings-accent-option')].map(e=>e.textContent)`),
    ) === JSON.stringify(ACCENT_COLORS.map(([label]) => label)),
  );
  check(
    `${name}: eight swatches`,
    js(`document.querySelectorAll('.settings-accent-menu .settings-accent-swatch').length`) === 8,
  );
  run("click", `.settings-accent-option:has-text("${name}")`);
  check(
    `${name}: persisted value`,
    js(`document.documentElement.style.getPropertyValue('--ll-settings-accent')`) === hex,
  );
  check(
    `${name}: closed and returned focus`,
    js(
      `!document.querySelector('.settings-accent-menu') && document.activeElement.matches('.settings-accent-trigger')`,
    ),
  );
}
run("click", ".settings-accent-trigger");
run("press", "Home");
run("press", "ArrowDown");
run("press", "Enter");
check(
  "keyboard selects Blue",
  js(`document.querySelector('.settings-accent-trigger').textContent`) === "Blue",
);
run("reload");
run("wait", ".settings-accent-trigger");
check(
  "Blue survives reload",
  js(`document.querySelector('.settings-accent-trigger').textContent`) === "Blue",
);
check("custom hex remains editable", js(`!document.querySelector('#custom-accent-hex').disabled`));
for (const width of [1280, 390]) {
  run("viewport", `${width}x${width === 390 ? 844 : 720}`);
  run("click", ".settings-accent-trigger");
  run("wait", ".settings-accent-menu");
  const result = js(
    `(()=>{const el=document.querySelector('.settings-accent-menu'), rect=el.getBoundingClientRect(), selected=el.querySelector('[data-state=checked]'); return {inside:rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight, overflow:el.scrollWidth>el.clientWidth, background:getComputedStyle(el).backgroundColor, highlight:getComputedStyle(selected).backgroundColor, check:!!selected.querySelector('svg'), width:rect.width,height:rect.height};})()`,
  );
  check(`${width}: fits viewport`, result.inside && !result.overflow);
  check(`${width}: reference surface`, result.background === "rgb(52, 52, 52)");
  check(
    `${width}: gray selection and check`,
    result.highlight === "rgb(74, 74, 74)" && result.check,
  );
  check(`${width}: native desktop proportions`, result.width === 218 && result.height === 300);
  run("press", "Escape");
  check(
    `${width}: Escape returns focus`,
    js(`document.activeElement.matches('.settings-accent-trigger')`),
  );
}
run("viewport", "1280x720");
console.log(`${checks.length} accent-picker browser checks passed.`);
