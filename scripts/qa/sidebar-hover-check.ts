/** Isolated Chromium only. All chat writes belong to this synthetic QA shoot. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const binary = process.argv[2];
if (!binary) throw new Error("Pass the installed browse binary");
const root = "/private/tmp/lenslabs-sidebar-hover-qa";
const origin = "http://127.0.0.1:8085";
const shoot = crypto.randomUUID();
mkdirSync(root, { recursive: true });
const run = (...args: string[]) => execFileSync(binary, args, { encoding: "utf8", timeout: 25000 });
const js = (expression: string) => JSON.parse(run("js", `({value:(${expression})})`)).value;
const waitFor = (expression: string) => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const value = js(expression);
    if (value) return value;
  }
  throw new Error(`Timed out: ${expression}`);
};
const asyncJs = (expression: string) => {
  run(
    "js",
    `(window.__qaResult=null,void (${expression}).then(value=>window.__qaResult={value},error=>window.__qaResult={error:String(error)}))`,
  );
  const result = waitFor("window.__qaResult");
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
  waitFor("document.querySelector('[aria-label=\"New shoot in this project\"]')?.disabled===false");
const sidebar = ".workbench-sidebar";
const opacity = (selector: string) =>
  `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).opacity`;
const idle = () => {
  run("hover", ".workbench-conversation");
  js("document.activeElement?.blur()");
  waitFor(
    "[...document.querySelectorAll('.ll-chat-hover,.ll-chat-heading-actions')].every(el=>getComputedStyle(el).opacity==='0')",
  );
};

check("Only isolated launched browser is used", run("status").includes("Mode: launched"));
run("viewport", "1440x900");
run("goto", `${origin}/workspace?shoot=${shoot}`);
run("wait", sidebar);
ready();
run("console", "--clear");
const ids = asyncJs(
  `(async()=>{const m=await import('/src/lib/chat-history.ts');const r=m.localChatRepository('device-local');const a=await r.save({...m.newChat('${shoot}'),title:'QA Cover selects',named:true,messages:[{role:'user',text:'Keep the second portrait.'}]});const b=await r.save({...m.newChat('${shoot}'),title:'QA Client notes',named:true});const c=await r.save({...m.newChat('${shoot}'),title:'QA Pinned brief',named:true,pinned:true});return {a:a.id,b:b.id,c:c.id}})()`,
);
writeFileSync(`${root}/ids.json`, JSON.stringify(ids));
run("reload");
const row = `[data-chat-id="${ids.a}"]`;
const sibling = `[data-chat-id="${ids.b}"]`;
run("wait", row);
ready();
idle();
check(
  "All row and heading actions are hidden at rest, including pinned chats",
  js(
    "[...document.querySelectorAll('.ll-chat-hover,.ll-chat-heading-actions')].every(el=>getComputedStyle(el).opacity==='0'&&getComputedStyle(el).pointerEvents==='none')",
  ),
);
check(
  "Per-chat search button and field have been removed",
  js("!document.querySelector('[aria-label=\"Search chats\"],.ll-chat-search')"),
);
check(
  "foto has its aperture mark and no cloud icons",
  js(
    "document.querySelector('.workbench-brand').textContent.trim()==='foto'&&!!document.querySelector('.workbench-brand svg')&&!document.querySelector('.workbench-sidebar .lucide-cloud')",
  ),
);
run("screenshot", `${root}/desktop-idle.png`, "--viewport");
run("hover", row);
waitFor(`${opacity(`${row} .ll-chat-hover`)}==='1'`);
check(
  "Hover reveals only the pointed chat's controls",
  js(`${opacity(`${row} .ll-chat-hover`)}==='1'&&${opacity(`${sibling} .ll-chat-hover`)}==='0'`),
);
run("screenshot", `${root}/desktop-hover.png`, "--viewport");
run("click", `${row} [aria-label="Pin QA Cover selects"]`);
ready();
check(
  "Pin moves the selected chat into Pinned",
  js(
    `document.querySelector('${row}').closest('.ll-chat-group').querySelector('h3').textContent==='Pinned'`,
  ),
);
idle();
check(
  "Clicked pin does not remain visible after pointer leaves",
  js(`${opacity(`${row} .ll-chat-hover`)}==='0'`),
);
run("reload");
run("wait", row);
ready();
check("Pin survives reload", js(`!!document.querySelector('${row} [aria-pressed=true]')`));
idle();
run("hover", row);
run("click", `${row} [aria-label^="More options"]`);
run("wait", '[role="menu"]');
run("hover", '[role="menu"]');
check(
  "Open menu keeps its trigger usable off the chat row",
  js(`${opacity(`${row} [aria-label^="More options"]`)}==='1'`),
);
check(
  "Chat actions remain available without a ChatGPT link",
  js(
    "(()=>{const text=document.querySelector('[role=menu]').textContent;return ['Share with client','Rename','Unpin','Archive','Delete shoot','Section','Open in Quick Chat','Adobe export'].every(x=>text.includes(x))&&!text.includes('chatgpt.com')})()",
  ),
);
run("press", "Escape");
idle();
run("click", `${row} .ll-chat-title`);
ready();
run("hover", ".workbench-conversation");
run("press", "Tab");
waitFor(`${opacity(`${row} .ll-chat-hover`)}==='1'`);
check(
  "Keyboard focus reveals row actions without a mouse hover",
  js(
    `document.activeElement.closest('${row}')!==null&&document.activeElement.matches(':focus-visible')&&${opacity(`${row} .ll-chat-hover`)}==='1'`,
  ),
);
idle();
run("hover", ".ll-chat-heading");
waitFor(`${opacity(".ll-chat-heading-actions")}==='1'`);
check(
  "New-chat and archive controls only reveal on the chat heading",
  js(`${opacity(".ll-chat-heading-actions")}==='1'&&${opacity(`${row} .ll-chat-hover`)}==='0'`),
);
run("click", '[aria-label="Show archived shoots"]');
check(
  "Archive view still opens",
  js("!!document.querySelector('[aria-label=\"Show recent shoots\"]')"),
);
run("hover", ".ll-chat-heading");
run("click", '[aria-label="Show recent shoots"]');
run("wait", row);
const count = js("document.querySelectorAll('.ll-chat-row').length");
run("click", '.workbench-nav-item:has-text("New shoot")');
ready();
waitFor(`document.querySelectorAll('.ll-chat-row').length>${count}`);
check(
  "New chat stays in the same shoot and preserves existing chats",
  js(
    `new URL(location.href).searchParams.get('shoot')==='${shoot}'&&!!document.querySelector('${row}')&&document.querySelectorAll('.ll-chat-row').length===${count + 1}`,
  ),
);
run("click", '.workbench-nav-item:has-text("New project")');
waitFor(`new URL(location.href).searchParams.get('shoot')!=='${shoot}'`);
ready();
const nextShoot = js("new URL(location.href).searchParams.get('shoot')");
check("New shoot creates a separate shoot", nextShoot && nextShoot !== shoot);
run("click", '[aria-label="Go back"]');
waitFor(`new URL(location.href).searchParams.get('shoot')==='${shoot}'`);
ready();
check(
  "Back returns to the original shoot and enables Forward",
  js("document.querySelector('[aria-label=\"Go forward\"]').disabled===false"),
);
run("click", '[aria-label="Go forward"]');
waitFor(`new URL(location.href).searchParams.get('shoot')==='${nextShoot}'`);
check("Forward returns to the new shoot", true);
run("click", '[aria-label="Go back"]');
waitFor(`new URL(location.href).searchParams.get('shoot')==='${shoot}'`);
ready();
run("click", '[aria-label="All tools"]');
waitFor("document.querySelectorAll('[role=option]').length>0");
check(
  "Studio, Delivery, and Clients remain available in All tools",
  js(
    "['Studio','Delivery','Clients'].every(label=>[...document.querySelectorAll('[role=option]')].some(el=>el.textContent===label))",
  ),
);
run("click", '[role="option"]:has-text("Studio")');
waitFor("location.pathname==='/studio'");
check(
  "Tools open within the same shoot and branching disables Forward",
  js(
    `new URL(location.href).searchParams.get('shoot')==='${shoot}'&&document.querySelector('[aria-label="Go forward"]').disabled===true`,
  ),
);
run("click", '[aria-label="Go back"]');
waitFor("location.pathname==='/workspace'");
ready();
check(
  "Chat content remains unchanged after navigation",
  asyncJs(
    `(async()=>{const m=await import('/src/lib/chat-history.ts');const a=await m.localChatRepository('device-local').read('${ids.a}');return a.messages.length===1&&a.messages[0].text==='Keep the second portrait.'&&a.pinned})()`,
  ),
);
const material = js(
  "(()=>{const s=getComputedStyle(document.querySelector('.workbench-sidebar [data-sidebar=sidebar]'));return {background:s.backgroundColor,blur:s.backdropFilter}})()",
);
check(
  "Sidebar uses translucent charcoal and real backdrop blur",
  /rgba\(.+, 0\./.test(material.background) && material.blur.includes("blur(36px)"),
);
const priorContrast = js("document.documentElement.getAttribute('data-contrast')");
js("document.documentElement.setAttribute('data-contrast','more')");
check(
  "High contrast provides an opaque, blur-free fallback",
  js(
    "(()=>{const s=getComputedStyle(document.querySelector('.workbench-sidebar [data-sidebar=sidebar]'));return s.backgroundColor==='rgb(36, 36, 36)'&&s.backdropFilter==='none'})()",
  ),
);
js(
  `(()=>{const value=${JSON.stringify(priorContrast)};if(value===null)document.documentElement.removeAttribute('data-contrast');else document.documentElement.setAttribute('data-contrast',value);return true})()`,
);
check("Desktop has no horizontal overflow", js("document.documentElement.scrollWidth<=innerWidth"));
run("click", '[aria-label="Collapse sidebar"]');
run("wait", '[aria-label="Open sidebar"]');
run("click", '[aria-label="Open sidebar"]');
run("wait", sidebar);
check("Sidebar collapses and reopens", true);
run("viewport", "390x844");
run("click", '[aria-label="Open sidebar"]');
run("wait", ".workbench-mobile-sidebar");
waitFor("document.querySelector('.workbench-mobile-sidebar').getBoundingClientRect().left===0");
check(
  "Forward history survives the desktop-to-mobile drawer change",
  js(
    "document.querySelector('.workbench-mobile-sidebar [aria-label=\"Go forward\"]').disabled===false",
  ),
);
check(
  "Mobile navigation fits the viewport",
  js(
    "(()=>{const r=document.querySelector('.workbench-mobile-sidebar').getBoundingClientRect();return r.width<=innerWidth&&r.left>=0&&r.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth})()",
  ),
);
run("screenshot", `${root}/mobile.png`, "--viewport");
run("press", "Escape");
waitFor("!document.querySelector('.workbench-mobile-sidebar')");
check("Mobile navigation dismisses with Escape", true);
run("viewport", "1440x900");
run("wait", sidebar);
idle();
const errors = run("console", "--errors");
check("No browser runtime errors during the flow", !/\[(?:error|pageerror)\]/i.test(errors));
writeFileSync(`${root}/console.txt`, errors);
console.log(`${checks.length} checks passed; evidence: ${root}`);
