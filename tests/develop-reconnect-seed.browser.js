// Seed only a reserved disposable library; follow with a real page reload.
return await (async () => {
  const shoot = 'eeaf3000-1111-4222-8333-000000000007';
  if (location.hostname !== '127.0.0.1' || location.port !== '8085' || new URL(location.href).searchParams.get('shoot') !== shoot) throw new Error('Use the reserved reconnect QA route');
  const module = await import('/src/lib/develop/store.ts');
  const {defaultDevelopSettings} = await import('/src/lib/develop/contract.ts');
  const store = module.createDevelopStore({scope:'device-local',libraryId:`shoot:${shoot}`});
  try {
    const canvas = document.createElement('canvas');canvas.width=320;canvas.height=240;
    const context=canvas.getContext('2d');context.fillStyle='#57736c';context.fillRect(0,0,320,240);context.fillStyle='#a28655';context.fillRect(50,50,80,100);
    const file = new File([await new Promise(resolve => canvas.toBlob(resolve,'image/png'))],'reconnect-qa.png',{type:'image/png'});
    const source = await module.developPhotoFromFile(file);
    const stored = await store.loadLibrary();
    if (stored.photos.length) throw new Error('Reconnect QA library must start empty');
    await store.addPhotos([{...source,id:'studio:qa-reconnect',sourceBlob:null,previewBlob:null,sourceDigest:null,initialState:{settings:{...defaultDevelopSettings(),exposure:0.5,temperature:12},metadata:{rating:4,flag:'pick',colorLabel:'green'}}}]);
    const bytes = new Uint8Array(await file.arrayBuffer());
    sessionStorage.setItem('foto-develop-reconnect-file',JSON.stringify({name:file.name,bytes:Array.from(bytes),digest:source.sourceDigest}));
    return {seeded:'One synthetic preview-less Studio photo, 0.5 EV, Temp 12, four stars',next:'Reload the page, then run tests/develop-reconnect.browser.js'};
  } finally {store.close();}
})()
