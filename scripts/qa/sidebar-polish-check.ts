/** Run against the separate launched QA browser, never the user's browser. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";

const binary = process.argv[2];
if (!binary) throw new Error("Pass the browse binary");
const run = (...args: string[]) => execFileSync(binary, args, { encoding: "utf8", timeout: 25000 });
const js = (code: string) => JSON.parse(run("js", `({value:(${code})})`)).value;
if (!run("status").includes("Mode: launched")) {
  throw new Error("Use an isolated launched QA browser");
}
const artifacts = mkdtempSync("/private/tmp/lenslabs-sidebar-polish-");
const checks: string[] = [];
const check = (name: string, condition: unknown) => {
  if (!condition) throw new Error(name);
  checks.push(name);
  console.log(`PASS ${name}`);
};
run("goto", `http://127.0.0.1:8085/workspace?shoot=${crypto.randomUUID()}`);
run("wait", ".workbench-composer");
run("console", "--clear");
const before = js(`({class:document.documentElement.getAttribute('class'),
  style:document.documentElement.getAttribute('style')})`);
try {
  for (const width of [1440, 390]) {
    run("viewport", `${width}x${width === 390 ? 844 : 900}`);
    const sidebar = width === 390 ? ".workbench-mobile-sidebar" : ".workbench-sidebar";
    if (width === 390) run("click", '[aria-label="Open sidebar"]');
    run("wait", sidebar);
    for (const theme of ["dark", "light"]) {
      for (const accent of ["#eab54c", "linear-gradient(90deg, #eab54c, #ed79b6)"]) {
        const prefix = `${width}/${theme}/${accent.startsWith("#") ? "yellow" : "gradient"}`;
        js(`(()=>{const html=document.documentElement;
          html.classList.toggle('dark',${theme === "dark"});
          html.style.setProperty('--ll-settings-accent','#eab54c');
          html.style.setProperty('--ll-accent-gradient',${JSON.stringify(accent)});
          return true;})()`);
        const result = js(`(()=>{
          const panel=document.querySelector(${JSON.stringify(sidebar)});
          const nodes=[...panel.querySelectorAll('.workbench-nav-item')];
          const active=nodes.filter(el=>el.classList.contains('is-active'));
          const font=getComputedStyle(nodes[0]).fontFamily;
          return {
            compact:nodes.every(el=>getComputedStyle(el).fontSize==='14px' && getComputedStyle(el).lineHeight==='20px'),
            font:font.startsWith('-apple-system') && !font.includes('Inter Tight'),
            aligned:getComputedStyle(panel.querySelector('.ll-chat-recents')).fontFamily===font,
            brand:getComputedStyle(panel.querySelector('.workbench-brand')).fontSize==='18px',
            neutral:active.length>=1 && active.every(el=>getComputedStyle(el,'::after').content==='none' && getComputedStyle(el).backgroundColor===${JSON.stringify(theme === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.05)")}),
            targets:nodes.every(el=>el.getBoundingClientRect().height>=${width === 390 ? 44 : 40}),
            overflow:document.documentElement.scrollWidth<=innerWidth && panel.scrollWidth<=panel.clientWidth,
            family:font
          };
        })()`);
        for (const key of [
          "compact",
          "font",
          "aligned",
          "brand",
          "neutral",
          "targets",
          "overflow",
        ]) {
          check(`${prefix} ${key}`, result[key]);
        }
        run("click", `${sidebar} .account-trigger`);
        run("wait", ".account-menu");
        check(
          `${prefix} menu font`,
          js(`getComputedStyle(document.querySelector('.account-menu')).fontFamily`) ===
            result.family,
        );
        run("press", "Escape");
        run("press", "Tab");
        js(
          `document.querySelector(${JSON.stringify(sidebar + " .workbench-nav-item.is-active")}).focus()`,
        );
        check(
          `${prefix} keyboard focus`,
          js(
            `document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).outlineWidth==='2px'`,
          ),
        );
        js("document.activeElement.blur()");
        if (accent.startsWith("#"))
          run("screenshot", `${artifacts}/${width}-${theme}.png`, "--viewport");
      }
    }
    if (width === 390) run("press", "Escape");
  }
  writeFileSync(`${artifacts}/checks.json`, JSON.stringify(checks, null, 2));
  console.log(`${checks.length} checks passed. Screenshots: ${artifacts}`);
  console.log(run("console"));
} finally {
  js(`(()=>{const html=document.documentElement;const before=${JSON.stringify(before)};
    for(const attr of ['class','style']) {
      if(before[attr]===null)html.removeAttribute(attr);else html.setAttribute(attr,before[attr]);
    }
    return true;
  })()`);
  run("viewport", "1440x900");
}
