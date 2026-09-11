return await (async () => {
  const shoot='eeaf3000-1111-4222-8333-000000000007';
  if(location.hostname!=='127.0.0.1'||location.port!=='8085'||new URL(location.href).searchParams.get('shoot')!==shoot) throw new Error('Use the reserved reconnect QA route');
  const fixture=JSON.parse(sessionStorage.getItem('foto-develop-reconnect-file')||'null');
  if(!fixture) throw new Error('Seed the synthetic reconnect fixture first');
  const root=()=>document.querySelector('.foto-develop');
  const checks=[];
  const check=(name,value)=>{if(!value)throw new Error(name);checks.push(name);};
  const wait=async(predicate,message)=>{const end=Date.now()+20000;while(Date.now()<end){if(predicate())return;await new Promise(r=>setTimeout(r,80));}throw new Error(message);};
  const button=(text)=>[...root().querySelectorAll('button')].find(b=>b.textContent.trim()===text||b.getAttribute('aria-label')===text);
  await wait(()=>root()?.querySelector('.develop-filmstrip-items button'),'Missing saved photo');
  check('legacy entry remains selected without a decodable source',root().querySelector('.develop-filmstrip-items .is-active')?.textContent.includes(fixture.name));
  check('source-less photo offers an explicit reconnect action',Boolean(button('Reconnect original')));
  check('source-less photo cannot export or adjust unavailable pixels',button('Export')?.disabled&&root().querySelector('[aria-label="Exposure value"]').matches(':disabled'));
  const attach=async(name)=>{
    button('Reconnect original').click();
    const input=root().querySelector('input[aria-label="Reconnect original file"]');
    if(!input)throw new Error('Reconnect file input missing');
    const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(fixture.bytes)],name,{type:'image/png'}));
    input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,120));
  };
  await attach('wrong-frame.png');
  await wait(()=>root().textContent.includes('Choose the original file named'),'Wrong original was not rejected');
  check('wrong filename is rejected without making the entry exportable',button('Export').disabled);
  await attach(fixture.name);
  await wait(()=>{const image=root().querySelector('.develop-image-frame img');return image?.complete&&image.naturalWidth>0&&!button('Export').disabled;},'Reconnected photo did not become editable');
  check('reconnect does not create a duplicate frame',root().querySelectorAll('.develop-filmstrip-items button').length===1);
  check('reconnect preserves exposure, temperature and rating',root().querySelector('[aria-label="Exposure value"]').value==='0.5'&&root().querySelector('[aria-label="Temp value"]').value==='12'&&button('Rate 4 stars').getAttribute('aria-pressed')==='true');
  const module=await import('/src/lib/develop/store.ts');
  const store=module.createDevelopStore({scope:'device-local',libraryId:`shoot:${shoot}`});
  try {
    const library=await store.loadLibrary(),photo=library.photos[0],doc=library.documents[photo.id];
    check('actual original bytes are attached to the same Studio ID',photo.id==='studio:qa-reconnect'&&photo.sourceAvailable&&photo.sourceDigest===fixture.digest&&Array.from(new Uint8Array(await photo.sourceBlob.arrayBuffer())).join(',')===fixture.bytes.join(','));
    check('saved history is not reset by reconnection',doc.history.length===2&&module.currentRecipe(doc).exposure===0.5);
  } finally {store.close();}
  return {passed:checks.length,checks,note:'Synthetic original attached via real React file-change handler; no customer photo records modified.'};
})()
