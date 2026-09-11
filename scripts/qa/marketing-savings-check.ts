/** Uses only a launched, isolated QA browser and synthetic calculator inputs. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const binary = process.argv[2];
if (!binary) throw new Error("Pass the existing browse binary");
const root = "/private/tmp/lenslabs-marketing-savings-qa";
mkdirSync(root, { recursive: true });
const run = (...args: string[]) =>
  execFileSync(binary, args, {
    encoding: "utf8",
    timeout: 30000,
    // QA invocations are short-lived children; keep the browser across those commands.
    env: { ...process.env, BROWSE_PARENT_PID: "0" },
  });
const js = (expression: string) => JSON.parse(run("js", `({value:(${expression})})`)).value;
const checks: string[] = [];
const check = (name: string, condition: unknown) => {
  if (!condition) throw new Error(name);
  checks.push(name);
  console.log(`PASS ${name}`);
  writeFileSync(`${root}/checks.json`, JSON.stringify({ checks }, null, 2));
};
const waitFor = (expression: string) => {
  for (let i = 0; i < 40; i++) {
    if (js(expression)) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  throw new Error(`Timed out: ${expression}`);
};
const metric = `document.querySelector('.marketing-value__metric--money .marketing-value__number').textContent`;
const reset = () => run("click", '.marketing-value button:has-text("Reset example")');
const fill = (field: string, value: string) => run("fill", `#savings-${field}`, value);

check(
  "Test browser is isolated, not attached to a user browser",
  run("status").includes("Mode: launched"),
);
run("viewport", "1440x1000");
run("goto", "http://127.0.0.1:8085/#savings");
// A same-page hash navigation preserves React state; start each run with a full reload.
run("reload");
run("console", "--clear");
run("wait", "#savings-hoursPerWeek");
check(
  "Public page exposes calculator without submitting a sign-in form",
  js(`!!document.querySelector('#savings') && !document.querySelector('input[type=password]')`),
);
check(
  "Illustrative example and limits visible",
  js(
    `document.querySelector('#savings').textContent.includes('not measured results') && document.querySelector('#savings').textContent.includes('Time value is not cash income')`,
  ),
);
check("Default estimate matches $24,960", js(`${metric} === '$24,960'`));
fill("hoursPerWeek", "20");
check("Changing weekly hours updates real rendered results", js(`${metric} === '$48,960'`));
fill("hourlyValue", "25");
check("Changing hourly value updates results", js(`${metric} === '$24,960'`));
fill("weeksPerYear", "24");
check("Changing seasonal workload updates results", js(`${metric} === '$12,960'`));
fill("lensMonthlyBudget", "80");
check("LensLabs costs are subtracted", js(`${metric} === '$12,480'`));
fill("replacedMonthlyCost", "0");
check("No cancellation does not invent software savings", js(`${metric} === '$11,040'`));
fill("hoursPerWeek", "0");
check(
  "Negative net total stays negative",
  js(
    `${metric} === '-$960' && document.querySelector('#savings').textContent.includes('Additional software cost')`,
  ),
);
// browse's CLI rejects an empty fill argument; use the real keyboard path instead.
run("click", "#savings-hoursPerWeek");
run("press", "ControlOrMeta+A");
run("press", "Backspace");
check(
  "Blank input clears stale result and exposes accessible error",
  js(
    `${metric} === '—' && document.querySelector('#savings-hoursPerWeek').getAttribute('aria-invalid') === 'true'`,
  ),
);
fill("hoursPerWeek", "169");
check("Impossible weekly hours remain invalid", js(`${metric} === '—'`));
reset();
fill("weeksPerYear", "12.5");
check(
  "Fractional working weeks expose precise validation",
  js(`document.querySelector('#savings-weeksPerYear-error').textContent.includes('whole number')`),
);
reset();
check(
  "Reset restores all five example inputs",
  js(
    `[...document.querySelectorAll('#savings input')].map(el=>el.value).join(',') === '10,50,48,120,40' && ${metric} === '$24,960'`,
  ),
);
run("click", ".marketing-value__math summary");
check(
  "Formula disclosure shows the complete calculation",
  js(
    `document.querySelector('.marketing-value__math').open && document.querySelector('.marketing-value__math').textContent.includes('12 months')`,
  ),
);
run("click", ".marketing-value__math summary");
run("click", ".marketing-value__calculator summary");
check(
  "Calculator can collapse without hiding the estimate",
  js(`!document.querySelector('.marketing-value__calculator').open && ${metric} === '$24,960'`),
);
run("press", "Enter");
check(
  "Keyboard reopens calculator",
  js(`document.querySelector('.marketing-value__calculator').open`),
);
run("screenshot", `${root}/desktop.png`, "--selector", "#savings");

run("click", '[aria-label="Next workflow steps"]');
run("click", '[aria-label="Next workflow steps"]');
waitFor(`document.querySelector('[aria-label="Next workflow steps"]').disabled`);
check(
  "Workflow navigation reaches Deliver and stops at the final slide",
  js(`document.querySelector('[aria-label="Next workflow steps"]').disabled`),
);
// Embla updates button state at selection time, before its scroll animation settles.
waitFor(
  `(()=>{const c=document.querySelector('[aria-label="Photography workflow"]').getBoundingClientRect(); const r=[...document.querySelectorAll('.marketing-workflow__card')].find(el=>el.textContent.includes('Deliver')).getBoundingClientRect();return r.left>=c.left-1 && r.right<=c.right+1})()`,
);
check(
  "Final delivery card appears inside the carousel viewport",
  js(
    `(()=>{const c=document.querySelector('[aria-label="Photography workflow"]').getBoundingClientRect(); const r=[...document.querySelectorAll('.marketing-workflow__card')].find(el=>el.textContent.includes('Deliver')).getBoundingClientRect();return r.left>=c.left-1 && r.right<=c.right+1})()`,
  ),
);
run("click", '[aria-label="Previous workflow steps"]');
run("click", '[aria-label="Previous workflow steps"]');
waitFor(`document.querySelector('[aria-label="Previous workflow steps"]').disabled`);
check(
  "Workflow navigation returns to first slide",
  js(`document.querySelector('[aria-label="Previous workflow steps"]').disabled`),
);

for (const width of [320, 390, 768, 1440]) {
  run("viewport", `${width}x900`);
  check(
    `Savings and workflow containers fit ${width}px`,
    js(
      `[...document.querySelectorAll('#savings, .marketing-workflow, .marketing-value__metric, .marketing-value input')].every(el=>{const r=el.getBoundingClientRect();return r.left>=-1 && r.right<=innerWidth+1})`,
    ),
  );
  check(
    `Page has no horizontal overflow at ${width}px`,
    js(`document.documentElement.scrollWidth <= innerWidth`),
  );
}
run("viewport", "390x844");
run("screenshot", `${root}/mobile.png`, "--selector", "#savings");
run("screenshot", `${root}/workflow-mobile.png`, "--selector", ".marketing-workflow");
fill("hoursPerWeek", "168");
fill("hourlyValue", "10000");
fill("weeksPerYear", "52");
fill("replacedMonthlyCost", "100000");
check(
  "Largest valid total fits its mobile metric card",
  js(
    `(()=>{const e=document.querySelector('.marketing-value__metric--money .marketing-value__number');return e.scrollWidth<=e.clientWidth+1 && !e.textContent.includes('Infinity')})()`,
  ),
);
reset();
run("reload");
run("wait", "#savings-hoursPerWeek");
check(
  "Reload returns an explicit example, not a stale personalized claim",
  js(
    `${metric} === '$24,960' && document.querySelector('.marketing-value__estimate-label').textContent.includes('Illustrative example')`,
  ),
);
check(
  "No application console errors",
  !/\[(?:error|pageerror)\]/i.test(run("console", "--errors")),
);
run("viewport", "1440x1000");
console.log(`${checks.length} browser checks passed. Evidence: ${root}`);
