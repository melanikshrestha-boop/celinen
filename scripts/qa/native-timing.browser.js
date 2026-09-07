/** Three real JPEG fixtures, repeated requests: not a 3,000-photo or accuracy benchmark. */
if (!["localhost", "127.0.0.1"].includes(location.hostname)) throw new Error("Local QA only");
const native = await import("/src/lib/studio/native-client.ts");
const names = ["basketball-action-usaf-pd.jpg", "basketball-hangar-usnavy-pd.jpg", "volleyball-portrait-cc0.jpg"];
const files = await Promise.all(names.map(async name => new File([await (await fetch("/tests/fixtures/photos/" + name)).blob()], name, {type:"image/jpeg"})));
const rounds = [];
for (let round = 0; round < 3; round++) {
  const start = performance.now();
  const results = await Promise.all(files.map(async file => {
    const begin = performance.now();
    const result = await native.analyseFileNative(file);
    if (!result) throw new Error("Native engine unavailable; no fallback benchmark allowed");
    return {name:file.name,elapsedMs:performance.now()-begin,cached:result.nativeCached,width:result.width,height:result.height};
  }));
  rounds.push({round,elapsedMs:performance.now()-start,results});
}
return {fixtureBytes:files.reduce((sum,file)=>sum+file.size,0),uniquePhotos:files.length,rounds};
