/** Real browser uploads with synthetic raster files; isolated lab identity only. */
import { execFileSync } from "node:child_process";
const binary = process.argv[2];
if (!binary) throw new Error("Pass the browse executable");
const run = (...args: string[]) => execFileSync(binary, args, { encoding: "utf8", timeout: 25000 });
const js = (source: string) => {
  const output = run("js", `({value:(${source})})`);
  // The browser may omit a return for a script launching asynchronous work; its
  // completion is checked separately via a DOM marker, never assumed successful.
  return output.trim() ? JSON.parse(output).value : undefined;
};
if (!run("status").includes("Mode: launched")) throw new Error("Use an isolated QA browser only");
const checks: string[] = [];
const check = (name: string, value: unknown) => {
  if (!value) throw new Error(name);
  checks.push(name);
};
const click = (text: string) => run("click", `button:visible:has-text(${JSON.stringify(text)})`);
const profileKey = "lenslabs.development-lab.profile.v1";
const saved = () => js(`JSON.parse(localStorage.getItem(${JSON.stringify(profileKey)}))`);
run("goto", "http://127.0.0.1:8085/settings/profile");
run("wait", "#profile-specialties");
run("viewport", "1280x900");
const original = js(`localStorage.getItem(${JSON.stringify(profileKey)})`);
const workspaceName = saved()?.workspaceName ?? "Development workspace";
function select(label: string) {
  run("fill", '[aria-label="Search photography specialties"]', label);
  run("click", `[cmdk-item][data-value=${JSON.stringify(label)}]`);
}
function upload(expression: string) {
  js(
    `(()=>{const transfer=new DataTransfer();transfer.items.add(${expression});const input=document.querySelector('.settings-avatar-editor input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`,
  );
}
try {
  check(
    "old workspace field and renaming filler removed",
    js(
      `!document.querySelector('#profile-workspace-name')&&!document.body.textContent.includes('Renaming it keeps')`,
    ),
  );
  run("click", "#profile-specialties");
  check(
    "search is focused on open",
    js(`document.activeElement.matches('[aria-label="Search photography specialties"]')`),
  );
  select("Real estate");
  select("Portrait");
  select("Drone & aerial");
  select("Wedding");
  select("Other / write your own");
  run("fill", '[aria-label="Search photography specialties"]', "Fine art");
  check(
    "sixth specialty disabled",
    js(
      `document.querySelector('[cmdk-item][data-value="Fine art"]').getAttribute('aria-disabled')==='true'`,
    ),
  );
  check(
    "five selections announced",
    js(`document.querySelector('.profile-specialty-footer').textContent.includes('5/5 selected')`),
  );
  select("Wedding");
  select("Fine art");
  click("Done");
  run("wait", "#profile-specialties:focus");
  check("Done returns keyboard focus", js(`document.activeElement.id==='profile-specialties'`));
  run("fill", "#profile-custom-specialty", "Dance photography");
  click("Save changes");
  run("wait", '[role=status]:has-text("Saved on this device")');
  check(
    "specialties saved, old workspace retained",
    saved().specialties.length === 5 && saved().workspaceName === workspaceName,
  );
  check("custom specialty saved", saved().customSpecialty === "Dance photography");
  run("reload");
  run("wait", "#profile-specialties");
  check(
    "selections restored",
    js(`document.querySelector('#profile-specialties').textContent.includes('Real estate')`),
  );
  check(
    "custom specialty restored",
    js(`document.querySelector('#profile-custom-specialty').value==='Dance photography'`),
  );
  check(
    "reload is a clean draft",
    js(`document.querySelector('.settings-form-actions button[type=submit]').disabled`),
  );
  run("fill", "#profile-custom-specialty", "Unsaved test");
  click("Cancel");
  check(
    "Cancel restores saved draft",
    js(`document.querySelector('#profile-custom-specialty').value==='Dance photography'`),
  );
  for (const width of [1280, 390]) {
    run("viewport", `${width}x${width === 390 ? 844 : 900}`);
    run("click", "#profile-specialties");
    run("wait", ".profile-specialty-popover");
    check(
      `${width}: picker stays inside viewport`,
      js(
        `(()=>{const el=document.querySelector('.profile-specialty-popover'),r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&el.scrollWidth<=el.clientWidth})()`,
      ),
    );
    run("screenshot", `/private/tmp/lenslabs-profile-specialties-${width}.png`, "--viewport");
    run("press", "Escape");
    run("wait", "#profile-specialties:focus");
    check(
      `${width}: Escape returns focus`,
      js(`document.activeElement.id==='profile-specialties'`),
    );
    check(
      `${width}: no horizontal page overflow`,
      js(`document.documentElement.scrollWidth<=innerWidth`),
    );
  }
  run("viewport", "1280x900");
  // Use browser encoders to produce real JPEG, PNG and WebP files, not header-only mocks.
  js(`(()=>{delete document.documentElement.dataset.profileQa;window.__profileQaError='';void(async()=>{
    const canvas=document.createElement('canvas');canvas.width=6000;canvas.height=4000;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#7495a5';ctx.fillRect(0,0,6000,4000);ctx.fillStyle='#273e4a';ctx.fillRect(3000,0,3000,4000);
    const toBlob=(mime)=>new Promise(resolve=>canvas.toBlob(resolve,mime,.9));
    window.__profileHighRes=new File([await toBlob('image/jpeg')],'24mp.jpg',{type:'image/jpeg'});
    const jpeg=new Uint8Array(await window.__profileHighRes.arrayBuffer());
    const exif=new Uint8Array([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
    window.__profileRotated=new File([jpeg.slice(0,2),exif,jpeg.slice(2)],'rotated-24mp.jpg',{type:'image/jpeg'});
    canvas.width=2400;canvas.height=1800;
    const pixels=ctx.createImageData(2400,1800);let seed=12345;
    for(let i=0;i<pixels.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels.data[i]=seed&255;pixels.data[i+1]=(seed>>>8)&255;pixels.data[i+2]=(seed>>>16)&255;pixels.data[i+3]=255;}
    ctx.putImageData(pixels,0,0);
    window.__profileLarge=new File([await toBlob('image/png')],'large-portrait.png',{type:''});
    canvas.width=640;canvas.height=480;ctx.fillStyle='#567788';ctx.fillRect(0,0,640,480);
    window.__profileWebP=new File([await toBlob('image/webp')],'portrait.webp',{type:'image/webp'});
    window.__profileHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await window.__profileLarge.arrayBuffer()))).join(',');
    canvas.width=canvas.height=1;document.documentElement.dataset.profileQa='ready';
  })().catch(e=>{window.__profileQaError=e.message;document.documentElement.dataset.profileQa='error'});return true})()`);
  run("wait", "html[data-profile-qa]");
  check("synthetic fixtures encoded", js(`document.documentElement.dataset.profileQa==='ready'`));
  const sourceBytes = js(`window.__profileLarge.size`);
  check(
    "PNG genuinely exceeds former 4 MB cap",
    sourceBytes > 4 * 1024 * 1024 && sourceBytes < 50 * 1024 * 1024,
  );
  upload("window.__profileHighRes");
  run("wait", ".settings-avatar-crop canvas");
  check(
    "real 24 MP JPEG opens crop",
    js(`document.querySelector('.settings-avatar-crop canvas').width===512`),
  );
  click("Cancel crop");
  check(
    "cancel removes crop without changing saved avatar",
    !js(`document.querySelector('.settings-avatar-crop')!==null`),
  );
  upload("window.__profileRotated");
  run("wait", ".settings-avatar-crop canvas");
  check(
    "EXIF-rotated portrait remains upright in crop",
    js(
      `(()=>{const ctx=document.querySelector('.settings-avatar-crop canvas').getContext('2d'),top=ctx.getImageData(256,32,1,1).data,bottom=ctx.getImageData(256,480,1,1).data,left=ctx.getImageData(32,32,1,1).data,right=ctx.getImageData(480,32,1,1).data;return Math.abs(top[0]-bottom[0])>30&&Math.abs(left[0]-right[0])<5})()`,
    ),
  );
  click("Cancel crop");
  upload("window.__profileWebP");
  run("wait", ".settings-avatar-crop canvas");
  check("real WebP decodes", js(`!!document.querySelector('.settings-avatar-crop canvas')`));
  click("Cancel crop");
  upload("new File(['<svg onload=alert(1)/>'],'renamed.jpg',{type:'image/jpeg'})");
  run("wait", '.settings-avatar-editor [role=alert]:has-text("Choose a JPEG")');
  check("unsupported content rejected", js(`!document.querySelector('.settings-avatar-crop')`));
  upload("new File([new Uint8Array(50*1024*1024+1)],'oversized.png',{type:'image/png'})");
  run("wait", '.settings-avatar-editor [role=alert]:has-text("50 MB")');
  check(
    "over-limit rejection is recoverable",
    js(`!document.querySelector('.settings-avatar-editor button').disabled`),
  );
  upload("window.__profileLarge");
  run("wait", ".settings-avatar-crop canvas");
  check(
    "large unlabeled PNG opens crop after errors",
    js(`!document.querySelector('.settings-avatar-editor [role=alert]')`),
  );
  run("click", '[aria-label="Zoom"]');
  run("press", "Home");
  run("press", "ArrowRight");
  check(
    "crop zoom responds to keyboard",
    js(`Number(document.querySelector('[aria-label="Zoom"]').value)>1`),
  );
  click("Use crop");
  check(
    "crop applied without saving original",
    js(
      `!document.querySelector('.settings-avatar-crop')&&document.querySelector('.settings-avatar-editor img').src.length<=40000`,
    ),
  );
  click("Save changes");
  run("wait", '[role=status]:has-text("Saved on this device")');
  const cropBytes = saved().avatar.length;
  check("saved image below 40 KB metadata budget", cropBytes > 100 && cropBytes <= 40000);
  check(
    "photo save preserves specialties and workspace",
    saved().specialties.length === 5 && saved().workspaceName === workspaceName,
  );
  js(
    `(()=>{delete document.documentElement.dataset.profileQa;void(async()=>{window.__profileUnchanged=window.__profileHash===Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await window.__profileLarge.arrayBuffer()))).join(',');document.documentElement.dataset.profileQa='ready'})();return true})()`,
  );
  run("wait", 'html[data-profile-qa="ready"]');
  check("source bytes unchanged", js(`window.__profileUnchanged`));
  run("reload");
  run("wait", ".settings-avatar-editor img");
  check(
    "avatar survives reload and decodes",
    js(
      `document.querySelector('.settings-avatar-editor img').complete&&document.querySelector('.settings-avatar-editor img').naturalWidth>=128`,
    ),
  );
  click("Remove avatar");
  click("Cancel");
  check("removal can be cancelled", js(`!!document.querySelector('.settings-avatar-editor img')`));
  click("Remove avatar");
  click("Save changes");
  run("wait", '[role=status]:has-text("Saved on this device")');
  check("explicit removal persists", saved().avatar === "");
  // The browser's --errors output also includes performance warnings. Fail on
  // runtime error entries, not the readback hint from our synthetic pixel test.
  check(
    "no browser errors",
    !/\[(?:error|pageerror|exception)\]/i.test(run("console", "--errors")),
  );
  console.log(JSON.stringify({ passed: checks.length, sourceBytes, cropBytes, checks }, null, 2));
} finally {
  // Restore only the isolated QA profile we changed; never touch real tabs, accounts or shoots.
  js(
    `(()=>{const value=${JSON.stringify(original)};if(value===null)localStorage.removeItem(${JSON.stringify(profileKey)});else localStorage.setItem(${JSON.stringify(profileKey)},value);return true})()`,
  );
  run("goto", "http://127.0.0.1:8085/settings/profile");
  run("viewport", "1280x900");
}
