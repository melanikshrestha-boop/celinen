// Explicit read-only owner test. Never discovers a folder or activates V2 itself.
import {createHash} from 'node:crypto';
import {open,readdir,realpath,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,relative,join,dirname,basename} from 'node:path';
const args=process.argv.slice(2),arg=k=>args.includes(k)?args[args.indexOf(k)+1]:undefined;
const source=arg('--source'),shoot=arg('--shoot'),output=arg('--report');
const token=process.env.LENSLAB_OWNER_ACCESS_TOKEN;
if(!source || !output || !/^[a-f0-9-]{36}$/.test(shoot??'') || !token || !args.includes('--send'))
  throw Error('Require --source DIRECTORY --shoot UUID --report NEW_FILE --send and private LENSLAB_OWNER_ACCESS_TOKEN environment');
const root=await realpath(source),report=join(await realpath(dirname(resolve(output))),basename(output)),rel=relative(root,report);
if(!(rel==='..'||rel.startsWith('../'))) throw Error('Report must be outside the source directory');
const origin='https://lenslab.dev/api/native/v2';
const auth={Authorization:'Bearer '+token};
const healthStart=performance.now();
const health=await fetch(origin,{headers:auth,signal:AbortSignal.timeout(35000)});
const state=await health.json();
const healthMs=performance.now()-healthStart;
if(!health.ok || state.enabled!==true || state.native?.architecture!=='linux-amd64')
  throw Error('Authenticated owner/native activation is not verified; no corpus uploaded');
async function* files(directory){
  for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    if(entry.isSymbolicLink()) continue;
    const path=join(directory,entry.name);
    if(entry.isDirectory()) yield* files(path);else if(entry.isFile()) yield path;
  }
}
async function read(path,collect){
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const info=await file.stat();if(!info.isFile()) throw Error('source_not_regular');
    const hash=createHash('sha256'),chunks=[];let size=0;
    for await(const chunk of file.createReadStream({autoClose:false})){
      hash.update(chunk);size+=chunk.length;
      if(collect&&size<=64*1024*1024) chunks.push(chunk);
    }
    return {sha:hash.digest('hex'),size,data:collect&&size<=64*1024*1024?Buffer.concat(chunks):null};
  }finally{await file.close();}
}
const rows=[],start=performance.now();let previous=0,first=null,networkBytes=0;
for await(const path of files(root)){
  const before=await read(path,true),detected=performance.now(),row={source_sha256:before.sha,bytes:before.size};
  if(!before.data || !before.size){row.code='file_size_not_supported';row.supported=false;}
  else{
    await new Promise(r=>setTimeout(r,Math.max(0,2100-(performance.now()-previous))));previous=performance.now();
    let result;
    try{
      const response=await fetch(origin,{method:'POST',headers:{...auth,'Content-Type':'application/octet-stream',
        'X-Shoot-Id':shoot,'X-Source-Sha256':before.sha},body:before.data,signal:AbortSignal.timeout(90000)});
      networkBytes+=before.size;result=await response.json();
      Object.assign(row,{http_status:response.status,code:result.code??result.status,supported:response.ok,
        job_id:response.headers.get('X-Job-Id'),canonical:result.canonical,stages:result.stages,architecture:result.architecture,
        native_ms:Number(response.headers.get('X-Processing-Ms'))||null,peak_memory_kib:Number(response.headers.get('X-Peak-Memory-KiB'))||null});
      if(response.ok){
        if(result.decoder_domain!=='sports-canonical-rgba256-v2'||result.customer_authority!==false||result.source!==before.sha||
          result.architecture!=='linux-amd64'||createHash('sha256').update(Buffer.from(result.image.data,'base64')).digest('hex')!==result.canonical)
          throw Error('invalid_native_provenance');
        if(first===null) first=performance.now()-start;
      }
    }catch(error){row.code=error instanceof Error&&error.message==='invalid_native_provenance'?'invalid_native_provenance':'request_failed';row.supported=false;}
  }
  const after=await read(path,false);row.after_sha256=after.sha;row.source_preserved=before.sha===after.sha;
  row.wall_ms=performance.now()-detected;rows.push(row);
  if(!row.source_preserved || row.code==='invalid_native_provenance') break;
}
const elapsed=performance.now()-start;
await writeFile(report,JSON.stringify({schema:1,decoder_domain:'sports-canonical-rgba256-v2',rows,
  files:rows.length,completed:rows.filter(r=>r.supported).length,total_ms:elapsed,images_per_second:rows.length/(elapsed/1000),
  time_to_first_result_ms:first,network_source_bytes:networkBytes,admission_spacing_ms:2100,
  source_preserved:rows.every(r=>r.source_preserved),mac_linux_equality:'not_measured',v1_comparison:'not_measured',
  sports_accuracy:'not_measured',initial_health_ms:healthMs,cold_start:'unknown_health_check_warms_container'},null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({files:rows.length,completed:rows.filter(r=>r.supported).length,source_preserved:rows.every(r=>r.source_preserved)}));
if(rows.some(r=>!r.source_preserved||r.code==='invalid_native_provenance')) process.exitCode=1;
