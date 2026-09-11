/** Real isolated Chromium + synthetic records only. No auth bypass, real emails or AI requests. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const binary = process.argv[2];
if (!binary) throw new Error("Pass the existing browse binary");
const phase = process.argv[3] ?? "chat";
const root = "/private/tmp/lenslabs-conversation-controls-qa";
const origin = "http://127.0.0.1:8085";
const shoot = "592c4eee-0c8e-4f6c-bd43-4fd583bd1b9a";
mkdirSync(root, { recursive: true });
const run = (...args: string[]): string =>
  execFileSync(binary, args, { encoding: "utf8", timeout: 25000 });
const js = (expression: string) => JSON.parse(run("js", `({value:(${expression})})`)).value;
const waitFor = (expression: string) => {
  for (let i = 0; i < 90; i++) {
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
  writeFileSync(`${root}/${phase}-checks.json`, JSON.stringify(checks, null, 2));
  if (!passed) throw new Error(name);
  console.log(`PASS ${name}`);
};
const choice = (label: string, text: string) => {
  run("click", `[role=combobox][aria-label=${JSON.stringify(label)}]`);
  run("click", `[role=option]:has-text(${JSON.stringify(text)})`);
};
const load = (path: string) => {
  run("goto", `${origin}${path}?shoot=${shoot}`);
  run("wait", ".workbench-body");
};
const ready = () =>
  waitFor("!document.querySelector('[aria-label=\"New chat in this shoot\"]').disabled");
check("Isolated browser, no real account cookies", run("status").includes("Mode: launched"));
run("console", "--clear");
run("viewport", "1440x900");
if (phase === "chat") {
  load("/workspace");
  ready();
  const ids = asyncJs(
    `(async()=>{const m=await import('/src/lib/chat-history.ts');window.__qaRepo=m.localChatRepository('device-local');const a=await window.__qaRepo.save({...m.newChat('${shoot}'),title:'QA Client review',named:true,messages:[{role:'user',text:'Choose the strongest cover.'},{role:'assistant',text:'The second frame. <script>not executable</script>',tools:[{name:'receipt',result:'PRIVATE_RECEIPT'}]},{role:'user',text:'PRIVATE_EMAIL',privateConnector:true}],draft:'PRIVATE_DRAFT'});const b=await window.__qaRepo.save({...m.newChat('${shoot}'),title:'QA Keep this chat',named:true});const other=await window.__qaRepo.save({...m.newChat('qa-other-project'),title:'QA Other shoot',named:true});return {a:a.id,b:b.id,other:other.id};})()`,
  );
  writeFileSync(`${root}/ids.json`, JSON.stringify(ids));
  run("reload");
  run("wait", `[data-chat-id="${ids.a}"]`);
  ready();
  const row = `[data-chat-id="${ids.a}"]`;
  const menu = () => {
    ready();
    run("hover", row);
    run("click", `${row} [aria-label^="More options"]`);
  };
  check(
    "New chats render separate action menus",
    js(`document.querySelectorAll('.ll-chat-row').length>=2`),
  );
  run("hover", row);
  waitFor(`getComputedStyle(document.querySelector('${row} .ll-chat-hover')).opacity==='1'`);
  check(
    "Pin icon is visible on hover",
    js(`getComputedStyle(document.querySelector('${row} .ll-chat-hover')).opacity==='1'`),
  );
  run("click", `${row} [aria-label="Pin QA Client review"]`);
  ready();
  check(
    "Pin moves chat into Pinned section",
    js(
      `document.querySelector('${row}').closest('.ll-chat-group').querySelector('h3').textContent==='Pinned'`,
    ),
  );
  run("reload");
  run("wait", row);
  ready();
  check("Pin survives reload", js(`document.querySelector('${row} [aria-pressed=true]')!==null`));
  menu();
  check(
    "Menu contains requested actions and no ChatGPT link",
    js(
      `(()=>{const text=document.querySelector('[role=menu]').textContent;return ['Share with client','Rename','Unpin','Archive','Delete chat','Section','Open in Quick Chat','Adobe export'].every(x=>text.includes(x))&&!text.includes('chatgpt.com')})()`,
    ),
  );
  run("screenshot", `${root}/chat-menu.png`, "--viewport");
  run("click", '[role=menuitem]:has-text("Rename")');
  run("fill", ".ll-chat-dialog input", "QA Client delivery");
  run("click", '.ll-chat-dialog button:has-text("Save")');
  ready();
  check(
    "Rename saves and updates sidebar",
    js(`document.querySelector('${row} .ll-chat-title').textContent==='QA Client delivery'`),
  );
  menu();
  run("hover", '[role=menuitem]:has-text("Section")');
  run("click", '[role=menuitem]:has-text("New section…")');
  run("fill", ".ll-chat-dialog input", "Client selects");
  run("click", '.ll-chat-dialog button:has-text("Save")');
  ready();
  check(
    "New section moves chat and unpins it",
    js(
      `document.querySelector('${row}').closest('.ll-chat-group').querySelector('h3').textContent==='Client selects'&&!document.querySelector('${row} [aria-pressed=true]')`,
    ),
  );
  menu();
  run("click", '[role=menuitem]:has-text("Share with client")');
  run("wait", ".ll-transcript-preview article:first-of-type");
  check(
    "Share preview shows full safe transcript only",
    js(
      `(()=>{const p=document.querySelector('.ll-transcript-preview');return p.textContent.includes('Choose the strongest cover')&&p.textContent.includes('The second frame')&&!p.textContent.includes('PRIVATE_')&&!p.querySelector('script')})()`,
    ),
  );
  // Capture bytes at the actual download boundary, without using the OS clipboard or sending a message.
  js(
    "(window.__qaDownload=null,window.__qaCreateURL=URL.createObjectURL,URL.createObjectURL=blob=>{blob.text().then(text=>window.__qaDownload=text);return window.__qaCreateURL(blob)})",
  );
  run("click", '.ll-chat-dialog button:has-text("Download transcript")');
  waitFor("window.__qaDownload");
  check(
    "Download produces escaped, private-data-free HTML",
    js(
      "window.__qaDownload.includes('&lt;script&gt;')&&!window.__qaDownload.includes('PRIVATE_')&&window.__qaDownload.includes(\"default-src 'none'\")",
    ),
  );
  run("press", "Escape");
  ready();
  menu();
  run("click", '[role=menuitem]:has-text("Open in Quick Chat")');
  run("wait", ".is-quick-chat");
  check(
    "Quick Chat reuses one composer and preserves draft",
    js(
      "document.querySelectorAll('.workbench-chat-mount textarea').length===1&&document.querySelector('.workbench-chat-mount textarea').value==='PRIVATE_DRAFT'",
    ),
  );
  run("screenshot", `${root}/quick-chat.png`, "--viewport");
  run("click", '[aria-label="Close Quick Chat"]');
  check(
    "Quick Chat closes without discarding text",
    js(
      "!document.querySelector('.is-quick-chat')&&document.querySelector('.workbench-chat-mount textarea').value==='PRIVATE_DRAFT'",
    ),
  );
  menu();
  run("click", '[role=menuitem]:has-text("Adobe export")');
  run("click", '.ll-chat-dialog button:has-text("Download Adobe sidecars")');
  check(
    "Empty shoot export gives an honest error instead of a fake handoff",
    waitFor(
      "document.querySelector('.ll-chat-dialog .ll-chat-note')?.textContent.includes('photo')",
    ),
  );
  run("press", "Escape");
  menu();
  run("click", '[role=menuitem]:has-text("Archive")');
  ready();
  check("Archive hides chat from recents", js(`!document.querySelector('${row}')`));
  run("hover", ".ll-chat-heading");
  run("click", '[aria-label="Show archived chats"]');
  run("wait", row);
  menu();
  run("click", '[role=menuitem]:has-text("Restore chat")');
  ready();
  run("hover", ".ll-chat-heading");
  run("click", '[aria-label="Show recent chats"]');
  run("wait", row);
  check(
    "Restore keeps section and transcript",
    js(
      `document.querySelector('${row}').closest('.ll-chat-group').querySelector('h3').textContent==='Client selects'`,
    ),
  );
  menu();
  run("click", '[role=menuitem]:has-text("Delete chat")');
  check(
    "Deletion explicitly excludes photos",
    js(
      "document.querySelector('.ll-chat-dialog').textContent.includes('photos and edits stay untouched')",
    ),
  );
  run("click", '.ll-chat-dialog button:has-text("Cancel")');
  check("Cancel deletion preserves row", js(`!!document.querySelector('${row}')`));
  menu();
  run("click", '[role=menuitem]:has-text("Delete chat")');
  run("click", '.ll-chat-dialog button:has-text("Delete chat")');
  ready();
  check(
    "Confirmed deletion removes only selected row",
    js(`!document.querySelector('${row}')&&!!document.querySelector('[data-chat-id="${ids.b}"]')`),
  );
  const deletion = asyncJs(
    `(async()=>{const m=await import('/src/lib/chat-history.ts'),r=m.localChatRepository('device-local');let missing=false;try{await r.read('${ids.a}')}catch{missing=true}return missing&&(await r.read('${ids.b}')).title==='QA Keep this chat'&&(await r.read('${ids.other}')).project==='qa-other-project'})()`,
  );
  check("Deletion is durable and other shoot's conversation is untouched", deletion);
  run("hover", ".ll-chat-heading");
  run("click", '[aria-label="New chat in this shoot"]');
  ready();
  check(
    "Explicit new chat persists an empty conversation",
    js("[...document.querySelectorAll('.ll-chat-title')].some(n=>n.textContent==='New chat')"),
  );
  run("click", ".workbench-header");
  run("press", "Alt+Shift+T");
  waitFor("document.querySelector('.chat-save-status')?.textContent.includes('Temporary chat')");
  run("fill", ".workbench-chat-mount textarea", "EPHEMERAL_QA_DRAFT");
  check(
    "Temporary draft never enters IndexedDB",
    asyncJs(
      `(async()=>{const m=await import('/src/lib/chat-history.ts'),r=m.localChatRepository('device-local'),rows=await r.list('${shoot}');for(const row of rows)if((await r.read(row.id)).draft.includes('EPHEMERAL'))return false;return true})()`,
    ),
  );
  run("click", ".workbench-header");
  run("dialog-dismiss");
  run("press", "Alt+Shift+C");
  check(
    "Cancel leaving temporary chat retains its draft",
    js("document.querySelector('.workbench-chat-mount textarea').value==='EPHEMERAL_QA_DRAFT'"),
  );
  run("dialog-accept");
  run("press", "Alt+Shift+C");
  ready();
  check(
    "Discard temporary chat starts an empty saved chat",
    js(
      "document.querySelector('.workbench-chat-mount textarea').value===''&&!document.querySelector('.chat-save-status').textContent.includes('Temporary')",
    ),
  );
  run("click", ".workbench-header");
  run("press", "Meta+Alt+P");
  ready();
  check(
    "Pin shortcut operates on active chat",
    js("!!document.querySelector('.ll-chat-row.is-active [aria-pressed=true]')"),
  );
  run("fill", ".workbench-chat-mount textarea", "Typing protection");
  run("press", "Meta+Alt+P");
  check(
    "Chat shortcuts do not fire while typing",
    js("!!document.querySelector('.ll-chat-row.is-active [aria-pressed=true]')"),
  );
  run("click", ".workbench-header");
  run("press", "Meta+Alt+N");
  run("wait", ".is-quick-chat");
  run("viewport", "390x844");
  check(
    "Quick Chat fits mobile viewport",
    js(
      "(()=>{const r=document.querySelector('.is-quick-chat').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1})()",
    ),
  );
  run("screenshot", `${root}/quick-mobile.png`, "--viewport");
  check("No browser console errors", run("console", "--errors").includes("(no console errors)"));
}
if (phase === "storage") {
  load("/workspace");
  ready();
  const result = asyncJs(
    `(async()=>{const m=await import('/src/lib/chat-history.ts');const r=m.localChatRepository(crypto.randomUUID());let checks=0;for(let i=0;i<1000;i++){const initial=await r.save({...m.newChat('qa-stress'),title:'Cycle '+i,named:true});const updated=await r.save({...initial,pinned:true,section:'Client selects',unread:true});try{await r.remove(updated.id,'other-shoot',updated.revision);throw Error('wrong shoot delete accepted')}catch(e){if(!String(e).includes('another tab'))throw e;checks++}try{await r.remove(updated.id,updated.project,initial.revision);throw Error('stale delete accepted')}catch(e){if(!String(e).includes('another tab'))throw e;checks++}const read=await r.read(updated.id);if(!read.pinned||read.section!=='Client selects'||!read.unread)throw Error('metadata lost');checks++;await r.remove(updated.id,updated.project,updated.revision);try{await r.save(updated);throw Error('deleted record resurrected')}catch(e){if(!String(e).includes('another tab'))throw e;checks++}}return {cycles:1000,checks,remaining:(await r.list('qa-stress')).length}})()`,
  );
  check(
    "1,000 real IndexedDB cycles: scope, stale revisions, metadata and no resurrection",
    result.cycles === 1000 && result.checks === 4000 && result.remaining === 0,
  );
  writeFileSync(`${root}/storage-stress.json`, JSON.stringify(result, null, 2));
}
if (phase === "appearance") {
  load("/settings/general");
  run("wait", ".settings-shell");
  choice("Appearance", "Light");
  check("General switches to Light", js("!document.documentElement.classList.contains('dark')"));
  choice("Appearance", "Dark");
  choice("Contrast", "More");
  check("Contrast preference applies", js("document.documentElement.dataset.contrast==='more'"));
  for (const color of ["Default", "Blue", "Green", "Yellow", "Pink", "Orange", "Purple", "White"]) {
    choice("Accent color", color);
    check(
      `${color} preset saves`,
      js(
        `document.querySelector('[aria-label="Accent color"]').textContent===${JSON.stringify(color)}`,
      ),
    );
  }
  run("fill", '[aria-label="Custom accent hex"]', "ef88bb");
  run("click", '.settings-hex-form button:has-text("Apply")');
  check(
    "Bare custom hex applies",
    js("document.documentElement.style.getPropertyValue('--ll-settings-accent')==='#ef88bb'"),
  );
  run("fill", '[aria-label="Custom accent hex"]', "#111111");
  run("click", '.settings-hex-form button:has-text("Apply")');
  check(
    "Unreadable accent rejected without changing prior selection",
    js(
      "document.documentElement.style.getPropertyValue('--ll-settings-accent')==='#ef88bb'&&!!document.querySelector('.settings-content [role=alert]')",
    ),
  );
  run("fill", '[aria-label="Custom accent hex"]', "#ef88bb");
  run("click", '.settings-hex-form button:has-text("Apply")');
  choice("Accent style", "Gradient");
  run("fill", '[aria-label="Gradient end hex"]', "#88bbff");
  run("click", '.settings-hex-form:has([aria-label="Gradient end hex"]) button');
  if (
    js(
      "document.querySelector('[aria-label=\"Workspace grid\"]').getAttribute('aria-checked')!=='true'",
    )
  )
    run("click", '[aria-label="Workspace grid"]');
  check(
    "Gradient and grid set bounded rendering values",
    js(
      "document.documentElement.style.getPropertyValue('--ll-accent-gradient').includes('#88bbff')&&document.documentElement.dataset.workspaceGrid==='true'",
    ),
  );
  run("reload");
  run("wait", ".settings-shell");
  check(
    "Appearance survives reload",
    js(
      "document.documentElement.dataset.contrast==='more'&&document.documentElement.dataset.workspaceGrid==='true'&&document.documentElement.style.getPropertyValue('--ll-settings-accent')==='#ef88bb'",
    ),
  );
  choice("Language", "Español");
  check(
    "Spanish changes navigation and row labels",
    js(
      "document.querySelector('[data-section=appearance]').textContent==='Apariencia'&&document.querySelector('#setting-language h3').textContent==='Idioma'&&document.documentElement.lang==='es'",
    ),
  );
  run("reload");
  run("wait", ".settings-shell");
  check(
    "Spanish survives reload",
    js("document.querySelector('[data-section=profile]').textContent==='Perfil'"),
  );
  choice("Language", "English");
  choice("Default file open destination", "Adobe");
  run("click", 'button:has-text("Open shoot files")');
  run("wait", ".ll-chat-dialog");
  check(
    "Adobe destination opens current-shoot export confirmation",
    js("document.querySelector('.ll-chat-dialog h2').textContent==='Export this shoot to Adobe'"),
  );
  run("press", "Escape");
  run("click", "[data-section=shortcuts]");
  run("wait", '[aria-label="Search keyboard shortcuts"]');
  run("click", '[aria-label="Edit Toggle pin"]');
  run("click", 'button:has-text("Focus here and press")');
  run("press", "Alt+Shift+9");
  check(
    "Custom shortcut recorder accepts a safe numeric chord",
    waitFor(
      "document.querySelector('[aria-label=\"Edit Toggle pin\"]')?.textContent.includes('9')",
    ),
  );
  run("click", '[aria-label="Remove Toggle pin shortcut"]');
  check(
    "Remove binding produces Unassigned",
    js(
      "document.querySelector('[aria-label=\"Edit Toggle pin\"]').textContent.includes('Unassigned')",
    ),
  );
  run("click", '[aria-label="Reset Toggle pin"]');
  check(
    "Reset restores pin starter binding",
    js("document.querySelector('[aria-label=\"Edit Toggle pin\"]').textContent.includes('p')"),
  );
  run("click", '[aria-label="Edit Toggle pin"]');
  choice("Key combination", "Ctrl + Space");
  check(
    "Conflicting shortcut is rejected",
    js("document.querySelector('[role=alertdialog]').textContent.includes('Already assigned')"),
  );
  run("click", '[role=alertdialog] button:has-text("Cancel")');
  waitFor("!document.querySelector('[role=alertdialog][data-state=open]')");
  js("document.querySelector('.settings-main').scrollTo(0,0)");
  for (const size of ["1440x900", "768x1024", "390x844", "320x740"]) {
    run("viewport", size);
    check(
      `${size}: shortcut controls fit horizontally`,
      js(
        "document.querySelector('.settings-main').scrollWidth<=document.querySelector('.settings-main').clientWidth+1",
      ),
    );
    run("screenshot", `${root}/shortcuts-${size}.png`, "--viewport");
  }
  check("No browser console errors", run("console", "--errors").includes("(no console errors)"));
}
if (phase === "notifications") {
  load("/settings/general");
  run("wait", ".settings-shell");
  js(
    "(window.__qaNotifications=[],window.__qaPermissionRequests=0,Object.defineProperty(window,'Notification',{configurable:true,value:class {static permission='default';static async requestPermission(){window.__qaPermissionRequests++;return this.permission='granted';}constructor(title,options){window.__qaNotifications.push({title,options});}close(){}}}),window.dispatchEvent(new Event('focus')))",
  );
  check("Permission is not requested on load", js("window.__qaPermissionRequests===0"));
  run("click", 'button:has-text("Allow notifications")');
  check(
    "Explicit permission button requests once",
    waitFor(
      "window.__qaPermissionRequests===1&&document.querySelector('#setting-browser-permission').textContent.includes('Allowed')",
    ),
  );
  if (
    js(
      "document.querySelector('[aria-label=\"Desktop notifications\"]').getAttribute('aria-checked')!=='true'",
    )
  )
    run("click", '[aria-label="Desktop notifications"]');
  run("click", "#setting-preview-notification button");
  check(
    "Notification preview uses generic system notification",
    js(
      "window.__qaNotifications.length===1&&window.__qaNotifications[0].title==='LensLabs'&&window.__qaNotifications[0].options.silent===true&&!JSON.stringify(window.__qaNotifications).includes('PRIVATE_')",
    ),
  );
  js("(Notification.permission='denied',window.dispatchEvent(new Event('focus')))");
  run("click", "#setting-preview-notification button");
  check(
    "Denied permission falls back to in-app alert",
    waitFor(
      "!!document.querySelector('.workspace-notification')&&document.querySelector('#setting-browser-permission').textContent.includes('Blocked')&&window.__qaNotifications.length===1",
    ),
  );
  run("click", '[aria-label="Dismiss notification"]');
  choice("Show notifications", "Never");
  check(
    "Never suppresses automatic notifications",
    asyncJs(
      "(async()=>{const m=await import('/src/lib/workspace-notifications.ts');return m.notifyResponseReady({completionNotifications:'off',desktopNotifications:true})==='off'&&!document.querySelector('.workspace-notification')})()",
    ),
  );
  check(
    "Background push limit is explicit",
    js(
      "document.querySelector('#setting-desktop-notifications').textContent.includes('after closing the app is not connected')",
    ),
  );
  run("reload");
  run("wait", ".settings-shell");
  check(
    "Notification policy persists and test API replacements are gone",
    js(
      "document.querySelector('[aria-label=\"Show notifications\"]').textContent==='Never'&&window.__qaNotifications===undefined",
    ),
  );
  check("No console errors", run("console", "--errors").includes("(no console errors)"));
}
if (phase === "sharing") {
  load("/workspace");
  ready();
  const id = asyncJs(
    `(async()=>{const m=await import('/src/lib/chat-history.ts');return (await m.localChatRepository('device-local').save({...m.newChat('${shoot}'),title:'QA Share lifecycle',named:true,messages:[{role:'user',text:'Our cover choice.'},{role:'assistant',text:'Frame two.',tools:[{name:'mail',result:'PRIVATE_QA_TOOL'}]}],draft:'PRIVATE_QA_DRAFT'})).id})()`,
  );
  run("reload");
  run("wait", `[data-chat-id="${id}"]`);
  ready();
  run(
    "js",
    `(window.__qaShareMode='unsupported',window.__qaShares=[],Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>window.__qaShareMode!=='unsupported'}),Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{if(window.__qaShareMode==='cancel')throw new DOMException('Canceled','AbortError');if(window.__qaShareMode==='pending')await new Promise(resolve=>window.__qaResolveShare=resolve);window.__qaShares.push({title:data.title,text:await data.files[0].text(),type:data.files[0].type});}}),true)`,
  );
  waitFor("window.__qaShares?.length===0&&typeof navigator.share==='function'");
  const menu = () => run("click", `[data-chat-id="${id}"] [aria-label^="More options"]`);
  const share = () => {
    menu();
    run("click", '[role=menuitem]:has-text("Share with client")');
    run("wait", ".ll-transcript-preview article:first-of-type");
  };
  share();
  run("click", '.ll-chat-dialog button:has-text("Share file…")');
  check(
    "Unsupported native file sharing leaves a working download fallback",
    waitFor(
      "document.querySelector('.ll-chat-note')?.textContent.includes('Download the transcript')&&!document.querySelector('.ll-chat-dialog button').disabled&&window.__qaShares.length===0",
    ),
  );
  js("window.__qaShareMode='cancel'");
  run("click", '.ll-chat-dialog button:has-text("Share file…")');
  check(
    "Cancel native share never reports success",
    waitFor(
      "![...document.querySelectorAll('.ll-chat-dialog button')].some(b=>b.disabled)&&!document.querySelector('.ll-chat-note')&&window.__qaShares.length===0",
    ),
  );
  js("window.__qaShareMode='success'");
  run("click", '.ll-chat-dialog button:has-text("Share file…")');
  check(
    "Native share receives the real safe transcript file",
    waitFor(
      "window.__qaShares.length===1&&window.__qaShares[0].text.includes('Our cover choice')&&!window.__qaShares[0].text.includes('PRIVATE_QA_')&&window.__qaShares[0].type==='text/html'",
    ),
  );
  check(
    "Share success is shown only after completion",
    waitFor("document.querySelector('.ll-chat-note')?.textContent==='Shared through your device.'"),
  );
  js("window.__qaShareMode='pending'");
  run("click", '.ll-chat-dialog button:has-text("Share file…")');
  run("press", "Escape");
  waitFor("!document.querySelector('.ll-chat-dialog')");
  check(
    "Closing a pending share restores row keyboard focus",
    js(
      `document.activeElement?.getAttribute('aria-label')==='More options for QA Share lifecycle'`,
    ),
  );
  menu();
  run("click", '[role=menuitem]:has-text("Rename")');
  js("(window.__qaResolveShare(),true)");
  waitFor("window.__qaShares.length===2");
  check(
    "Late native share completion cannot overwrite another dialog",
    js(
      "document.querySelector('.ll-chat-dialog h2').textContent==='Rename chat'&&!document.querySelector('.ll-chat-note')",
    ),
  );
  run("press", "Escape");
  run("reload");
  run("wait", `[data-chat-id="${id}"]`);
  check("Test share hooks disappear after reload", js("window.__qaShares===undefined"));
  check("No browser console errors", !run("console", "--errors").includes("[error]"));
}
if (phase === "adobe") {
  const exportShoot = crypto.randomUUID();
  run("goto", `${origin}/studio?shoot=${exportShoot}`);
  run("wait", ".workbench-body");
  ready();
  waitFor(
    "!!document.querySelector('[data-workbench-tool=\"studio\"] input[type=file]:not([webkitdirectory])')",
  );
  check(
    "Synthetic photo enters the real import input",
    asyncJs(`(async()=>{
      const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
      const c=canvas.getContext('2d');for(let i=0;i<128;i++){c.fillStyle=i%8<4?'#4a88cc':'#edbc88';c.fillRect(i,0,1,128);}
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      window.__qaOriginal=new File([blob],'qa-artificial-frame.png',{type:'image/png',lastModified:123456789});
      window.__qaOriginalHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await window.__qaOriginal.arrayBuffer()))).join(',');
      const dt=new DataTransfer();dt.items.add(window.__qaOriginal);
      const input=document.querySelector('[data-workbench-tool="studio"] input[type=file]:not([webkitdirectory])');
      input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;
    })()`),
  );
  run("wait", '[aria-label^="qa-artificial-frame.png"]');
  waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent==='Discard')");
  run("click", 'button:text-is("Discard")');
  ready();
  run("click", 'button:text-is("Keep · K")');
  check(
    "Keep decision reaches the photo",
    waitFor(
      "document.querySelector('[aria-label^=\"qa-artificial-frame.png\"]').getAttribute('aria-label').includes('keep')",
    ),
  );
  asyncJs(`(async()=>{
    const {studioDatabaseKey}=await import('/src/lib/studio/shoot-directory.ts');
    window.__qaReadPhotos=()=>new Promise((resolve,reject)=>{
      const req=indexedDB.open(studioDatabaseKey('device-local','${exportShoot}'));
      req.onsuccess=()=>{const db=req.result,tx=db.transaction('shots','readonly'),r=tx.objectStore('shots').getAll();
        r.onsuccess=()=>resolve(r.result.map(({previewBlob,...shot})=>({...shot,previewSize:previewBlob?.size})));tx.oncomplete=()=>db.close();};req.onerror=()=>reject(req.error);
    });
    return true;
  })()`);
  let photos;
  for (let i = 0; i < 60; i++) {
    photos = asyncJs("window.__qaReadPhotos()");
    if (photos.length === 1 && photos[0].verdict === "keep") break;
  }
  check("Photo decision is durably saved", photos?.length === 1 && photos[0].verdict === "keep");
  js(
    "(window.__qaZip=null,window.__qaCreateURL=URL.createObjectURL,URL.createObjectURL=blob=>{if(blob.type==='application/zip')blob.arrayBuffer().then(bytes=>window.__qaZip=Array.from(new Uint8Array(bytes)));return window.__qaCreateURL(blob)})",
  );
  run("click", '.ll-chat-row.is-active [aria-label^="More options"]');
  run("click", '[role=menuitem]:has-text("Adobe export")');
  run("click", '.ll-chat-dialog button:has-text("Download Adobe sidecars")');
  waitFor("window.__qaZip");
  check(
    "Menu downloads a real ZIP, not a fake handoff",
    js(
      "window.__qaZip[0]===80&&window.__qaZip[1]===75&&document.querySelector('.ll-chat-note').textContent.includes('1 sidecar')",
    ),
  );
  const entries = asyncJs(`(async()=>{
    const a=new Uint8Array(window.__qaZip),v=new DataView(a.buffer),decoder=new TextDecoder(),entries=[];
    const {crc32}=await import('/src/lib/zip.ts');let p=0;
    while(v.getUint32(p,true)===0x04034b50){const n=v.getUint16(p+26,true),x=v.getUint16(p+28,true),len=v.getUint32(p+18,true),start=p+30+n+x,data=a.slice(start,start+len);
      entries.push({name:decoder.decode(a.slice(p+30,p+30+n)),text:decoder.decode(data),crcValid:crc32(data)===v.getUint32(p+14,true)});p=start+len;}
    return entries;
  })()`);
  writeFileSync(`${root}/adobe-sidecar.zip`, new Uint8Array(js("window.__qaZip")));
  check(
    "ZIP has a matching XMP filename and valid CRC",
    entries.length === 1 &&
      entries[0].name === "qa-artificial-frame.xmp" &&
      entries.every((e) => e.crcValid),
  );
  check(
    "Adobe XML preserves keep flag without inventing star ratings",
    js(
      `(()=>{const xml=new DOMParser().parseFromString(${JSON.stringify(entries[0].text)},'application/xml'),description=xml.getElementsByTagName('rdf:Description')[0];return !xml.querySelector('parsererror')&&description.getAttribute('crs:Pick')==='1'&&description.getAttribute('xmp:Rating')==='0'})()`,
    ),
  );
  check(
    "Export does not change saved photo metadata",
    JSON.stringify(await asyncJs("window.__qaReadPhotos()")) === JSON.stringify(photos),
  );
  check(
    "Original file bytes remain identical",
    asyncJs(
      "(async()=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await window.__qaOriginal.arrayBuffer()))).join(',')===window.__qaOriginalHash)()",
    ),
  );
  run("press", "Escape");
  run("goto", `${origin}/settings/keyboard-shortcuts?shoot=${exportShoot}`);
  run("wait", '[aria-label="Search keyboard shortcuts"]');
  run("click", '[aria-label="Edit Go to photo"]');
  run("click", 'button:has-text("Focus here and press")');
  run("press", "Alt+Shift+G");
  waitFor("!document.querySelector('[role=alertdialog][data-state=open]')");
  run("click", ".settings-main h1");
  run("press", "Alt+Shift+G");
  run("wait", ".ll-photo-jump");
  run("fill", '[aria-label="Photo number"]', "2");
  run("click", ".ll-photo-jump button");
  check(
    "Photo jump reports out-of-range values",
    waitFor(
      "document.querySelector('.ll-photo-jump [role=alert]')?.textContent.includes('1 to 1')",
    ),
  );
  run("fill", '[aria-label="Photo number"]', "1");
  run("click", ".ll-photo-jump button");
  check(
    "Recorded photo shortcut selects the requested frame",
    waitFor(
      "!document.querySelector('.ll-photo-jump')&&document.querySelector('[aria-label^=\"qa-artificial-frame.png\"]')?.getAttribute('aria-pressed')==='true'",
    ),
  );
  run("screenshot", `${root}/adobe-studio.png`, "--viewport");
  run("reload");
  run("wait", '[aria-label^="qa-artificial-frame.png"]');
  check(
    "Photo and keep decision survive reload after export",
    js(
      "document.querySelector('[aria-label^=\"qa-artificial-frame.png\"]').getAttribute('aria-label').includes('keep')",
    ),
  );
  check("No browser console errors", !run("console", "--errors").includes("[error]"));
}
console.log(`${checks.length} browser checks passed for ${phase}.`);
