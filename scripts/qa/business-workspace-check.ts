/** Isolated launched Chromium only. Appends synthetic records; never clears any store. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const binary = process.argv[2];
if (!binary) throw new Error("Pass the installed browse binary");
const root = "/private/tmp/lenslabs-business-workspace-qa";
mkdirSync(root, { recursive: true });
const origin = "http://127.0.0.1:8085";
const project = crypto.randomUUID();
const tag = `QA ${project.slice(0, 8)}`;
const run = (...args: string[]) =>
  execFileSync(binary, args, {
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, BROWSE_PARENT_PID: "0" },
  });
const js = (expr: string) => JSON.parse(run("js", `({value:(${expr})})`)).value;
const wait = (expr: string) => {
  for (let i = 0; i < 70; i++) {
    const value = js(expr);
    if (value) return value;
  }
  throw new Error(`Timed out: ${expr}`);
};
const asyncJs = (expr: string) => {
  run(
    "js",
    `(window.__businessResult=null,void (${expr}).then(value=>window.__businessResult={value},error=>window.__businessResult={error:String(error)}))`,
  );
  const result = wait("window.__businessResult");
  if (result.error) throw new Error(result.error);
  return result.value;
};
const checks: { name: string; passed: boolean }[] = [];
const check = (name: string, passed: unknown) => {
  checks.push({ name, passed: !!passed });
  writeFileSync(`${root}/checks.json`, JSON.stringify(checks, null, 2));
  if (!passed) throw new Error(name);
  console.log(`PASS ${name}`);
};
const ready = () =>
  wait("document.querySelector('[aria-label=\"New shoot in this project\"]')?.disabled===false");
check("Isolated browser, not user browser", run("status").includes("Mode: launched"));
run("viewport", "1440x1000");
run("goto", `${origin}/workspace?shoot=${project}`);
ready();
run("console", "--clear");
asyncJs(
  `(async()=>{const d=await import('/src/lib/studio/shoot-directory.ts');await d.renameShoot('device-local','${project}','${tag} project');const c=await import('/src/lib/chat-history.ts');await c.localChatRepository('device-local').save({...c.newChat('${project}'),title:'${tag} shoot',named:true});return true})()`,
);
run("reload");
ready();
run("wait", `.ll-chat-title:has-text("${tag} shoot")`);
const alignment = js(
  `(()=>{const sel=['.chat-recents-heading > span','[data-shoot-id="${project}"] .workbench-nav-item > span','.ll-chat-heading > span','.ll-chat-title > span'];return sel.map(s=>document.querySelector(s).getBoundingClientRect().left)})()`,
);
check(
  "Project, shoot, and heading text share the same left edge",
  Math.max(...alignment) - Math.min(...alignment) < 1,
);
check("Only one shoot group heading", js("!document.querySelector('.ll-chat-group h3')"));
run("click", 'button.workbench-nav-item:has-text("New shoot")');
ready();
check(
  "New shoot remains inside its project",
  js(
    `new URL(location.href).searchParams.get('shoot')==='${project}'&&[...document.querySelectorAll('.ll-chat-title')].some(el=>el.textContent==='New shoot')`,
  ),
);
run("click", 'button.workbench-nav-item:has-text("New project")');
ready();
const newId = wait(
  `new URL(location.href).searchParams.get('shoot')!=='${project}'&&new URL(location.href).searchParams.get('shoot')`,
);
wait(
  `document.querySelector('[data-shoot-id="${newId}"]')?.textContent.includes('Untitled project')`,
);
run("reload");
ready();
check(
  "New empty project is persisted to Recents",
  asyncJs(
    `import('/src/lib/studio/shoot-directory.ts').then(async m=>(await m.listRecentShoots('device-local')).some(p=>p.id==='${newId}'&&p.title==='Untitled project'))`,
  ),
);
run("click", '.workbench-business-nav a:has-text("Client database")');
run("wait", "#client-search");
wait(
  "[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Add client'&&!b.disabled)",
);
check(
  "Client database loads local records without cloud authentication errors",
  js(
    "document.querySelector('.business-workspace h1').textContent==='Client database'&&!document.querySelector('.business-workspace [role=alert]')",
  ),
);
run("click", 'button:has-text("Add client")');
run("fill", 'label:has-text("Name") input', `${tag} client`);
run("fill", 'label:has-text("Email") input', "lenslabs-qa@example.com");
run("click", 'button:has-text("Save client")');
wait("document.body.textContent.includes('Saved on this device.')");
run("reload");
run("wait", "#client-search");
run("fill", "#client-search", `${tag} client`);
wait(`document.body.textContent.includes('${tag} client')`);
run("click", `tbody button:has-text("${tag} client")`);
check(
  "Client save, search and reload preserve the contact",
  asyncJs(
    `import('/src/lib/client-workspace.ts').then(m=>m.loadClientWorkspace().state.clients.some(c=>c.name==='${tag} client'&&c.email==='lenslabs-qa@example.com'))`,
  ),
);
check(
  "Client records use the full workspace without clipping",
  js(
    "document.querySelector('.workbench-conversation').hidden&&document.querySelector('.workbench-tool-scroll').scrollWidth<=document.querySelector('.workbench-tool-scroll').clientWidth+1",
  ),
);
js("document.activeElement?.blur()");
run("screenshot", `${root}/clients-desktop.png`, "--viewport");
run("click", '.workbench-business-nav a:has-text("Earnings")');
run("wait", "#earnings-period");
wait("!document.body.textContent.includes('loading ledger…')");
run("click", ".business-invoices > summary");
check(
  "Invoice drafts remain accessible and unsent",
  js(
    "document.querySelector('.business-invoices').open&&[...document.querySelectorAll('.business-workspace button')].some(b=>b.textContent==='Send invoice'&&b.disabled)",
  ),
);
run("click", ".business-invoices > summary");
const before = asyncJs(
  "import('/src/lib/local-finance-store.ts').then(m=>m.loadLocalFinanceState().state)",
);
// Select an unused year so repeatable checks cannot conflate earlier QA records.
const used = new Set(before.entries.map((e: { occurredOn: string }) => e.occurredOn.slice(0, 4)));
let year = 2031;
while (used.has(String(year))) year++;
const add = (kind: string, date: string, label: string, amount: string) => {
  run("click", `.business-workspace button:text-is("${kind}")`);
  run("fill", '[aria-label="Ledger date"]', date);
  run("fill", '[aria-label="Ledger description"]', label);
  run("fill", '[aria-label="Ledger amount in USD"]', amount);
  run("click", '.business-workspace button:text-is("Add")');
  wait("document.querySelector('[aria-label=\"Ledger description\"]').value===''");
};
add("income", `${year}-01-01`, `${tag} portrait, \"day one\"`, "1250.25");
add("expense", `${year}-12-31`, `${tag} studio rental`, "240.10");
add("income", `${year + 1}-01-01`, `${tag} next-year session`, "99.00");
run("select", "#earnings-period", String(year));
const metrics = () =>
  js("[...document.querySelectorAll('.business-metrics strong')].map(e=>e.textContent)");
check(
  "Year-filtered income, expenses and net use exact recorded amounts",
  JSON.stringify(metrics()) === JSON.stringify(["$1,250.25", "$240.10", "$1,010.15"]),
);
run("reload");
run("wait", "#earnings-period");
run("select", "#earnings-period", String(year));
check(
  "Ledger survives reload",
  JSON.stringify(metrics()) === JSON.stringify(["$1,250.25", "$240.10", "$1,010.15"]),
);
check(
  "Invoice drafts and estimates are not counted as earnings",
  js(
    "!document.body.textContent.includes('quarterly set-aside')&&!document.body.textContent.includes('Schedule C')&&document.body.textContent.includes('Invoice drafts are not counted')",
  ),
);
const after = asyncJs(
  "import('/src/lib/local-finance-store.ts').then(m=>m.loadLocalFinanceState().state)",
);
check(
  "Earlier ledger entries and invoice drafts are unchanged",
  before.entries.every(
    (e: { id: string }) =>
      JSON.stringify(e) ===
      JSON.stringify(after.entries.find((v: { id: string }) => v.id === e.id)),
  ) && JSON.stringify(before.invoices) === JSON.stringify(after.invoices),
);
js("document.querySelector('.workbench-tool-scroll').scrollTop=0");
run("screenshot", `${root}/earnings-desktop.png`, "--viewport");
run("click", 'button:text-is("Tax records")');
wait("document.getElementById('tax-records').getBoundingClientRect().top<innerHeight");
check("Tax records action brings exports into view", true);
// Capture the actual Blob produced by clicking the real download controls.
js(
  "(()=>{window.__exported=[];window.__originalCreateURL=URL.createObjectURL;URL.createObjectURL=function(blob){if(blob.type.startsWith('text/csv'))blob.text().then(text=>window.__exported.push(text));return window.__originalCreateURL.call(URL,blob)};return true})()",
);
run("click", 'button:text-is("Download ledger CSV")');
wait("window.__exported.length===1");
const csv = js("window.__exported[0]");
check(
  "Downloaded ledger includes only the selected year's records and exact amounts",
  csv.includes('"1250.25","USD"') &&
    csv.includes('"240.10","USD"') &&
    !csv.includes('"99.00","USD"') &&
    csv.includes('""day one""'),
);
run("click", 'button:text-is("Download category summary")');
wait("window.__exported.length===2");
check(
  "Downloaded summary reconciles and does not claim taxable income",
  js(
    "window.__exported[1].includes('1010.15')&&window.__exported[1].includes('not taxable income')",
  ),
);
js("URL.createObjectURL=window.__originalCreateURL");
run("screenshot", `${root}/tax-records-desktop.png`, "--viewport");
for (const width of [390, 768, 1440]) {
  run("viewport", `${width}x900`);
  js("document.querySelector('.workbench-tool-scroll').scrollTop=0");
  check(
    `Business screen has no page overflow at ${width}px`,
    js("document.documentElement.scrollWidth<=innerWidth"),
  );
  if (width === 390) run("screenshot", `${root}/earnings-mobile.png`, "--viewport");
}
check(
  "No runtime errors after client and earnings flows",
  !run("console", "--errors").includes("[error]"),
);
writeFileSync(`${root}/run.json`, JSON.stringify({ project, newId, tag, year }));
console.log(`${checks.length} checks passed; evidence: ${root}`);
