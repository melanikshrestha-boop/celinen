/** Presentation regression matrix. Separate launched browser, synthetic shoots/files only. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const binary = process.argv[2];
if (!binary) throw new Error("Pass the existing browse binary");
const root = "/private/tmp/lenslabs-workspace-layout-qa";
const extraOnly = process.argv[3] === "extras";
mkdirSync(root, { recursive: true });
const run = (...args: string[]) => execFileSync(binary, args, { encoding: "utf8", timeout: 25000 });
const js = (code: string) => JSON.parse(run("js", `({value:(${code})})`)).value;
const wait = (code: string) => {
  for (let i = 0; i < 100; i++) {
    const value = js(code);
    if (value) return value;
  }
  throw new Error(`Timed out: ${code}`);
};
const asyncJs = (code: string) => {
  run(
    "js",
    `window.__qaResult=null;void (${code}).then(value=>window.__qaResult={value},error=>window.__qaResult={error:String(error)})`,
  );
  const result = wait("window.__qaResult");
  if (result.error) throw new Error(result.error);
  return result.value;
};
const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
const check = (name: string, passed: unknown, detail?: unknown) => {
  checks.push({ name, passed: !!passed, detail });
  writeFileSync(
    `${root}/${extraOnly ? "extra-checks" : "checks"}.json`,
    JSON.stringify(checks, null, 2),
  );
  if (!passed) throw new Error(`${name}: ${JSON.stringify(detail)}`);
  console.log(`PASS ${name}`);
};
const rect = (selector: string) =>
  js(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`);
const screenshot = (name: string) => run("screenshot", `${root}/${name}.png`, "--viewport");
const field = "#studio-chat-input";
const load = (shoot: string) => {
  run("goto", `http://127.0.0.1:8085/workspace?shoot=${shoot}`);
  run("wait", ".workbench-composer");
  wait(`!document.querySelector(${JSON.stringify(field)}).disabled`);
  wait(`document.querySelector('.workbench-messages').textContent === ''`);
};
const emptyField = () => {
  run("click", field);
  run("press", "Meta+A");
  run("press", "Backspace");
  wait(`document.querySelector(${JSON.stringify(field)}).value === ''`);
};
const noOverflow = () =>
  js(
    "document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth",
  );

// This dispatches actual File objects through the production drop handler and folder walker.
const drop = (name: string, fail = false, delay = 0) =>
  asyncJs(`(async()=>{
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
  const context=canvas.getContext('2d');context.fillStyle='#689293';context.fillRect(0,0,64,64);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  const entries=[1,2,3].map(i=>({name:'qa-'+i+'.png',isFile:true,isDirectory:false,file:success=>success(new File([blob],'qa-'+i+'.png',{type:'image/png',lastModified:i}))}));
  const directory={name:${JSON.stringify(name)},isDirectory:true,isFile:false,createReader:()=>{let done=false;return {readEntries:(success,error)=>setTimeout(()=>{if(${fail})error(new Error('QA folder permission denied'));else{success(done?[]:entries);done=true;}},${delay})}}};
  const transfer=new DataTransfer();transfer.items.add(new File([''],'folder',{type:'application/octet-stream'}));
  Object.defineProperty(transfer,'items',{value:[{kind:'file',webkitGetAsEntry:()=>directory,getAsFile:()=>null}]});
  document.querySelector('.workbench-composer').dispatchEvent(new DragEvent('dragenter',{bubbles:true,dataTransfer:transfer}));
  window.__qaDragOutline = document.querySelector('.workbench-composer').classList.contains('is-dragging');
  document.querySelector('.workbench-composer').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));
  return true;
})()`);

check("Separate QA browser", run("status").includes("Mode: launched"));
run("console", "--clear");
// Reset only this isolated browser's presentation preferences; no user browser or saved shoot.
const previous = asyncJs(
  `(async()=>{const p=await import('/src/lib/account-preferences.ts');const key=p.preferenceKey('device-local'),previous=localStorage.getItem(key);localStorage.setItem(key,JSON.stringify({...p.DEFAULT_PREFERENCES,reduceMotion:true}));window.dispatchEvent(new StorageEvent('storage',{key}));return {key,previous};})()`,
);
try {
  if (!extraOnly)
    for (const [width, height] of [
      [1440, 900],
      [1280, 800],
      [1024, 768],
      [390, 844],
    ]) {
      const prefix = `${width}x${height}`;
      const shoot = crypto.randomUUID();
      run("viewport", prefix);
      load(shoot);
      js("document.activeElement.blur()");
      const composer = rect(".workbench-composer");
      check(
        `${prefix} empty geometry`,
        composer.width ===
          Math.min(820, width - (width >= 1024 ? 272 : 0) - (width < 421 ? 24 : 48)) &&
          composer.height === 64 &&
          composer.bottom === height - (width < 421 ? 12 : 24),
        composer,
      );
      check(
        `${prefix} exact placeholder, empty value and viewport`,
        js(
          `document.querySelector('${field}').placeholder==='Drop your shoot folder.' && document.querySelector('${field}').value==='' && document.querySelector('.workbench-messages').textContent==='' && !document.querySelector('.workbench-chat-empty')`,
        ),
      );
      check(
        `${prefix} toolbar is one 56px row`,
        rect(".workbench-header").height === 56 && js("!document.querySelector('.workbench-tabs')"),
      );
      check(
        `${prefix} disabled send`,
        js("document.querySelector('[aria-label=\"Send message\"]').disabled"),
      );
      check(`${prefix} no overflow`, noOverflow());
      screenshot(`${prefix}-empty`);
      run("fill", field, "Keep the strongest frames.");
      check(
        `${prefix} one line stays compact and enables send`,
        rect(".workbench-composer").height === 64 &&
          !js("document.querySelector('[aria-label=\"Send message\"]').disabled"),
      );
      screenshot(`${prefix}-one-line`);
      run(
        "fill",
        field,
        Array.from(
          { length: 30 },
          (_, i) => `Line ${i + 1}: Keep the crop and originals unchanged.`,
        ).join("\n"),
      );
      wait(`document.querySelector('${field}').clientHeight===192`);
      check(
        `${prefix} long draft is capped and scrollable`,
        js(`document.querySelector('${field}').scrollHeight>192`) && noOverflow(),
      );
      screenshot(`${prefix}-multiline`);
      emptyField();
      run("click", '[aria-label="Attach photos or a folder"]');
      run("wait", ".workbench-attach-menu");
      const menu = rect(".workbench-attach-menu");
      check(
        `${prefix} attachment menu within viewport`,
        menu.left >= 0 && menu.right <= width && menu.top >= 0 && menu.bottom <= height,
        menu,
      );
      screenshot(`${prefix}-menu`);
      run("press", "Escape");
      check(
        `${prefix} menu restores attachment focus`,
        js("document.activeElement.getAttribute('aria-label')==='Attach photos or a folder'"),
      );
      drop("QA shoot", false, 700);
      run("wait", ".workbench-attachment");
      check(
        `${prefix} reading is not ready`,
        js(
          "document.querySelector('[aria-label=\"Send message\"]').disabled && document.querySelector('.workbench-attachment').textContent.includes('QA shoot')",
        ),
      );
      wait("!!document.querySelector('[aria-label=\"Dismiss import summary\"]')");
      check(
        `${prefix} actual folder metadata and completed count`,
        js(
          "document.querySelector('.workbench-attachment').textContent.includes('3 selected photos') && document.querySelector('.workbench-attachment').textContent.includes('3 frames read')",
        ),
      );
      check(
        `${prefix} import did not navigate`,
        js("location.pathname==='/workspace'") && noOverflow(),
      );
      screenshot(`${prefix}-folder`);
      run("click", '[aria-label="Dismiss import summary"]');
      check(
        `${prefix} dismiss removes attachment shelf only`,
        js(
          "!document.querySelector('.workbench-attachment') && document.querySelector('.workbench-shoot').textContent.includes('3')",
        ),
      );
      drop("QA Very long folder name — client selects and delivery — ".repeat(3));
      run("wait", ".workbench-attachment");
      wait("!!document.querySelector('[aria-label=\"Dismiss import summary\"]')");
      check(
        `${prefix} long folder name truncates without moving send`,
        noOverflow() &&
          js(
            "getComputedStyle(document.querySelector('.workbench-attachment strong')).textOverflow==='ellipsis'",
          ),
      );
      screenshot(`${prefix}-long-folder`);
      drop("QA unreadable folder", true);
      wait(
        "document.querySelector('.workbench-attachment').textContent.includes('This item could not be read')",
      );
      check(
        `${prefix} error keeps actual folder name`,
        js(
          "document.querySelector('.workbench-attachment').textContent.includes('QA unreadable folder')",
        ) && noOverflow(),
      );
      screenshot(`${prefix}-error`);
      run("click", '[aria-label="Dismiss import summary"]');
      // Existing repository API seeds known synthetic history. No application history schema changes.
      const id = asyncJs(
        `(async()=>{const m=await import('/src/lib/chat-history.ts');const repo=m.localChatRepository('device-local');const chat=await repo.save({...m.newChat('${shoot}'),title:'QA Cover selection',named:true,messages:Array.from({length:30},(_,i)=>({role:i%2?'assistant':'user',text:i%2?'The second frame leaves more space for the subject. Keep the original crop.':'Compare cover option '+i+'.'}))});return chat.id;})()`,
      );
      run("reload");
      run("wait", ".workbench-composer");
      if (width < 1024) {
        run("click", '[aria-label="Open sidebar"]');
        run("wait", ".workbench-mobile-sidebar");
      }
      run("click", `[data-chat-id="${id}"] .ll-chat-title`);
      if (
        width < 1024 &&
        js("!!document.querySelector('.workbench-mobile-sidebar[data-state=open]')")
      )
        run("press", "Escape");
      wait("document.querySelectorAll('.workbench-message').length===30");
      check(
        `${prefix} populated conversation uses composer column`,
        rect(".workbench-messages").x === rect(".workbench-composer").x &&
          rect(".workbench-messages").width === rect(".workbench-composer").width,
      );
      js("document.querySelector('.workbench-messages').scrollTop=100");
      wait("!!document.querySelector('.workbench-jump')");
      const before = js("document.querySelector('.workbench-messages').scrollTop");
      run("fill", field, "A draft should not move what I am reading.");
      check(
        `${prefix} typing preserves reading position`,
        js("document.querySelector('.workbench-messages').scrollTop") === before,
      );
      screenshot(`${prefix}-conversation`);
      run("click", ".workbench-jump");
      check(
        `${prefix} jump reaches latest`,
        js(
          "(()=>{const n=document.querySelector('.workbench-messages');return n.scrollHeight-n.scrollTop-n.clientHeight<64})()",
        ),
      );
      emptyField();
      run("click", '[aria-label="Conversation actions"]');
      run("click", '[role=menuitem]:has-text("Rename")');
      run("wait", ".ll-chat-dialog");
      check(
        `${prefix} toolbar action works with sidebar closed`,
        js("document.querySelector('.ll-chat-dialog input').value==='QA Cover selection'"),
      );
      run("press", "Escape");
      if (width < 1024) {
        run("click", '[aria-label="Open sidebar"]');
        run("wait", ".workbench-mobile-sidebar");
        wait(
          "getComputedStyle(document.querySelector('.workbench-mobile-sidebar')).transform==='none'",
        );
      }
      const titleSelector = `[data-chat-id="${id}"] .ll-chat-title`;
      const titleBefore = rect(titleSelector);
      run("hover", `[data-chat-id="${id}"]`);
      check(
        `${prefix} hover reserves title space`,
        rect(titleSelector).width === titleBefore.width && rect(titleSelector).x === titleBefore.x,
      );
      run("click", `[data-chat-id="${id}"] [aria-label^="More options"]`);
      run("wait", ".ll-chat-menu");
      const chatMenu = rect(".ll-chat-menu");
      check(
        `${prefix} chat menu stays in viewport`,
        chatMenu.x >= 0 &&
          chatMenu.right <= width &&
          chatMenu.top >= 0 &&
          chatMenu.bottom <= height,
        chatMenu,
      );
      screenshot(`${prefix}-sidebar-menu`);
      run("press", "Escape");
      run("click", ".account-trigger");
      run("wait", ".account-menu");
      const accountMenu = rect(".account-menu");
      check(
        `${prefix} account menu stays in viewport`,
        accountMenu.x >= 0 &&
          accountMenu.right <= width &&
          accountMenu.top >= 0 &&
          accountMenu.bottom <= height,
        accountMenu,
      );
      screenshot(`${prefix}-account-menu`);
      check(
        `${prefix} primary navigation stays above scrolling recents`,
        rect(".workbench-sidebar-content > .workbench-nav-item").top >= 56,
      );
      run("press", "Escape");
      if (width < 1024) {
        run("press", "Escape");
        wait("document.activeElement?.getAttribute('aria-label')==='Open sidebar'");
      }
      if (width < 1024) {
        run("click", '[aria-label="Open sidebar"]');
        run("wait", ".workbench-mobile-sidebar");
        wait(
          "getComputedStyle(document.querySelector('.workbench-mobile-sidebar')).transform==='none'",
        );
        check(
          `${prefix} overlay drawer`,
          rect(".workbench-mobile-sidebar").width === 272 &&
            rect(".workbench-body").width === width,
        );
        screenshot(`${prefix}-drawer`);
        run("press", "Escape");
        wait("document.activeElement?.getAttribute('aria-label')==='Open sidebar'");
        check(`${prefix} drawer restores focus`, true);
      } else {
        run("click", '[aria-label="Collapse sidebar"]');
        wait(
          "document.querySelector('.workbench-body').getBoundingClientRect().width===innerWidth",
        );
        check(
          `${prefix} collapse releases sidebar width`,
          rect(".workbench-composer").width === 820,
        );
        run("click", '[aria-label="Open sidebar"]');
      }
    }
  if (extraOnly) {
    const shoot = crypto.randomUUID();
    run("viewport", "390x844");
    load(shoot);
    asyncJs(
      `(async()=>{const p=await import('/src/lib/account-preferences.ts');const key=p.preferenceKey('device-local');localStorage.setItem(key,JSON.stringify({...p.DEFAULT_PREFERENCES,theme:'light',reduceMotion:true}));window.dispatchEvent(new StorageEvent('storage',{key}));return true;})()`,
    );
    wait("!document.documentElement.classList.contains('dark')");
    js("document.activeElement.blur()");
    check(
      "Light mode keeps a legible composer surface",
      js(
        "getComputedStyle(document.querySelector('.workbench-composer')).backgroundColor==='rgb(242, 242, 242)'",
      ),
    );
    check(
      "Mobile primary send target is 44px",
      rect('[aria-label="Send message"]').width === 44 &&
        rect('[aria-label="Send message"]').height === 44,
    );
    screenshot("390x844-light");
    run("viewport", "960x800");
    check(
      "Tablet uses drawer, not compressed desktop sidebar",
      js("!!document.querySelector('[aria-label=\"Open sidebar\"]')") &&
        rect(".workbench-body").width === 960 &&
        rect(".workbench-composer").width === 820,
    );
    run("click", '[aria-label="Open sidebar"]');
    run("wait", ".workbench-mobile-sidebar");
    wait(
      "getComputedStyle(document.querySelector('.workbench-mobile-sidebar')).transform==='none'",
    );
    screenshot("960x800-light-drawer");
    run("press", "Escape");
    wait("document.activeElement?.getAttribute('aria-label')==='Open sidebar'");
    run("viewport", "390x844");
    run("fill", field, "Keep this draft intact.");
    run("press", "Shift+Enter");
    check(
      "Shift+Enter makes a newline, not a message",
      js(
        `document.querySelector('${field}').value.endsWith(String.fromCharCode(10)) && document.querySelectorAll('.workbench-message').length===0`,
      ),
    );
    js(
      `document.querySelector('${field}').dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter',isComposing:true}))`,
    );
    check(
      "IME Enter does not send",
      js(
        `document.querySelector('${field}').value.startsWith('Keep this draft intact.') && document.querySelectorAll('.workbench-message').length===0`,
      ),
    );
    run("reload");
    run("wait", ".workbench-composer");
    wait(`document.querySelector('${field}').value.startsWith('Keep this draft intact.')`);
    check("Draft survives reload and visual states", true);
    run("viewport", "390x480");
    check(
      "Short keyboard-sized viewport keeps composer reachable",
      rect(".workbench-composer").bottom <= 480 &&
        rect(".workbench-composer").top >= 56 &&
        js(`document.querySelector('${field}').value.startsWith('Keep this draft intact.')`),
    );
    screenshot("390x480-short-viewport");
    run("viewport", "390x844");
    emptyField();
    run("fill", field, "   ");
    check(
      "Whitespace-only input stays disabled",
      js("document.querySelector('[aria-label=\"Send message\"]').disabled"),
    );
    emptyField();
    run("fill", field, "Keep this while reading files.");
    drop("QA cancellable folder", false, 10000);
    run("wait", ".workbench-attachment");
    check(
      "Reading disables a nonempty draft",
      js("document.querySelector('[aria-label=\"Send message\"]').disabled"),
    );
    run("click", '.workbench-attachment button:has-text("Stop")');
    wait("!!document.querySelector('[aria-label=\"Dismiss import summary\"]')");
    check(
      "Stopping enumeration preserves draft and existing files",
      js(
        `document.querySelector('${field}').value==='Keep this while reading files.' && document.querySelector('.workbench-attachment').textContent.includes('QA cancellable folder') && !document.querySelector('.workbench-shoot')`,
      ),
    );
    run("click", '[aria-label="Dismiss import summary"]');
    emptyField();
    asyncJs(
      `(async()=>{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const ctx=canvas.getContext('2d');ctx.fillStyle='#6688aa';ctx.fillRect(0,0,64,64);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const data=new DataTransfer();data.items.add(new File([blob],'QA single photo.png',{type:'image/png'}));document.querySelector('.workbench-composer').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:data}));return true;})()`,
    );
    wait(
      "!!document.querySelector('.workbench-attachment img') && !!document.querySelector('[aria-label=\"Dismiss import summary\"]')",
    );
    check(
      "One image has a real thumbnail and actual name",
      js(
        "document.querySelector('.workbench-attachment img').naturalWidth===64 && document.querySelector('.workbench-attachment').textContent.includes('QA single photo.png')",
      ),
    );
    screenshot("390x844-single-image");
  }
  check("No browser console errors", !run("console", "--errors").includes("[error]"));
} finally {
  js(
    `(localStorage.${previous.previous === null ? "removeItem" : "setItem"}(${JSON.stringify(previous.key)}${previous.previous === null ? "" : `,${JSON.stringify(previous.previous)}`}),window.dispatchEvent(new StorageEvent('storage',{key:${JSON.stringify(previous.key)}})))`,
  );
}
console.log(`Completed ${checks.length} checks. Artifacts: ${root}`);
