/** Read-only public-page checks, in a launched QA browser. Never logs into an account. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const binary = process.argv[2];
if (!binary) throw new Error("Pass the existing browse binary");
const root = "/private/tmp/lenslabs-marketing-design-qa";
mkdirSync(root, { recursive: true });
const run = (...args: string[]) =>
  execFileSync(binary, args, {
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, BROWSE_PARENT_PID: "0" },
  });
const js = (expression: string) => JSON.parse(run("js", `({value:(${expression})})`)).value;
const waitFor = (expression: string) => {
  for (let i = 0; i < 40; i++) {
    if (js(expression)) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  throw new Error(`Timed out: ${expression}`);
};
const checks: string[] = [];
const check = (name: string, ok: unknown) => {
  if (!ok) throw new Error(name);
  checks.push(name);
  console.log("PASS", name);
  writeFileSync(`${root}/checks.json`, JSON.stringify({ checks }, null, 2));
};
check("Isolated launched browser", run("status").includes("Mode: launched"));
run("viewport", "1440x1000");
run("goto", "http://127.0.0.1:8085/");
run("reload");
run("wait", ".marketing-hero");
run("console", "--clear");
check(
  "No unsupported speed, sample output, or generated-domain claims",
  js(
    `!/(in seconds|not minutes|300 RAW files|42 keepers|maya-okafor|Free subdomain|30\\+ factors)/i.test(document.querySelector('.marketing-page').textContent)`,
  ),
);
check("Page title makes no speed claim", js(`!/(seconds|minutes)/i.test(document.title)`));
check(
  "Home content does not depend on scrolling to become visible",
  js(
    `[...document.querySelectorAll('main section')].every(e => getComputedStyle(e).opacity === '1') && !document.querySelector('main .fade-scroll, main .rise-in')`,
  ),
);
check(
  "One heading and meaningful main landmark",
  js(
    `document.querySelectorAll('h1').length === 1 && document.querySelector('main').id === 'main-content'`,
  ),
);
check(
  "One type family across page headings and paragraphs",
  js(
    `new Set([...document.querySelectorAll('main h1, main h2, main h3, main p')].map(e => getComputedStyle(e).fontFamily)).size === 1`,
  ),
);
check(
  "Metric panels have no decorative gradients or borders",
  js(
    `[...document.querySelectorAll('.marketing-value__metric')].every(e => {const s=getComputedStyle(e); return s.backgroundImage==='none' && s.borderTopWidth==='0px'})`,
  ),
);
check(
  "Primary actions share dimensions, font, color, radius and no shadows",
  js(
    `(()=>{const s=[...document.querySelectorAll('main .marketing-action--primary')].map(e=>{const c=getComputedStyle(e);return [c.minHeight,c.fontSize,c.fontWeight,c.borderRadius,c.backgroundColor,c.color,c.boxShadow].join('|')});return s.length===2 && new Set(s).size===1 && s[0].startsWith('48px|16px|600|8px') && s[0].endsWith('|none')})()`,
  ),
);
check(
  "All five calculator fields are at least 44px high",
  js(
    `[...document.querySelectorAll('#savings input')].every(e=>e.getBoundingClientRect().height>=44)`,
  ),
);
check(
  "Ordinary text contrast is at least 4.5:1 on solid UI surfaces",
  js(`(()=> {
    const rgb=s=>s.match(/[\\d.]+/g).map(Number);
    const lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
    const targets=[...document.querySelectorAll('.marketing-value label,.marketing-value p,.marketing-value input,.marketing-value dt,.marketing-value dd,.marketing-workflow p,.marketing-workflow h3,.marketing-footer a,main .marketing-action--primary')].filter(e=>!e.classList.contains('sr-only'));
    return targets.every(e=>{
      let parent=e,bg;
      while(parent){const color=rgb(getComputedStyle(parent).backgroundColor);if(color.length===3||color[3]===1){bg=color;break}parent=parent.parentElement}
      if(!bg)return false;
      const a=lum(rgb(getComputedStyle(e).color)),b=lum(bg);
      return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5;
    });
  })()`),
);
check(
  "Footer contains only real destination links",
  js(
    `[...document.querySelectorAll('.marketing-footer nav a')].map(e=>e.getAttribute('href')).join(',')==='/docs,/security,/privacy,/terms'`,
  ),
);
check(
  "Landing page does not offer a nonfunctional theme toggle",
  js(`!document.querySelector('[aria-label="Toggle color mode"]')`),
);
run("press", "Tab");
check(
  "Keyboard exposes the skip link with visible focus",
  js(
    `document.activeElement.classList.contains('marketing-skip') && document.activeElement.getBoundingClientRect().top>=0 && getComputedStyle(document.activeElement).outlineStyle !== 'none'`,
  ),
);
run("press", "Enter");
check("Skip link moves focus to main content", js(`document.activeElement.id==='main-content'`));
run("click", 'header a[href="#savings"]');
check(
  "Savings navigation reaches the calculator below the sticky header",
  js(
    `location.hash==='#savings' && document.querySelector('#savings').getBoundingClientRect().top>=document.querySelector('header').getBoundingClientRect().bottom`,
  ),
);

for (const width of [320, 390, 768, 1024, 1440]) {
  run("viewport", `${width}x900`);
  run("js", "document.activeElement?.blur(); window.scrollTo(0,0)");
  check(
    `No horizontal overflow at ${width}px`,
    js(`document.documentElement.scrollWidth<=innerWidth`),
  );
  check(
    `Header controls fit at ${width}px without overlap`,
    js(
      `(()=>{const e=[...document.querySelectorAll('header > a,header > div > a,header > div > button')].map(e=>e.getBoundingClientRect()).filter(r=>r.width);return e.every((r,i)=>r.left>=0&&r.right<=innerWidth&&e.every((s,j)=>i===j||r.right<=s.left||s.right<=r.left))})()`,
    ),
  );
  check(
    `Hero, headings, inputs and footer fit at ${width}px`,
    js(
      `[...document.querySelectorAll('.marketing-hero,main h1,main h2,#savings input,.marketing-footer')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth+1})`,
    ),
  );
}
run("viewport", "390x844");
run("click", '[aria-label="Open menu"]');
check(
  "Mobile navigation exposes three valid destinations",
  js(`document.querySelectorAll('[role="menuitem"]').length===3`),
);
run("press", "Escape");
// Radix unmounts the closed menu after its exit animation, then restores focus.
waitFor(
  `!document.querySelector('[role="menu"]') && document.activeElement.getAttribute('aria-label')==='Open menu'`,
);
check(
  "Mobile menu closes and restores keyboard focus",
  js(
    `!document.querySelector('[role="menu"]') && document.activeElement.getAttribute('aria-label')==='Open menu'`,
  ),
);
run("js", "document.activeElement?.blur(); window.scrollTo(0,0)");
run("screenshot", `${root}/home-mobile.png`, "--viewport");
run("viewport", "1440x1000");
run("js", "window.scrollTo(0,0)");
run("screenshot", `${root}/home-desktop.png`, "--viewport");
run("click", 'header a[href="#savings"]');
run("js", "document.activeElement?.blur()");
run("screenshot", `${root}/savings-desktop.png`, "--viewport");
check(
  "Loaded stylesheet contains the reduced-motion override (not device emulation)",
  js(
    `[...document.styleSheets].some(sheet=>{try{return [...sheet.cssRules].some(rule=>rule.conditionText?.includes('prefers-reduced-motion: reduce') && rule.cssText.includes('.marketing-page') && rule.cssText.includes('transition: none !important'))}catch{return false}})`,
  ),
);
for (const path of ["/docs", "/security", "/privacy", "/terms", "/pricing"]) {
  run("goto", `http://127.0.0.1:8085${path}`);
  check(
    `Public destination ${path} resolves`,
    js(
      `location.pathname===${JSON.stringify(path)} && !!document.querySelector('h1') && !/not found/i.test(document.querySelector('h1').textContent)`,
    ),
  );
}
check(
  "Default navigation retains its working theme control outside the landing page",
  js(`!!document.querySelector('[aria-label="Toggle color mode"]')`),
);
check("No runtime console errors", !/\[(?:error|pageerror)\]/i.test(run("console", "--errors")));
run("goto", "http://127.0.0.1:8085/#savings");
console.log(`${checks.length} design checks passed. Evidence: ${root}`);
