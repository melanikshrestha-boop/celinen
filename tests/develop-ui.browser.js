// Run with gstack browse eval after opening /develop?shoot=<disposable UUID>.
// Synthetic pictures are generated locally and enter via the actual import handler.
return await (async () => {
  const root = () => document.querySelector('.foto-develop');
  const check = (name, value) => { if (!value) throw new Error(name); checks.push(name); };
  const checks = [];
  const wait = async (predicate, message, ms = 18000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await predicate()) return; await new Promise(r => setTimeout(r, 80)); }
    throw new Error(message);
  };
  const button = (label) => [...root().querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent.trim() === label);
  const click = async (label) => { const b = button(label); if (!b || b.disabled) throw new Error(`Unavailable button: ${label}`); b.click(); await new Promise(r => setTimeout(r, 100)); };
  const number = async (label, value) => {
    const input = root().querySelector(`input[aria-label="${label} value"]`);
    if (!input || input.disabled) throw new Error(`Unavailable control: ${label}`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
    input.dispatchEvent(new Event('input', {bubbles:true}));
    await new Promise(r => setTimeout(r, 60));
    input.dispatchEvent(new FocusEvent('focusout', {bubbles:true}));
    await wait(() => root().querySelector('.develop-save-status')?.textContent === 'All edits saved', 'Edit did not save');
  };
  const readyRender = async () => wait(() => {
    const img = root().querySelector('.develop-image-frame img');
    return !root().querySelector('.develop-render-error') && button('Export') && !button('Export').disabled && img?.complete && img.naturalWidth > 0;
  }, 'Image did not finish rendering');
  const pixels = () => {
    const img = root().querySelector('.develop-image-frame img');
    const c = document.createElement('canvas'); c.width=32;c.height=32;
    c.getContext('2d').drawImage(img,0,0,32,32);
    return Array.from(c.getContext('2d').getImageData(0,0,32,32).data).reduce((sum,n)=>sum+n,0);
  };
  check('only a dedicated disposable test route is used', location.pathname === '/develop' && /^eeaf3000-1111-4222-8333-0000000000/.test(new URL(location.href).searchParams.get('shoot') || ''));
  await wait(root, 'Develop did not mount');
  if (!root().querySelector('.develop-filmstrip-items button')) {
    const transfer = new DataTransfer();
    for (let n=0;n<2;n++) {
      const c=document.createElement('canvas');c.width=640;c.height=480;const ctx=c.getContext('2d');
      const g=ctx.createLinearGradient(0,0,640,480);g.addColorStop(0,n?'#523b2d':'#32525f');g.addColorStop(1,n?'#ead3ad':'#b9c5ac');ctx.fillStyle=g;ctx.fillRect(0,0,640,480);
      ctx.fillStyle='#bf7760';ctx.fillRect(180,150,180,140);
      const blob=await new Promise(r=>c.toBlob(r,'image/png'));transfer.items.add(new File([blob],`develop-qa-${n}.png`,{type:'image/png'}));
    }
    const input=root().querySelector('input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  }
  await wait(()=>root().querySelectorAll('.develop-filmstrip-items button').length>=2,'Import did not persist two photos');
  await readyRender(); check('import completes and a real native image appears', root().querySelector('.develop-image-frame img').naturalWidth>0);
  await click('Dismiss message').catch(()=>{});
  await click('Reset');await readyRender();const neutral=pixels();
  await number('Exposure',1);await readyRender();const brighter=pixels();
  check('exposure control changes rendered pixels', brighter>neutral);
  check('one exposure edit creates history', root().querySelector('.develop-history').textContent.includes('Exposure'));
  await click('Undo');await readyRender();check('undo restores exposure', root().querySelector('input[aria-label="Exposure value"]').value==='0');
  await click('Redo');await readyRender();check('redo restores exposure', root().querySelector('input[aria-label="Exposure value"]').value==='1');
  await click('Before');await new Promise(r=>setTimeout(r,100));check('Before shows original without changing settings', pixels() < brighter && root().querySelector('input[aria-label="Exposure value"]').value==='1');await click('Before');
  await click('Copy');
  await click('Next photograph');await readyRender();check('per-photo settings stay isolated',root().querySelector('input[aria-label="Exposure value"]').value==='0');
  await click('Paste');await readyRender();check('paste transfers recipe',root().querySelector('input[aria-label="Exposure value"]').value==='1');
  await click('Rate 4 stars');check('rating control updates',button('Rate 4 stars').getAttribute('aria-pressed')==='true');
  await click('Crop tool');
  const aspect=root().querySelector('select[aria-label="Crop aspect"]');aspect.value='1:1';aspect.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,100));
  await click('Done cropping');await readyRender();const crop=root().querySelector('.develop-image-frame img');check('square crop reaches native output',Math.abs(crop.naturalWidth-crop.naturalHeight)<=1);
  await click('Reset');await readyRender();
  await click('Mask tool');await click('Radial');await number('Mask exposure',1);await click('Done masking');await readyRender();
  check('manual mask is saved in history',root().querySelector('.develop-history').textContent.includes('Mask exposure'));
  await click('Reset');await readyRender();
  await click('Warm negative');await readyRender();check('preset updates actual control values',root().querySelector('input[aria-label="Temp value"]').value==='14');
  await click('Export');check('export dialog is real and includes sizing',root().querySelector('[role=dialog]')?.textContent.includes('Long edge'));
  const anchorClick = HTMLAnchorElement.prototype.click;
  const createObjectURL = URL.createObjectURL;
  const blobs = new Map();
  let exported = null;
  try {
    URL.createObjectURL = function(blob) { const url = createObjectURL.call(URL, blob); blobs.set(url, blob); return url; };
    HTMLAnchorElement.prototype.click = function () {
      if (this.download.endsWith('-foto.jpg') && this.href.startsWith('blob:')) {
        exported = blobs.get(this.href);
        return;
      }
      return anchorClick.call(this);
    };
    await click('Export JPEG');
    await wait(() => exported && !root().querySelector('[role=dialog]'), 'Native export did not finish');
    const jpeg = await exported;
    const bytes = new Uint8Array(await jpeg.arrayBuffer());
    const bitmap = await createImageBitmap(jpeg);
    check('export handler produces a decodable JPEG without upscaling the original', bytes[0] === 255 && bytes[1] === 216 && bitmap.width === 640 && bitmap.height === 480);
    bitmap.close();
  } finally {
    HTMLAnchorElement.prototype.click = anchorClick;
    URL.createObjectURL = createObjectURL;
  }
  const fillName = async (value) => {
    const input = root().querySelector('[role=dialog] input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', {bubbles:true}));
    await new Promise(r => setTimeout(r, 80));
  };
  const suffix = Date.now();
  await click('Create preset');await fillName(`QA warm ${suffix}`);await click('Save');
  await wait(() => !root().querySelector('[role=dialog]'), 'Preset did not finish saving');
  check('named preset appears after a successful save', Boolean(button(`QA warm ${suffix}`)));
  [...root().querySelectorAll('summary')].find(el => el.textContent.includes('Snapshots')).parentElement.open = true;
  await click('New snapshot');await fillName(`QA snapshot ${suffix}`);await click('Save');
  await wait(() => !root().querySelector('[role=dialog]'), 'Snapshot did not finish saving');
  await number('Temp', -12);await click(`QA snapshot ${suffix}`);await readyRender();
  check('saved snapshot restores actual settings', root().querySelector('input[aria-label="Temp value"]').value === '14');
  sessionStorage.setItem('foto-develop-qa-reload', JSON.stringify({route:location.href, name:root().querySelector('.develop-filmstrip-items .is-active')?.getAttribute('aria-label'), preset:`QA warm ${suffix}`, snapshot:`QA snapshot ${suffix}`, temperature:'14', rating:'true'}));
  check('no render error remains',!root().querySelector('.develop-render-error'));
  return {passed:checks.length,checks,note:'DOM-driven integration checks using synthetic disposable photos; captures the actual export download Blob. Separate native tests validate RAW bytes; this does not certify all camera models or full Lightroom parity.'};
})()
