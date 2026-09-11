/** Isolated real-app QA. Never import user cookies or point at a user-owned shoot. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { SETTINGS_SECTIONS, settingsPath } from "../../src/lib/settings-catalog";
import { SETTINGS_CONTROLS } from "../../src/lib/settings-inventory";
import { DEFAULT_PREFERENCES, preferenceKey } from "../../src/lib/account-preferences";
import { exportSettings } from "../../src/lib/settings-transfer";
const binary = process.argv[2];
const phase = process.argv[3] ?? "navigation";
if (!binary) throw new Error("Pass the existing isolated browse executable.");
const root = "/private/tmp/lenslabs-settings-audit-20260907-1900";
const origin = "http://127.0.0.1:8085";
const shoot = "592c4eee-0c8e-4f6c-bd43-4fd583bd1b9a";
mkdirSync(root, { recursive: true });
const run = (...args: string[]): string => {
  if (args[0] === "fill" && args[2] === "") {
    run("click", args[1]!);
    run("press", "Meta+A");
    return run("press", "Backspace");
  }
  // Radix options put their text in a child span rather than a direct text node.
  return execFileSync(
    binary,
    args.map((arg) => arg.replaceAll(":text-is(", ":has-text(")),
    { encoding: "utf8", timeout: 25_000 },
  );
};
const js = (expression: string) => {
  // Wrap primitives so the CLI cannot turn the attribute string "false" into a boolean.
  return JSON.parse(run("js", `({value:(${expression})})`)).value;
};
const checks: { name: string; passed: boolean; details?: unknown }[] = [];
const save = () => writeFileSync(`${root}/${phase}-checks.json`, JSON.stringify(checks, null, 2));
const check = (name: string, passed: unknown, details?: unknown) => {
  checks.push({ name, passed: !!passed, details });
  save();
  if (!passed) throw new Error(name + (details ? `: ${JSON.stringify(details)}` : ""));
};
const go = (id: (typeof SETTINGS_SECTIONS)[number]["id"], mobile = false) => {
  if (mobile) run("click", '[aria-label="Open settings navigation"]');
  run("click", `[data-section="${id}"]`);
  run(
    "wait",
    `.settings-content h1:has-text(${JSON.stringify(SETTINGS_SECTIONS.find((s) => s.id === id)!.label)})`,
  );
};
const health = (name: string) => {
  const errors = run("console", "--errors");
  check(name, errors.includes("(no console errors)"), errors);
};
run("goto", `${origin}/settings/profile?shoot=${shoot}`);
run("wait", ".settings-shell");
check(
  "Isolated launched browser, not real user CDP session",
  run("status").includes("Mode: launched"),
);
if (phase === "navigation") {
  const inventory: Record<string, unknown> = {};
  const found = new Map<string, string[]>();
  for (const [w, h] of [
    [1440, 900],
    [1024, 768],
    [390, 844],
    [320, 740],
  ]) {
    run("viewport", `${w}x${h}`);
    for (const section of SETTINGS_SECTIONS) {
      go(section.id, w < 768);
      if (w === 1440) {
        run("reload");
        run("wait", `[data-section="${section.id}"][aria-current="page"]`);
      }
      const state = js(
        `({heading:document.querySelector('.settings-content h1').textContent,path:location.pathname,shoot:new URL(location.href).searchParams.get('shoot'),overflow:document.documentElement.scrollWidth>innerWidth||document.querySelector('.settings-main').scrollWidth>document.querySelector('.settings-main').clientWidth,rows:[...document.querySelectorAll('[data-setting-id]')].map(n=>n.dataset.settingId),ids:[...document.querySelectorAll('[id]')].map(n=>n.id),controls:[...document.querySelectorAll('.settings-content button,.settings-content input,.settings-content select,.settings-content textarea,.settings-content a')].map(n=>({tag:n.tagName,label:n.getAttribute('aria-label')||n.textContent||n.id,type:n.type,disabled:n.disabled,role:n.getAttribute('role'),href:n.getAttribute('href'),value:n.tagName==='SELECT'?n.value:undefined,options:n.tagName==='SELECT'?[...n.options].map(o=>({label:o.label,value:o.value})):undefined}))})`,
      );
      check(
        `${w}: ${section.label} route, heading, scope, overflow, unique IDs`,
        state.heading === section.label &&
          state.path === settingsPath(section.id) &&
          state.shoot === shoot &&
          !state.overflow &&
          new Set(state.ids).size === state.ids.length,
        state.overflow ? state : undefined,
      );
      health(`${w}: ${section.label} console`);
      if (w === 1440) {
        inventory[section.id] = state.controls;
        found.set(section.id, state.rows);
      }
    }
    go("profile", w < 768);
    run("screenshot", `${root}/profile-${w}.png`, "--viewport");
  }
  writeFileSync(`${root}/controls.json`, JSON.stringify(inventory, null, 2));
  check(
    "Every indexed setting resolves to a rendered row",
    SETTINGS_CONTROLS.every((c) => found.get(c.page)?.includes(c.id)),
  );
  run("viewport", "1440x900");
  run("fill", '[aria-label="Search settings"]', "pointer");
  run("press", "Enter");
  run("wait", "#setting-use-pointer-cursors");
  check(
    "Search focuses its actual control row",
    js("document.activeElement.id==='setting-use-pointer-cursors'"),
  );
  run("fill", '[aria-label="Search settings"]', "no-setting-by-this-name");
  check(
    "Search empty state",
    js("document.querySelector('.settings-main').textContent.includes('0 results matching')"),
  );
  run("fill", '[aria-label="Search settings"]', "");
  go("general");
  go("import");
  run("back");
  run("wait", '[data-section="general"][aria-current="page"]');
  run("forward");
  run("wait", '[data-section="import"][aria-current="page"]');
  check(
    "Back and forward keep shoot context",
    js(`new URL(location.href).searchParams.get('shoot')===${JSON.stringify(shoot)}`),
  );
}
if (phase === "profile") {
  run("viewport", "1440x900");
  const initial = js(
    `({name:document.querySelector('#profile-display-name').value,workspace:document.querySelector('#profile-workspace-name').value,bio:document.querySelector('#profile-biography').value})`,
  );
  check(
    "Profile initially has no error",
    js("document.querySelectorAll('.settings-profile-form [role=alert]').length===0"),
  );
  check(
    "Unchanged profile cannot submit",
    js("document.querySelector('.settings-profile-form [type=submit]').disabled"),
  );
  run("fill", "#profile-display-name", "Celine QA Test");
  run("fill", "#profile-workspace-name", "QA Studio");
  run("fill", "#profile-biography", "Portraits • 色彩 • 📷\nSynthetic test only.");
  run("dialog-dismiss");
  run("click", '[data-section="appearance"]');
  check(
    "Unsaved profile navigation retains draft",
    js(
      "location.pathname==='/settings/profile'&&document.querySelector('#profile-display-name').value==='Celine QA Test'",
    ),
  );
  run("click", '.settings-profile-form [type="submit"]');
  run("wait", '.settings-form-actions [role="status"]:has-text("Saved on this device")');
  run("reload");
  run("wait", "#profile-display-name");
  check(
    "Profile name workspace and Unicode biography survive reload",
    js(
      "document.querySelector('#profile-display-name').value==='Celine QA Test'&&document.querySelector('#profile-workspace-name').value==='QA Studio'&&document.querySelector('#profile-biography').value.includes('色彩')",
    ),
  );
  for (const [id, value] of [
    ["profile-display-name", initial.name],
    ["profile-workspace-name", initial.workspace],
    ["profile-biography", initial.bio],
  ])
    run("fill", `#${id}`, value);
  run("click", '.settings-profile-form [type="submit"]');
  run("wait", '.settings-form-actions [role="status"]:has-text("Saved on this device")');
  const png = js(
    `(()=>{const c=document.createElement('canvas');c.width=96;c.height=64;const x=c.getContext('2d');x.fillStyle='#804020';x.fillRect(0,0,48,64);x.fillStyle='#206080';x.fillRect(48,0,48,64);return c.toDataURL('image/png')})()`,
  );
  const input = '.settings-avatar-editor input[type="file"]';
  const fixture = `${root}/avatar.png`;
  writeFileSync(fixture, Buffer.from(png.split(",")[1], "base64"));
  run("upload", input, fixture);
  run("wait", '[aria-label="avatar crop preview"]');
  run("click", '[aria-label="Zoom"]');
  run("press", "ArrowRight");
  run("click", 'button:has-text("Use crop")');
  run("click", '.settings-profile-form [type="submit"]');
  run("wait", '.settings-form-actions [role="status"]:has-text("Saved on this device")');
  run("reload");
  run("wait", ".settings-avatar-editor img");
  check(
    "PNG crop saves and reloads as bounded JPEG",
    js(
      "document.querySelector('.settings-avatar-editor img').src.startsWith('data:image/jpeg;base64,')&&document.querySelector('.settings-avatar-editor img').naturalWidth===128",
    ),
  );
  run("screenshot", `${root}/profile-avatar-saved.png`, "--viewport");
  run("click", 'button:has-text("Remove avatar")');
  run("click", '.settings-profile-form [type="submit"]');
  run("wait", '.settings-form-actions [role="status"]:has-text("Saved on this device")');
  // A real PNG may have an empty OS MIME value. Exercise the actual file-change handler.
  js(
    `(()=>{const i=document.querySelector(${JSON.stringify(input)});const d=new DataTransfer();d.items.add(new File([Uint8Array.from(atob(${JSON.stringify(png.split(",")[1])}),c=>c.charCodeAt(0))],'portrait.PNG',{type:''}));i.files=d.files;i.dispatchEvent(new Event('change',{bubbles:true}));return true})()`,
  );
  run("wait", '[aria-label="avatar crop preview"]');
  const missingMime = js(
    "({crop:!!document.querySelector('[aria-label=\"avatar crop preview\"]'),error:document.querySelector('.settings-avatar-editor [role=alert]')?.textContent})",
  );
  run("screenshot", `${root}/avatar-missing-mime-after.png`, "--viewport");
  check(
    "Valid PNG with empty OS MIME reaches cropping",
    missingMime.crop && !missingMime.error,
    missingMime,
  );
  run("click", 'button:has-text("Cancel crop")');
  for (const mime of ["image/jpeg", "image/webp"]) {
    const data = js(
      `(()=>{const c=document.createElement('canvas');c.width=32;c.height=32;return c.toDataURL(${JSON.stringify(mime)})})()`,
    );
    const path = `${root}/avatar.${mime === "image/jpeg" ? "jpg" : "webp"}`;
    writeFileSync(path, Buffer.from(data.split(",")[1], "base64"));
    run("upload", input, path);
    run("wait", '[aria-label="avatar crop preview"]');
    check(
      `${mime} really decodes and crops`,
      js("document.querySelector('canvas[aria-label=\"avatar crop preview\"]').width===128"),
    );
    run("click", 'button:has-text("Cancel crop")');
  }
  for (const [name, content, message] of [
    ["renamed.png", Buffer.from("<svg onload='alert(1)'/>"), "JPEG, PNG or WebP"],
    ["corrupt.png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "Could not read"],
    ["oversized.png", Buffer.alloc(4194305), "no larger than 4 MB"],
  ] as const) {
    const path = `${root}/${name}`;
    writeFileSync(path, content);
    run("upload", input, path);
    run("wait", `.settings-avatar-editor [role=alert]:has-text(${JSON.stringify(message)})`);
    check(
      `${name} fails safely without enabling save`,
      js(
        "!document.querySelector('[aria-label=\"avatar crop preview\"]')&&document.querySelector('.settings-profile-form [type=submit]').disabled",
      ),
    );
  }
  run("upload", input, fixture);
  run("wait", '[aria-label="avatar crop preview"]');
  check(
    "Valid retry clears previous error",
    js("!document.querySelector('.settings-avatar-editor [role=alert]')"),
  );
  run("click", 'button:has-text("Cancel crop")');
  health("Profile and avatar console");
}
if (phase === "controls") {
  run("viewport", "1440x900");
  const key = preferenceKey("device-local");
  const stored = () => js(`JSON.parse(localStorage.getItem(${JSON.stringify(key)})||'{}')`);
  const original = { ...DEFAULT_PREFERENCES, ...stored() };
  const choice = (label: string, value: string) => {
    run("click", `[role=combobox][aria-label=${JSON.stringify(label)}]`);
    const target = js(
      "[...document.querySelectorAll('[role=option]')].find(n=>n.textContent.trim()===" +
        JSON.stringify(value) +
        ").getAttribute('aria-labelledby')",
    );
    run("click", "[role=option][aria-labelledby=" + JSON.stringify(target) + "]");
  };
  for (const page of [
    "general",
    "import",
    "appearance",
    "configuration",
    "personalization",
    "pets",
    "browser",
  ] as const) {
    go(page);
    const switches: string[] = js(
      "[...document.querySelectorAll('.settings-content [role=switch]:not([disabled])')].map(n=>n.getAttribute('aria-label')).filter(x=>x!=='Desktop notifications')",
    );
    for (const label of switches) {
      const selector = `[role=switch][aria-label=${JSON.stringify(label)}]`;
      const before = js(
        `document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-checked')`,
      );
      run("click", selector);
      run("reload");
      run("wait", selector);
      check(
        `${page}: ${label} changes and survives reload`,
        js(
          `document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-checked')!==${JSON.stringify(before)}`,
        ),
      );
      run("click", selector);
      check(
        `${page}: ${label} restores`,
        js(
          `document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-checked')===${JSON.stringify(before)}`,
        ),
      );
    }
    const choices: string[] = js(
      "[...document.querySelectorAll('.settings-content button[role=combobox]:not([disabled])')].map(n=>n.getAttribute('aria-label'))",
    );
    for (const label of choices) {
      const selector = `[role=combobox][aria-label=${JSON.stringify(label)}]`;
      const before = js(`document.querySelector(${JSON.stringify(selector)}).textContent.trim()`);
      run("click", selector);
      const options: string[] = js(
        "[...document.querySelectorAll('[role=option]')].filter(n=>n.getAttribute('aria-disabled')!=='true').map(n=>n.textContent.trim())",
      );
      run("press", "Escape");
      for (const option of options) {
        choice(label, option);
        run("reload");
        run("wait", selector);
        check(
          `${page}: ${label} → ${option} persists`,
          js(
            `document.querySelector(${JSON.stringify(selector)}).textContent.trim()===${JSON.stringify(option)}`,
          ),
        );
      }
      choice(label, before);
    }
    health(`${page} controls console`);
  }
  go("appearance");
  for (const mode of ["Light", "System", "Dark"]) {
    run("click", `.settings-theme-options button:text-is(${JSON.stringify(mode)})`);
    run("reload");
    run("wait", ".settings-theme-options");
    check(
      `${mode} applies after reload`,
      js(
        `document.documentElement.classList.contains('dark')===${mode === "System" ? "matchMedia('(prefers-color-scheme: dark)').matches" : String(mode === "Dark")}`,
      ),
    );
  }
  for (const [label, variable] of [
    ["Interface size", "--ll-ui-size"],
    ["Code size", "--ll-code-size"],
  ]) {
    const selector = `[aria-label=${JSON.stringify(label)}]`;
    for (const key of ["Home", "End"]) {
      run("click", selector);
      run("press", key);
      run("reload");
      run("wait", selector);
      check(
        `${label} ${key} updates effective CSS`,
        js(
          `document.documentElement.style.getPropertyValue(${JSON.stringify(variable)})===document.querySelector(${JSON.stringify(selector)}).value+'px'`,
        ),
      );
    }
  }
  go("personalization");
  run("fill", "#preferred-terms", "Keepers, not winners");
  run("fill", "#personal-instructions", "Protect natural skin tones. Synthetic QA preference.");
  run("click", 'button:text-is("Save instructions")');
  run("reload");
  run("wait", "#personal-instructions");
  check(
    "Instructions and terminology persist",
    js(
      "document.querySelector('#personal-instructions').value.includes('Synthetic QA')&&document.querySelector('#preferred-terms').value==='Keepers, not winners'",
    ),
  );
  go("configuration");
  const fixture = `${root}/restore-preferences.json`;
  writeFileSync(fixture, exportSettings(original));
  run("upload", ".settings-content input[type=file]", fixture);
  run("wait", "[role=alertdialog]");
  check(
    "Import previews changes before applying",
    js(
      "document.querySelector('[role=alertdialog]').textContent.includes('Import these settings')",
    ),
  );
  run("click", '[role=alertdialog] button:text-is("Cancel")');
  check(
    "Cancel import preserves current preferences",
    stored().customInstructions.includes("Synthetic QA"),
  );
  run("upload", ".settings-content input[type=file]", fixture);
  run("wait", "[role=alertdialog]");
  const submit = js(
    "[...document.querySelectorAll('[role=alertdialog] button')].map(n=>n.textContent.trim()).find(n=>n!=='Cancel')",
  );
  run("click", `[role=alertdialog] button:text-is(${JSON.stringify(submit)})`);
  check(
    "Confirmed import restores preferences without photos/profile",
    stored().customInstructions === original.customInstructions &&
      stored().theme === original.theme,
  );
  const bad = `${root}/invalid-settings.json`;
  writeFileSync(bad, '{"product":"LensLabs","version":999}');
  run("upload", ".settings-content input[type=file]", bad);
  run("wait", ".settings-content [role=alert]");
  check(
    "Invalid settings file does not open confirmation",
    js("!document.querySelector('[role=alertdialog][data-state=open]')"),
  );
  run("reload");
  run("wait", ".settings-content");
  health("Portable settings console");
}
console.log(JSON.stringify({ phase, passed: checks.filter((c) => c.passed).length, root }));
